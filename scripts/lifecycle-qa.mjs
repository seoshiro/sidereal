import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
// An owned, minimized/offscreen browser. Never attaches to the user's browser.
const browser = await chromium.launch({
  headless: false,
  args: ["--start-minimized", "--window-position=-32000,-32000"],
  ...(process.env.QA_BROWSER ? { executablePath: process.env.QA_BROWSER } : {}),
});
const context = await browser.newContext();
const page = await context.newPage();
const report = [];
const session = await context.newCDPSession(page);
await session.send("Emulation.setFocusEmulationEnabled", { enabled: false });
try {
  await page.goto(process.env.QA_URL || "http://127.0.0.1:4173");
  await session.send("Emulation.setFocusEmulationEnabled", { enabled: false });
  await page.locator("[data-action=play]").click();
  await page.waitForTimeout(200);
  const other = await context.newPage();
  await other.goto("about:blank");
  await other.bringToFront();
  const ownWindow = await session.send("Browser.getWindowForTarget");
  await session.send("Browser.setWindowBounds", {
    windowId: ownWindow.windowId,
    bounds: { windowState: "minimized" },
  });
  await page.waitForTimeout(400);
  const actual = await page.evaluate(() => ({
    hidden: document.hidden,
    visibility: document.visibilityState,
    playing: window.siderealDiagnostics.playing,
    voices: window.siderealDiagnostics.activeVoices,
  }));
  if (actual.hidden) {
    assert.equal(actual.playing, false);
    assert.equal(actual.voices, 0);
    report.push({
      name: "Actual hidden document pauses and clears voices",
      status: "pass",
      actual,
    });
  } else {
    report.push({
      name: "Actual document visibility",
      status: "unverified",
      reason:
        "This automation environment keeps document.hidden false even with focus emulation disabled and the owned window minimized.",
      actual,
    });
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.equal(
      await page.evaluate(() => window.siderealDiagnostics.playing),
      false,
    );
    assert.equal(
      await page.evaluate(() => window.siderealDiagnostics.activeVoices),
      0,
    );
    report.push({
      name: "Visibility handler pauses and clears voices with a synthetic event",
      status: "pass",
      synthetic: true,
    });
    await page.evaluate(() => {
      delete document.hidden;
    });
  }
  await other.close();
  await session.send("Browser.setWindowBounds", {
    windowId: ownWindow.windowId,
    bounds: { windowState: "normal" },
  });
  await page.bringToFront();
  await page.locator("[data-action=play]").click();
  await page.waitForTimeout(200);
  assert.equal(
    await page.evaluate(() => window.siderealDiagnostics.playing),
    true,
  );
  await page.locator("[data-action=stop]").click();
  report.push({ name: "Explicit resume after tab returns", status: "pass" });
} catch (e) {
  report.push({ error: e.stack });
  process.exitCode = 1;
} finally {
  await fs.mkdir("qa-artifacts", { recursive: true });
  await fs.writeFile(
    "qa-artifacts/lifecycle-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(report);
  await browser.close();
}
