import {
  Score,
  Star,
  Voice,
  Scale,
  COLORS,
  ROOTS,
  SCALES,
  PRESETS,
  preset,
  clone,
  uid,
  validate,
  parseScore,
  point,
  fromPoint,
  noteName,
  audible,
  shareEncode,
  shareDecode,
  clamp,
} from "./model";
import { Engine, renderAudio } from "./audio";
import { PALETTE } from "./palette";
import { translate, Key, Language } from "./i18n";
import { DeviceStore, KEYS } from "./storage";
import {
  LessonRecord,
  LessonAction,
  LESSON_ACTIONS,
  readLesson,
  freshLesson,
  storeLesson,
} from "./lesson";
import { shell, icon, PATHS } from "./ui";
const app = document.querySelector<HTMLDivElement>("#app")!;
const store = new DeviceStore();
const reduced = matchMedia("(prefers-reduced-motion: reduce)"),
  mobile = matchMedia("(max-width: 760px)");
let score = preset("evening"),
  library: Score[] = [],
  lang: Language = "en",
  selected = score.stars[2].id,
  activeLayer = 0;
let undo: Score[] = [],
  redo: Score[] = [],
  draftState: "saved" | "unsaved" | "failed" = "unsaved",
  pendingShare = false;
let lesson: LessonRecord | null = null,
  original: Snapshot | null = null,
  initialized = false,
  listening = false,
  panelOpen = false,
  panelReturn = "action-panel";
let busy = false,
  playBusy = false,
  transportGeneration = 0,
  toastKey: Key = "paused",
  atlasTab = "presets";
let animation = 0,
  readoutTimer = 0,
  anchorBeat = 0,
  anchorTime = 0,
  anchorBpm = 76,
  lastBeat = -1,
  beatWrites = 0,
  visualFrames = 0,
  pulseGeneration = 0;
const pulseTimers = new Set<number>();
let drag: {
    id: string;
    before: Score;
    x: number;
    y: number;
    pointer: number;
    changed: boolean;
  } | null = null,
  suppressClick = false,
  rangeBefore: Score | null = null;
interface Snapshot {
  score: Score;
  selected: string;
  layer: number;
  undo: Score[];
  redo: Score[];
  draftState: "saved" | "unsaved" | "failed";
  pendingShare: boolean;
  listening: boolean;
  listOpen: boolean;
  tuningOpen: boolean;
}
const t = (key: Key) => translate(key, lang);
const $ = <T extends Element = HTMLElement>(id: string) =>
  document.getElementById(id) as unknown as T;
