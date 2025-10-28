import express from "express";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteer.use(StealthPlugin());

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
        "--disable-dev-shm-usage",
        "--single-process",
        "--no-zygote",
      ],
      timeout: 0
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/120.0.0.0 Safari/537.36"
    );

    console.log(`🟢 Cargando Binance P2P (${asset}/${fiat})...`);
    await page.goto(`https://p2p.binance.com/en/trade/${asset}?fiat=${fiat}`, {
      waitUntil: "networkidle2",
      timeout: 90000
    });

    await page.waitForSelector(".css-1m1f8hn, .css-1ap5wc6", { timeout: 90000 });
    await page.waitForTimeout(6000);

    const data = await page.evaluate(() => {
      const anuncios = Array.from(document.querySelectorAll(".css-1m1f8hn"));
      return anuncios.slice(0, 5).map(card => ({
        precio: card.querySelector(".css-ovjotx")?.textContent.trim() || "",
        vendedor: card.querySelector(".css-1x1sbwg")?.textContent.trim() || "",
        pagos: Array.from(card.querySelectorAll(".css-1ap5wc6")).map(p => p.textContent.trim())
      }));
    });

    await browser.close();
    return { ok: true, asset, data };
  } catch (error) {
    if (browser) await browser.close();
    console.error("❌ Error:", error.message);
    return { ok: false, asset, data: [], error: error.message };
  }
}

app.get("/", (_req, res) => {
  res.send("✅ P2P EUR Proxy con modo stealth activo. Usa /p2p-eur/raw");
});

app.get("/p2p-eur/raw", async (_req, res) => {
  const resultado = await obtenerDatos("USDT", "EUR");
  res.json(resultado);
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor activo en puerto ${PORT}`);
});
