const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ========================================
// CONFIGURACIÓN
// ========================================
const ASSETS = ["USDT", "BTC", "ETH", "BNB", "SOL"];
const DESIRED_PAYTYPES = [
  "SEPA INSTANT",
  "SEPA (EU) bank transfer",
  "Bank Transfer",
  "Wise",
  "Skrill"
];

// ========================================
// FUNCIONES AUXILIARES
// ========================================
function normalizePayTypeName(s) {
  if (!s) return "";
  const raw = String(s).trim().toUpperCase().replace(/[\s_\-().]+/g, "");
  if (raw.includes("SEPAINSTANT") || raw.includes("SEPAEUINSTANT")) return "SEPA INSTANT";
  if (raw.includes("SEPAEUBANKTRANSFER") || raw.includes("BANKTRANSFER")) return "SEPA (EU) bank transfer";
  if (raw.includes("SEPA")) return "SEPA";
  if (raw.includes("WISE")) return "Wise";
  if (raw.includes("SKRILL")) return "Skrill";
  return s;
}

function extractPayTypes(entry) {
  const fromFriendly = Array.isArray(entry?.payTypes) ? entry.payTypes : [];
  const fromTradeMethods = Array.isArray(entry?.adv?.tradeMethods)
    ? entry.adv.tradeMethods.map((tm) => tm?.payType).filter(Boolean)
    : [];
  const merged = [...fromFriendly, ...fromTradeMethods].map(normalizePayTypeName);
  return Array.from(new Set(merged)).filter(Boolean);
}

function pickDesiredPayType(payTypes) {
  for (const desired of DESIRED_PAYTYPES) {
    const match = payTypes.find(
      (p) => normalizePayTypeName(p).toUpperCase() === normalizePayTypeName(desired).toUpperCase()
    );
    if (match) return normalizePayTypeName(match);
  }
  return null;
}

// ========================================
// FETCH DE BINANCE P2P
// ========================================
async function fetchBinanceP2P(asset, fiat = "EUR", tradeType = "BUY") {
  const url = "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search";
  const body = {
    page: 1,
    rows: 20,
    asset,
    fiat,
    tradeType,
    publisherType: null,
  };
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (compatible; p2p-eur-proxy/1.2)",
  };

  const resp = await axios.post(url, body, { headers, timeout: 8000 });
  return resp.data?.data || [];
}

// ========================================
// ENDPOINT NORMAL (filtrado)
// ========================================
app.get("/p2p-eur", async (_req, res) => {
  try {
    const results = [];
    for (const asset of ASSETS) {
      const entries = await fetchBinanceP2P(asset, "EUR", "BUY");
      const filtered = entries
        .map((r) => {
          const adv = r?.adv || {};
          const advertiser = r?.advertiser || {};
          const payTypes = extractPayTypes(r);
          const chosenPay = pickDesiredPayType(payTypes);

          return {
            asset: adv.asset,
            price: adv.price ? Number(adv.price) : null,
            buyer: advertiser?.nickName || null,
            maxAmount: adv.maxSingleTransAmount || null,
            payTypes,
            chosenPay,
          };
        })
        .filter((x) => x.asset && x.price && x.chosenPay);

      filtered.sort((a, b) => b.price - a.price);
      results.push(filtered[0] || { asset, note: "no_offer_for_desired_methods" });
    }

    return res.json({ ok: true, fiat: "EUR", tradeType: "BUY", results });
  } catch (err) {
    console.error("p2p-eur error:", err.message);
    res.status(502).json({ ok: false, error: err.message });
  }
});

// ========================================
// ENDPOINT DE DEBUG (sin filtro)
// ========================================
app.get("/p2p-eur/raw", async (_req, res) => {
  try {
    const data = await fetchBinanceP2P("USDT", "EUR", "BUY");
    // devolvemos solo campos útiles para no sobrecargar
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
app.get("/", (_req, res) => res.send("P2P EUR proxy activo. Usa /p2p-eur o /p2p-eur/raw"));
app.listen(PORT, () => console.log(`✅ P2P EUR proxy corriendo en puerto ${PORT}`));