const esc = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const engine = new Engine(() => score, schedulePulse);
function star() {
  return score.stars.find((n) => n.id === selected);
}
function starsText(count: number) {
  const rule = new Intl.PluralRules(lang).select(count);
  return `${count} ${t(rule === "one" ? "starone" : rule === "few" ? "starfew" : "stars")}`;
}
function setValue(id: string, value: string | number) {
  const el = $<HTMLInputElement | HTMLSelectElement>(id);
  if (el.value !== String(value)) el.value = String(value);
}
function message(key: Key) {
  toastKey = key;
  $("status").textContent = t(key);
}
function retainFocus(work: () => void) {
  const focused = document.activeElement as HTMLElement;
  const scroll = focused.closest(
    ".note-rows,.saved-rows",
  ) as HTMLElement | null;
  const top = scroll?.scrollTop;
  work();
  if (
    focused !== document.activeElement &&
    focused.isConnected &&
    !focused.closest("[hidden]")
  )
    focused.focus({ preventScroll: true });
  if (scroll && top !== undefined) scroll.scrollTop = top;
}
function persist() {
  if (lesson) {
    lesson.practice = clone(score);
    lesson.selected = selected;
    lesson.layer = activeLayer;
    if (!storeLesson(store, lesson)) message("storage");
    return;
  }
  if (store.write(KEYS.draft, JSON.stringify(score))) {
    draftState = "saved";
    if (pendingShare) {
      pendingShare = false;
      window.history.replaceState(
        null,
        "",
        location.pathname + location.search,
      );
    }
  } else {
    draftState = "failed";
    message("storage");
  }
  syncDraft();
}
function pushHistory(before: Score) {
  undo.push(before);
  if (undo.length > 60) undo.shift();
  redo = [];
  persist();
}
async function edit(change: () => void, action?: LessonAction, tempo = false) {
  const before = clone(score),
    playing = engine.playing;
  const token = tempo ? ++transportGeneration : transportGeneration;
  if (tempo && playing) {
    engine.pause();
    stopMotion();
  }
  change();
  if (JSON.stringify(before) !== JSON.stringify(score)) {
    pushHistory(before);
    if (!tempo) engine.silence();
    if (action) markLesson(action);
  }
  update();
  if (tempo && playing) {
    try {
      await engine.play();
      if (token !== transportGeneration) engine.stop();
      else startMotion();
    } catch {
      message("audiofailed");
    }
    update();
  }
}
function syncDraft() {
  $("draft-status").textContent = t(
    lesson
      ? "lessonstatus"
      : pendingShare
        ? "sharedsky"
        : draftState === "saved"
          ? "draftsaved"
          : draftState === "failed"
            ? "draftfailed"
            : "draftunsaved",
  );
  $("draft-status").classList.toggle(
    "save-failed",
    !lesson && draftState === "failed",
  );
}
function translateUI() {
  document.documentElement.lang = lang;
  document
    .querySelectorAll<HTMLElement>("[data-i18n]")
    .forEach((el) => (el.textContent = t(el.dataset.i18n as Key)));
  document
    .querySelectorAll<HTMLElement>("[data-label]")
    .forEach((el) => el.setAttribute("aria-label", t(el.dataset.label as Key)));
  $("action-language").textContent = lang === "en" ? "RU" : "EN";
  $("action-language").setAttribute(
    "aria-label",
    lang === "en" ? "Переключить на русский" : "Switch to English",
  );
  $("tempo").setAttribute("aria-label", t("tempo"));
  $("step").setAttribute("aria-label", t("stepplain"));
  $("step-prev").setAttribute("aria-label", `${t("stepplain")} −`);
  $("step-next").setAttribute("aria-label", `${t("stepplain")} +`);
  $("transport").setAttribute("aria-label", t("play"));
  $("layer-controls").setAttribute("aria-label", t("layers"));
  $("sheet-backdrop").setAttribute("aria-label", t("panelclose"));
  $("status").textContent = t(toastKey);
  syncDraft();
}
function drawSky() {
  const rings = Array.from(
    { length: 8 },
    (_, i) =>
      `<circle cx="400" cy="400" r="${80 + (i * 240) / 7}" class="orbit-ring" ${i === 7 ? 'id="outer-orbit"' : ""}/>`,
  ).join("");
  const ticks = Array.from({ length: 64 }, (_, i) => {
    const a = (i / 64) * Math.PI * 2 - Math.PI / 2,
      r = i % 4 ? 343 : 335;
    return `<path d="M${400 + Math.cos(a) * r} ${400 + Math.sin(a) * r}L${400 + Math.cos(a) * 350} ${400 + Math.sin(a) * 350}" class="tick ${i % 4 ? "" : "major"}"/>`;
  }).join("");
  const spokes = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    return `<path d="M${400 + Math.cos(a) * 64} ${400 + Math.sin(a) * 64}L${400 + Math.cos(a) * 320} ${400 + Math.sin(a) * 320}" class="spoke"/>`;
  }).join("");
  $("stage").innerHTML =
    `<svg id="sky" viewBox="0 0 800 800" xmlns="http://www.w3.org/2000/svg" role="group" tabindex="0"><rect width="800" height="800" fill="transparent"/>${rings}${spokes}${ticks}<g id="constellation-lines"></g><g id="sweep" transform="rotate(0 400 400)"><path d="M400 344V58"/><circle cx="400" cy="58" r="4"/></g><circle cx="400" cy="400" r="43" class="center-ring"/><text id="sky-root" x="400" y="408" text-anchor="middle" class="center-label"></text><g id="star-groups"></g>${[
      ["01", 400, 30],
      ["05", 770, 407],
      ["09", 400, 778],
      ["13", 30, 407],
    ]
      .map(
        ([s, x, y]) =>
          `<text x="${x}" y="${y}" text-anchor="middle" class="map-label">${s}</text>`,
      )
      .join("")}</svg>`;
  const host = $("constellation-lines");
  for (let i = 0; i < 3; i++) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.id = `constellation-${i}`;
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", COLORS[i]);
    host.append(path);
  }
}
function syncSky() {
  retainFocus(() => {
    const host = $("star-groups");
    const ids = new Set(score.stars.map((s) => s.id));
    host.querySelectorAll<SVGGElement>("[data-star]").forEach((el) => {
      if (!ids.has(el.dataset.star!)) el.remove();
    });
    for (const n of score.stars) {
      let group = $<SVGGElement>(`star-${n.id}`);
      if (!group) {
        group = document.createElementNS("http://www.w3.org/2000/svg", "g");
        group.id = `star-${n.id}`;
        group.dataset.star = n.id;
        group.setAttribute("class", "map-star");
        group.setAttribute("tabindex", "0");
        group.setAttribute("role", "button");
        group.innerHTML =
          '<circle class="hit" r="40" fill="transparent"/><circle class="pulse-ring" r="12"/><circle class="selection-ring" r="15"/><path class="star-cross" d="M-10 0h20M0-10v20"/><circle class="star-dot"/><text class="note-label" y="-24" text-anchor="middle"></text>';
        host.append(group);
      }
      const p = point(n);
      group.setAttribute("transform", `translate(${p.x} ${p.y})`);
      group.style.setProperty("--layer", COLORS[n.layer]);
      group.classList.toggle("selected", n.id === selected);
      group.classList.toggle("muted", !audible(score, n.layer));
      group.setAttribute("aria-pressed", String(n.id === selected));
      group.setAttribute(
        "aria-label",
        `${score.layers[n.layer].name}, ${noteName(score, n)}, ${t("step")} ${n.step + 1}`,
      );
      group
        .querySelector(".star-dot")!
        .setAttribute("r", String(4 + n.velocity * 3));
      group.querySelector(".note-label")!.textContent = noteName(score, n);
    }
    for (let i = 0; i < 3; i++) {
      const stars = score.stars
        .filter((s) => s.layer === i)
        .sort((a, b) => a.step - b.step);
      $(`constellation-${i}`).setAttribute(
        "d",
        stars.length > 1
          ? stars
              .map((s, j) => {
                const p = point(s);
                return `${j ? "L" : "M"}${p.x} ${p.y}`;
              })
              .join(" ")
          : "",
      );
      $(`constellation-${i}`).setAttribute(
        "opacity",
        audible(score, i) ? ".65" : ".2",
      );
    }
    $("sky-root").textContent = ROOTS[score.root];
    $("sky").setAttribute("aria-label", t("map"));
    resizeSky();
  });
}
function resizeSky() {
  app.classList.toggle(
    "text-large",
    parseFloat(getComputedStyle(document.documentElement).fontSize) >= 24,
  );
  const stage = $("stage"),
    area = $("orbit-area");
  if (!mobile.matches) {
    const css = getComputedStyle(area);
    const width =
      area.clientWidth -
      parseFloat(css.paddingLeft) -
      parseFloat(css.paddingRight);
    const height =
      area.clientHeight -
      area.querySelector(".orbit-heading")!.getBoundingClientRect().height -
      area.querySelector(".orbit-caption")!.getBoundingClientRect().height -
      parseFloat(css.paddingTop) -
      parseFloat(css.paddingBottom);
    const size = Math.max(0, Math.min(width, height));
    stage.style.width = `${size}px`;
    stage.style.height = `${size}px`;
  } else {
    stage.style.removeProperty("width");
    stage.style.removeProperty("height");
  }
  const width = $("stage").getBoundingClientRect().width;
  if (!width) return;
  const size = 800 / width;
  $("sky").style.setProperty("--map-font", `${14 * size}px`);
  $("sky").style.setProperty("--note-font", `${14 * size}px`);
  $("sky")
    .querySelectorAll(".hit")
    .forEach((n) => n.setAttribute("r", String(22 * size)));
  $("sky")
    .querySelectorAll(".selection-ring")
    .forEach((n) => n.setAttribute("r", String(11 * size)));
  $("sky")
    .querySelectorAll(".note-label")
    .forEach((n) => n.setAttribute("y", String(-18 * size)));
}
function syncList() {
  retainFocus(() => {
    const host = $("note-rows"),
      ids = new Set(score.stars.map((n) => n.id));
    host.querySelectorAll<HTMLElement>("[data-select]").forEach((row) => {
      if (!ids.has(row.dataset.select!)) row.remove();
    });
    for (const n of [...score.stars].sort(
      (a, b) => a.step - b.step || a.layer - b.layer,
    )) {
      let row = $<HTMLButtonElement>(`row-${n.id}`);
      if (!row) {
        row = document.createElement("button");
        row.id = `row-${n.id}`;
        row.dataset.select = n.id;
        row.className = "note-row";
        row.innerHTML =
          '<span class="row-dot"></span><strong></strong><span class="row-layer"></span><span class="row-step music-value"></span><span class="row-duration music-value"></span>';
        host.append(row);
      }
      row.style.setProperty("--layer", COLORS[n.layer]);
      row.classList.toggle("selected", selected === n.id);
      row.setAttribute("aria-pressed", String(selected === n.id));
      row.querySelector("strong")!.textContent = noteName(score, n);
      row.querySelector(".row-layer")!.textContent = score.layers[n.layer].name;
      row.querySelector(".row-step")!.textContent = String(n.step + 1).padStart(
        2,
        "0",
      );
      row.querySelector(".row-duration")!.textContent = `${n.duration} ♩`;
      row.setAttribute(
        "aria-label",
        `${noteName(score, n)}, ${score.layers[n.layer].name}, ${t("step")} ${n.step + 1}, ${n.duration} ${t("duration")}`,
      );
    }
    const sorted = [...score.stars].sort(
      (a, b) => a.step - b.step || a.layer - b.layer,
    );
    sorted.forEach((n, i) => {
      const row = $(`row-${n.id}`);
      if (host.children[i] !== row)
        host.insertBefore(row, host.children[i] ?? null);
    });
    $("list-count").textContent = String(score.stars.length);
  });
}
function update() {
  retainFocus(() => {
    setValue("title", score.title);
    setValue("tempo", score.bpm);
    setValue("master-volume", engine.volume * 100);
    $("master-value").textContent = `${Math.round(engine.volume * 100)}%`;
    const play = $<HTMLButtonElement>("action-play");
    play.dataset.label = engine.playing ? "pause" : "play";
    play.querySelector("span")!.dataset.i18n = play.dataset.label;
    play
      .querySelector("path")!
      .setAttribute("d", PATHS[engine.playing ? "pause" : "play"]);
    play.setAttribute("aria-pressed", String(engine.playing));
    const master = $("action-master");
    master.dataset.label = engine.muted ? "unmute" : "mute";
    master.setAttribute("aria-pressed", String(engine.muted));
    master
      .querySelector("path")!
      .setAttribute("d", PATHS[engine.muted ? "mute" : "volume"]);
    const mode = $("action-listening");
    mode.dataset.label = listening ? "editmode" : "listenmode";
    mode.querySelector("span")!.dataset.i18n = mode.dataset.label;
    mode.setAttribute("aria-pressed", String(listening));
    app.classList.toggle("listening", listening);
    $("inspector").inert = listening;
    $("layer-controls").inert = listening || panelOpen;
    $("action-undo").setAttribute("aria-disabled", String(!undo.length));
    $("action-redo").setAttribute("aria-disabled", String(!redo.length));
    score.layers.forEach((l, i) => {
      const b = $(`layer-${i}`);
      b.style.setProperty("--layer", COLORS[i]);
      b.classList.toggle("active", i === activeLayer);
      b.setAttribute("aria-pressed", String(i === activeLayer));
      b.querySelector("strong")!.textContent = l.name;
      b.querySelector(".layer-count")!.textContent = String(
        score.stars.filter((n) => n.layer === i).length,
      );
      b.querySelector(".layer-state")!.textContent = l.mute
        ? "M"
        : l.solo
          ? "S"
          : "";
      b.setAttribute(
        "aria-label",
        `${l.name}, ${t(l.voice)}, ${starsText(score.stars.filter((n) => n.layer === i).length)}${l.mute ? ", " + t("mute") : ""}${l.solo ? ", " + t("solo") : ""}`,
      );
    });
    setValue("voice", score.layers[activeLayer].voice);
    $<HTMLButtonElement>("layer-mute").setAttribute(
      "aria-pressed",
      String(score.layers[activeLayer].mute),
    );
    $<HTMLButtonElement>("layer-solo").setAttribute(
      "aria-pressed",
      String(score.layers[activeLayer].solo),
    );
    const n = star();
    $("selected-summary").hidden = !n;
    $("select-empty").hidden = !!n;
    $<HTMLFieldSetElement>("note-fields").disabled = !n;
    if (n) {
      $("selected-summary").style.setProperty("--layer", COLORS[n.layer]);
      $("selected-note").textContent = noteName(score, n);
      $("selected-layer").textContent = score.layers[n.layer].name;
      const select = $<HTMLSelectElement>("note");
      Array.from(select.options).forEach(
        (o, i) => (o.textContent = noteName(score, { ...n, degree: i })),
      );
      setValue("note", n.degree);
      setValue("step", n.step + 1);
      setValue("duration", n.duration);
      setValue("velocity", n.velocity * 100);
      $("velocity-value").textContent = `${Math.round(n.velocity * 100)}%`;
      $("selection-caption").textContent =
        `${noteName(score, n)} / ${String(n.step + 1).padStart(2, "0")}`;
    } else $("selection-caption").textContent = t("empty");
    setValue("root", score.root);
    setValue("scale", score.scale);
    for (const id of ["action-wav", "action-png"])
      $<HTMLButtonElement>(id).disabled = busy;
    translateUI();
    syncSky();
    syncList();
    syncLibrary();
    syncLesson();
    updateReadout();
  });
}
function syncLibrary() {
  retainFocus(() => {
    const list = lesson ? lesson.atlas : library,
      host = $("saved-rows"),
      ids = new Set(list.map((s) => s.id));
    host.querySelectorAll<HTMLElement>("[data-saved]").forEach((el) => {
      if (!ids.has(el.dataset.saved!)) el.remove();
    });
    for (const s of list) {
      let row = $(`saved-${s.id}`);
      if (!row) {
        row = document.createElement("div");
        row.id = `saved-${s.id}`;
        row.dataset.saved = s.id;
        row.className = "saved-row";
        row.innerHTML = `<button id="load-${s.id}" data-load="${s.id}"><strong></strong><span></span></button><button id="delete-${s.id}" data-delete-save="${s.id}" class="icon-button">${icon("trash")}</button>`;
        host.append(row);
      }
      row.querySelector("strong")!.textContent = s.title;
      row.querySelector("button span")!.textContent =
        `${s.bpm} BPM · ${starsText(s.stars.length)}`;
      row
        .querySelector("[data-delete-save]")!
        .setAttribute("aria-label", `${t("saveddelete")} ${s.title}`);
    }
    $("library-empty").hidden = !!list.length;
    for (const tab of ["presets", "library"]) {
      $(`tab-${tab}`).setAttribute("aria-selected", String(tab === atlasTab));
      $(`tab-${tab}`).setAttribute("tabindex", tab === atlasTab ? "0" : "-1");
      $(`${tab === "presets" ? "preset" : "library"}-panel`).hidden =
        tab !== atlasTab;
    }
  });
}
function makePresets() {
  for (const name of PRESETS) {
    const p = preset(name),
      row = document.createElement("button");
    row.dataset.preset = name;
    row.id = `preset-${name}`;
    row.className = "preset-row";
    const dots = p.stars
      .filter((s) => s.layer === 0)
      .slice(0, 5)
      .map((n) => {
        const x = 20 + (n.step / 32) * 54,
          y = 60 - (n.degree / 14) * 42;
        return { x, y };
      });
    row.innerHTML = `<svg viewBox="0 0 90 90" aria-hidden="true"><circle cx="45" cy="45" r="34"/><path d="${dots.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ")}"/>${dots.map((p) => `<circle class="mini-star" cx="${p.x}" cy="${p.y}" r="2.5"/>`).join("")}</svg><span><strong data-i18n="${name}"></strong><span data-i18n="${name}desc"></span></span><span class="music-value">${p.bpm}<br>BPM</span>`;
    $("preset-rows").append(row);
  }
}
function phase() {
  if (!engine.playing || !engine.ctx) return engine.beat;
  return (
    (anchorBeat + ((engine.ctx.currentTime - anchorTime) * anchorBpm) / 60) % 16
  );
}
function reanchor() {
  anchorBeat = engine.beat;
  anchorTime = engine.ctx?.currentTime ?? 0;
  anchorBpm = score.bpm;
}
function updateReadout() {
  const value = Math.floor(phase()) + 1;
  if (value !== lastBeat) {
    $("beat-counter").textContent = String(value).padStart(2, "0");
    lastBeat = value;
    beatWrites++;
  }
}
function frame() {
  animation = 0;
  if (!engine.playing) return;
  visualFrames++;
  $("sweep").setAttribute(
    "transform",
    `rotate(${(phase() / 16) * 360} 400 400)`,
  );
  updateReadout();
  animation = requestAnimationFrame(frame);
}
function startMotion() {
  cancelAnimationFrame(animation);
  clearInterval(readoutTimer);
  reanchor();
  if (!engine.playing) return;
  if (reduced.matches) readoutTimer = window.setInterval(updateReadout, 100);
  else animation = requestAnimationFrame(frame);
}
function stopMotion() {
  cancelAnimationFrame(animation);
  clearInterval(readoutTimer);
  animation = 0;
  readoutTimer = 0;
  pulseGeneration++;
  pulseTimers.forEach(clearTimeout);
  pulseTimers.clear();
  document
    .querySelectorAll(".sounding")
    .forEach((el) => el.classList.remove("sounding"));
  if (!reduced.matches)
    $("sweep").setAttribute(
      "transform",
      `rotate(${(engine.beat / 16) * 360} 400 400)`,
    );
  updateReadout();
}
function stopSound(reset = true) {
  transportGeneration++;
  if (reset) engine.stop();
  else engine.pause();
  stopMotion();
}
function pulse(id: string) {
  if (reduced.matches) return;
  const node = $(`star-${id}`);
  if (!node) return;
  node.classList.remove("sounding");
  const timer = window.setTimeout(() => {
    node.classList.add("sounding");
    pulseTimers.delete(timer);
  }, 0);
  pulseTimers.add(timer);
}
function schedulePulse(step: number) {
  if (reduced.matches) return;
  const generation = pulseGeneration;
  let delay = (((step / 2 - engine.beat + 16) % 16) * 60) / score.bpm;
  if (delay > 0.2) delay = 0;
  const timer = window.setTimeout(() => {
    pulseTimers.delete(timer);
    if (generation !== pulseGeneration || !engine.playing) return;
    score.stars
      .filter((n) => n.step === step && audible(score, n.layer))
      .forEach((n) => pulse(n.id));
  }, delay * 1000);
  pulseTimers.add(timer);
}
async function togglePlay() {
  if (playBusy) return;
  if (engine.playing) {
    stopSound(false);
    message("paused");
    update();
    return;
  }
  playBusy = true;
  const token = ++transportGeneration;
  try {
    await engine.play();
    if (token !== transportGeneration) engine.stop();
    else {
      startMotion();
      markLesson("play");
      message("playing");
    }
  } catch {
    message("audiofailed");
  } finally {
    playBusy = false;
    update();
  }
}
function snapshot(): Snapshot {
  return {
    score: clone(score),
    selected,
    layer: activeLayer,
    undo: clone(undo),
    redo: clone(redo),
    draftState,
    pendingShare,
    listening,
    listOpen: $<HTMLDetailsElement>("note-list").open,
    tuningOpen: $<HTMLDetailsElement>("tuning").open,
  };
}
function beginTour(record?: LessonRecord) {
  stopSound();
  closePanel();
  original = snapshot();
  lesson = record ?? freshLesson(t("practicetitle"));
  score = clone(lesson.practice);
  selected = score.stars.some((n) => n.id === lesson!.selected)
    ? lesson.selected
    : (score.stars[0]?.id ?? "");
  activeLayer = lesson.layer;
  undo = [];
  redo = [];
  listening = false;
  storeLesson(store, lesson);
  update();
  enterLessonStep();
}
function finishTour(skipped: boolean) {
  if (!lesson || !original) return;
  stopSound();
  closePanel();
  lesson.status = skipped ? "skipped" : "done";
  lesson.practice = clone(score);
  storeLesson(store, lesson);
  const saved = original;
  lesson = null;
  original = null;
  score = saved.score;
  selected = saved.selected;
  activeLayer = saved.layer;
  undo = saved.undo;
  redo = saved.redo;
  draftState = saved.draftState;
  pendingShare = saved.pendingShare;
  listening = saved.listening;
  $<HTMLDetailsElement>("note-list").open = saved.listOpen;
  $<HTMLDetailsElement>("tuning").open = saved.tuningOpen;
  update();
  message("tourfinished");
  $("action-help").focus({ preventScroll: true });
}
function markLesson(action: LessonAction) {
  if (!lesson || LESSON_ACTIONS[lesson.step] !== action) return;
  lesson.completed[lesson.step] = true;
  lesson.practice = clone(score);
  lesson.selected = selected;
  lesson.layer = activeLayer;
  const written = storeLesson(store, lesson);
  if (action === "save" && !written) lesson.completed[5] = false;
  syncLesson();
}
function enterLessonStep() {
  if (!lesson) return;
  listening = false;
  update();
  if (mobile.matches && lesson.step === 4) {
    openPanel();
    $("duration").focus();
  } else {
    closePanel();
    const ids = [
      "action-play",
      "layer-1",
      "action-add",
      `star-${selected}`,
      "duration",
      "action-save",
    ];
    $(ids[lesson.step])?.focus({ preventScroll: !mobile.matches });
  }
  syncLesson();
}
function syncLesson() {
  const bar = $("lesson-bar");
  bar.hidden = !lesson;
  app.classList.toggle("learning", !!lesson);
  document
    .querySelectorAll(".tour-target")
    .forEach((el) => el.classList.remove("tour-target"));
  if (!lesson) {
    document.documentElement.style.setProperty("--lesson-height", "0px");
    return;
  }
  $("lesson-counter").textContent = `${lesson.step + 1} / 6`;
  $("lesson-title").textContent = t(`lesson${lesson.step + 1}title` as Key);
  $("lesson-body").textContent = t(`lesson${lesson.step + 1}body` as Key);
  $("lesson-progress").textContent = t(
    lesson.completed[lesson.step] ? "lessonready" : "lessonwait",
  );
  $<HTMLButtonElement>("action-tour-back").disabled = lesson.step === 0;
  $<HTMLButtonElement>("action-tour-next").disabled =
    !lesson.completed[lesson.step];
  const next = $("action-tour-next");
  next.querySelector("span")!.textContent = t(
    lesson.step === 5 ? "lessonfinish" : "lessonnext",
  );
  next.setAttribute(
    "aria-label",
    t(lesson.step === 5 ? "lessonfinish" : "lessonnext"),
  );
  const targets = [
    "action-play",
    "layer-selectors",
    "action-add",
    "stage",
    "note-fields",
    "action-save",
  ];
  $(targets[lesson.step])?.classList.add("tour-target");
  document.documentElement.style.setProperty(
    "--lesson-height",
    `${panelOpen ? 0 : bar.getBoundingClientRect().height}px`,
  );
}
function openPanel() {
  if (!mobile.matches) {
    $("note").focus();
    return;
  }
  if (panelOpen) return;
  panelReturn = (document.activeElement as HTMLElement).id || "action-panel";
  panelOpen = true;
  const panel = $("inspector");
  panel.classList.add("open");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  $("sheet-backdrop").hidden = false;
  $("lesson-bar").parentElement !== panel &&
    panel.insertBefore($("lesson-bar"), $("selected-summary"));
  for (const id of ["orbit-area", "transport", "layer-controls"])
    $(id).inert = true;
  document.querySelector<HTMLElement>(".topbar")!.inert = true;
  document.querySelector<HTMLElement>(".statusbar")!.inert = true;
  document.body.classList.add("sheet-open");
  $("action-close-panel").focus({ preventScroll: true });
  syncLesson();
}
function closePanel() {
  if (!panelOpen) return;
  panelOpen = false;
  const panel = $("inspector");
  panel.classList.remove("open");
  panel.removeAttribute("role");
  panel.removeAttribute("aria-modal");
  $("sheet-backdrop").hidden = true;
  $("lesson-home").append($("lesson-bar"));
  for (const id of ["orbit-area", "transport", "layer-controls"])
    $(id).inert = false;
  document.querySelector<HTMLElement>(".topbar")!.inert = false;
  document.querySelector<HTMLElement>(".statusbar")!.inert = false;
  document.body.classList.remove("sheet-open");
  $(panelReturn)?.focus({ preventScroll: true });
  syncLesson();
}
function add(position = { step: Math.floor(engine.beat * 2) % 32, degree: 6 }) {
  if (score.stars.length >= 96) {
    message("limit");
    return;
  }
  void edit(() => {
    const n: Star = {
      id: uid(),
      layer: activeLayer,
      ...position,
      duration: 0.5,
      velocity: 0.65,
    };
    score.stars.push(n);
    selected = n.id;
  }, "add");
  $(`star-${selected}`)?.focus({ preventScroll: true });
}
function select(id: string) {
  const n = score.stars.find((s) => s.id === id);
  if (!n) return;
  selected = id;
  activeLayer = n.layer;
  if (lesson) {
    lesson.selected = id;
    lesson.layer = n.layer;
    storeLesson(store, lesson);
  }
  update();
}
function replaceScore(next: Score) {
  stopSound();
  const before = clone(score);
  score = next;
  selected = score.stars[0]?.id ?? "";
  activeLayer = 0;
  pushHistory(before);
  update();
}
function save() {
  if (lesson) {
    lesson.atlas = [clone(score)];
    lesson.practice = clone(score);
    const written = storeLesson(store, lesson);
    markLesson("save");
    if (written) message("practicesaved");
    else message("storage");
    syncLibrary();
    return;
  }
  const index = library.findIndex((s) => s.id === score.id);
  if (index < 0 && library.length >= 24) {
    message("librarylimit");
    return;
  }
  const next = clone(library);
  if (index < 0) next.push(clone(score));
  else next[index] = clone(score);
  if (!store.write(KEYS.atlas, JSON.stringify(next))) {
    message("storage");
    return;
  }
  library = next;
  persist();
  syncLibrary();
  message("savedtoast");
}
function download(blob: Blob, extension: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = `${score.title.replace(/[^\p{L}\p{N}-]+/gu, "-") || "sidereal"}.${extension}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function exportPNG() {
  const svg = $<SVGSVGElement>("sky").cloneNode(true) as SVGSVGElement;
  svg.querySelector("#sweep")?.remove();
  svg
    .querySelectorAll(".hit,.pulse-ring,.selection-ring,.note-label")
    .forEach((n) => n.remove());
  svg.removeAttribute("style");
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = `svg{--map-font:18px;--note-font:20px}.orbit-ring,.center-ring{fill:none;stroke:${PALETTE.orbit};stroke-width:1}.spoke,.tick{stroke:${PALETTE.line};fill:none}.tick.major{stroke:${PALETTE.secondary}}.star-dot{fill:var(--layer)}.star-cross{stroke:var(--layer);stroke-width:.7}.map-label,.center-label{fill:${PALETTE.secondary};font:18px monospace}.muted .star-dot,.muted .star-cross{opacity:.3}`;
  svg.prepend(style);
  const src = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(svg)], {
      type: "image/svg+xml",
    }),
  );
  try {
    const image = new Image();
    image.src = src;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 1880;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = PALETTE.background;
    ctx.fillRect(0, 0, 1600, 1880);
    ctx.fillStyle = PALETTE.text;
    ctx.font = "26px sans-serif";
    ctx.fillText("S I D E R E A L  /  MUSICAL OBSERVATORY", 100, 100);
    ctx.font = "64px Georgia";
    ctx.fillText(score.title, 100, 205, 1400);
    ctx.drawImage(image, 100, 240, 1400, 1400);
    ctx.fillStyle = PALETTE.secondary;
    ctx.font = "26px monospace";
    ctx.fillText(
      `${score.bpm} BPM · ${ROOTS[score.root]} ${score.scale} · 16 beats / 32 steps`,
      100,
      1740,
    );
    ctx.font = "22px sans-serif";
    ctx.fillText(
      score.layers
        .map(
          (l) =>
            `${l.name} / ${l.voice}${l.mute ? " [muted]" : ""}${l.solo ? " [solo]" : ""}`,
        )
        .join(" · "),
      100,
      1800,
      1400,
    );
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(Error())), "image/png"),
    );
    download(blob, "png");
  } finally {
    URL.revokeObjectURL(src);
  }
}
function mapPoint(event: PointerEvent | MouseEvent) {
  const matrix = $<SVGSVGElement>("sky").getScreenCTM();
  if (!matrix) return { x: 400, y: 400 };
  return new DOMPoint(event.clientX, event.clientY).matrixTransform(
    matrix.inverse(),
  );
}
function nearby(event: MouseEvent | PointerEvent) {
  const svg = $<SVGSVGElement>("sky"),
    matrix = svg.getScreenCTM();
  if (!matrix) return [];
  return score.stars
    .map((n) => {
      const p = point(n),
        screen = new DOMPoint(p.x, p.y).matrixTransform(matrix);
      return {
        id: n.id,
        d: Math.hypot(screen.x - event.clientX, screen.y - event.clientY),
      };
    })
    .filter((n) => n.d <= 24)
    .sort((a, b) => a.d - b.d)
    .map((n) => n.id);
}
function pick(ids: string[]) {
  const host = $("pick-rows");
  host.replaceChildren();
  for (const id of ids) {
    const n = score.stars.find((s) => s.id === id)!;
    const b = document.createElement("button");
    b.dataset.pick = id;
    b.className = "pick-row";
    b.style.setProperty("--layer", COLORS[n.layer]);
    b.textContent = `${noteName(score, n)} · ${score.layers[n.layer].name} · ${t("step")} ${n.step + 1}`;
    host.append(b);
  }
  $<HTMLDialogElement>("pick-dialog").showModal();
}
function bind() {
  app.addEventListener("click", async (event) => {
    const target = (event.target as Element).closest<HTMLElement>(
      "button,summary",
    );
    const menu = $<HTMLDetailsElement>("export-menu");
    if (menu.open && !(event.target as Element).closest("#export-menu"))
      menu.open = false;
    if (target?.closest(".menu-body")) {
      menu.open = false;
      $("export-summary").focus({ preventScroll: true });
    }
    if (target?.dataset.layer !== undefined) {
      activeLayer = +target.dataset.layer;
      markLesson("layer");
      update();
      return;
    }
    if (target?.dataset.select) {
      select(target.dataset.select);
      return;
    }
    if (target?.dataset.pick) {
      select(target.dataset.pick);
      $<HTMLDialogElement>("pick-dialog").close();
      $(`star-${selected}`)?.focus({ preventScroll: true });
      return;
    }
    if (target?.dataset.preset) {
      const p = preset(target.dataset.preset as (typeof PRESETS)[number]);
      p.title = t(target.dataset.preset as Key);
      replaceScore(p);
      $<HTMLDialogElement>("atlas-dialog").close();
      return;
    }
    if (target?.dataset.tab) {
      atlasTab = target.dataset.tab;
      syncLibrary();
      return;
    }
    if (target?.dataset.load) {
      const found = (lesson ? lesson.atlas : library).find(
        (s) => s.id === target.dataset.load,
      );
      if (found) {
        replaceScore(clone(found));
        $<HTMLDialogElement>("atlas-dialog").close();
      }
      return;
    }
    if (target?.dataset.deleteSave) {
      if (confirm(t("discard"))) {
        if (lesson) {
          lesson.atlas = [];
          storeLesson(store, lesson);
        } else {
          const next = library.filter(
            (s) => s.id !== target.dataset.deleteSave,
          );
          if (store.write(KEYS.atlas, JSON.stringify(next))) library = next;
          else message("storage");
        }
        syncLibrary();
        $("action-new").focus({ preventScroll: true });
      }
      return;
    }
    const action = target?.dataset.action;
    if (action) {
      switch (action) {
        case "play":
          await togglePlay();
          break;
        case "stop":
          stopSound();
          message("paused");
          update();
          break;
        case "master":
          engine.toggleMute();
          update();
          message(engine.muted ? "soundoff" : "soundon");
          break;
        case "layer-mute":
          await edit(
            () =>
              (score.layers[activeLayer].mute =
                !score.layers[activeLayer].mute),
          );
          break;
        case "layer-solo":
          await edit(
            () =>
              (score.layers[activeLayer].solo =
                !score.layers[activeLayer].solo),
          );
          break;
        case "language":
          lang = lang === "en" ? "ru" : "en";
          store.write(KEYS.language, lang);
          update();
          break;
        case "help":
          if (lesson) enterLessonStep();
          else beginTour();
          break;
        case "tour-skip":
          finishTour(true);
          break;
        case "tour-back":
          if (lesson && lesson.step > 0) {
            lesson.step--;
            storeLesson(store, lesson);
            enterLessonStep();
          }
          break;
        case "tour-next":
          if (lesson && lesson.completed[lesson.step]) {
            if (lesson.step === 5) finishTour(false);
            else {
              lesson.step++;
              storeLesson(store, lesson);
              enterLessonStep();
            }
          }
          break;
        case "listening":
          closePanel();
          listening = !listening;
          update();
          break;
        case "panel":
          openPanel();
          break;
        case "close-panel":
          closePanel();
          break;
        case "list":
          if (listening) {
            listening = false;
            update();
          }
          $<HTMLDetailsElement>("note-list").open = true;
          if (mobile.matches) openPanel();
          $("note-list").scrollIntoView({
            block: "nearest",
            behavior: "instant",
          });
          break;
        case "atlas":
          $<HTMLDialogElement>("atlas-dialog").showModal();
          break;
        case "close-atlas":
          $<HTMLDialogElement>("atlas-dialog").close();
          break;
        case "close-pick":
          $<HTMLDialogElement>("pick-dialog").close();
          break;
        case "close-link":
          $<HTMLDialogElement>("link-dialog").close();
          break;
        case "add":
          add();
          break;
        case "duplicate": {
          const n = star();
          if (!n) break;
          if (score.stars.length >= 96) {
            message("limit");
            break;
          }
          await edit(() => {
            const copy = { ...n, id: uid(), step: (n.step + 1) % 32 };
            score.stars.push(copy);
            selected = copy.id;
          }, "add");
          break;
        }
        case "remove":
          await edit(() => {
            score.stars = score.stars.filter((n) => n.id !== selected);
            selected = score.stars[0]?.id ?? "";
          });
          break;
        case "step-prev":
        case "step-next":
          if (star())
            await edit(
              () =>
                (star()!.step =
                  (star()!.step + (action === "step-next" ? 1 : 31)) % 32),
              "move",
            );
          break;
        case "preview":
          if (star())
            try {
              await engine.preview(star()!);
              pulse(selected);
            } catch {
              message("audiofailed");
            }
          break;
        case "undo":
          if (undo.length) {
            stopSound();
            redo.push(clone(score));
            score = undo.pop()!;
            if (!star()) selected = score.stars[0]?.id ?? "";
            persist();
            update();
          }
          break;
        case "redo":
          if (redo.length) {
            stopSound();
            undo.push(clone(score));
            score = redo.pop()!;
            if (!star()) selected = score.stars[0]?.id ?? "";
            persist();
            update();
          }
          break;
        case "save":
          save();
          break;
        case "new":
          replaceScore({
            ...preset("evening"),
            title: t("untitled"),
            stars: [],
          });
          $<HTMLDialogElement>("atlas-dialog").close();
          break;
        case "import":
          $<HTMLInputElement>("import-file").click();
          break;
        case "json":
          try {
            download(
              new Blob([JSON.stringify(score, null, 2)], {
                type: "application/json",
              }),
              "sidereal.json",
            );
            message("exported");
          } catch {
            message("filefailed");
          }
          break;
        case "share":
          try {
            const link = `${location.href.split("#")[0]}#score=${shareEncode(score)}`;
            try {
              await navigator.clipboard.writeText(link);
              message("copied");
            } catch {
              setValue("share-link", link);
              $<HTMLDialogElement>("link-dialog").showModal();
              $<HTMLTextAreaElement>("share-link").select();
              message("copyfailed");
            }
          } catch {
            message("sharelarge");
          }
          break;
        case "png":
        case "wav":
          if (busy) break;
          busy = true;
          update();
          message("rendering");
          try {
            if (action === "png") await exportPNG();
            else
              download(await renderAudio(clone(score), engine.volume), "wav");
            message("exported");
          } catch {
            message(action === "png" ? "pngfailed" : "wavfailed");
          } finally {
            busy = false;
            update();
          }
          break;
      }
      return;
    }
    if ((event.target as Element).closest("#sky")) {
      if (suppressClick) return;
      const candidates = nearby(event);
      if (candidates.length > 1) pick(candidates);
      else if (candidates.length) select(candidates[0]);
      else {
        const p = mapPoint(event);
        if (
          Math.hypot(p.x - 400, p.y - 400) > 64 &&
          Math.hypot(p.x - 400, p.y - 400) < 328
        )
          add(fromPoint(p.x, p.y));
      }
    }
  });
  app.addEventListener("change", async (event) => {
    const el = event.target as HTMLInputElement,
      n = star();
    switch (el.id) {
      case "title":
        await edit(() => (score.title = el.value.trim() || t("untitled")));
        break;
      case "tempo":
        await edit(
          () => (score.bpm = clamp(Number(el.value) || 76, 40, 180)),
          undefined,
          true,
        );
        break;
      case "root":
        await edit(() => (score.root = +el.value));
        break;
      case "scale":
        await edit(() => (score.scale = el.value as Scale));
        break;
      case "voice":
        await edit(() => (score.layers[activeLayer].voice = el.value as Voice));
        break;
      case "note":
        if (n) await edit(() => (n.degree = +el.value), "move");
        break;
      case "step":
        if (n)
          await edit(
            () => (n.step = clamp(Math.round(+el.value || 1) - 1, 0, 31)),
            "move",
          );
        break;
      case "duration":
        if (n) await edit(() => (n.duration = +el.value), "shape");
        break;
      case "velocity":
        if (n) {
          if (rangeBefore) {
            pushHistory(rangeBefore);
            rangeBefore = null;
            markLesson("shape");
          } else
            await edit(
              () => (n.velocity = clamp(+el.value / 100, 0.1, 1)),
              "shape",
            );
          update();
        }
        break;
      case "import-file": {
        const file = el.files?.[0];
        if (!file) break;
        try {
          if (file.size > 60000) throw Error();
          const next = parseScore(await file.text());
          replaceScore({ ...next, id: uid() });
          message("loaded");
        } catch {
          message("invalid");
        }
        el.value = "";
        break;
      }
    }
  });
  app.addEventListener("input", (event) => {
    const el = event.target as HTMLInputElement;
    if (el.id === "master-volume") {
      engine.setVolume(+el.value / 100);
      $("master-value").textContent = `${el.value}%`;
    }
    if (el.id === "velocity" && star()) {
      rangeBefore ??= clone(score);
      star()!.velocity = clamp(+el.value / 100, 0.1, 1);
      $("velocity-value").textContent = `${el.value}%`;
      syncSky();
    }
  });
  app.addEventListener("pointerdown", (event) => {
    const target = (event.target as Element).closest<SVGGElement>(
      "[data-star]",
    );
    if (!target || event.button !== 0) return;
    const nearest = nearby(event)[0] ?? target.dataset.star!;
    drag = {
      id: nearest,
      before: clone(score),
      x: event.clientX,
      y: event.clientY,
      pointer: event.pointerId,
      changed: false,
    };
    if (event.pointerType === "mouse") event.preventDefault();
  });
  window.addEventListener("pointermove", (event) => {
    if (!drag || drag.pointer !== event.pointerId) return;
    if (
      !drag.changed &&
      Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6
    )
      return;
    const n = score.stars.find((n) => n.id === drag!.id);
    if (!n) return;
    selected = n.id;
    activeLayer = n.layer;
    const p = mapPoint(event),
      position = fromPoint(p.x, p.y);
    if (n.step !== position.step || n.degree !== position.degree) {
      Object.assign(n, position);
      drag.changed = true;
      syncSky();
    }
  });
  const endDrag = () => {
    if (!drag) return;
    if (drag.changed) {
      pushHistory(drag.before);
      engine.silence();
      markLesson("move");
      suppressClick = true;
      setTimeout(() => (suppressClick = false), 0);
      update();
    }
    drag = null;
  };
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);
  window.addEventListener("keydown", (event) => {
    const el = event.target as HTMLElement;
    if (event.key === "Escape") {
      $<HTMLDetailsElement>("export-menu").open = false;
      if (el.closest("#export-menu"))
        $("export-summary").focus({ preventScroll: true });
      stopSound();
      update();
      if (panelOpen) closePanel();
      return;
    }
    if (panelOpen && event.key === "Tab") {
      const fields = [
        ...$("inspector").querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,[tabindex="0"]',
        ),
      ].filter((n) => n.getClientRects().length);
      if (fields.length) {
        const first = fields[0],
          last = fields.at(-1)!;
        if (event.shiftKey && el === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && el === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    if (
      el.matches("[role=tab]") &&
      ["ArrowLeft", "ArrowRight"].includes(event.key)
    ) {
      event.preventDefault();
      atlasTab = atlasTab === "presets" ? "library" : "presets";
      syncLibrary();
      $(`tab-${atlasTab}`).focus();
      return;
    }
    const editing =
      el.matches("input,select,textarea") || !!el.closest("dialog");
    if (editing) return;
    if (
      lesson &&
      event.altKey &&
      ["ArrowRight", "ArrowLeft"].includes(event.key)
    ) {
      event.preventDefault();
      $(
        event.key === "ArrowRight" ? "action-tour-next" : "action-tour-back",
      ).click();
      return;
    }
    if (
      event.code === "Space" &&
      !event.repeat &&
      (!el.matches("button,summary,a") || el.closest("#sky"))
    ) {
      event.preventDefault();
      void togglePlay();
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "z") {
      event.preventDefault();
      $(event.shiftKey ? "action-redo" : "action-undo").click();
    }
    if (el.dataset.star) selected = el.dataset.star;
    if (el.closest("#sky") && star()) {
      if (
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      ) {
        event.preventDefault();
        void edit(() => {
          const n = star()!;
          if (event.key === "ArrowLeft") n.step = (n.step + 31) % 32;
          if (event.key === "ArrowRight") n.step = (n.step + 1) % 32;
          if (event.key === "ArrowUp") n.degree = clamp(n.degree + 1, 0, 14);
          if (event.key === "ArrowDown") n.degree = clamp(n.degree - 1, 0, 14);
        }, "move");
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        $("action-remove").click();
        $("action-add").focus({ preventScroll: true });
      }
      if (event.key === "Enter" && el.dataset.star) {
        select(el.dataset.star);
        if (mobile.matches) openPanel();
        $("note").focus();
      }
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && engine.playing) {
      stopSound(false);
      update();
      message("hidden");
    }
  });
  window.addEventListener("pagehide", () => {
    stopSound();
    if (lesson) storeLesson(store, lesson);
  });
  reduced.addEventListener("change", () => {
    stopMotion();
    if (engine.playing) startMotion();
  });
  mobile.addEventListener("change", () => {
    if (!mobile.matches) closePanel();
    resizeSky();
  });
  new ResizeObserver(() => {
    resizeSky();
    if (lesson) syncLesson();
  }).observe($("orbit-area"));
}
export async function initialize() {
  if (initialized) return;
  await document.fonts.ready;
  lang = store.read(KEYS.language) === "ru" ? "ru" : "en";
  const draft = store.read(KEYS.draft);
  if (draft) {
    try {
      score = parseScore(draft);
      draftState = "saved";
    } catch {
      draftState = "failed";
    }
  } else if (!store.available) draftState = "failed";
  try {
    const raw = JSON.parse(store.read(KEYS.atlas) || "[]");
    if (Array.isArray(raw))
      library = raw.slice(0, 24).flatMap((s) => {
        try {
          return [validate(s)];
        } catch {
          return [];
        }
      });
  } catch {
    /* Leave corrupt stored data untouched. */
  }
  if (location.hash.startsWith("#score=")) {
    try {
      score = { ...shareDecode(location.hash.slice(7)), id: uid() };
      pendingShare = true;
      toastKey = "loaded";
    } catch {
      toastKey = "invalid";
    }
  }
  selected = score.stars[2]?.id ?? score.stars[0]?.id ?? "";
  app.innerHTML = shell();
  const bar = $("lesson-bar"),
    home = document.createElement("div");
  home.id = "lesson-home";
  bar.replaceWith(home);
  home.append(bar);
  $<HTMLSelectElement>("root").replaceChildren(
    ...ROOTS.map((v, i) => new Option(v, String(i))),
  );
  $<HTMLSelectElement>("scale").replaceChildren(
    ...Object.keys(SCALES).map((v) => {
      const o = new Option(t(v as Key), v);
      o.dataset.i18n = v;
      return o;
    }),
  );
  drawSky();
  makePresets();
  bind();
  initialized = true;
  update();
  const stored = readLesson(store);
  if (!stored) beginTour();
  else if (stored.status === "active") beginTour(stored);
  Object.defineProperty(window, "siderealDiagnostics", {
    configurable: true,
    get: () => ({
      playing: engine.playing,
      beat: engine.beat,
      activeVoices: engine.nodes,
      contextState: engine.ctx?.state ?? "not-created",
      muted: engine.muted,
      volume: engine.volume,
      score: clone(score),
      userScore: clone(original?.score ?? score),
      library: clone(library),
      lesson: lesson
        ? {
            step: lesson.step,
            completed: lesson.completed,
            status: lesson.status,
          }
        : null,
      draftState,
      pendingShare,
      listening,
      visualFrames,
      beatWrites,
      visualLoop: !!animation || !!readoutTimer,
    }),
  });
}
