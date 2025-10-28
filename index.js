// index.js – Proxy P2P EUR real (Chromium completo)
import express from "express";
import puppeteer from "puppeteer";

const app = express();
const PORT = process.env.PORT || 8080;

// Criptos a consultar
const ASSETS = ["USDT", "BTC", "ETH", "BNB", "SOL"];

// Espera que cargue la página y lee las ofertas
async function obtenerOfertas(asset = "USDT", fiat = "EUR", tradeType = "BUY") {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
      ],
      defaultViewport: null,
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
    );

    const url = `https://p2p.binance.com/en/trade/${asset}?fiat=${fiat}`;
    console.log(`🌍 Cargando ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    // Esperar que aparezcan los anuncios
    await page.waitForSelector(".css-1m1f8hn", { timeout: 30000 }).catch(() => null);

    // Extraer datos visibles en la página
    const data = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll(".css-1m1f8hn"));
      return cards.slice(0, 10).map((card) => {
        const precio = card.querySelector(".css-1m1f8hn .css-1m1f8hn")?.textContent || "";
        const pay = Array.from(card.querySelectorAll(".css-1ap5wc6")).map((el) =>
          el.textContent.trim()
        );
        const vendedor = card.querySelector(".css-1x1sbwg")?.textContent || "";
        return { precio, pay, vendedor };
      });
    });

    await browser.close();
    return { ok: true, asset, data };
  } catch (err) {
    if (browser) await browser.close();
    console.error("❌ Error al obtener ofertas:", err.message);
    return { ok: false, asset, data: [], error: err.message };
  }
}

// Endpoint principal
app.get("/p2p-eur", async (_req, res) => {
  const resultados = [];
  for (const asset of ASSETS) {
    const r = await obtenerOfertas(asset, "EUR", "BUY");
    resultados.push(r);
  }
  res.json({ ok: true, fiat: "EUR", tradeType: "BUY", resultados });
});

// Endpoint de prueba (solo USDT)
app.get("/p2p-eur/raw", async (_req, res) => {
  const r = await obtenerOfertas("USDT", "EUR", "BUY");
  res.json(r);
});

app.get("/", (_req, res) => {
  res.send("✅ P2P EUR Proxy activo (Chromium completo). Usa /p2p-eur o /p2p-eur/raw");
});

app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));
