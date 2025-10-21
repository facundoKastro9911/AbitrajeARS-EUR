// index.js
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Configuración fija (lo que acordamos)
const ASSETS = ["USDT", "BTC", "ETH", "BNB", "SOL"];
// Priorizo SEPA INSTANT arriba; igual filtramos por cualquiera de estos 4
const DESIRED_PAYTYPES = ["SEPA INSTANT", "SEPA", "Wise", "Skrill"];

// Normalizador de nombres de métodos (p. ej. "SEPAInstant" => "SEPA INSTANT")
function normalizePayTypeName(s) {
  if (!s) return "";
  const raw = String(s).trim().toUpperCase().replace(/[\s_-]+/g, "");
  if (raw === "SEPAINSTANT") return "SEPA INSTANT";
  if (raw === "SEPA") return "SEPA";
  if (raw === "WISE" || raw === "WISETRANSFER") return "Wise";
  if (raw === "SKRILL") return "Skrill";
  return s; // devolver tal cual si no coincide
}

// extrae lista de paytypes de un anuncio (según estructura que devuelva Binance)
function extractPayTypes(entry) {
  // Algunos payloads traen r.payTypes (array de strings)
  // Otros traen r.adv.tradeMethods = [{ payType: "Wise", ... }]
  const fromFriendly = Array.isArray(entry?.payTypes) ? entry.payTypes : [];
  const fromTradeMethods = Array.isArray(entry?.adv?.tradeMethods)
    ? entry.adv.tradeMethods.map(tm => tm?.payType).filter(Boolean)
    : [];

  const merged = [...fromFriendly, ...fromTradeMethods].map(normalizePayTypeName);
  // Unificar y limpiar
  return Array.from(new Set(merged)).filter(Boolean);
}

// devuelve el primer método que coincida con nuestras prioridades
function pickDesiredPayType(payTypes) {
  for (const desired of DESIRED_PAYTYPES) {
    // comparar normalizando
    const match = payTypes.find(p => normalizePayTypeName(p).toUpperCase() === normalizePayTypeName(desired).toUpperCase());
    if (match) return normalizePayTypeName(match);
  }
  return null;
}

// Cache simple para evitar rate limit
const cache = {};
const CACHE_TTL_MS = 8000;
const getCache = (k) => {
  const it = cache[k];
  if (!it) return null;
  if (Date.now() - it.ts > CACHE_TTL_MS) { delete cache[k]; return null; }
  return it.value;
};
const setCache = (k, v) => { cache[k] = { ts: Date.now(), value: v }; };

// Llamada robusta al endpoint "friendly" de Binance P2P
async function fetchBinanceP2P(asset, fiat = "EUR", tradeType = "BUY") {
  const url = "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search";
  const body = {
    page: 1,
    rows: 40,            // traer suficientes para filtrar
    asset,
    fiat,
    tradeType,           // BUY = compradores (vos vendés)
    publisherType: null
    // No paso payTypes aquí para no perder anuncios; filtro yo después
  };
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (compatible; p2p-eur-proxy/1.0)"
  };

  // Reintentos simples por si hay 429/timeout
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const resp = await axios.post(url, body, { headers, timeout: 8000 });
      return resp.data?.data || [];
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw lastErr || new Error("binance_p2p_request_failed");
}

// calcula la mejor oferta (más cara) para un asset dado, filtrando por métodos deseados
async function bestBuyerForAsset(asset) {
  const cacheKey = `best:${asset}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const entries = await fetchBinanceP2P(asset, "EUR", "BUY");
  // Filtrar por paytypes deseados
  const filtered = entries
    .map(r => {
      const adv = r?.adv || {};
      const advertiser = r?.advertiser || {};
      const payTypes = extractPayTypes(r);
      const chosenPay = pickDesiredPayType(payTypes);

      return {
        asset: adv.asset,
        price: adv.price ? Number(adv.price) : null,
        buyer: advertiser?.nickName || null,
        maxAmount: adv.maxSingleTransAmount ? Number(adv.maxSingleTransAmount) : null,
        payTypes,
        chosenPay
      };
    })
    .filter(x =>
      x.asset &&
      typeof x.price === "number" &&
      x.chosenPay &&                       // debe tener al menos un método válido de nuestra lista
      DESIRED_PAYTYPES.map(normalizePayTypeName).includes(normalizePayTypeName(x.chosenPay))
    );

  if (filtered.length === 0) {
    const result = { asset, price: null, payType: null, buyer: null, maxAmount: null, note: "no_offer_for_desired_methods" };
    setCache(cacheKey, result);
    return result;
  }

  // Para BUY: queremos el que MÁS paga => ordenar desc por precio
  filtered.sort((a, b) => b.price - a.price);
  const top = filtered[0];

  const result = {
    asset: top.asset,
    price: top.price.toString(),          // devuelvo como string para ser consistente con otros proxies
    payType: top.chosenPay,
    buyer: top.buyer,
    maxAmount: top.maxAmount !== null ? top.maxAmount.toString() : null
  };
  setCache(cacheKey, result);
  return result;
}

// pequeña ayuda para espaciar requests y evitar rate-limit
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

app.get('/p2p-eur', async (_req, res) => {
  try {
    const results = [];
    for (let i = 0; i < ASSETS.length; i++) {
      const asset = ASSETS[i];
      const r = await bestBuyerForAsset(asset);
      results.push(r);
      if (i < ASSETS.length - 1) await sleep(180); // escalonar un toque
    }

    // respuesta final
    return res.json({
      ok: true,
      fiat: "EUR",
      tradeType: "BUY",
      payTypes: DESIRED_PAYTYPES,
      results // array con un objeto por asset (solo el más caro)
    });
  } catch (err) {
    console.error("p2p-eur error:", err?.message || err);
    return res.status(502).json({ ok: false, error: "error_querying_binance_p2p", detail: String(err) });
  }
});

app.get('/', (_req, res) => {
  res.send('P2P EUR proxy activo. Usa /p2p-eur');
});

app.listen(PORT, () => {
  console.log(`P2P EUR proxy corriendo en puerto ${PORT}`);
});
