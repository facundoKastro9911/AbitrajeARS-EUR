// index.js — versión ligera SOLO API Binance P2P
const express = require("express");
const fetch = require("node-fetch");
const app = express();
const PORT = process.env.PORT || 8080;

const ASSETS = ["USDT", "BTC", "ETH", "BNB", "SOL"];
const FIAT = "EUR";
const DEFAULT_TRADE = "BUY";

// Función principal para consultar API pública de Binance P2P
async function queryBinanceP2P(asset, fiat = FIAT, tradeType = DEFAULT_TRADE, rows = 20) {
  const url = "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search";
  const body = {
    asset,
    fiat,
    merchantCheck: false,
    page: 1,
    payTypes: [],
    publisherType: null,
    rows,
    tradeType,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      accept: "application/json, text/plain, */*",
    },
    body: JSON.stringify(body),
    timeout: 20000,
  });

  if (!res.ok) throw new Error(`Binance API ${res.status}`);
  const json = await res.json();
  const data = Array.isArray(json.data) ? json.data : [];

  return data.map((adv) => ({
    asset,
    price: adv.adv?.price || adv.price,
    methods: adv.adv?.tradeMethods?.map((m) => m.identifier || m.tradeMethodName) || [],
    advertiser: adv.advertiser?.nickName || "Desconocido",
  }));
}

// Ruta principal de prueba
app.get("/", (req, res) => {
  res.send("✅ P2P EUR Proxy activo (solo API). Usa /p2-eur?asset=USDT o /p2-eur/raw");
});

// Ruta individual
app.get("/p2-eur", async (req, res) => {
  try {
    const asset = (req.query.asset || "USDT").toUpperCase();
    const tradeType = (req.query.tradeType || DEFAULT_TRADE).toUpperCase();

    if (!ASSETS.includes(asset))
      return res.status(400).json({ ok: false, error: `Asset no soportado: ${asset}` });

    const results = await queryBinanceP2P(asset, FIAT, tradeType);
    res.json({ ok: true, fiat: FIAT, tradeType, resultados: results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Ruta múltiple
app.get("/p2-eur/raw", async (req, res) => {
  try {
    const tradeType = (req.query.tradeType || DEFAULT_TRADE).toUpperCase();
    const promises = ASSETS.map((asset) =>
      queryBinanceP2P(asset, FIAT, tradeType)
        .then((r) => ({ asset, ok: true, data: r }))
        .catch((e) => ({ asset, ok: false, error: e.message }))
    );
    const results = await Promise.all(promises);
    res.json({ ok: true, fiat: FIAT, tradeType, results });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => console.log(`🚀 Proxy EUR API-only activo en puerto ${PORT}`));
