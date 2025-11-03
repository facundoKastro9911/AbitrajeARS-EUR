// index.js
// Proxy P2P EUR (Binance P2P primary + Puppeteer fallback)
// Usa: GET /p2-eur?asset=USDT&tradeType=BUY
//      GET /p2-eur/raw   -> consulta todos los activos del array ASSETS

const express = require("express");
const fetch = require("node-fetch"); // v2
const app = express();
const PORT = process.env.PORT || 3000;

const ASSETS = ["USDT", "BTC", "ETH", "BNB", "SOL"];
const FIAT = "EUR";
const DEFAULT_TRADE = "BUY";

// Retry helper
async function retry(fn, attempts = 4, delayMs = 800) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn(i);
    } catch (err) {
      lastErr = err;
      const backoff = delayMs * Math.pow(1.6, i);
      console.warn(`Retry ${i + 1}/${attempts} failed: ${err.message}. Backoff ${Math.round(backoff)}ms`);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}

// Primary: Binance P2P API call
async function queryBinanceP2P(asset, fiat = FIAT, tradeType = DEFAULT_TRADE, rows = 20) {
  const url = "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search";
  const body = {
    asset,
    fiat,
    merchantCheck: false,
    page: 1,
    payTypes: [], // empty -> all payment methods
    publisherType: null,
    rows,
    tradeType,
  };

  const headers = {
    "content-type": "application/json",
    "user-agent": "Mozilla/5.0 (compatible; p2p-proxy/1.0; +https://example.com)",
    accept: "application/json, text/plain, */*",
  };

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    timeout: 20000,
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Binance API ${res.status} ${res.statusText} ${txt.slice(0, 200)}`);
  }

  const json = await res.json();

  // The API returns data in json.data (array of offers) usually inside {data: {ads: ...} or data: [...]}
  // Inspect common shape:
  // If json.data && json.data.length -> ok
  // If json.data && json.data.rows -> use that
  // But typical: json.data is an array of adv objects
  let results = [];

  if (Array.isArray(json.data) && json.data.length > 0) {
    results = json.data;
  } else if (json && json.data && Array.isArray(json.data.rows) && json.data.rows.length) {
    results = json.data.rows;
  } else if (json && Array.isArray(json.data?.data)) {
    results = json.data.data;
  } else if (Array.isArray(json.data?.ads)) {
    results = json.data.ads;
  } else {
    // Try common wrapper
    if (Array.isArray(json.data?.adv)) {
      results = json.data.adv;
    }
  }

  // Map results to simple format (defensive)
  const mapped = (results || []).slice(0, rows).map((adv) => {
    // Many shapes — pick fields defensively
    const price = adv?.adv?.price ?? adv?.advPrice ?? adv?.price ?? adv?.adv?.price;
    const tradeMethods =
      adv?.adv?.tradeMethods ??
      adv?.advertiser?.paymentMethods ??
      adv?.adv?.tradeMethods ??
      adv?.paymentMethods ??
      adv?.payTypes ??
      [];
    const buyer =
      adv?.advertiser?.nickName ??
      adv?.advertiser?.userName ??
      adv?.advertiserName ??
      adv?.adv?.advertiserName ??
      adv?.advertiser?.nickName ??
      adv?.adv?.userName ??
      adv?.nickname ??
      null;

    // Normalize tradeMethods to strings
    const methods = Array.isArray(tradeMethods)
      ? tradeMethods.map((m) => (typeof m === "string" ? m : m?.name ?? JSON.stringify(m))).slice(0, 10)
      : [];

    return {
      asset,
      price: price ? String(price) : null,
      tradeMethods: methods,
      buyer,
      raw: adv,
    };
  });

  return mapped;
}

// Fallback via Puppeteer (only used if API fails). This function is best-effort and heavier.
async function puppeteerFallback(asset, fiat = FIAT, tradeType = DEFAULT_TRADE) {
  // Lazy-load puppeteer only if needed
  const puppeteer = require("puppeteer");

  // args to work on platforms like Fly (no-sandbox, disable-dev-shm-usage, etc)
  const launchArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-accelerated-2d-canvas",
    "--no-first-run",
    "--no-zygote",
    "--single-process",
    "--disable-gpu",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--no-default-browser-check",
  ];

  const browser = await puppeteer.launch({
    headless: "new",
    args: launchArgs,
    ignoreDefaultArgs: ["--enable-automation"],
    defaultViewport: { width: 1200, height: 900 },
  });

  try {
    const page = await browser.newPage();
    // Spoof some headers to look like real browser
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36");
    await page.setExtraHTTPHeaders({
      "accept-language": "en-US,en;q=0.9",
    });

    // Build P2P page URL that lists offers
    // We'll use the public BINANCE P2P interface
    const p2pUrl = `https://p2p.binance.com/en/trade/${asset}?fiat=${fiat}&tradeType=${tradeType}`;

    await page.goto(p2pUrl, { waitUntil: "networkidle2", timeout: 45000 });

    // Wait for offers list to be present - multiple selectors attempted (resilient)
    const possibleSelectors = [
      '[data-testid="ad-list"]',
      '.css-1m1f8hn', // fallback class
      '.css-1xn7y3s', // older
      '.buy-sell-list', // fallback guess
    ];

    let found = false;
    for (const sel of possibleSelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 6000 });
        found = true;
        break;
      } catch (e) {
        // not found, try next
      }
    }

    if (!found) {
      // Try waiting a short while and continue
      await page.waitForTimeout(1500);
    }

    // Evaluate page extracting offers by scanning document for price and payment methods
    const offers = await page.evaluate(() => {
      const list = [];
      // Try several DOM heuristics:
      // 1) look for advertisement cards
      const cards = document.querySelectorAll('[data-testid="ad-card"], [data-testid="ad-item"], .css-1m1f8hn, .css-1xn7y3s, .buy-sell-item');
      if (cards && cards.length) {
        cards.forEach((c) => {
          try {
            const priceEl = c.querySelector("[data-testid='ad-price'], .price, .css-1u4ud9w, .css-1k5k3qk");
            const nameEl = c.querySelector("[data-testid='ad-owner'], .merchant, .css-1v1x1gz");
            // payment methods
            const pmEls = c.querySelectorAll(".payment-methods li, .css-1b3rpxv, .payment");
            const methods = [];
            pmEls.forEach((p) => {
              const text = p.innerText || p.textContent || "";
              if (text) methods.push(text.trim());
            });

            const price = priceEl ? (priceEl.innerText || priceEl.textContent || "").trim() : null;
            const buyer = nameEl ? (nameEl.innerText || nameEl.textContent || "").trim() : null;
            list.push({ price, buyer, tradeMethods: methods });
          } catch (e) {}
        });
      }
      return list;
    });

    await page.close();
    await browser.close();

    // Map to same shape
    const mapped = (offers || []).map((o) => ({
      asset,
      price: o.price ?? null,
      buyer: o.buyer ?? null,
      tradeMethods: Array.isArray(o.tradeMethods) ? o.tradeMethods.slice(0, 10) : [],
      raw: o,
    }));

    return mapped;
  } catch (err) {
    try { await browser.close(); } catch(e){}
    throw err;
  }
}

