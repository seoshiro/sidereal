import test from "node:test";
import assert from "node:assert/strict";
import {
  preset,
  validate,
  parseScore,
  shareEncode,
  shareDecode,
  point,
  fromPoint,
  noteName,
  audible,
  SCALES,
} from "../src/model.ts";
test("presets have deterministic music and valid scores", () => {
  for (const name of ["evening", "glass", "drift"] as const) {
    const a = preset(name),
      b = preset(name);
    assert.deepEqual(a.stars, b.stars);
    assert.deepEqual(validate(a), a);
  }
});
test("all 480 reachable musical coordinates round-trip", () => {
  for (let step = 0; step < 32; step++)
    for (let degree = 0; degree < 15; degree++) {
      const p = point({ step, degree });
      assert.deepEqual(fromPoint(p.x, p.y), { step, degree });
    }
});
test("notes follow the selected scale and voice octave", () => {
  const s = preset("evening");
  assert.equal(noteName(s, { ...s.stars[0], degree: 0 }), "C4");
  s.layers[0].voice = "tide";
  assert.equal(noteName(s, { ...s.stars[0], degree: 0 }), "C2");
  for (const scale of Object.keys(SCALES)) {
    s.scale = scale as keyof typeof SCALES;
    assert.equal(validate(s).scale, scale);
  }
});
test("mute wins and solo excludes other layers", () => {
  const s = preset("evening");
  s.layers[1].solo = true;
  assert.equal(audible(s, 0), false);
  assert.equal(audible(s, 1), true);
  s.layers[1].mute = true;
  assert.equal(audible(s, 1), false);
});
test("untrusted input rejects incompatible, oversized and dangerous scores", () => {
  const s = preset("evening");
  for (const mutate of [
    (v: any) => (v.version = 2),
    (v: any) => (v.bpm = NaN),
    (v: any) => (v.root = 12),
    (v: any) => (v.scale = "__proto__"),
    (v: any) => (v.stars[0].id = '" onload="alert(1)'),
    (v: any) => (v.stars[0].step = 32),
    (v: any) => (v.stars[0].degree = -1),
    (v: any) => (v.stars[0].duration = 100),
    (v: any) => (v.stars[0].velocity = 2),
    (v: any) => (v.stars[1].id = v.stars[0].id),
    (v: any) => (v.layers[0].voice = "sample"),
    (v: any) => (v.stars = Array(97).fill(v.stars[0])),
  ]) {
    const v = structuredClone(s);
    mutate(v);
    assert.throws(() => validate(v));
  }
  assert.throws(() => parseScore("{broken"));
  assert.throws(() => parseScore(" ".repeat(60001)));
});
test("validation strips unknown fields and text remains data", () => {
  const s: any = preset("evening");
  s.title = "<script>alert(1)</script>";
  s.extra = "discard";
  s.stars[0].extra = "discard";
  const v: any = validate(s);
  assert.equal(v.title, s.title);
  assert.equal(v.extra, undefined);
  assert.equal(v.stars[0].extra, undefined);
});
test("unicode shares round-trip and reject malformed or large links", () => {
  const s = preset("evening");
  s.title = "Ночное созвездие ✧";
  assert.deepEqual(shareDecode(shareEncode(s)), s);
  assert.throws(() => shareDecode("$bad"));
  assert.throws(() => shareDecode("a".repeat(12001)));
  assert.throws(() => shareDecode(btoa("{}")));
});
