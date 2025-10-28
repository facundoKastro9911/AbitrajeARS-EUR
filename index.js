// index.js – Proxy P2P EUR liviano y estable
import express from "express";
import puppeteer from "puppeteer";

const app = express();
const PORT = process.env.PORT || 8080;

async function obtenerDatos(asset = "USDT", fiat = "EUR") {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--single-process",
        "--no-zygote",
        "--disable-dev-shm-usage",
      ],
    });

    const page = await browser.newPage();
    await page.goto(`https://p2p.binance.com/en/trade/${asset}?fiat=${fiat}`, {
      waitUntil: "networkidle2",
      timeout: 90000,
    });

    await page.waitForTimeout(8000);

    const data = await page.evaluate(() => {
      const offers = Array.from(document.querySelectorAll(".css-1m1f8hn"));
      return offers.slice(0, 5).map((card) => ({
        precio: card.querySelector(".css-ovjotx")?.textContent.trim() || "",
        vendedor: card.querySelector(".css-1x1sbwg")?.textContent.trim() || "",
        pago: Array.from(card.querySelectorAll(".css-1ap5wc6")).map((p) => p.textContent.trim()),
      }));
    });

    await browser.close();
    return { ok: true, asset, data };
  } catch (err) {
    if (browser) await browser.close();
    console.error("❌ Error:", err.message);
    return { ok: false, asset, data: [], error: err.message };
  }
}

// Endpoint base
app.get("/", (_req, res) => {
  res.send("✅ P2P EUR Proxy activo. Usa /p2p-eur/raw");
});

// Endpoint principal
app.get("/p2p-eur/raw", async (_req, res) => {
  const resultado = await obtenerDatos("USDT", "EUR");
  res.json(resultado);
});

app.listen(PORT, () => console.log(`🚀 Proxy activo en puerto ${PORT}`));
