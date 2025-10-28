// index.js – Proxy P2P EUR (Chromium completo con espera y cookies)
import express from "express";
import puppeteer from "puppeteer";

const app = express();
const PORT = process.env.PORT || 8080;

// Criptos a consultar
const ASSETS = ["USDT", "BTC", "ETH", "BNB", "SOL"];

// Función principal para obtener las ofertas
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
        "--single-process",
      ],
      defaultViewport: null,
    });

    const page = await browser.newPage();

    // User-Agent realista
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
    );

    const url = `https://p2p.binance.com/en/trade/${asset}?fiat=${fiat}`;
    console.log(`🌍 Cargando: ${url}`);

    // Esperar que cargue completamente la red
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

    // Espera adicional para que aparezcan los anuncios dinámicos
    await page.waitForTimeout(8000);

    // Aceptar cookies si aparece
    try {
      const btn = await page.$('button:has-text("Accept All")');
      if (btn) {
        await btn.click();
        console.log("🍪 Cookies aceptadas");
        await page.waitForTimeout(3000);
      }
    } catch (e) {
      console.log("ℹ️ No se detectó banner de cookies");
    }

    // Esperar selector principal de anuncios
    await page.waitForSelector(".css-1m1f8hn", { timeout: 45000 }).catch(() => null);

    // Extraer los anuncios visibles
    const data = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll(".css-1m1f8hn"));
      return cards.slice(0, 10).map((card) => {
        const precio =
          card.querySelector(".css-1m1f8hn .css-1m1f8hn")?.textContent.trim() || "";
        const pay = Array.from(card.querySelectorAll(".css-1ap5wc6")).map((el) =>
          el.textContent.trim()
        );
        const vendedor = card.querySelector(".css-1x1sbwg")?.textContent.trim() || "";
        return { precio, pay, vendedor };
      });
    });

    await browser.close();

    if (!data.length) {
      console.warn(`⚠️ No se encontraron ofertas visibles para ${asset}`);
    }

    return { ok: true, asset, data };
  } catch (err) {
    if (browser) await browser.close();
    console.error(`❌ Error al obtener ofertas de ${asset}:`, err.message);
    return { ok: false, asset, data: [], error: err.message };
  }
}

// Endpoint completo (todas las criptos)
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

// Página principal
app.get("/", (_req, res) => {
  res.send("✅ P2P EUR Proxy activo (Chromium completo). Usa /p2p-eur o /p2p-eur/raw");
});

app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));