// High-level single-asset function that tries API then fallback
async function fetchOffersForAsset(asset, tradeType = DEFAULT_TRADE) {
  // Validate asset
  if (!ASSETS.includes(asset)) {
    throw new Error(`Asset not allowed. Permitted: ${ASSETS.join(", ")}`);
  }

  // Try API with retries
  try {
    const res = await retry(async () => {
      const r = await queryBinanceP2P(asset, FIAT, tradeType, 15);
      if (!r || r.length === 0) throw new Error("Empty result from Binance P2P API");
      return r;
    }, 4, 700);
    return { ok: true, asset, data: res };
  } catch (apiErr) {
    console.warn("Primary API failed or returned empty -> trying Puppeteer fallback:", apiErr.message);

    // Try Puppeteer fallback with retries
    try {
      const res2 = await retry(async () => {
        const r2 = await puppeteerFallback(asset, FIAT, tradeType);
        if (!r2 || r2.length === 0) throw new Error("Empty result from Puppeteer fallback");
        return r2;
      }, 3, 1200);
      return { ok: true, asset, data: res2 };
    } catch (puppErr) {
      console.error("Both API and Puppeteer failed:", puppErr.message);
      return { ok: false, asset, data: [], error: puppErr.message || String(puppErr) };
    }
  }
}

// ROUTES
app.get("/", (req, res) => {
  res.send("P2P EUR proxy activo. Usa /p2-eur?asset=USDT&tradeType=BUY o /p2-eur/raw");
});

app.get("/p2-eur", async (req, res) => {
  const asset = (req.query.asset || "USDT").toUpperCase();
  const tradeType = (req.query.tradeType || DEFAULT_TRADE).toUpperCase();
  console.log(`Request for ${asset} ${tradeType}`);

  if (!ASSETS.includes(asset)) {
    return res.status(400).json({ ok: false, error: `Asset not supported. Allowed: ${ASSETS.join(", ")}` });
  }

  try {
    const result = await fetchOffersForAsset(asset, tradeType);
    return res.json({ ok: result.ok, fiat: FIAT, tradeType, resultados: result.ok ? result.data : [], error: result.error ?? null });
  } catch (err) {
    console.error("Unexpected error:", err);
    return res.status(500).json({ ok: false, asset, data: [], error: err.message || String(err) });
  }
});

// Raw batch: queries all ASSETS in parallel (with protection)
app.get("/p2-eur/raw", async (req, res) => {
  console.log("Batch raw request");
  const tradeType = (req.query.tradeType || DEFAULT_TRADE).toUpperCase();

  // Limit concurrency to avoid overload
  const promises = ASSETS.map((asset) =>
    fetchOffersForAsset(asset, tradeType).catch((e) => ({ ok: false, asset, data: [], error: e.message }))
  );

  const results = await Promise.all(promises);
  return res.json({ ok: true, fiat: FIAT, tradeType, results });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 P2P EUR proxy running on port ${PORT}. Endpoints: /p2-eur and /p2-eur/raw`);
});
