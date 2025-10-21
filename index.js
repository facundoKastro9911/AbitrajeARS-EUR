// index.js
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ========================================
// CONFIGURACIÓN PRINCIPAL
// ========================================
const ASSETS = ["USDT", "BTC", "ETH", "BNB", "SOL"];

// Métodos de pago aceptados y variantes comunes
const DESIRED_PAYTYPES = [
  "SEPA INSTANT",
  "SEPA (EU) INSTANT",
  "SEPAInstant",
  "SEPA (EU) bank transfer",
  "SEPA",
  "Bank Transfer",
  "Wise",
  "WiseTransfer",
  "Skrill"
];

// ========================================
// FUNCIONES AUXILIARES
// ========================================

// Normalizador de nombres de métodos de pago
function normalizePayTypeName(s) {
  if (!s) return "";
  const raw = String(s).trim().toUpperCase().replace(/[\s_\-().]+/g, "");
  if (raw.includes("SEPAINSTANT") || raw.includes("SEPAEUINSTANT")) return "SEPA INSTANT";
  if (raw.includes("SEPAEUBANKTRANSFER") || raw.includes("BANKTRANSFER") || raw.includes("SEPAEU")) return "SEPA (EU) bank transfer";
  if (raw.includes("SEPA")) return "SEPA";
  if (raw.includes("WISE")) return "Wise";
  if (raw.includes("SKRILL")) return "Skrill";
  return s;
}

// Extrae los métodos de pago de cada anuncio
function extractPayTypes(entry) {
  const fromFriendly = Array.isArray(entry?.payTypes) ? entry.payTypes : [];
  const fromTradeMethods = Array.isArray(entry?.adv?.tradeMethods)
    ? entry.adv.tradeMethods.map(tm => tm?.payType).filter(Boolean)
    : [];
  const merged = [...fromFriendly, ...fromTradeMethods].map(normalizePayTypeName);
  return Array.from(new Set(merged)).filter(Boolean);
}

// Devuelve el primer método que coincida con nuestras prioridades
function pickDesiredPayType(payTypes) {
  for (const desired of DESIRED_PAYTYPES) {
    const match = payTypes.find(p => normalizePayTypeName(p).toUpperCase() === normalizePayTypeName(desired).toUpperCase());
    if (match) return normalizePayTypeName(match);
  }
  return null;
}

// ========================================
// CACHE PARA EVITAR RATE LIMIT
// ========================================
const cache = {};
const CACHE_TTL_MS = 8000;
const getCache = (k) => {
  const it = cache[k];
  if (!it) return null;
  if (Date.now() - it.ts > CACHE_TTL_MS) {
    delete cache[k];
    return null;
  }
  return it.value;
};
const setCache = (k, v) => { cache[k] = { ts: Date.now(), value: v }; };

// ========================================
// FUNCIÓN PRINCIPAL: CONSULTA BINANCE P2P
// ========================================
async function fetchBinanceP2P(asset, fiat = "EUR", tradeType = "BUY") {
  const url = "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search";
  const body = {
    page: 1,
    rows: 40,
    asset,
    fiat,
    tradeType, // BUY = compradores (vos vendés)
    publisherType: null
  };
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (compatible; p2p-eur-proxy/1.1)"
  };

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

// ========================================
// PROCESA EL MEJOR COMPRADOR (precio más alto)
// ========================================
async function bestBuyerForAsset(asset) {
  const cacheKey = `best:${asset}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const entries = await fetchBinanceP2P(asset, "EUR", "BUY");

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
      x.chosenPay &&
      DESIRED_PAYTYPES.map(normalizePayTypeName).includes(normalizePayTypeName(x.chosenPay))
    );

  if (filtered.length === 0) {
    const result = { asset, price: null, payType: null, buyer: null, maxAmount: null, note: "no_offer_for_desired_methods" };
    setCache(cacheKey, result);
    return result;
  }

  filtered.sort((a, b) => b.price - a.price); // el que más paga
  const top = filtered[0];

  const result = {
    asset: top.asset,
    price: top.price.toString(),
    payType: top.chosenPay,
    buyer: top.buyer,
    maxAmount: top.maxAmount !== null ? top.maxAmount.toString() : null
  };
  setCache(cacheKey, result);
  return result;
}

// ========================================
// ENDPOINT PRINCIPAL
// ========================================
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

app.get('/p2p-eur', async (_req, res) => {
  try {
    const results = [];
    for (let i = 0; i < ASSETS.length; i++) {
      const asset = ASSETS[i];
      const r = await bestBuyerForAsset(asset);
      results.push(r);
      if (i < ASSETS.length - 1) await sleep(200); // pausa pequeña entre requests
    }

    return res.json({
      ok: true,
      fiat: "EUR",
      tradeType: "BUY",
      payTypes: DESIRED_PAYTYPES,
      results
    });
  } catch (err) {
    console.error("p2p-eur error:", err?.message || err);
    return res.status(502).json({ ok: false, error: "error_querying_binance_p2p", detail: String(err) });
  }
});

// ========================================
// ENDPOINT DE ESTADO
// ========================================
app.get('/', (_req, res) => {
  res.send('P2P EUR proxy activo. Usa /p2p-eur');
});

// ========================================
// INICIO DEL SERVIDOR
// ========================================
app.listen(PORT, () => {
  console.log(`✅ P2P EUR proxy corriendo en puerto ${PORT}`);
});
