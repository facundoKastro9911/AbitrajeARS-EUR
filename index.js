// index.js - Puppeteer + fetch in-page approach
import express from "express";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium-min";

const app = express();
const PORT = process.env.PORT || 8080;

// Configuración fija
const ASSETS = ["USDT", "BTC", "ETH", "BNB", "SOL"];
const DESIRED_PAYTYPES_NORMALIZED = ["SEPA INSTANT","SEPA","WISE","SKRILL","BANK","SEPAINSTANT","SEPA (EU) BANK TRANSFER","SEPA (EU) INSTANT","N26","PAYMENTS","PAYMENT"];

// Cache simple en memoria (evita pedir en cada request)
const cache = {};
const CACHE_TTL_MS = 8_000;
const getCache = (k) => {
  const it = cache[k];
  if (!it) return null;
  if (Date.now() - it.ts > CACHE_TTL_MS) { delete cache[k]; return null; }
  return it.value;
};
const setCache = (k, v) => { cache[k] = { ts: Date.now(), value: v }; };

// helper normalize
function normalizePayTypeName(s) {
  if (!s) return "";
  return String(s).trim().replace(/\s+/g," ").toUpperCase();
}

// Esta función abre un navegador headless, navega a la página pública (para cookies/fingerprints),
// y ejecuta dentro de la página un fetch al endpoint interno de Binance para obtener los anuncios.
async function fetchP2PDataBrowser(asset = "USDT", fiat = "EUR", tradeType = "BUY") {
  const cacheKey = `p2p:${asset}:${fiat}:${tradeType}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  let browser;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    // UserAgent "real"
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

    // Ir a la página pública para obtener cookies y que se ejecute JS
    const publicUrl = `https://p2p.binance.com/en/trade/${asset}?fiat=${fiat}`;
    await page.goto(publicUrl, { waitUntil: "networkidle2", timeout: 30000 });

    // Ejecutamos fetch dentro del navegador — así la petición sale desde un contexto "real"
    const result = await page.evaluate(async (assetArg, fiatArg, tradeTypeArg) => {
      try {
        const url = "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search";
        const body = {
          page: 1,
          rows: 50,
          asset: assetArg,
          fiat: fiatArg,
          tradeType: tradeTypeArg,
          publisherType: null
        };
        const resp = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json;charset=UTF-8",
            "accept": "application/json, text/plain, */*"
          },
          body: JSON.stringify(body),
          credentials: "include"
        });
        const json = await resp.json();
        // devolvemos el array data (o vacío)
        return { ok: true, data: Array.isArray(json?.data) ? json.data : [] };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    }, asset, fiat, tradeType);

    if (!result.ok) {
      setCache(cacheKey, { ok: false, data: [], error: result.error });
      return { ok: false, data: [], error: result.error };
    }

    // process data in Node side: map each entry to a simpler objet
    const mapped = (result.data || []).map(r => {
      const adv = r?.adv || {};
      const advertiser = r?.advertiser || {};
      // tradeMethods pueden venir en adv.tradeMethods o payTypes
      let tradeMethods = [];
      if (Array.isArray(adv.tradeMethods)) tradeMethods = adv.tradeMethods.map(tm => tm?.identifier || tm?.payType || "");
      if (Array.isArray(r?.payTypes) && r.payTypes.length && !tradeMethods.length) tradeMethods = r.payTypes;
      // fallback: try adv.tradeMethods items with structure {payType:..}
      const normalizedMethods = Array.from(new Set(tradeMethods.map(m => String(m || "").trim()).filter(Boolean)));
      return {
        asset: adv.asset || asset,
        price: adv.price ? String(adv.price) : null,
        maxSingleTransAmount: adv.maxSingleTransAmount || null,
        buyer: advertiser.nickName || advertiser?.userName || null,
        tradeMethods: normalizedMethods,
      };
    });

    setCache(cacheKey, { ok: true, data: mapped });
    return { ok: true, data: mapped };
  } catch (err) {
    console.error("fetchP2PDataBrowser error:", err?.message || err);
    setCache(cacheKey, { ok: false, data: [], error: String(err) });
    return { ok: false, data: [], error: String(err) };
  } finally {
    if (browser) await browser.close();
  }
}

// Escoge la mejor oferta entre las devueltas (según price y si incluye método deseado)
function pickBestOffer(offers) {
  if (!Array.isArray(offers) || offers.length === 0) return null;
  // filter offers that have at least one desired method (if any)
  const withPreferred = offers.filter(o => {
    const methods = Array.isArray(o.tradeMethods) ? o.tradeMethods.map(normalizePayTypeName) : [];
    return methods.some(m => DESIRED_PAYTYPES_NORMALIZED_INCLUDING?.includes(m) || DESIRED_PAYTYPES_NORMALIZED.includes(m));
  });

  const candidates = withPreferred.length ? withPreferred : offers;
  candidates.sort((a,b) => {
    const pa = parseFloat(a.price || "0") || 0;
    const pb = parseFloat(b.price || "0") || 0;
    return pb - pa; // descendente -> mas caro primero (BUY => comprador paga mas)
  });

  return candidates[0] || null;
}

// small normalization list used in pickBestOffer
const DESIRED_PAYTYPES_NORMALIZED_INCLUDING = DESIRED_PAYTYPES_NORMALIZED.map(s => normalizePayTypeName(s));

// Endpoints
app.get("/", (_req, res) => res.send("P2P EUR proxy (Puppeteer). Usa /p2p-eur o /p2p-eur/raw"));

app.get("/p2p-eur/raw", async (_req, res) => {
  // devuelve solo USDT raw como prueba
  const result = await fetchP2PDataBrowser("USDT", "EUR", "BUY");
  if (!result.ok) return res.json({ ok: true, sample: [] });
  res.json({ ok: true, sample: result.data });
});

app.get("/p2p-eur", async (_req, res) => {
  try {
    const results = [];
    for (const asset of ASSETS) {
      const r = await fetchP2PDataBrowser(asset, "EUR", "BUY");
      if (!r.ok || !r.data.length) {
        results.push({ asset, note: "no_offer_for_desired_methods" });
        continue;
      }
      const best = pickBestOffer(r.data);
      if (!best) {
        results.push({ asset, note: "no_offer_for_desired_methods" });
      } else {
        results.push({
          asset,
          price: best.price,
          payTypes: best.tradeMethods,
          buyer: best.buyer,
          maxAmount: best.maxSingleTransAmount
        });
      }
      // pequeño delay para ser amable con el servidor
      await new Promise(r => setTimeout(r, 200));
    }

    res.json({ ok: true, fiat: "EUR", tradeType: "BUY", results });
  } catch (err) {
    console.error("p2p-eur error:", err);
    res.status(502).json({ ok: false, error: String(err) });
  }
});

app.listen(PORT, () => console.log(`P2P EUR Puppeteer proxy escuchando en puerto ${PORT}`));
