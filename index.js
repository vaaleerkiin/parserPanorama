const express = require("express");
const { chromium } = require("playwright");
const cheerio = require("cheerio");
const cors = require("cors");
const path = require("path");
const { WebSocketServer } = require("ws");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.static("public"));

const server = app.listen(PORT, () => {
  console.log(`🚀 Сервер: http://localhost:${PORT}`);
});

const wss = new WebSocketServer({ server });
let currentSocket = null;

wss.on("connection", (ws) => {
  console.log("🧩 WebSocket подключен");
  currentSocket = ws;

  ws.on("close", () => {
    console.log("❌ WebSocket отключён");
    currentSocket = null;
  });
});

function sendStatus(message) {
  if (currentSocket && currentSocket.readyState === 1) {
    currentSocket.send(JSON.stringify({ type: "status", message }));
  }
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/scrape", async (req, res) => {
  const {
    type = "motoryzacja",
    region = "mazowieckie",
    city = "warszawa",
  } = req.query;

  const baseUrl = `https://panoramafirm.pl/${type}/${region},,${city}/firmy`;

  try {
    const browser = await chromium.launch({ headless: true });
    const pageInstance = await browser.newPage();

    const firstPageUrl = `${baseUrl},1.html`;
    await pageInstance.goto(firstPageUrl, { waitUntil: "networkidle" });
    const firstPageHTML = await pageInstance.content();
    const $ = cheerio.load(firstPageHTML);

    const pageNumbers = $("ul.pagination li a[data-paginatorpage]")
      .map((_, el) => parseInt($(el).attr("data-paginatorpage"), 10))
      .get()
      .filter((n) => !isNaN(n));

    const maxPage = Math.max(...pageNumbers, 1);
    sendStatus(`📄 Всего страниц: ${maxPage}`);

    const companies = [];

    for (let i = 1; i <= maxPage; i++) {
      const url = `${baseUrl},${i}.html`;
      sendStatus(`➡️ Страница ${i}: загружаем ${url}`);

      try {
        await pageInstance.goto(url, { waitUntil: "networkidle" });
        const html = await pageInstance.content();

        const match = html.match(/var\s+markers\s*=\s*(\[\{.+?\}\]);/s);
        if (!match) {
          sendStatus(`⚠️ markers не найден на странице ${i}`);
          continue;
        }

        const markers = JSON.parse(match[1]);

        for (const marker of markers) {
          for (const company of marker.companies || []) {
            const contact = company.contact || {};

            const entry = {
              name: company.name,
              address: company.address || "",
            };

            if (contact.email) entry.email = contact.email;
            if (contact.phone?.formatted) entry.phone = contact.phone.formatted;
            if (contact.www) entry.www = contact.www;

            companies.push(entry);
          }
        }

        sendStatus(`✅ Страница ${i}: всего компаний — ${companies.length}`);
      } catch (err) {
        sendStatus(`❌ Ошибка на странице ${i}: ${err.message}`);
      }

      await new Promise((r) => setTimeout(r, 300));
    }

    await browser.close();

    sendStatus(`🏁 Готово! Всего компаний: ${companies.length}`);
    res.json(companies);
  } catch (error) {
    sendStatus(`🚨 Ошибка парсинга: ${error.message}`);
    res.status(500).json({ error: "Ошибка при парсинге." });
  }
});
