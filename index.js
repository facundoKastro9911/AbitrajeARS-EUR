import express from "express";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium-min";

const app = express();
const PORT = process.env.PORT || 8080;

app.get("/", (req, res) => {
  res.send("P2P EUR proxy activo (modo Puppeteer). Usa /p2p-eur o /p2p-eur/raw");
});

async function fetchP2PData(asset = "USDT", fiat = "EUR", tradeType = "BUY") {
  let browser = null;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    // Emulamos un navegador real
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    );

    const url = `https://p2p.binance.com/en/trade/${asset}?fiat=${fiat}&tradeType=${tradeType}`;
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

    // Esperamos que carguen los precios
    await page.waitForSelector(".css-1m1f8hn", { timeout: 20000 }).catch(() => null);

    const data = await page.evaluate(() => {
      const offers = [];
      const cards = document.querySelectorAll(".css-1m1f8hn");
      cards.forEach((card) => {
        const priceEl = card.querySelector(".css-ydcgk2");
        const nameEl = card.querySelector(".css-1aajx9u");
        const methodsEl = card.querySelectorAll(".css-1x8dg53");

        const price = priceEl ? priceEl.innerText.trim() : null;
        const buyer = nameEl ? nameEl.innerText.trim() : null;
        const tradeMethods = Array.from(methodsEl).map((m) => m.innerText.trim());

        if (price && buyer) offers.push({ asset: "USDT", price, buyer, tradeMethods });
      });
      return offers.slice(0, 10); // primeros 10 resultados
    });

    return { ok: true, sample: data };
  } catch (err) {
    console.error("Puppeteer error:", err);
    return { ok: false, error: err.message };
  } finally {
    if (browser) await browser.close();
  }
}

app.get("/p2p-eur/raw", async (req, res) => {
  const result = await fetchP2PData("USDT", "EUR", "BUY");
  res.json(result);
});

app.get("/p2p-eur", async (req, res) => {
  const assets = ["USDT", "BTC", "ETH", "BNB", "SOL"];
  const fiat = "EUR";
  const tradeType = "BUY";
  const results = [];

  for (const asset of assets) {
    const data = await fetchP2PData(asset, fiat, tradeType);
    if (data.ok && data.sample.length > 0) {
      results.push({ asset, offers: data.sample });
    } else {
      results.push({ asset, note: data.error || "no_data" });
    }
  }

  res.json({ ok: true, fiat, tradeType, results });
});

app.listen(PORT, () => console.log(`✅ Proxy Puppeteer activo en puerto ${PORT}`));

