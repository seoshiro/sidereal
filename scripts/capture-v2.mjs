import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.QA_BROWSER,
});
const base = process.env.QA_URL || "http://127.0.0.1:4173/";
await fs.mkdir("docs/screenshots", { recursive: true });
for (const [name, width, height] of [
  ["editor-1366", 1366, 768],
  ["editor-1440", 1440, 900],
  ["editor-short", 1366, 600],
  ["editor-1920", 1920, 1080],
  ["editor-mobile390", 390, 844],
  ["editor-mobile360", 360, 800],
  ["editor-tablet768", 768, 1024],
]) {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
  await page.goto(base);
  await page.waitForSelector("#sky");
  await page.locator("#boot-screen").waitFor({ state: "detached" });
  if (name === "editor-1366")
    await page.screenshot({
      path: "docs/screenshots/tour-desktop.png",
      fullPage: true,
    });
  if (name === "editor-mobile390")
    await page.screenshot({
      path: "docs/screenshots/tour-mobile.png",
      fullPage: true,
    });
  await page.locator("#action-tour-skip").click();
  await page.screenshot({
    path: `docs/screenshots/${name}.png`,
    fullPage: true,
  });
  console.log(
    name,
    await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      orbit: document.querySelector("#stage").getBoundingClientRect().toJSON(),
      transport: document
        .querySelector("#transport")
        .getBoundingClientRect()
        .toJSON(),
      context: window.siderealDiagnostics.contextState,
    })),
  );
  if (name === "editor-mobile390") {
    await page.locator("#action-panel").click();
    await page.screenshot({
      path: "docs/screenshots/note-mobile.png",
      fullPage: true,
    });
    await page.locator("#action-close-panel").click();
    await page.locator("#action-language").click();
    await page.locator("#action-atlas").click();
    await page.locator("#preset-evening").click();
    await page.screenshot({
      path: "docs/screenshots/editor-mobile390-ru.png",
      fullPage: true,
    });
  }
  await page.close();
}
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
let release;
const hold = new Promise((r) => (release = r));
await page.route(
  base.includes("127.0.0.1") ? "**/src/main.ts*" : "**/main-*.js",
  async (route) => {
    await hold;
    await route.continue();
  },
);
const nav = page.goto(base);
await page.locator("#boot-screen").waitFor();
await page.screenshot({ path: "docs/screenshots/loading.png" });
release();
await nav;
await page.waitForSelector("#sky");
await browser.close();
