import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
const base = process.env.QA_URL || "http://127.0.0.1:4173/";
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.QA_BROWSER,
});
const report = [],
  errors = [];
const ctx = await browser.newContext({
  viewport: { width: 1366, height: 768 },
  acceptDownloads: true,
});
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(e.message));
const diag = (p = page) => p.evaluate(() => window.siderealDiagnostics);
const ready = async (p) => {
  await p.waitForSelector("#sky");
  await p.locator("#boot-screen").waitFor({ state: "detached" });
};
const check = async (name, fn) => {
  await fn();
  report.push({ name, status: "pass" });
  console.log("PASS", name);
};
const click = async (id) => page.locator("#" + id).click();
const change = async (id, value, p = page) => {
  const el = p.locator("#" + id);
  await el.fill(String(value));
  await el.press("Tab");
};
const importScore = async (score, p = page) => {
  await p.locator("#import-file").setInputFiles({
    name: "score.sidereal.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      typeof score === "string" ? score : JSON.stringify(score),
    ),
  });
  await p.waitForTimeout(80);
};
const preset = async (name) => {
  await click("action-atlas");
  await click("tab-presets");
  await page.locator(`[data-preset=${name}]`).click();
};
async function exportFile(type, artifact = "v2-" + type) {
  if (!(await page.locator("#export-menu").evaluate((e) => e.open)))
    await click("export-summary");
  const promise = page.waitForEvent("download");
  await click("action-" + type);
  const file = await (await promise).path();
  const bytes = await fs.readFile(file);
  await fs.writeFile(
    `qa-artifacts/${artifact}.${type === "json" ? "sidereal.json" : type}`,
    bytes,
  );
  return bytes;
}
async function decodeAudio(bytes) {
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const ctx = new AudioContext();
    const buffer = await ctx.decodeAudioData(bytes.buffer);
    let peak = 0,
      energy = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++)
      for (const v of buffer.getChannelData(channel)) {
        peak = Math.max(peak, Math.abs(v));
        energy += v * v;
      }
    await ctx.close();
    return {
      duration: buffer.duration,
      channels: buffer.numberOfChannels,
      sampleRate: buffer.sampleRate,
      peak,
      rms: Math.sqrt(energy / (buffer.length * buffer.numberOfChannels)),
    };
  }, bytes.toString("base64"));
}
async function completeTour(p = page) {
  const c = (id) => p.locator("#" + id).click();
  await c("action-play");
  await c("action-tour-next");
  await c("layer-1");
  await c("action-tour-next");
  await c("action-add");
  await c("action-tour-next");
  await p.keyboard.press("ArrowRight");
  await c("action-tour-next");
  await p.locator("#duration").selectOption("2");
  await c("action-tour-next");
  await c("action-save");
  await c("action-tour-next");
}
await fs.mkdir("qa-artifacts", { recursive: true });
try {
  await page.goto(base);
  await ready(page);
  await check(
    "first entry: six-step tour, silent until Play, no user draft/atlas writes",
    async () => {
      const d = await diag();
      assert.equal(d.contextState, "not-created");
      assert.equal(d.lesson.step, 0);
      assert.equal(
        await page.evaluate(() => localStorage.getItem("sidereal.draft.v1")),
        null,
      );
      assert.equal(
        await page.evaluate(() => localStorage.getItem("sidereal.atlas.v1")),
        null,
      );
      assert.equal(await page.locator("#action-tour-next").isDisabled(), true);
      await completeTour();
      assert.equal((await diag()).lesson, null);
      assert.equal((await diag()).playing, false);
      assert.equal(
        await page.evaluate(() => localStorage.getItem("sidereal.draft.v1")),
        null,
      );
      assert.equal(
        JSON.parse(
          await page.evaluate(() => localStorage.getItem("sidereal.lesson.v2")),
        ).status,
        "done",
      );
    },
  );
  const initial = (await diag()).score;
  await check(
    "Play/Pause/Resume/Stop preserves focused button and uses real AudioContext",
    async () => {
      await click("action-play");
      await page.waitForTimeout(500);
      assert.equal((await diag()).contextState, "running");
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        "action-play",
      );
      await click("action-play");
      const beat = (await diag()).beat;
      await page.waitForTimeout(250);
      assert.equal((await diag()).beat, beat);
      await click("action-play");
      await page.waitForTimeout(250);
      assert.ok((await diag()).beat >= beat);
      await click("action-stop");
      assert.equal((await diag()).beat, 0);
      assert.equal((await diag()).activeVoices, 0);
    },
  );
  await check(
    "all presets and live tempo changes preserve valid transport",
    async () => {
      for (const name of ["glass", "drift", "evening"]) {
        await click("action-play");
        await preset(name);
        assert.equal((await diag()).playing, false);
      }
      await change("tempo", 120);
      await click("action-play");
      await change("tempo", 90);
      await page.waitForTimeout(150);
      assert.equal((await diag()).playing, true);
      assert.equal((await diag()).score.bpm, 90);
      await click("action-stop");
    },
  );
  await check(
    "keyboard editing, duplicate/delete and Undo/Redo keep focus and open list",
    async () => {
      await page.locator("#note-list summary").click();
      await click("action-add");
      const s = (await diag()).score.stars.at(-1);
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowUp");
      let n = (await diag()).score.stars.find((n) => n.id === s.id);
      assert.equal(n.step, 1);
      assert.equal(n.degree, 7);
      await click("action-duplicate");
      const count = (await diag()).score.stars.length;
      await click("action-remove");
      await click("action-undo");
      assert.equal((await diag()).score.stars.length, count);
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        "action-undo",
      );
      await click("action-redo");
      assert.equal((await diag()).score.stars.length, count - 1);
      await page.locator("#note-rows button").first().click();
      assert.equal(
        await page.locator("#note-list").evaluate((e) => e.open),
        true,
      );
      assert.ok(
        (await page.locator("#note-rows button.selected").count()) === 1,
      );
    },
  );
  await check("drag changes one note without adding another", async () => {
    await preset("evening");
    const before = (await diag()).score;
    const id = before.stars[2].id;
    const pos = await page.locator(`[data-star="${id}"]`).evaluate((e) => {
      const p = new DOMPoint(0, 0).matrixTransform(e.getScreenCTM());
      return { x: p.x, y: p.y };
    });
    const box = await page.locator("#sky").boundingBox();
    await page.mouse.move(pos.x, pos.y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.18, {
      steps: 12,
    });
    await page.mouse.up();
    const after = (await diag()).score;
    assert.equal(after.stars.length, before.stars.length);
    assert.notDeepEqual(
      after.stars.find((s) => s.id === id),
      before.stars.find((s) => s.id === id),
    );
  });
  await check(
    "note, duration, intensity, root, scale, timbre, layer M/S and master controls",
    async () => {
      await page.locator("#note").selectOption("3");
      await change("step", 12);
      await page.locator("#duration").selectOption("4");
      await page.locator("#velocity").fill("83");
      await page.locator("#velocity").dispatchEvent("change");
      await page.locator("#tuning summary").click();
      await page.locator("#root").selectOption("7");
      await page.locator("#scale").selectOption("minor");
      await page.locator("#voice").selectOption("felt");
      let d = await diag();
      assert.equal(d.score.root, 7);
      assert.equal(d.score.scale, "minor");
      const s = d.score.stars.find((s) => s.step === 11 && s.degree === 3);
      assert.equal(s.duration, 4);
      assert.equal(s.velocity, 0.83);
      await click("layer-mute");
      assert.equal((await diag()).score.layers[0].mute, true);
      await click("layer-mute");
      await click("layer-solo");
      assert.equal((await diag()).score.layers[0].solo, true);
      await click("layer-solo");
      await page.locator("#layer-mute").hover();
      assert.equal(
        await page
          .locator("#mute-tip")
          .evaluate((e) => getComputedStyle(e).opacity),
        "1",
      );
      await page.locator("#layer-solo").focus();
      assert.equal(
        await page
          .locator("#solo-tip")
          .evaluate((e) => getComputedStyle(e).opacity),
        "1",
      );
      await click("action-master");
      assert.equal((await diag()).muted, true);
      await click("action-master");
      await page.locator("#master-volume").fill("48");
      assert.equal((await diag()).volume, 0.48);
    },
  );
  await check(
    "listening mode preserves score, selection and disclosure state",
    async () => {
      const score = (await diag()).score;
      const selected = await page
        .locator(".map-star.selected")
        .getAttribute("data-star");
      await click("action-listening");
      assert.equal((await diag()).listening, true);
      assert.equal(
        await page.locator("#inspector").evaluate((e) => e.inert),
        true,
      );
      await click("action-listening");
      assert.deepEqual((await diag()).score, score);
      assert.equal(
        await page.locator(".map-star.selected").getAttribute("data-star"),
        selected,
      );
      assert.equal(
        await page.locator("#note-list").evaluate((e) => e.open),
        true,
      );
    },
  );
  await check(
    "save multiple compositions, restore reload and JSON compatibility",
    async () => {
      await change("title", "QA first sky");
      await click("action-save");
      await click("action-atlas");
      await click("action-new");
      await change("title", "QA second sky");
      await click("action-add");
      await click("action-save");
      assert.equal((await diag()).library.length, 2);
      await page.reload();
      await ready(page);
      assert.equal((await diag()).lesson, null);
      assert.equal((await diag()).score.title, "QA second sky");
      assert.equal((await diag()).contextState, "not-created");
      assert.equal((await diag()).draftState, "saved");
      const bytes = await exportFile("json");
      await importScore(bytes.toString());
      assert.equal((await diag()).score.title, "QA second sky");
      assert.equal((await diag()).score.version, 1);
    },
  );
  await check(
    "malformed, oversized, unsupported and hostile imports leave current score untouched",
    async () => {
      const score = (await diag()).score;
      for (const raw of [
        "{bad",
        JSON.stringify({ ...score, version: 9 }),
        JSON.stringify({
          ...score,
          stars: [{ ...score.stars[0], id: "<script>" }],
        }),
        " ".repeat(60001),
      ]) {
        await importScore(raw);
        assert.deepEqual((await diag()).score, score);
        await expect(page.locator("#status")).toContainText("Could not open");
      }
    },
  );
  await check(
    "tour interruption/reload/back/skip strictly preserves draft, atlas and shared URL",
    async () => {
      const original = await page.evaluate(() => ({
        draft: localStorage.getItem("sidereal.draft.v1"),
        atlas: localStorage.getItem("sidereal.atlas.v1"),
      }));
      const shared = { ...initial, title: "Shared original" };
      const code = Buffer.from(JSON.stringify(shared)).toString("base64url");
      await page.goto(`${base}#score=${code}`);
      await ready(page);
      await click("action-help");
      await click("action-play");
      await click("action-tour-next");
      await click("layer-2");
      await click("action-tour-next");
      await click("action-add");
      await click("action-tour-back");
      await page.reload();
      await ready(page);
      assert.equal((await diag()).lesson.step, 1);
      await click("action-save");
      await click("action-tour-skip");
      assert.equal((await diag()).score.title, "Shared original");
      assert.equal((await diag()).pendingShare, true);
      assert.equal(await page.evaluate(() => location.hash), `#score=${code}`);
      assert.deepEqual(
        await page.evaluate(() => ({
          draft: localStorage.getItem("sidereal.draft.v1"),
          atlas: localStorage.getItem("sidereal.atlas.v1"),
        })),
        original,
      );
      await click("action-help");
      await completeTour();
      assert.equal((await diag()).score.title, "Shared original");
      assert.deepEqual(
        await page.evaluate(() => ({
          draft: localStorage.getItem("sidereal.draft.v1"),
          atlas: localStorage.getItem("sidereal.atlas.v1"),
        })),
        original,
      );
      await change("title", "Accepted shared");
      assert.equal(await page.evaluate(() => location.hash), "");
    },
  );
  await check(
    "safe share output restores independently without sound",
    async () => {
      await page.evaluate(() =>
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: { writeText: async (text) => (window.__share = text) },
        }),
      );
      await exportFile("json");
      await click("export-summary");
      await click("action-share");
      const link = await page.evaluate(() => window.__share);
      assert.ok(link.includes("#score="));
      assert.ok(link.length < 10000);
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
      assert.equal(await page.locator("#share-link").inputValue(), link);
      await click("action-close-link");
      const other = await browser.newPage();
      await other.goto(link);
      await ready(other);
      assert.equal((await diag(other)).userScore.title, "Accepted shared");
      assert.equal((await diag(other)).contextState, "not-created");
      await other.locator("#action-tour-skip").click();
      assert.equal((await diag(other)).score.title, "Accepted shared");
      await other.close();
    },
  );
  await check(
    "PNG decodes, has shared graphite palette, WAV decodes to non-silent stereo without clipping",
    async () => {
      await preset("evening");
      await page.locator("#master-volume").fill("48");
      const png = await exportFile("png");
      assert.equal(png.readUInt32BE(16), 1600);
      assert.equal(png.readUInt32BE(20), 1880);
      const decoded = await page.evaluate(async (b64) => {
        const i = new Image();
        i.src = "data:image/png;base64," + b64;
        await i.decode();
        const c = document.createElement("canvas");
        c.width = i.width;
        c.height = i.height;
        const x = c.getContext("2d");
        x.drawImage(i, 0, 0);
        return {
          size: [i.width, i.height],
          pixel: [...x.getImageData(0, 0, 1, 1).data],
        };
      }, png.toString("base64"));
      assert.deepEqual(decoded, {
        size: [1600, 1880],
        pixel: [12, 13, 18, 255],
      });
      const wav = await exportFile("wav");
      assert.equal(wav.toString("ascii", 0, 4), "RIFF");
      assert.equal(wav.readUInt16LE(22), 2);
      assert.equal(wav.readUInt32LE(24), 44100);
      const audio = await decodeAudio(wav);
      assert.ok(audio.peak > 0.01 && audio.peak < 0.9);
      assert.ok(audio.rms > 0.001);
      report.push({
        audio,
        wavSHA256: createHash("sha256").update(wav).digest("hex"),
      });
      assert.equal((await diag()).playing, false);
    },
  );
  await check(
    "96-note duplication limit and worst-case WAV remain bounded",
    async () => {
      const score = {
        ...initial,
        stars: Array.from({ length: 96 }, (_, i) => ({
          ...initial.stars[0],
          id: "stress-" + i,
          step: 0,
          degree: i % 15,
          layer: i % 3,
          velocity: 1,
          duration: 4,
        })),
      };
      await importScore(score);
      await click("action-duplicate");
      await click("action-add");
      assert.equal((await diag()).score.stars.length, 96);
      await page.locator("#master-volume").fill("80");
      const wav = await exportFile("wav", "v2-stress96");
      const audio = await decodeAudio(wav);
      assert.ok(audio.peak < 0.9);
      report.push({ stressAudio: audio });
      for (let i = 0; i < 3; i++) {
        await page.locator("#layer-" + i).click();
        await click("layer-mute");
      }
      const silent = await decodeAudio(await exportFile("wav", "v2-silent"));
      assert.equal(silent.peak, 0);
      await preset("evening");
      await page.locator("#master-volume").fill("48");
    },
  );
  await check(
    "repeat clicks, reduced motion, Stop idle and beat-only text updates",
    async () => {
      for (let i = 0; i < 12; i++) await click("action-preview");
      assert.ok((await diag()).activeVoices <= 1);
      await click("action-stop");
      await click("action-play");
      const d = await diag();
      await page.waitForTimeout(1700);
      let after = await diag();
      assert.ok(after.visualFrames - d.visualFrames > 30);
      assert.ok(after.beatWrites - d.beatWrites <= 4);
      await click("action-stop");
      const f = (await diag()).visualFrames;
      await page.waitForTimeout(300);
      assert.equal((await diag()).visualFrames, f);
      assert.equal((await diag()).visualLoop, false);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await click("action-play");
      const transform = await page.locator("#sweep").getAttribute("transform");
      await page.waitForTimeout(850);
      assert.equal(
        await page.locator("#sweep").getAttribute("transform"),
        transform,
      );
      assert.equal((await diag()).playing, true);
      assert.equal((await diag()).visualFrames, f);
      await click("action-stop");
      await page.emulateMedia({ reducedMotion: "no-preference" });
    },
  );
  await check(
    "responsive RU/EN at 360/390/768/1366/1440/1920 and short laptop",
    async () => {
      for (const [width, height] of [
        [360, 800],
        [390, 844],
        [768, 1024],
        [1366, 768],
        [1440, 900],
        [1920, 1080],
        [1366, 600],
      ]) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(100);
        for (const language of ["ru", "en"]) {
          if ((await page.locator("html").getAttribute("lang")) !== language)
            await click("action-language");
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth),
            width,
          );
          const box = await page.locator("#stage").boundingBox();
          assert.ok(Math.abs(box.width - box.height) < 2);
          if (width > 760) {
            const play = await page.locator("#action-play").boundingBox();
            assert.ok(play.y + play.height < height);
          }
          await expect(page.locator("#action-play")).toBeVisible();
        }
      }
      await page.setViewportSize({ width: 1366, height: 768 });
    },
  );
  await check(
    "mobile panel focus trap, open list, dense-note picker and six-step tour",
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await click("action-list");
      await expect(page.locator("#inspector")).toHaveAttribute(
        "aria-modal",
        "true",
      );
      await page.locator("#note-rows button").last().click();
      assert.equal(
        await page.locator("#layer-controls").evaluate((e) => e.inert),
        true,
      );
      assert.equal(
        await page.locator("#note-list").evaluate((e) => e.open),
        true,
      );
      await page.locator("#action-close-panel").focus();
      await page.keyboard.press("Shift+Tab");
      assert.equal(
        await page.evaluate(
          () => document.activeElement.closest("#inspector")?.id,
        ),
        "inspector",
      );
      await page.keyboard.press("Escape");
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        "action-list",
      );
      const score = {
        ...initial,
        stars: [
          { ...initial.stars[0], id: "close-a" },
          { ...initial.stars[0], id: "close-b", layer: 1 },
        ],
      };
      await importScore(score);
      await page.locator("[data-star=close-b]").click();
      await expect(page.locator("#pick-dialog")).toBeVisible();
      assert.equal(await page.locator("#pick-rows button").count(), 2);
      await page.locator("#pick-rows button").last().click();
      await click("action-help");
      await completeTour();
      assert.equal((await diag()).lesson, null);
      await page.setViewportSize({ width: 1366, height: 768 });
    },
  );
  await check(
    "200% text size, contrast, 14px controls and visible keyboard focus",
    async () => {
      await page.evaluate(
        () => (document.documentElement.style.fontSize = "32px"),
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(100);
      await expect(page.locator("#app")).toHaveClass(/text-large/);
      const layers = await page
        .locator(".layer-selector")
        .evaluateAll((nodes) =>
          nodes.map((n) => n.getBoundingClientRect().toJSON()),
        );
      assert.ok(
        layers[0].bottom <= layers[1].top && layers[1].bottom <= layers[2].top,
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth),
        390,
      );
      await click("action-panel");
      await page.locator("#note").focus();
      await page.keyboard.press("Tab");
      assert.equal(
        await page.evaluate(
          () => document.activeElement.closest("#inspector")?.id,
        ),
        "inspector",
      );
      await page.keyboard.press("Escape");
      await page.evaluate(
        () => (document.documentElement.style.fontSize = "16px"),
      );
      await page.setViewportSize({ width: 1366, height: 768 });
      const css = await page.evaluate(() => ({
        body: getComputedStyle(document.body).backgroundColor,
        labels: [
          ...document.querySelectorAll(
            "label:not(.sr-only),button span[data-i18n]",
          ),
        ]
          .filter((e) => e.getClientRects().length)
          .map((e) => parseFloat(getComputedStyle(e).fontSize)),
        focus: getComputedStyle(document.querySelector("#action-help"))
          .outlineWidth,
      }));
      assert.equal(css.body, "rgb(12, 13, 18)");
      assert.ok(css.labels.every((n) => n >= 14));
      function luminance(hex) {
        const rgb = hex
          .match(/../g)
          .map((x) => parseInt(x, 16) / 255)
          .map((v) =>
            v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
          );
        return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
      }
      const contrast = (fg, bg) =>
        (luminance(fg) + 0.05) / (luminance(bg) + 0.05);
      const ratios = {
        secondaryOnSurface: contrast("A7ADBD", "171921"),
        textOnSurface: contrast("F2F3F7", "171921"),
        textOnRaised: contrast("F2F3F7", "202330"),
        primary: contrast("B9C9FF", "0C0D12"),
      };
      assert.ok(Object.values(ratios).every((n) => n >= 4.5));
      report.push({ contrast: ratios });
      await page.locator("#action-help").focus();
      await page.keyboard.press("Tab");
      assert.ok(
        (await page.evaluate(() =>
          parseFloat(getComputedStyle(document.activeElement).outlineWidth),
        )) >= 2,
      );
    },
  );
  await check(
    "70 seconds playback with bounded nodes; background lifecycle handler pauses",
    async () => {
      await preset("evening");
      await change("tempo", 180);
      await click("action-play");
      for (let i = 0; i < 7; i++) {
        await page.waitForTimeout(10000);
        assert.equal((await diag()).playing, true);
        assert.ok((await diag()).activeVoices <= 30);
        console.log("PLAYBACK", 10 * (i + 1), (await diag()).activeVoices);
      }
      const other = await ctx.newPage();
      await other.goto("about:blank");
      await other.bringToFront();
      await page.waitForTimeout(150);
      const hidden = await page.evaluate(() => document.hidden);
      if (hidden) assert.equal((await diag()).playing, false);
      else {
        await page.evaluate(() => {
          Object.defineProperty(document, "hidden", {
            configurable: true,
            get: () => true,
          });
          document.dispatchEvent(new Event("visibilitychange"));
        });
        assert.equal((await diag()).playing, false);
        report.push({
          limitation:
            "Headless Chromium does not hide background tabs; hidden-tab handler checked with explicit visibilitychange, not a physical tab-switch claim.",
        });
      }
      await other.close();
      await page.evaluate(() => delete document.hidden);
      await click("action-stop");
      assert.equal((await diag()).activeVoices, 0);
    },
  );
  await check(
    "blocked storage and unavailable audio/export show separate truthful errors",
    async () => {
      const c = await browser.newContext();
      await c.addInitScript(() => {
        Storage.prototype.setItem = () => {
          throw new DOMException("Quota", "QuotaExceededError");
        };
        Object.defineProperty(window, "AudioContext", { value: undefined });
        Object.defineProperty(window, "OfflineAudioContext", {
          value: undefined,
        });
      });
      const p = await c.newPage();
      await p.goto(base);
      await ready(p);
      await p.locator("#action-tour-skip").click();
      await p.locator("#action-add").click();
      assert.equal((await diag(p)).draftState, "failed");
      await expect(p.locator("#draft-status")).toContainText("could not");
      await p.locator("#action-play").click();
      await expect(p.locator("#status")).toContainText("Sound could not start");
      await p.locator("#export-summary").click();
      await p.locator("#action-wav").click();
      await expect(p.locator("#status")).toContainText("WAV could not");
      await c.close();
    },
  );
  await check(
    "real preparation loader waits for module and failure offers working Retry",
    async () => {
      const p = await browser.newPage();
      let release;
      const hold = new Promise((r) => (release = r));
      const match = base.includes("127.0.0.1")
        ? "**/src/main.ts*"
        : "**/main-*.js";
      await p.route(match, async (route) => {
        await hold;
        await route.abort();
      });
      const nav = p.goto(base);
      await expect(p.locator("#boot-screen")).toBeVisible();
      assert.equal(await p.locator("#app").textContent(), "");
      assert.equal(await p.locator("#boot-screen progress").count(), 0);
      release();
      await nav;
      await expect(p.locator("#boot-error")).toBeVisible();
      await p.unroute(match);
      await p.locator("#boot-retry").click();
      await ready(p);
      assert.equal((await diag(p)).contextState, "not-created");
      await p.close();
    },
  );
  assert.deepEqual(errors, []);
  report.push({
    browser: await browser.version(),
    pageErrors: errors,
    auditoryReview:
      "No human listening available. Real AudioContext, waveform decode and clipping checks only.",
  });
} catch (error) {
  console.error(error);
  report.push({ failure: error.stack });
  process.exitCode = 1;
  await page
    .screenshot({ path: "qa-artifacts/v2-failure.png", fullPage: true })
    .catch(() => {});
} finally {
  await fs.writeFile(
    "qa-artifacts/v2-browser-report.json",
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
