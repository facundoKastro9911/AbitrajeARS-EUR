import express from "express";
import puppeteer from "puppeteer";

const app = express();
const PORT = process.env.PORT || 8080;

// Reintentos automáticos
async function obtenerDatos(asset = "USDT", fiat = "EUR", intento = 1) {
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
        "--no-zygote"
      ],
      timeout: 0,
    });

    const page = await browser.newPage();

    console.log(`🔍 Intento ${intento}: cargando página de Binance P2P para ${asset}/${fiat}...`);
    await page.goto(`https://p2p.binance.com/en/trade/${asset}?fiat=${fiat}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    // Espera dinámica al frame principal
    await page.waitForFunction(
      () => document.readyState === "complete",
      { timeout: 60000 }
    );
    await page.waitForSelector(".css-1m1f8hn, .css-1ap5wc6", { timeout: 60000 });
    await page.waitForTimeout(5000); // margen extra

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

    // Si falla por "main frame too early", reintentamos
    if (error.message.includes("main frame too early") && intento < 3) {
      console.log(`⚠️ Reintentando (${intento + 1})...`);
      await new Promise(r => setTimeout(r, 4000));
      return obtenerDatos(asset, fiat, intento + 1);
    }

    console.error("❌ Error final:", error.message);
    return { ok: false, asset, data: [], error: error.message };
  }
}

// Rutas
app.get("/", (_req, res) => {
  res.send("✅ P2P EUR Proxy activo y estable (con reintentos). Usa /p2p-eur/raw");
});

app.get("/p2p-eur/raw", async (_req, res) => {
  const resultado = await obtenerDatos("USDT", "EUR");
  res.json(resultado);
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor en puerto ${PORT}`);
});
