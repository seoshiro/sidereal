import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.QA_BROWSER,
});
const base = process.env.QA_URL || "http://127.0.0.1:4173/";
const report = [],
  errors = [];
const initTiming = () => {
  let boot;
  window.__loaderTiming = {};
  new MutationObserver((records) => {
    boot ??= document.getElementById("boot-screen");
    if (document.getElementById("sky") && !window.__loaderTiming.prepared)
      window.__loaderTiming.prepared = performance.now();
    if (
      records.some(
        (r) =>
          r.target === boot &&
          r.attributeName === "class" &&
          boot.classList.contains("ready"),
      ) &&
      !window.__loaderTiming.ready
    )
      window.__loaderTiming.ready = performance.now();
    if (boot && !boot.isConnected && !window.__loaderTiming.removed)
      window.__loaderTiming.removed = performance.now();
  }).observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"],
  });
};
const context = await browser.newContext({
  viewport: { width: 1366, height: 768 },
});
await context.addInitScript(initTiming);
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
const diag = (p = page) => p.evaluate(() => window.siderealDiagnostics);
const ready = async (p) => {
  await p.waitForSelector("#sky");
  await p.locator("#boot-screen").waitFor({ state: "detached" });
};
const snapshot = (p = page) =>
  p.evaluate(() => ({
    score: window.siderealDiagnostics.score,
    draft: localStorage.getItem("sidereal.draft.v1"),
    atlas: localStorage.getItem("sidereal.atlas.v1"),
    hash: location.hash,
  }));
