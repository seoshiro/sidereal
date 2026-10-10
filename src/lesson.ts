import { Score, validate, preset } from "./model";
import { DeviceStore, KEYS } from "./storage";
export type LessonAction = "play" | "layer" | "add" | "move" | "shape" | "save";
export const LESSON_ACTIONS: LessonAction[] = [
  "play",
  "layer",
  "add",
  "move",
  "shape",
  "save",
];
export interface LessonRecord {
  version: 2;
  status: "active" | "done" | "skipped";
  step: number;
  practice: Score;
  selected: string;
  layer: number;
  completed: boolean[];
  atlas: Score[];
}
export function readLesson(store: DeviceStore): LessonRecord | null {
  try {
    const raw = store.read(KEYS.lesson);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (
      v.version !== 2 ||
      !["active", "done", "skipped"].includes(v.status) ||
      !Number.isInteger(v.step) ||
      v.step < 0 ||
      v.step > 5 ||
      !Number.isInteger(v.layer) ||
      v.layer < 0 ||
      v.layer > 2 ||
      !Array.isArray(v.completed) ||
      v.completed.length !== 6 ||
      v.completed.some((b: unknown) => typeof b !== "boolean") ||
      typeof v.selected !== "string" ||
      !Array.isArray(v.atlas) ||
      v.atlas.length > 1
    )
      return null;
    return {
      version: 2,
      status: v.status,
      step: v.step,
      practice: validate(v.practice),
      selected: v.selected,
      layer: v.layer,
      completed: v.completed,
      atlas: v.atlas.map(validate),
    };
  } catch {
    return null;
  }
}
export function freshLesson(title: string): LessonRecord {
  const practice = preset("evening");
  practice.title = title;
  return {
    version: 2,
    status: "active",
    step: 0,
    practice,
    selected: practice.stars[2].id,
    layer: 0,
    completed: Array(6).fill(false),
    atlas: [],
  };
}
export function storeLesson(store: DeviceStore, record: LessonRecord) {
  return store.write(KEYS.lesson, JSON.stringify(record));
}
