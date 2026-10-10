import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const base = process.env.QA_URL || "https://seoshiro.github.io/sidereal/";
const results = [];
const response = await fetch(base);
assert.equal(response.status, 200);
const html = await response.text();
const local = await fs.readFile("dist/index.html", "utf8");
assert.equal(html, local);
results.push({
  name: "Published index exactly matches the local production build",
  status: "pass",
  url: base,
});
for (const path of [
  ...html.matchAll(/(?:src|href)="(\.\/(?:assets\/[^\"]+|favicon\.svg))"/g),
].map((x) => x[1])) {
  const result = await fetch(new URL(path, base));
  assert.equal(result.status, 200);
  const data = Buffer.from(await result.arrayBuffer());
  const build = await fs.readFile("dist/" + path.slice(2));
  assert.ok(data.equals(build));
  results.push({
    name: "Published asset under repository base path matches build",
    status: "pass",
    path,
    bytes: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
  });
}
const browser = await chromium.launch({
  headless: true,
  ...(process.env.QA_BROWSER ? { executablePath: process.env.QA_BROWSER } : {}),
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForSelector("#sky");
  assert.equal(
    await page.evaluate(() => window.siderealDiagnostics.contextState),
    "not-created",
  );
  await page.locator("[data-action=play]").click();
  await page.waitForTimeout(500);
  assert.equal(
    await page.evaluate(() => window.siderealDiagnostics.contextState),
    "running",
  );
  await page.locator("[data-action=stop]").click();
  assert.equal(
    await page.evaluate(() => window.siderealDiagnostics.activeVoices),
    0,
  );
  assert.deepEqual(errors, []);
  results.push({
    name: "Published instrument loads silently, plays through a real AudioContext and stops",
    status: "pass",
    browser: await browser.version(),
    pageErrors: errors,
  });
  for (const width of [360, 390, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      width,
    );
    await expectVisibleUndo(page);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const before = await page.evaluate(
    () => window.siderealDiagnostics.score.stars.length,
  );
  await page.locator("[data-action=add]").click();
  await page.evaluate(() => scrollTo(0, 0));
  await page.locator("[data-action=undo]").click();
  assert.equal(
    await page.evaluate(() => window.siderealDiagnostics.score.stars.length),
    before,
  );
  await page.locator("[data-action=redo]").click();
  assert.equal(
    await page.evaluate(() => window.siderealDiagnostics.score.stars.length),
    before + 1,
  );
  results.push({
    name: "All five responsive widths have no overflow; mobile undo and redo work",
    status: "pass",
  });
  await page.locator("[data-action=save]").click();
  await page.locator("[data-preset=glass]").click();
  await page.locator("[data-action=save]").click();
  assert.equal(await page.locator("[data-load]").count(), 2);
  await page.reload();
  await page.waitForSelector("#sky");
  assert.equal(await page.locator("[data-load]").count(), 2);
  assert.equal(
    await page.evaluate(() => window.siderealDiagnostics.contextState),
    "not-created",
  );
  results.push({
    name: "Multiple named compositions survive a live-page reload without starting sound",
    status: "pass",
  });
} finally {
  await browser.close();
  await fs.mkdir("qa-artifacts", { recursive: true });
  await fs.writeFile(
    "qa-artifacts/deployment-report.json",
    JSON.stringify(results, null, 2),
  );
  console.log(results);
}
async function expectVisibleUndo(page) {
  assert.equal(await page.locator("[data-action=undo]").isVisible(), true);
}
