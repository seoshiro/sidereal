import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.QA_BROWSER,
});
const base = process.env.QA_URL || "http://127.0.0.1:4173/";
const report = [];
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const p = await context.newPage();
  await p.goto(base);
  await p.waitForSelector("#sky");
  await p.locator("#boot-screen").waitFor({ state: "detached" });
  await p.locator("#action-tour-skip").click();
  const box = await p.locator("#sky").boundingBox();
  const client = await context.newCDPSession(p);
  const x = box.x + box.width * 0.86,
    y = box.y + box.height * 0.76;
  const initial = await p.evaluate(() => scrollY);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
  for (let i = 1; i <= 6; i++)
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y - i * 26 }],
    });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await p.waitForTimeout(300);
  assert.ok((await p.evaluate(() => scrollY)) > initial);
  report.push({
    name: "Actual CDP touch swipe across empty orbit scrolls the mobile page",
    status: "pass",
  });
  const targets = await p
    .locator(
      ".header-actions button,.header-actions summary,.primary-controls button,.mobile-note-actions button,.tooltip-control button",
    )
    .evaluateAll((nodes) =>
      nodes
        .filter((n) => n.getClientRects().length)
        .map((n) => ({
          id: n.id,
          width: n.getBoundingClientRect().width,
          height: n.getBoundingClientRect().height,
        })),
    );
  assert.ok(targets.every((n) => n.width >= 44 && n.height >= 44));
  report.push({
    name: "Mobile header, transport and panel targets are at least 44 x 44 CSS px",
    status: "pass",
    targets,
  });
  await p.evaluate(() => localStorage.setItem("sidereal.draft.v1", "{broken"));
  await p.reload();
  await p.waitForSelector("#sky");
  await p.locator("#boot-screen").waitFor({ state: "detached" });
  assert.equal(
    await p.evaluate(() => localStorage.getItem("sidereal.draft.v1")),
    "{broken",
  );
  assert.equal(
    await p.evaluate(() => window.siderealDiagnostics.contextState),
    "not-created",
  );
  assert.equal(
    await p.evaluate(() => window.siderealDiagnostics.draftState),
    "failed",
  );
  report.push({
    name: "Malformed draft recovers silently and preserves raw data until an actual edit",
    status: "pass",
  });
  await p.evaluate(() => (document.documentElement.style.fontSize = "32px"));
  await expect(p.locator("#app")).toHaveClass(/text-large/);
  await p.screenshot({
    path: "docs/screenshots/text200-mobile.png",
    fullPage: true,
  });
  await p.locator("#action-panel").click();
  await p.locator("#duration").focus();
  await p.screenshot({
    path: "docs/screenshots/text200-panel.png",
    fullPage: false,
  });
  const position = await p.locator("#duration").boundingBox();
  assert.ok(position.y >= 0 && position.y + position.height <= 844);
  report.push({
    name: "200% mobile text: focused duration field scrolls into unobscured sheet viewport",
    status: "pass",
  });
  await context.close();
  const loader = await browser.newPage({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  let release;
  const hold = new Promise((r) => (release = r));
  const match = base.includes("127.0.0.1") ? "**/src/main.ts*" : "**/main-*.js";
  await loader.route(match, async (route) => {
    await hold;
    await route.continue();
  });
  const nav = loader.goto(base);
  await expect(loader.locator("#boot-screen")).toBeVisible();
  assert.equal(
    await loader
      .locator(".boot-ring")
      .evaluate((e) => getComputedStyle(e).animationName),
    "none",
  );
  await loader.screenshot({
    path: "docs/screenshots/loading-reduced-mobile.png",
  });
  release();
  await nav;
  await loader.waitForSelector("#sky");
  await loader.locator("#boot-screen").waitFor({ state: "detached" });
  assert.equal(
    await loader.evaluate(() => window.siderealDiagnostics.contextState),
    "not-created",
  );
  report.push({
    name: "Reduced-motion preparation has no assembling animation; real completion removes loader",
    status: "pass",
  });
  await loader.close();
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.push({ failure: error.stack });
  console.error(error);
  process.exitCode = 1;
} finally {
  await fs.mkdir("qa-artifacts", { recursive: true });
  await fs.writeFile(
    "qa-artifacts/v2-interaction-report.json",
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
