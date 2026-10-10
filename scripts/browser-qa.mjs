import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const base = process.env.QA_URL || "http://127.0.0.1:4173";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.QA_BROWSER ? { executablePath: process.env.QA_BROWSER } : {}),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  acceptDownloads: true,
});
const page = await context.newPage();
const errors = [],
  report = [];
page.on("pageerror", (e) => errors.push(e.message));
const diag = () => page.evaluate(() => window.siderealDiagnostics);
async function menu() {
  if ((await page.locator(".export-menu").getAttribute("open")) === null)
    await page.locator("summary").click();
}
async function check(name, fn) {
  await fn();
  report.push({ name, status: "pass" });
  console.log("PASS", name);
}
await fs.mkdir("qa-artifacts", { recursive: true });
try {
  await page.goto(base);
  await page.waitForSelector("#sky");
  await check("no audio before an explicit gesture", async () => {
    assert.equal((await diag()).contextState, "not-created");
  });
  await check(
    "play / pause / resume / stop uses a real AudioContext",
    async () => {
      await page.locator("[data-action=play]").click();
      await page.waitForTimeout(800);
      assert.equal((await diag()).contextState, "running");
      assert.equal((await diag()).playing, true);
      await page.locator("[data-action=play]").click();
      const stopped = (await diag()).beat;
      await page.waitForTimeout(350);
      assert.equal((await diag()).beat, stopped);
      await page.locator("[data-action=play]").click();
      await page.waitForTimeout(250);
      assert.equal((await diag()).playing, true);
      await page.locator("[data-action=stop]").click();
      assert.equal((await diag()).beat, 0);
      assert.equal((await diag()).activeVoices, 0);
    },
  );
  await check(
    "preset switches stop sound; tempo changes stay valid",
    async () => {
      await page.locator("[data-action=play]").click();
      await page.locator("[data-preset=glass]").click();
      assert.equal((await diag()).playing, false);
      assert.equal((await diag()).score.bpm, 104);
      await page.locator("#tempo").fill("120");
      await page.locator("#tempo").press("Tab");
      assert.equal((await diag()).score.bpm, 120);
      await page.locator("[data-action=play]").click();
      await page.locator("#tempo").fill("90");
      await page.locator("#tempo").press("Tab");
      await page.waitForTimeout(200);
      assert.equal((await diag()).playing, true);
      await page.locator("[data-action=stop]").click();
    },
  );
  await check("keyboard editing, add, remove, undo and redo", async () => {
    const before = (await diag()).score.stars.length;
    await page.locator("[data-action=add]").click();
    assert.equal((await diag()).score.stars.length, before + 1);
    const id = (await diag()).score.stars.at(-1).id;
    await page.locator(`[data-star="${id}"]`).focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowUp");
    const n = (await diag()).score.stars.find((n) => n.id === id);
    assert.equal(n.step, 1);
    assert.equal(n.degree, 7);
    await page.keyboard.press("Delete");
    assert.equal((await diag()).score.stars.length, before);
    await page.locator("[data-action=undo]").click();
    assert.equal((await diag()).score.stars.length, before + 1);
    await page.locator("[data-action=redo]").click();
    assert.equal((await diag()).score.stars.length, before);
  });
  await check(
    "drag moves one star without adding an accidental note",
    async () => {
      await page.locator("[data-preset=evening]").click();
      const before = (await diag()).score;
      const id = before.stars[2].id;
      const box = await page.locator(`[data-star="${id}"]`).boundingBox();
      const sky = await page.locator("#sky").boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        sky.x + sky.width * 0.5,
        sky.y + sky.height * 0.22,
        { steps: 12 },
      );
      await page.mouse.up();
      const after = (await diag()).score;
      assert.equal(after.stars.length, before.stars.length);
      assert.notEqual(
        after.stars.find((s) => s.id === id).step,
        before.stars.find((s) => s.id === id).step,
      );
    },
  );
  await check(
    "exact note, duration, scale, root and timbre controls",
    async () => {
      await page.locator("#note").selectOption("8");
      await page.locator("#duration").selectOption("2");
      await page.locator("#scale").selectOption("dorian");
      await page.locator("#root").selectOption("2");
      await page.locator("#voice-0").selectOption("felt");
      const s = (await diag()).score;
      assert.equal(s.root, 2);
      assert.equal(s.scale, "dorian");
      assert.equal(s.layers[0].voice, "felt");
      assert.ok(s.stars.some((s) => s.degree === 8 && s.duration === 2));
    },
  );
  await check("mute / solo and master mute toggle immediately", async () => {
    await page.locator('[data-mute="0"]').click();
    assert.equal((await diag()).score.layers[0].mute, true);
    await page.locator('[data-solo="1"]').click();
    assert.equal((await diag()).score.layers[1].solo, true);
    await page.locator("[data-action=master]").click();
    assert.equal((await diag()).muted, true);
    await page.locator("[data-action=play]").click();
    await page.waitForTimeout(250);
    assert.equal((await diag()).muted, true);
    await page.locator("[data-action=master]").click();
    assert.equal((await diag()).muted, false);
    await page.locator("[data-action=stop]").click();
  });
  await check("named atlas and draft survive reload", async () => {
    await page.locator("#title").fill("QA constellation");
    await page.locator("#title").press("Tab");
    await page.locator("[data-action=save]").click();
    const saved = (await diag()).score;
    await page.reload();
    await page.waitForSelector("#sky");
    assert.deepEqual((await diag()).score, saved);
    assert.equal(await page.locator("[data-load]").count(), 1);
    assert.equal((await diag()).contextState, "not-created");
    await page.locator("[data-action=new]").click();
    assert.equal((await diag()).score.stars.length, 0);
    await page.locator("[data-load]").click();
    assert.deepEqual((await diag()).score, saved);
  });
  await check(
    "malformed and hostile imports are rejected without changing the score",
    async () => {
      const before = (await diag()).score;
      for (const payload of [
        "{bad",
        JSON.stringify({ ...before, version: 99 }),
        JSON.stringify({
          ...before,
          stars: [{ ...before.stars[0], id: '" onload="alert(1)' }],
        }),
      ]) {
        await page.locator("#import-file").setInputFiles({
          name: "bad.json",
          mimeType: "application/json",
          buffer: Buffer.from(payload),
        });
        await expect(page.locator("#status")).toContainText("Could not");
        assert.deepEqual((await diag()).score, before);
      }
    },
  );
  await check("JSON export and valid import round-trip", async () => {
    await page.locator("summary").click();
    const p = page.waitForEvent("download");
    await page.locator("[data-action=json]").click();
    const download = await p;
    const file = await download.path();
    const raw = await fs.readFile(file, "utf8");
    assert.equal(JSON.parse(raw).format, "sidereal");
    await page.locator("#import-file").setInputFiles({
      name: "score.json",
      mimeType: "application/json",
      buffer: Buffer.from(raw),
    });
    await expect(page.locator("#status")).toContainText("Score opened");
  });
  await check("PNG export really decodes to 1600 × 1880", async () => {
    await menu();
    const p = page.waitForEvent("download");
    await page.locator("[data-action=png]").click();
    const file = await (await p).path();
    const bytes = await fs.readFile(file);
    assert.equal(bytes.readUInt32BE(16), 1600);
    assert.equal(bytes.readUInt32BE(20), 1880);
    await fs.copyFile(file, "qa-artifacts/score.png");
    const decoded = await page.evaluate(async (b64) => {
      const i = new Image();
      i.src = "data:image/png;base64," + b64;
      await i.decode();
      return [i.naturalWidth, i.naturalHeight];
    }, bytes.toString("base64"));
    assert.deepEqual(decoded, [1600, 1880]);
  });
  await check(
    "WAV export decodes to non-silent stereo PCM without clipping",
    async () => {
      await page.locator("[data-preset=evening]").click();
      await page.locator("summary").click();
      const p = page.waitForEvent("download");
      await page.locator("[data-action=wav]").click();
      const file = await (await p).path();
      const bytes = await fs.readFile(file);
      assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
      assert.equal(bytes.readUInt16LE(22), 2);
      assert.equal(bytes.readUInt32LE(24), 44100);
      await fs.copyFile(file, "qa-artifacts/orbit.wav");
      const audio = await page.evaluate(async (b64) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const ctx = new AudioContext();
        const buffer = await ctx.decodeAudioData(bytes.buffer);
        let peak = 0,
          energy = 0;
        for (const value of buffer.getChannelData(0)) {
          peak = Math.max(peak, Math.abs(value));
          energy += value * value;
        }
        await ctx.close();
        return {
          duration: buffer.duration,
          channels: buffer.numberOfChannels,
          peak,
          rms: Math.sqrt(energy / buffer.length),
        };
      }, bytes.toString("base64"));
      assert.equal(audio.channels, 2);
      assert.ok(audio.duration > 16 && audio.duration < 35);
      assert.ok(audio.peak > 0.01 && audio.peak < 0.91);
      assert.ok(audio.rms > 0.001);
      report.push({ audio });
      console.log("AUDIO", audio);
    },
  );
  await check("RU / EN, help dialog and keyboard focus", async () => {
    await page.locator("[data-action=language]").click();
    assert.equal(await page.locator("html").getAttribute("lang"), "ru");
    await expect(page.locator("[data-action=play]")).toContainText("Играть");
    await page.locator("[data-action=help]").click();
    await expect(page.locator("#help-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#help-dialog")).not.toBeVisible();
    await page.locator("[data-action=language]").click();
    assert.equal(await page.locator("html").getAttribute("lang"), "en");
  });
  await check(
    "reduced motion suppresses sweeping while sound remains functional",
    async () => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.locator("[data-action=play]").click();
      const first = await page.locator("#sweep").getAttribute("transform");
      await page.waitForTimeout(800);
      assert.equal(
        await page.locator("#sweep").getAttribute("transform"),
        first,
      );
      assert.equal((await diag()).playing, true);
      await page.locator("[data-action=stop]").click();
      await page.emulateMedia({ reducedMotion: "no-preference" });
    },
  );
  await check(
    "share link restores a score without creating sound",
    async () => {
      const s = (await diag()).score;
      const code = Buffer.from(JSON.stringify(s)).toString("base64url");
      const shared = await context.newPage();
      await shared.goto(`${base}#score=${code}`);
      await shared.waitForSelector("#sky");
      const d = await shared.evaluate(() => window.siderealDiagnostics);
      assert.equal(d.score.title, s.title);
      assert.deepEqual(d.score.stars, s.stars);
      assert.equal(d.contextState, "not-created");
      await shared.close();
    },
  );
  await check(
    "responsive 360 / 390 / 768 / 1440 / 1920 and mobile atlas",
    async () => {
      for (const width of [360, 390, 768, 1440, 1920]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth),
          width,
        );
        await expect(page.locator("[data-action=play]")).toBeVisible();
        if (width <= 390) await expect(page.locator(".atlas")).toBeVisible();
      }
      await page.setViewportSize({ width: 1440, height: 1100 });
    },
  );
  await check("repeated preview clicks leave bounded nodes", async () => {
    for (let i = 0; i < 15; i++)
      await page.locator("[data-action=preview]").click();
    assert.ok((await diag()).activeVoices <= 1);
    await page.locator("[data-action=stop]").click();
    assert.equal((await diag()).activeVoices, 0);
  });
  await check(
    "70 seconds of playback stays bounded and Stop clears all voices",
    async () => {
      await page.locator("#tempo").fill("180");
      await page.locator("#tempo").press("Tab");
      await page.locator("[data-action=play]").click();
      for (let i = 0; i < 7; i++) {
        await page.waitForTimeout(10000);
        const d = await diag();
        assert.equal(d.playing, true);
        assert.ok(d.activeVoices <= 30);
        console.log("PLAYBACK", 10 * (i + 1), d.activeVoices);
      }
      await page.locator("[data-action=stop]").click();
      assert.equal((await diag()).activeVoices, 0);
    },
  );
  assert.deepEqual(errors, []);
  report.push({
    browser: await browser.version(),
    pageErrors: errors,
    auditoryReview:
      "Not available. Web Audio rendering and decode were verified; no claim of human listening.",
  });
} catch (e) {
  report.push({ error: e.stack });
  console.error(e);
  process.exitCode = 1;
} finally {
  await fs.writeFile(
    "qa-artifacts/browser-report.json",
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
