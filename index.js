const express = require("express");
const axios = require("axios");
const app = express();
const PORT = process.env.PORT || 3000;

const ASSETS = ["USDT", "BTC", "ETH", "BNB", "SOL"];
const DESIRED_PAYTYPES = [
  "SEPAinstant", "SEPA", "BANK", "Wise", "Skrill", "BBVABank",
  "BancoSantanderSpain", "CaixaBank", "Bunq", "N26",
  "UniCreditEU", "DukascopyBank", "Paysera", "ZEN"
];

// Cache simple (30 s)
const cache = {};
const CACHE_TTL = 30000;
const now = () => Date.now();
function getCache(key) {
  const it = cache[key];
  if (!it) return null;
  if (now() - it.ts > CACHE_TTL) { delete cache[key]; return null; }
  return it.data;
}
function setCache(key, data) { cache[key] = { ts: now(), data }; }

function normalizePayTypeName(s) {
  if (!s) return "";
  return String(s).trim().toUpperCase().replace(/[\s_\-().]+/g, "");
}
function isDesired(payType) {
  const norm = normalizePayTypeName(payType);
  return DESIRED_PAYTYPES.some(d => normalizePayTypeName(d) === norm);
}
function extractPayTypes(entry) {
  const fromFriendly = Array.isArray(entry?.payTypes) ? entry.payTypes : [];
  const fromTradeMethods = Array.isArray(entry?.adv?.tradeMethods)
    ? entry.adv.tradeMethods.map(tm => tm?.payType).filter(Boolean)
    : [];
  return Array.from(new Set([...fromFriendly, ...fromTradeMethods]));
}

// Fetch con headers reales
async function fetchBinanceP2P(asset, fiat = "EUR", tradeType = "BUY") {
  const cached = getCache(`${asset}_${fiat}_${tradeType}`);
  if (cached) return cached;

  const url = "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search";
  const body = { page: 1, rows: 30, asset, fiat, tradeType };
  const headers = {
    "Content-Type": "application/json",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Origin": "https://p2p.binance.com",
    "Referer": "https://p2p.binance.com/en/trade/all-payments/USDT?fiat=EUR",
    "X-ClientType": "web"
  };

  try {
    const resp = await axios.post(url, body, { headers, timeout: 10000 });
    const data = resp.data?.data || [];
    setCache(`${asset}_${fiat}_${tradeType}`, data);
    return data;
  } catch (err) {
    console.error("Binance fetch error:", err.message);
    return [];
  }
}

// Endpoint principal
app.get("/p2p-eur", async (_req, res) => {
  try {
    const results = [];
    for (const asset of ASSETS) {
      const entries = await fetchBinanceP2P(asset, "EUR", "BUY");

      const offers = entries
        .map(r => {
          const adv = r?.adv || {};
          const advertiser = r?.advertiser || {};
          const payTypes = extractPayTypes(r);
          const matching = payTypes.filter(isDesired);

          return {
            asset: adv.asset,
            price: adv.price ? Number(adv.price) : null,
            buyer: advertiser.nickName,
            payTypes,
            matching
          };
        })
        .filter(o => o.price && o.matching.length > 0);

      offers.sort((a, b) => b.price - a.price);
      results.push(offers[0] || { asset, note: "no_offer_for_desired_methods" });
    }
    res.json({ ok: true, fiat: "EUR", tradeType: "BUY", results });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// Endpoint raw (debug)
app.get("/p2p-eur/raw", async (_req, res) => {
  try {
    const data = await fetchBinanceP2P("USDT", "EUR", "BUY");
    const formatted = data.map(r => ({
      asset: r?.adv?.asset,
      price: r?.adv?.price,
      tradeMethods: r?.adv?.tradeMethods?.map(tm => tm?.payType),
      buyer: r?.advertiser?.nickName
    }));
    res.json({ ok: true, sample: formatted.slice(0, 10) });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// Status
app.get("/status", (_req, res) => {
  const keys = Object.keys(cache);
  res.json({ ok: true, cachedKeys: keys, cacheCount: keys.length });
});

app.get("/", (_req, res) =>
  res.send("P2P EUR proxy activo. Usa /p2p-eur o /p2p-eur/raw")
);

app.listen(PORT, () =>
  console.log(`✅ Proxy EUR corriendo en puerto ${PORT}`)
);
