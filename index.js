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
        "--disable-dev-shm-usage",
        "--single-process",
        "--no-zygote",
      ],
      timeout: 0,
    });

    const page = await browser.newPage();

    // ✅ Aumentamos el tiempo antes de ejecutar scripts
    await page.goto(`https://p2p.binance.com/en/trade/${asset}?fiat=${fiat}`, {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });

    // ✅ Esperamos explícitamente a que aparezcan los elementos
    await page.waitForSelector(".css-1m1f8hn, .css-1ap5wc6", { timeout: 60000 });
    await page.waitForTimeout(5000); // espera extra para asegurar render completo

    const data = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll(".css-1m1f8hn"));
      return cards.slice(0, 5).map((card) => ({
        precio: card.querySelector(".css-ovjotx")?.textContent.trim() || "",
        vendedor: card.querySelector(".css-1x1sbwg")?.textContent.trim() || "",
        pagos: Array.from(card.querySelectorAll(".css-1ap5wc6")).map((p) => p.textContent.trim()),
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
  res.send("✅ P2P EUR Proxy activo y estable. Usa /p2p-eur/raw");
});

app.get("/p2p-eur/raw", async (_req, res) => {
  const resultado = await obtenerDatos("USDT", "EUR");
  res.json(resultado);
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor activo en puerto ${PORT}`);
});
