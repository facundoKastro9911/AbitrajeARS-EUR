import express from "express";
import axios from "axios";

const app = express();
const PORT = process.env.PORT || 8080;

// --- Rotación de User-Agent ---
const userAgents = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36",
];
const randomUA = () => userAgents[Math.floor(Math.random() * userAgents.length)];

// --- Cache en memoria ---
const cache = {};
const setCache = (k, d) => (cache[k] = { data: d, ts: Date.now() });
const getCache = (k, ttl = 15000) => {
  const c = cache[k];
  return c && Date.now() - c.ts < ttl ? c.data : null;
};

// --- Función principal ---
async function fetchBinanceP2P(asset, fiat = "EUR", tradeType = "BUY") {
  const cacheKey = `${asset}_${fiat}_${tradeType}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const ua = randomUA();
  const basePage = `https://p2p.binance.com/en/trade/all-payments/${asset}?fiat=${fiat}`;
  const url = "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search";

  try {
    // 1️⃣ GET inicial para obtener cookies reales
    const getResp = await axios.get(basePage, {
      headers: {
        "User-Agent": ua,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://p2p.binance.com/",
        "Origin": "https://p2p.binance.com",
      },
      timeout: 7000,
      maxRedirects: 5,
      validateStatus: null,
    });

    const setCookies = getResp.headers["set-cookie"] || [];
    const cookieHeader = setCookies.map(c => c.split(";")[0]).join("; ");

    // 2️⃣ POST real con cookies y headers realistas
    const body = { page: 1, rows: 40, asset, fiat, tradeType, publisherType: null };
    const postResp = await axios.post(url, body, {
      headers: {
        "User-Agent": ua,
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "Origin": "https://p2p.binance.com",
        "Referer": basePage,
        "Cookie": cookieHeader,
        "X-ClientType": "web",
      },
      timeout: 10000,
    });

    const data = postResp.data?.data || [];
    setCache(cacheKey, data);
    return data;
  } catch (err) {
    console.error("fetchBinanceP2P error:", err.message);
    return [];
  }
}

// --- Endpoint limpio ---
app.get("/", (_, res) =>
  res.send("P2P EUR proxy activo. Usa /p2p-eur o /p2p-eur/raw")
);

// --- Endpoint filtrado ---
app.get("/p2p-eur", async (_, res) => {
  const cryptos = ["USDT", "BTC", "ETH", "BNB", "SOL"];
  const results = [];

  for (const asset of cryptos) {
    const data = await fetchBinanceP2P(asset);
    if (data.length > 0) {
      const best = data.reduce((a, b) => (parseFloat(a.adv.price) > parseFloat(b.adv.price) ? a : b));
      results.push({
        asset,
        price: best.adv.price,
        payType: best.adv.tradeMethods.map(m => m.identifier),
        buyer: best.advertiser.nickName,
        maxAmount: best.adv.maxSingleTransAmount,
      });
    } else {
      results.push({ asset, note: "no_offer_for_desired_methods" });
    }
  }

  res.json({ ok: true, fiat: "EUR", tradeType: "BUY", results });
});

// --- Endpoint sin filtro (raw completo) ---
app.get("/p2p-eur/raw", async (_, res) => {
  const sample = await fetchBinanceP2P("USDT");
  res.json({ ok: true, sample });
});

app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
