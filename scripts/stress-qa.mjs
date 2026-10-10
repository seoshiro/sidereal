import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.QA_BROWSER ? { executablePath: process.env.QA_BROWSER } : {}),
});
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
const report = [];
async function wave() {
  if ((await page.locator(".export-menu").getAttribute("open")) === null)
    await page.locator("summary").click();
  const wait = page.waitForEvent("download");
  await page.locator("[data-action=wav]").click();
  const data = await fs.readFile(await (await wait).path());
  return page.evaluate(async (text) => {
    const ctx = new AudioContext();
    const b = await ctx.decodeAudioData(
      Uint8Array.from(atob(text), (c) => c.charCodeAt(0)).buffer,
    );
    let peak = 0;
    for (let ch = 0; ch < b.numberOfChannels; ch++)
      for (const sample of b.getChannelData(ch))
        peak = Math.max(peak, Math.abs(sample));
    await ctx.close();
    return { peak, seconds: b.duration };
  }, data.toString("base64"));
}
try {
  await page.goto(process.env.QA_URL || "http://127.0.0.1:4173");
  const s = await page.evaluate(() => window.siderealDiagnostics.score);
  s.bpm = 180;
  s.layers.forEach((l) => {
    l.mute = false;
    l.solo = false;
    l.volume = 1;
  });
  s.stars = Array.from({ length: 96 }, (_, i) => ({
    id: `dense-${i}`,
    layer: i % 3,
    step: 0,
    degree: i % 15,
    duration: 4,
    velocity: 1,
  }));
  await page
    .locator("#import-file")
    .setInputFiles({
      name: "dense.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(s)),
    });
  await page.locator("#master-volume").fill("80");
  const loud = await wave();
  assert.ok(loud.peak > 0 && loud.peak < 0.91);
  report.push({
    name: "96 simultaneous stars at maximum intensity and master volume remain below clipping",
    status: "pass",
    audio: loud,
  });
  await page.locator("[data-action=play]").click();
  await page.waitForTimeout(600);
  assert.ok(
    (await page.evaluate(() => window.siderealDiagnostics.activeVoices)) <= 96,
  );
  await page.locator("#tempo").focus();
  await page.keyboard.press("Escape");
  assert.equal(
    await page.evaluate(() => window.siderealDiagnostics.playing),
    false,
  );
  assert.equal(
    await page.evaluate(() => window.siderealDiagnostics.activeVoices),
    0,
  );
  assert.match(await page.locator("[data-action=play]").textContent(), /Play/);
  report.push({
    name: "Escape from a form control stops sound and updates transport",
    status: "pass",
  });
  for (let i = 0; i < 3; i++) await page.locator(`[data-mute="${i}"]`).click();
  const silent = await wave();
  assert.equal(silent.peak, 0);
  report.push({
    name: "All layer mutes produce an actually silent WAV",
    status: "pass",
    audio: silent,
  });
} catch (e) {
  report.push({ error: e.stack });
  process.exitCode = 1;
} finally {
  await fs.mkdir("qa-artifacts", { recursive: true });
  await fs.writeFile(
    "qa-artifacts/stress-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(report);
  await browser.close();
}
