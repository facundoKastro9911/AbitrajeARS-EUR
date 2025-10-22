const express = require("express");
const axios = require("axios");
const app = express();
const PORT = process.env.PORT || 3000;

// ========================================
// CONFIGURACIÓN
// ========================================
const ASSETS = ["USDT", "BTC", "ETH", "BNB", "SOL"];

// ✅ Lista ampliada con TODAS las variantes posibles detectadas en Binance
const DESIRED_PAYTYPES = [
  "SEPAinstant",
  "SEPA",
  "BANK",
  "Wise",
  "Skrill",
  "BBVABank",
  "BancoSantanderSpain",
  "CaixaBank",
  "Bunq",
  "N26",
  "UniCreditEU",
  "DukascopyBank",
  "Paysera",
  "ZEN"
];

// ========================================
// FUNCIONES AUXILIARES
// ========================================
function normalizePayTypeName(s) {
  if (!s) return "";
  return String(s).trim().toUpperCase().replace(/[\s_\-().]+/g, "");
}

function isDesired(payType) {
  const norm = normalizePayTypeName(payType);
  return DESIRED_PAYTYPES.some((d) => normalizePayTypeName(d) === norm);
}

function extractPayTypes(entry) {
  const fromFriendly = Array.isArray(entry?.payTypes) ? entry.payTypes : [];
  const fromTradeMethods = Array.isArray(entry?.adv?.tradeMethods)
    ? entry.adv.tradeMethods.map((tm) => tm?.payType).filter(Boolean)
    : [];
  return Array.from(new Set([...fromFriendly, ...fromTradeMethods]));
}

// ========================================
// FETCH DE BINANCE
// ========================================
async function fetchBinanceP2P(asset, fiat = "EUR", tradeType = "BUY") {
  const url = "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search";
  const body = { page: 1, rows: 40, asset, fiat, tradeType };
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (compatible; p2p-eur-proxy/1.4)"
  };

  const resp = await axios.post(url, body, { headers, timeout: 8000 });
  return resp.data?.data || [];
}

// ========================================
// ENDPOINT PRINCIPAL /p2p-eur
// ========================================
app.get("/p2p-eur", async (_req, res) => {
  try {
    const results = [];

    for (const asset of ASSETS) {
      const entries = await fetchBinanceP2P(asset, "EUR", "BUY");

      const offers = entries
        .map((r) => {
          const adv = r?.adv || {};
          const advertiser = r?.advertiser || {};
          const payTypes = extractPayTypes(r);
          const matching = payTypes.filter(isDesired);

          return {
            asset: adv.asset,
            price: adv.price ? Number(adv.price) : null,
            buyer: advertiser.nickName,
            payTypes,
            matching,
          };
        })
        .filter((o) => o.price && o.matching.length > 0);

      offers.sort((a, b) => b.price - a.price);
      results.push(offers[0] || { asset, note: "no_offer_for_desired_methods" });
    }

    res.json({ ok: true, fiat: "EUR", tradeType: "BUY", results });
  } catch (err) {
    console.error("Error en /p2p-eur:", err.message);
    res.status(502).json({ ok: false, error: err.message });
  }
});

// ========================================
// ENDPOINT DEBUG /p2p-eur/raw
// ========================================
app.get("/p2p-eur/raw", async (_req, res) => {
  try {
    const data = await fetchBinanceP2P("USDT", "EUR", "BUY");
    const formatted = data.map((r) => ({
      asset: r?.adv?.asset,
      price: r?.adv?.price,
      tradeMethods: r?.adv?.tradeMethods?.map((tm) => tm?.payType),
      buyer: r?.advertiser?.nickName,
    }));
    res.json({ ok: true, sample: formatted.slice(0, 10) });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// ========================================
app.get("/", (_req, res) =>
  res.send("P2P EUR proxy activo. Usa /p2p-eur o /p2p-eur/raw")
);

app.listen(PORT, () =>
  console.log(`✅ Proxy EUR corriendo en puerto ${PORT}`)
);
