import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.QA_BROWSER ? { executablePath: process.env.QA_BROWSER } : {}),
});
await fs.mkdir("docs/screenshots", { recursive: true });
for (const [name, width, height] of [
  ["desktop-1440", 1440, 1120],
  ["desktop-1920", 1920, 1280],
  ["mobile-390", 390, 844],
  ["mobile-360", 360, 800],
  ["tablet-768", 768, 1024],
]) {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  await page.goto(process.env.QA_URL || "http://127.0.0.1:4173");
  await page.waitForSelector("#sky");
  await page.screenshot({
    path: `docs/screenshots/${name}.png`,
    fullPage: true,
  });
  if (name === "mobile-390") {
    await page.locator("[data-action=language]").click();
    await page.screenshot({
      path: "docs/screenshots/mobile-390-ru.png",
      fullPage: true,
    });
    console.log(
      "RU",
      await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        width: innerWidth,
      })),
    );
  }
  console.log(
    name,
    await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      width: innerWidth,
      stars: document.querySelectorAll("[data-star]").length,
      context: window.siderealDiagnostics.contextState,
    })),
  );
  await page.close();
}
await browser.close();
