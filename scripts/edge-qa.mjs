import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.QA_BROWSER ? { executablePath: process.env.QA_BROWSER } : {}),
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
const report = [];
const base = process.env.QA_URL || "http://127.0.0.1:4173";
const d = () => page.evaluate(() => window.siderealDiagnostics);
try {
  await page.goto(base);
  await page.waitForSelector("#sky");
  const first = (await d()).score.stars[0];
  await page.locator(`[data-star="${first.id}"]`).focus();
  await page.keyboard.press("ArrowRight");
  assert.equal((await d()).score.stars.find((s) => s.id === first.id).step, 1);
  report.push("focused unselected star edits itself with keyboard");
  const box = await page.locator("#sky").boundingBox();
  const client = await page.context().newCDPSession(page);
  const y = box.y + box.height * 0.75,
    x = box.x + box.width * 0.8;
  const scrollBefore = await page.evaluate(() => scrollY);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
  for (let i = 1; i <= 5; i++)
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y - i * 35 }],
    });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await page.waitForTimeout(350);
  assert.ok((await page.evaluate(() => scrollY)) > scrollBefore);
  report.push("real touch swipe over empty SVG scrolls the page");
  await page.locator("[data-action=play]").click();
  await page.waitForTimeout(200);
  const other = await page.context().newPage();
  await other.goto("about:blank");
  await other.bringToFront();
  await page.waitForTimeout(500);
  const visibility = await page.evaluate(() => ({
    hidden: document.hidden,
    playing: window.siderealDiagnostics.playing,
  }));
  console.log("VISIBILITY", visibility);
  if (visibility.hidden) {
    assert.equal(visibility.playing, false);
    report.push("actual hidden tab pauses playback");
  } else
    report.push(
      "headless browser does not hide background tabs: manual device check remains",
    );
  await other.close();
  await page.bringToFront();
  await page.locator("[data-action=stop]").click();
  await page.evaluate(() =>
    localStorage.setItem("sidereal.draft.v1", "{malformed"),
  );
  await page.reload();
  await page.waitForSelector("#sky");
  assert.equal((await d()).score.format, "sidereal");
  assert.equal((await d()).contextState, "not-created");
  report.push("corrupt local draft recovers to a silent default score");
  await page.addInitScript(() => {
    Object.defineProperty(window, "AudioContext", {
      value: undefined,
      writable: true,
    });
    Object.defineProperty(window, "webkitAudioContext", {
      value: undefined,
      writable: true,
    });
  });
  await page.reload();
  await page.waitForSelector("#sky");
  await page.locator("[data-action=play]").click();
  assert.equal((await d()).playing, false);
  assert.equal((await d()).contextState, "not-created");
  assert.match(await page.locator("#status").textContent(), /unavailable/);
  report.push("Web Audio unavailable: visual editing and clear error remain");
} catch (e) {
  report.push({ error: e.stack });
  process.exitCode = 1;
} finally {
  console.log(report);
  await fs.mkdir("qa-artifacts", { recursive: true });
  await fs.writeFile(
    "qa-artifacts/edge-report.json",
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