const click = async (id) => page.locator("#" + id).click();
const check = async (name, run) => {
  await run();
  report.push({ name, status: "pass" });
  console.log("PASS", name);
};
async function duration(p, reduced) {
  const timing = await p.evaluate(() => window.__loaderTiming);
  const extra = timing.ready - timing.prepared;
  assert.ok(extra >= 1950 && extra < 2900, JSON.stringify(timing));
  assert.ok(timing.removed >= timing.ready);
  report.push({
    loading: {
      reducedMotion: reduced,
      additionalMilliseconds: extra,
      fadeMilliseconds: timing.removed - timing.ready,
    },
  });
}
await fs.mkdir("qa-artifacts", { recursive: true });
try {
  await page.goto(base);
  await page.waitForSelector("#sky");
  assert.equal(await page.locator("#app").evaluate((e) => e.inert), true);
  await page.keyboard.press("Space");
  assert.equal((await diag()).contextState, "not-created");
  await ready(page);
  await check(
    "real preparation plus approximately two seconds; no percentage; silent/inert while loading",
    async () => {
      await duration(page, false);
      assert.equal((await diag()).contextState, "not-created");
      assert.equal(await page.locator("#boot-screen").count(), 0);
      await expect(page.locator("#action-home")).toHaveAccessibleName(
        "SIDEREAL — Back to editor",
      );
    },
  );
  await check(
    "first-tour logo return restores original sky and marks practice skipped without draft/atlas writes",
    async () => {
      const original = (await diag()).userScore;
      await click("action-add");
      await click("action-home");
      assert.equal((await diag()).lesson, null);
      assert.deepEqual((await diag()).score, original);
      assert.equal(
        await page.evaluate(() => localStorage.getItem("sidereal.draft.v1")),
        null,
      );
      assert.equal(
        await page.evaluate(() => localStorage.getItem("sidereal.atlas.v1")),
        null,
      );
      assert.equal(
        JSON.parse(
          await page.evaluate(() => localStorage.getItem("sidereal.lesson.v2")),
        ).status,
        "skipped",
      );
    },
  );
  await page.locator("#title").fill("Logo safety");
  await page.locator("#title").press("Tab");
  await click("action-add");
  await click("action-add");
  await click("action-save");
  const original = await snapshot();
  const overlapping = (await diag()).score.stars.at(-1).id;
  await check(
    "normal return closes disclosures, preserves score/draft/atlas and does not restart loader",
    async () => {
      await page.locator("#tuning summary").click();
      await page.locator("#note-list summary").click();
      await page.locator("#action-home").focus();
      await page.keyboard.press("Space");
      assert.deepEqual(await snapshot(), original);
      assert.equal(
        await page.locator("#tuning").evaluate((e) => e.open),
        false,
      );
      assert.equal(
        await page.locator("#note-list").evaluate((e) => e.open),
        false,
      );
      assert.equal(await page.locator("#boot-screen").count(), 0);
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        "action-home",
      );
    },
  );
  await check(
    "keyboard Enter exits listening while preserving active playback and user data",
    async () => {
      await click("action-play");
      await page.waitForTimeout(200);
      await click("action-listening");
      const before = (await diag()).beat;
      await page.locator("#action-home").focus();
      await page.keyboard.press("Enter");
      assert.equal((await diag()).listening, false);
      assert.equal((await diag()).playing, true);
      assert.ok((await diag()).beat >= before);
      assert.deepEqual(await snapshot(), original);
      assert.equal(
        await page.locator("#inspector").evaluate((e) => e.inert),
        false,
      );
      await click("action-stop");
    },
  );
  await check(
    "actual logo controls return from atlas, dense picker, clipboard fallback and export menu",
    async () => {
      await click("action-atlas");
      await click("home-atlas");
      assert.equal(
        await page.locator("#atlas-dialog").evaluate((e) => e.open),
        false,
      );
      const pos = await page
        .locator(`[data-star="${overlapping}"]`)
        .evaluate((e) => {
          const p = new DOMPoint(0, 0).matrixTransform(e.getScreenCTM());
          return { x: p.x, y: p.y };
        });
      await page.mouse.click(pos.x, pos.y);
      await expect(page.locator("#pick-dialog")).toBeVisible();
      await click("home-pick");
      await page.evaluate(() =>
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: async () => {
              throw Error("denied");
            },
          },
        }),
      );
      await click("export-summary");
      await click("action-share");
      await expect(page.locator("#link-dialog")).toBeVisible();
      await click("home-link");
      await click("export-summary");
      await click("action-home");
      assert.equal(
        await page.locator("#export-menu").evaluate((e) => e.open),
        false,
      );
      assert.equal(await page.locator("dialog[open]").count(), 0);
      assert.deepEqual(await snapshot(), original);
    },
  );
  await check(
    "return from modified practice restores user edits and Undo/Redo history",
    async () => {
      await click("action-help");
      await click("action-add");
      await page.locator("#duration").selectOption("4");
      await click("action-save");
      await click("action-home");
      assert.deepEqual(await snapshot(), original);
      assert.equal((await diag()).lesson, null);
      await click("action-undo");
      assert.equal(
        (await diag()).score.stars.length,
        original.score.stars.length - 1,
      );
      await click("action-redo");
      assert.deepEqual((await diag()).score, original.score);
    },
  );
  await check(
    "RU/EN keyboard names and pending shared URL survive logo/tour return",
    async () => {
      await click("action-language");
      await expect(page.locator("#action-home")).toHaveAccessibleName(
        "SIDEREAL — Вернуться в редактор",
      );
      await page.locator("#action-home").focus();
      await page.keyboard.press("Enter");
      await click("action-language");
      await expect(page.locator("#action-home")).toHaveAccessibleName(
        "SIDEREAL — Back to editor",
      );
      const share = Buffer.from(JSON.stringify(original.score)).toString(
        "base64url",
      );
      await page.goto(`${base}#score=${share}`);
      await page.reload();
      await ready(page);
      assert.equal((await diag()).pendingShare, true);
      const incoming = await snapshot();
      await click("action-help");
      await click("action-add");
      await click("action-home");
      assert.deepEqual(await snapshot(), incoming);
      assert.equal((await diag()).pendingShare, true);
    },
  );
  await check(
    "touch RU mobile sheet/atlas/listening/tour returns preserve raw storage and reload",
    async () => {
      const c = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      await c.addInitScript(initTiming);
      const seed = await page.evaluate(() => ({
        draft: localStorage.getItem("sidereal.draft.v1"),
        atlas: localStorage.getItem("sidereal.atlas.v1"),
        lesson: localStorage.getItem("sidereal.lesson.v2"),
      }));
      await c.addInitScript((seed) => {
        for (const [key, value] of Object.entries({
          "sidereal.draft.v1": seed.draft,
          "sidereal.atlas.v1": seed.atlas,
          "sidereal.lesson.v2": seed.lesson,
          "sidereal.language": "ru",
        }))
          if (localStorage.getItem(key) === null && value !== null)
            localStorage.setItem(key, value);
      }, seed);
      const p = await c.newPage();
      p.on("pageerror", (e) => errors.push(e.message));
      await p.goto(base);
      await p.waitForSelector("#sky");
      assert.match(await p.locator("#boot-status").textContent(), /[А-Яа-я]/);
      await ready(p);
      await duration(p, false);
      const before = await snapshot(p);
      await p.locator("#action-panel").tap();
      await expect(p.locator("#home-panel")).toBeVisible();
      await p.screenshot({ path: "qa-artifacts/home-mobile-panel.png" });
      await p.locator("#home-panel").tap();
      assert.equal(
        await p.locator("#inspector").getAttribute("aria-modal"),
        null,
      );
      await p.locator("#action-atlas").tap();
      await p.screenshot({ path: "qa-artifacts/home-mobile-atlas.png" });
      await p.locator("#home-atlas").tap();
      await p.locator("#action-listening").tap();
      await p.locator("#action-home").tap();
      assert.equal((await diag(p)).listening, false);
      await p.locator("#action-help").tap();
      await p.locator("#action-add").tap();
      await p.locator("#action-panel").tap();
      await p.locator("#duration").selectOption("2");
      await p.locator("#home-panel").tap();
      assert.deepEqual(await snapshot(p), before);
      assert.equal((await diag(p)).lesson, null);
      await p.reload();
      await ready(p);
      assert.deepEqual(await snapshot(p), before);
      assert.equal((await diag(p)).contextState, "not-created");
      assert.equal(await p.locator("#boot-screen").count(), 0);
      await c.close();
    },
  );
  await check(
    "reduced motion still adds two seconds, has no assembly animation or fade",
    async () => {
      const p = await browser.newPage({
        viewport: { width: 390, height: 844 },
        reducedMotion: "reduce",
      });
      await p.addInitScript(initTiming);
      await p.goto(base);
      await p.waitForSelector("#sky");
      assert.equal(
        await p
          .locator(".boot-ring")
          .evaluate((e) => getComputedStyle(e).animationName),
        "none",
      );
      await ready(p);
      await duration(p, true);
      assert.equal(await p.locator("#boot-screen").count(), 0);
      assert.equal((await diag(p)).contextState, "not-created");
      await p.close();
    },
  );
  await check(
    "module failure shows immediate error; Retry keeps the requested success delay",
    async () => {
      const p = await browser.newPage();
      await p.addInitScript(initTiming);
      const match = base.includes("127.0.0.1")
        ? "**/src/main.ts*"
        : "**/main-*.js";
      await p.route(match, (route) => route.abort());
      const start = Date.now();
      await p.goto(base);
      await expect(p.locator("#boot-error")).toBeVisible({ timeout: 2000 });
      assert.ok(Date.now() - start < 2000);
      assert.equal(await p.locator("#app").evaluate((e) => e.inert), true);
      await p.unroute(match);
      await p.locator("#boot-retry").click();
      await ready(p);
      await duration(p, false);
      await p.close();
    },
  );
  assert.deepEqual(errors, []);
  report.push({
    url: base,
    browser: await browser.version(),
    pageErrors: errors,
    checkedAt: new Date().toISOString(),
  });
} catch (error) {
  report.push({ failure: error.stack });
  console.error(error);
  process.exitCode = 1;
  await page
    .screenshot({
      path: "qa-artifacts/home-loader-failure.png",
      fullPage: true,
    })
    .catch(() => {});
} finally {
  await fs.writeFile(
    "qa-artifacts/home-loader-report.json",
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
