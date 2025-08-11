const express = require("express");
const { chromium } = require("playwright");
const cheerio = require("cheerio");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.static("public"));
const logFilePath = path.join(__dirname, "output.md");
fs.writeFileSync(logFilePath, "# Лог статусов парсера\n\n");

const server = app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен: http://localhost:${PORT}`);
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
  const timestamp = new Date().toISOString();
  const logLine = `- **[${timestamp}]** ${message}\n`;

  if (currentSocket && currentSocket.readyState === 1) {
    currentSocket.send(JSON.stringify({ type: "status", message }));
  }

  console.log("→ Отправляем статус клиенту:", message);

  fs.appendFile(logFilePath, logLine, (err) => {
    if (err) {
      console.error("❌ Ошибка записи в файл логов:", err);
    }
  });
}

app.get("/", (req, res) => {
  console.log("📥 Запрос к главной странице");
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/scrape", async (req, res) => {
  const {
    type = "motoryzacja",
    region = "mazowieckie",
    city = "warszawa",
  } = req.query;

  console.log(
    `📡 Параметры запроса: type=${type}, region=${region}, city=${city}`
  );

  const baseUrl = `https://panoramafirm.pl/${type}/${region},,${city}/firmy`;
  console.log("🔗 Формируем базовый URL:", baseUrl);

  try {
    console.log("🛠️ Запускаем браузер Chromium...");
    const browser = await chromium.launch({ headless: true });
    console.log("✅ Браузер запущен");

    const pageInstance = await browser.newPage();
    console.log("🌐 Создана новая страница браузера");

    const firstPageUrl = `${baseUrl},1.html`;
    console.log("⏳ Переходим на первую страницу:", firstPageUrl);
    await pageInstance.goto(firstPageUrl, { waitUntil: "networkidle" });

    console.log("📄 Загружаем HTML первой страницы...");
    const firstPageHTML = await pageInstance.content();

    const $ = cheerio.load(firstPageHTML);
    console.log("🧹 Загружена DOM-структура первой страницы");

    const pageNumbers = $("ul.pagination li a[data-paginatorpage]")
      .map((_, el) => parseInt($(el).attr("data-paginatorpage"), 10))
      .get()
      .filter((n) => !isNaN(n));
    console.log("🔢 Найдены номера страниц пагинации:", pageNumbers);

    const maxPage = Math.max(...pageNumbers, 1);
    console.log("📊 Максимальное количество страниц:", maxPage);
    sendStatus(`📄 Всего страниц: ${maxPage}`);

    const companies = [];
    console.log("🚀 Начинаем парсинг страниц...");

    for (let i = 1; i <= maxPage; i++) {
      const url = `${baseUrl},${i}.html`;
      console.log(`➡️ Обрабатываем страницу ${i} по URL: ${url}`);
      sendStatus(`➡️ Страница ${i}: загружаем ${url}`);

      try {
        await pageInstance.goto(url, { waitUntil: "networkidle" });
        console.log(`🌐 Страница ${i} загружена`);

        const html = await pageInstance.content();
        console.log(
          `📝 Получен HTML страницы ${i}, размер: ${html.length} символов`
        );

        const match = html.match(/var\s+markers\s*=\s*(\[\{.+?\}\]);/s);
        if (!match) {
          console.warn(`⚠️ markers не найден на странице ${i}`);
          sendStatus(`⚠️ markers не найден на странице ${i}`);
          continue;
        }
        console.log(`🔍 markers найден на странице ${i}`);

        const markers = JSON.parse(match[1]);
        console.log(
          `📦 markers распарсен, количество элементов: ${markers.length}`
        );

        for (const marker of markers) {
          console.log(
            `📍 Обрабатываем marker с ${
              marker.companies?.length || 0
            } компаниями`
          );
          for (const company of marker.companies || []) {
            const contact = company.contact || {};
            const slugMatch = company.slug.match(/-([a-z0-9_]+)\.html$/i);
            const slugId = slugMatch ? slugMatch[1] : "";
            const card = $(`li.card.company-item[data-eid="${slugId}"]`);
            const entry = {
              name: company.name,
              address: company.address || "",
              slug: slugId,
              // card: card.length ? card.html() : "",
              stars: card._findBySelector(".rating-average").text()
                ? card._findBySelector(".rating-average").text()
                : 0,
              reviews: (() => {
                const text = card
                  ._findBySelector(".rating-count")
                  .text()
                  .trim();
                const match = text.match(/\((\d+)\s*opini/i);
                return match ? parseInt(match[1], 10) : 0;
              })(),
            };

            if (contact.email) entry.email = contact.email;
            if (contact.phone?.formatted) entry.phone = contact.phone.formatted;
            if (contact.www) entry.www = contact.www;

            companies.push(entry);
            console.log(
              `   ➕ Добавлена компания: ${company.name}, slug: ${slugId}`
            );
          }
        }

        sendStatus(`✅ Страница ${i}: всего компаний — ${companies.length}`);
        console.log(
          `✅ Страница ${i} обработана, всего компаний сейчас: ${companies.length}`
        );
      } catch (err) {
        console.error(`❌ Ошибка при обработке страницы ${i}:`, err);
        sendStatus(`❌ Ошибка на странице ${i}: ${err.message}`);
      }

      await new Promise((r) => setTimeout(r, 100));
      console.log(`⏲️ Пауза 300 мс после страницы ${i}`);
    }

    await browser.close();
    console.log("🛑 Закрываем браузер");

    sendStatus(`🏁 Готово! Всего компаний: ${companies.length}`);
    console.log("🎉 Парсинг завершён. Всего компаний:", companies.length);
    res.json(companies);
  } catch (error) {
    console.error("🚨 Ошибка парсинга:", error);
    sendStatus(`🚨 Ошибка парсинга: ${error.message}`);
    res.status(500).json({ error: "Ошибка при парсинге." });
  }
});
