import test from "node:test";
import assert from "node:assert/strict";
import { DeviceStore, KEYS } from "../src/storage.ts";
import { freshLesson, readLesson, storeLesson } from "../src/lesson.ts";
function device() {
  const values = new Map<string, string>();
  return {
    values,
    store: new DeviceStore(
      () =>
        ({
          getItem: (key: string) => values.get(key) ?? null,
          setItem: (key: string, value: string) => values.set(key, value),
        }) as Storage,
    ),
  };
}
test("practice persistence never changes v1 draft or atlas", () => {
  const { values, store } = device();
  values.set(KEYS.draft, "original draft");
  values.set(KEYS.atlas, "original atlas");
  const lesson = freshLesson("Practice");
  lesson.step = 4;
  lesson.practice.stars[0].duration = 2;
  lesson.completed[0] = true;
  assert.equal(storeLesson(store, lesson), true);
  assert.deepEqual(readLesson(store), lesson);
  assert.equal(values.get(KEYS.draft), "original draft");
  assert.equal(values.get(KEYS.atlas), "original atlas");
});
test("malformed lessons and invalid nested scores are rejected", () => {
  const { values, store } = device();
  for (const mutate of [
    (v: any) => (v.step = 6),
    (v: any) => (v.completed = [true]),
    (v: any) => (v.layer = 3),
    (v: any) => (v.status = "unknown"),
    (v: any) => (v.atlas = [v.practice, v.practice]),
    (v: any) => (v.practice.stars[0].duration = 99),
  ]) {
    const lesson = freshLesson("Practice");
    mutate(lesson);
    values.set(KEYS.lesson, JSON.stringify(lesson));
    assert.equal(readLesson(store), null);
  }
  values.set(KEYS.lesson, "{broken");
  assert.equal(readLesson(store), null);
});
test("blocked storage returns a failure instead of claiming a save", () => {
  const store = new DeviceStore(() => {
    throw new Error("blocked");
  });
  assert.equal(store.read(KEYS.draft), null);
  assert.equal(store.available, false);
  assert.equal(storeLesson(store, freshLesson("Practice")), false);
});
