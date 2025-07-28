const { exec } = require("child_process");

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
  } = req.query;

  const baseUrl = `https://panoramafirm.pl/${type}/${region},,${city}/firmy`;

  try {
    const browser = await chromium.launch({ headless: true });
    const pageInstance = await browser.newPage();

    // ШАГ 1: Получаем первую страницу
    const firstPageUrl = `${baseUrl},1.html`;
    await pageInstance.goto(firstPageUrl, { waitUntil: "networkidle" });
    const firstPageHTML = await pageInstance.content();
    const $ = cheerio.load(firstPageHTML);

    // ШАГ 2: Находим количество страниц
    const pageNumbers = $("ul.pagination li a[data-paginatorpage]")
      .map((_, el) => parseInt($(el).attr("data-paginatorpage"), 10))
      .get()
      .filter((n) => !isNaN(n));

    const maxPage = Math.max(...pageNumbers, 1);
    console.log(`📄 Всего страниц для обработки: ${maxPage}`);

    const jsonldElements = [];

    // ШАГ 3: Перебор всех страниц
    for (let i = 1; i <= maxPage; i++) {
      const url = `${baseUrl},${i}.html`;
      console.log(`➡️ Страница ${i}: загружаем ${url}`);

      try {
        await pageInstance.goto(url, { waitUntil: "networkidle" });
        const html = await pageInstance.content();
        const $$ = cheerio.load(html);

        let countOnPage = 0;

        $$('script[type="application/ld+json"]').each((_, el) => {
          try {
            const raw = $$(el).html();
            const parsed = JSON.parse(raw);

            if (Array.isArray(parsed)) {
              parsed.forEach((item) => {
                if (item["@type"] === "LocalBusiness") {
                  jsonldElements.push(item);
                  countOnPage++;
                }
              });
            } else if (parsed["@type"] === "LocalBusiness") {
              jsonldElements.push(parsed);
              countOnPage++;
            }
          } catch (e) {
            console.warn(
              `⚠️ JSON-LD ошибка парсинга на стр. ${i}: ${e.message}`
            );
          }
        });

        console.log(`✅ Страница ${i}: получено ${countOnPage} компаний`);
      } catch (pageError) {
        console.error(
          `❌ Ошибка при обработке страницы ${i}:`,
          pageError.message
        );
      }

      // задержка, чтобы не перегружать сервер
      await new Promise((r) => setTimeout(r, 300));
    }

    await browser.close();
    console.log(
      `🏁 Завершено! Всего компаний собрано: ${jsonldElements.length}`
    );

    res.json(jsonldElements);
  } catch (error) {
    console.error("🚨 Общая ошибка при обработке запроса:", error.message);
    res.status(500).json({ error: "Ошибка при парсинге страниц." });
  }
});

app.listen(PORT, () => {
  console.log(`Сервер запущен на http://localhost:${PORT}`);

  const url = `http://localhost:${PORT}`;

  //   const startCmd =
  //     process.platform === "win32"
  //       ? `start ${url}`
  //       : process.platform === "darwin"
  //       ? `open ${url}`
  //       : `xdg-open ${url}`;

  //   exec(startCmd, (err) => {
  //     if (err) {
  //       console.error("Не удалось открыть браузер:", err);
  //     }
  //   });
});
