// index.js – Proxy P2P EUR (estable y con un solo navegador)
import express from "express";
import puppeteer from "puppeteer";

const app = express();
const PORT = process.env.PORT || 8080;

// Criptos a consultar
const ASSETS = ["USDT", "BTC", "ETH", "BNB", "SOL"];

// ====== FUNCIÓN PRINCIPAL ======
async function obtenerOfertas(asset, page) {
  try {
    const url = `https://p2p.binance.com/en/trade/${asset}?fiat=EUR`;
    console.log(`🌍 Abriendo ${url}`);

    await page.goto(url, { waitUntil: "networkidle2", timeout: 90000 });
    await page.waitForTimeout(7000);

    // Aceptar cookies si aparecen
    try {
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll("button"));
        const aceptar = buttons.find((b) =>
          b.textContent.toLowerCase().includes("accept")
        );
        if (aceptar) aceptar.click();
      });
      await page.waitForTimeout(3000);
    } catch {}

    await page.waitForSelector(".css-1m1f8hn", { timeout: 45000 });

    // Extraer datos
    const data = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll(".css-1m1f8hn"));
      return cards.slice(0, 5).map((card) => {
        const precio = card.querySelector(".css-ovjotx")?.textContent.trim() || "";
        const vendedor = card.querySelector(".css-1x1sbwg")?.textContent.trim() || "";
        const pay = Array.from(card.querySelectorAll(".css-1ap5wc6")).map((p) =>
          p.textContent.trim()
        );
        return { precio, vendedor, pay };
      });
    });

    if (!data.length) {
      return { ok: false, asset, data: [], error: "Sin resultados visibles" };
    }

    console.log(`✅ ${asset}: ${data.length} ofertas capturadas`);
    return { ok: true, asset, data };
  } catch (err) {
    console.error(`❌ Error en ${asset}:`, err.message);
    return { ok: false, asset, data: [], error: err.message };
  }
}

// ====== SERVIDOR EXPRESS ======
app.get("/p2p-eur", async (_req, res) => {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
    ],
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
  );

  const resultados = [];
  for (const asset of ASSETS) {
    const r = await obtenerOfertas(asset, page);
    resultados.push(r);
  }

  await browser.close();
  res.json({ ok: true, fiat: "EUR", tradeType: "BUY", resultados });
});

app.get("/p2p-eur/raw", async (_req, res) => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  const resultado = await obtenerOfertas("USDT", page);

  await browser.close();
  res.json(resultado);
});

app.get("/", (_req, res) => {
  res.send("✅ P2P EUR Proxy activo (Chromium completo y estable). Usa /p2p-eur o /p2p-eur/raw");
});

app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));
