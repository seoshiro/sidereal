import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.QA_BROWSER ? { executablePath: process.env.QA_BROWSER } : {}),
});
const context = await browser.newContext();
const page = await context.newPage();
const results = [];
try {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    }),
  );
  await page.goto(process.env.QA_URL || "https://seoshiro.github.io/sidereal/");
  await page.locator("summary").click();
  await page.locator("[data-action=share]").click();
  await expect(page.locator("#link-dialog")).toBeVisible();
  const link = await page.locator("#share-link").inputValue();
  assert.ok(link.includes("#score="));
  await page.locator("[data-action=close-link]").click();
  const original = await page.evaluate(() => window.siderealDiagnostics.score);
  const shared = await context.newPage();
  await shared.goto(link);
  await shared.waitForSelector("#sky");
  assert.deepEqual(
    await shared.evaluate(() => window.siderealDiagnostics.score.stars),
    original.stars,
  );
  assert.equal(
    await shared.evaluate(() => window.siderealDiagnostics.contextState),
    "not-created",
  );
  assert.equal(await shared.evaluate(() => location.hash), "");
  await shared.locator("#title").fill("Edited shared sky");
  await shared.locator("#title").press("Tab");
  await shared.reload();
  await shared.waitForSelector("#sky");
  assert.equal(
    await shared.locator("#title").inputValue(),
    "Edited shared sky",
  );
  results.push({
    name: "Real Share control produces a valid link through the clipboard-free fallback; shared edits survive reload",
    status: "pass",
    clipboard: "OS clipboard never read or changed",
  });
} catch (e) {
  results.push({ error: e.stack });
  process.exitCode = 1;
} finally {
  await fs.mkdir("qa-artifacts", { recursive: true });
  await fs.writeFile(
    "qa-artifacts/share-report.json",
    JSON.stringify(results, null, 2),
  );
  console.log(results);
  await browser.close();
}
