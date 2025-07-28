const express = require("express");
const { chromium } = require("playwright");
const cheerio = require("cheerio");
const app = express();
const PORT = 3000;
const cors = require("cors");
app.use(cors());
app.use(express.static("public"));
const path = require("path");

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/scrape", async (req, res) => {
  const {
    type = "motoryzacja",
    region = "mazowieckie",
    city = "warszawa",
    page = 1,
  } = req.query;

  const url = `https://panoramafirm.pl/${type}/${region},,${city}/firmy,${page}.html`;

  try {
    const browser = await chromium.launch({ headless: true });
    const pageInstance = await browser.newPage();
    await pageInstance.goto(url, { waitUntil: "networkidle" });

    const html = await pageInstance.content();
    await browser.close();

    const $ = cheerio.load(html);
    const jsonldElements = [];

    $('script[type="application/ld+json"]').each((i, el) => {
      try {
        const raw = $(el).html();
        const parsed = JSON.parse(raw);

        if (Array.isArray(parsed)) {
          parsed.forEach((item) => {
            if (item["@type"] === "LocalBusiness") {
              jsonldElements.push(item);
            }
          });
        } else if (parsed["@type"] === "LocalBusiness") {
          jsonldElements.push(parsed);
        }
      } catch (e) {
        console.warn(`Ошибка парсинга JSON-LD в элементе #${i}:`, e.message);
      }
    });

    res.json(jsonldElements);
  } catch (error) {
    console.error("Ошибка при обработке запроса:", error);
    res.status(500).json({ error: "Ошибка при парсинге страницы." });
  }
});

app.listen(PORT, () => {
  console.log(`Сервер запущен на http://localhost:${PORT}`);
});
