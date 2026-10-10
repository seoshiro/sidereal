import "./style.css";
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
import { translate, Key, Language } from "./i18n";
const app = document.querySelector<HTMLDivElement>("#app")!;
const DRAFT = "sidereal.draft.v1",
  LIBRARY = "sidereal.atlas.v1";
let lang: Language = "en",
  score = preset("evening"),
  selected = score.stars[2]?.id ?? "",
  activeLayer = 0,
  library: Score[] = [],
  saved = false;
let undo: Score[] = [],
  redo: Score[] = [],
  busy = false,
  drag: {
    id: string;
    before: Score;
    changed: boolean;
    pointer: number;
  } | null = null;
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const t = (key: Key) => translate(key, lang);
const esc = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
try {
  lang = localStorage.getItem("sidereal.language") === "ru" ? "ru" : "en";
  const draft = localStorage.getItem(DRAFT);
  if (draft) score = parseScore(draft);
  const list = JSON.parse(localStorage.getItem(LIBRARY) || "[]");
  if (Array.isArray(list)) library = list.slice(0, 24).map(validate);
  selected = score.stars[2]?.id ?? score.stars[0]?.id ?? "";
} catch {
  /* corrupt browser storage starts a clean sky */
}
let startup: Key | null = null;
if (location.hash.startsWith("#score=")) {
  try {
    score = shareDecode(location.hash.slice(7));
    score.id = uid();
    selected = score.stars[0]?.id ?? "";
    startup = "loaded";
    window.history.replaceState(null, "", location.pathname + location.search);
  } catch {
    startup = "invalid";
  }
}
const engine = new Engine(
  () => score,
  (step) => {
    if (!reduced.matches)
      score.stars
        .filter((s) => s.step === step && audible(score, s.layer))
        .forEach((s) => {
          const el = document.getElementById(`star-${s.id}`);
          el?.classList.remove("sounding");
          requestAnimationFrame(() => el?.classList.add("sounding"));
        });
  },
);
const paths: Record<string, string> = {
  play: "m9 5 11 7-11 7z",
  pause: "M8 5v14M16 5v14",
  stop: "M6 6h12v12H6z",
  plus: "M12 5v14M5 12h14",
  mute: "m11 5-6 4H2v6h3l6 4V5M16 9l6 6M22 9l-6 6",
  volume: "m11 5-6 4H2v6h3l6 4V5M16 8q6 4 0 8M19 5q10 7 0 14",
  undo: "M9 5 3 11l6 6M3 11h10q8 0 8 8",
  redo: "m15 5 6 6-6 6M21 11h-10q-8 0-8 8",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  export: "M12 16V3m-4 4 4-4 4 4M4 14v6h16v-6",
  help: "M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 4M12 18h.01",
  cross: "m6 6 12 12M18 6 6 18",
  star: "m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7z",
  save: "M5 3h12l4 4v14H3V3h2M7 3v6h10V3M7 21v-8h10v8",
};
const icon = (name: string) =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]}"/></svg>`;
const button = (
  action: string,
  label: string,
  symbol: string,
  classes = "",
  attrs = "",
) =>
  `<button type="button" data-action="${action}" class="${classes}" ${attrs}>${icon(symbol)}<span>${label}</span></button>`;
function persist() {
  try {
    localStorage.setItem(DRAFT, JSON.stringify(score));
    saved = true;
  } catch {
    saved = false;
    toast("storage");
  }
}
function toast(key: Key) {
  const el = document.querySelector<HTMLElement>("#status");
  if (el) el.textContent = t(key);
}
function history(before: Score) {
  undo.push(before);
  if (undo.length > 60) undo.shift();
  redo = [];
  persist();
}
function change(fn: () => void, tempo = false) {
  const before = clone(score);
  fn();
  if (JSON.stringify(before) !== JSON.stringify(score)) {
    history(before);
    if (tempo) engine.changeTempo();
    else engine.silence();
  }
  render();
}
function star() {
  return score.stars.find((s) => s.id === selected);
}
function renderStage() {
  const host = document.querySelector("#stage");
  if (!host) return;
  const lines = score.layers
    .map((_, i) => {
      const stars = score.stars
        .filter((s) => s.layer === i)
        .sort((a, b) => a.step - b.step);
      return stars.length > 1
        ? `<path d="${stars
            .map((s, j) => {
              const p = point(s);
              return `${j ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
            })
            .join(
              " ",
            )}" fill="none" stroke="${COLORS[i]}" opacity="${audible(score, i) ? ".42" : ".12"}" stroke-width="1"/>`
        : "";
    })
    .join("");
  const rings = Array.from(
    { length: 8 },
    (_, i) =>
      `<circle cx="400" cy="400" r="${80 + (i * 240) / 7}" class="orbit-ring"/>`,
  ).join("");
  const ticks = Array.from({ length: 64 }, (_, i) => {
    const a = (i / 64) * Math.PI * 2 - Math.PI / 2;
    const r = i % 4 === 0 ? 334 : 341;
    return `<path d="M${400 + Math.cos(a) * r} ${400 + Math.sin(a) * r}L${400 + Math.cos(a) * 347} ${400 + Math.sin(a) * 347}" class="tick ${i % 4 === 0 ? "major" : ""}"/>`;
  }).join("");
  const spokes = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    return `<path d="M${400 + Math.cos(a) * 60} ${400 + Math.sin(a) * 60}L${400 + Math.cos(a) * 320} ${400 + Math.sin(a) * 320}" class="spoke"/>`;
  }).join("");
  const labels = [
    ["01", 400, 34],
    ["05", 766, 405],
    ["09", 400, 775],
    ["13", 34, 405],
  ]
    .map(
      ([s, x, y]) =>
        `<text x="${x}" y="${y}" text-anchor="middle" class="map-label">${s}</text>`,
    )
    .join("");
  const stars = score.stars
    .map((s) => {
      const p = point(s),
        sel = s.id === selected;
      return `<g id="star-${s.id}" data-star="${s.id}" class="map-star ${sel ? "selected" : ""}" style="--star:${COLORS[s.layer]};opacity:${audible(score, s.layer) ? 1 : 0.25}" tabindex="0" role="button" aria-label="${esc(`${score.layers[s.layer].name}, ${noteName(score, s)}, ${t("step")} ${s.step + 1}`)}" aria-pressed="${sel}" transform="translate(${p.x} ${p.y})"><circle class="hit" r="20" fill="transparent"/><circle class="pulse-ring" r="10"/><circle class="selection-ring" r="15"/><path d="M-10 0h20M0-10v20" class="star-cross"/><circle r="${3 + s.velocity * 3}" fill="${COLORS[s.layer]}"/>${sel ? `<text y="-23" text-anchor="middle" class="note-label">${noteName(score, s)}</text>` : ""}</g>`;
    })
    .join("");
  host.innerHTML = `<svg id="sky" viewBox="0 0 800 800" xmlns="http://www.w3.org/2000/svg" role="group" aria-label="${t("map")}" tabindex="0"><rect width="800" height="800" fill="transparent"/>${rings}${spokes}${ticks}${lines}<g id="sweep" transform="rotate(${(engine.beat / 16) * 360} 400 400)"><path d="M400 350V64" stroke="#e8d0a7" opacity=".6"/><circle cx="400" cy="64" r="4" fill="#e8d0a7"/></g><circle cx="400" cy="400" r="42" class="center-ring"/><path d="M384 400h32M400 384v32" class="center-cross"/><circle cx="400" cy="400" r="3" fill="#d6bb91"/>${stars}${labels}<text x="400" y="463" text-anchor="middle" class="center-label">${score.root === 0 ? "C" : ROOTS[score.root]} / ${t(score.scale).toUpperCase()}</text></svg>`;
}
function render() {
  const focused = (document.activeElement as HTMLElement)?.id;
  document.documentElement.lang = lang;
  const n = star();
  const opt = (
    value: string | number,
    label: string,
    current: string | number,
  ) =>
    `<option value="${value}" ${value === current ? "selected" : ""}>${esc(label)}</option>`;
  app.innerHTML = `<div class="shell"><header class="masthead"><a class="brand" href="./" aria-label="SIDEREAL"><span class="brand-mark">✧</span> SIDEREAL<span class="edition">/ 01</span></a><span class="mast-sub">${t("observatory")}</span><div class="header-actions"><button data-action="language" class="language" aria-label="${lang === "en" ? "Переключить на русский" : "Switch to English"}">${lang === "en" ? "RU" : "EN"}</button><button data-action="help" class="icon-button" aria-label="${t("help")}">${icon("help")}</button><details class="export-menu"><summary>${icon("export")}<span>${t("export")}</span></summary><div class="menu-body">${["json", "png", "wav", "share", "import"].map((k) => `<button data-action="${k}" ${busy ? "disabled" : ""}>${t(k as Key)}</button>`).join("")}</div></details></div></header>
 <section class="score-heading"><div><p class="eyebrow">${t("subtitle")}</p><input id="title" class="title-input" value="${esc(score.title)}" maxlength="80" aria-label="${t("composition")}"></div><div class="heading-tools"><div class="history">${button("undo", t("undo"), "undo", "icon-button", `aria-label="${t("undo")}" ${undo.length ? "" : "disabled"}`)}${button("redo", t("redo"), "redo", "icon-button", `aria-label="${t("redo")}" ${redo.length ? "" : "disabled"}`)}</div>${button("save", t("save"), "save", "save-button")}</div></section>
 <main class="workspace"><aside class="left-rail"><section class="rail-section"><h2><span>01</span>${t("presets")}</h2><div class="preset-list">${PRESETS.map((p, i) => `<button data-preset="${p}" class="preset ${score.title === presetTitle(p) ? "chosen" : ""}"><span class="preset-number">0${i + 1}</span><span>${t(p)}</span>${icon("arrow")}</button>`).join("")}</div></section><section class="rail-section constellations"><h2><span>02</span>${t("layers")}</h2>${score.layers.map((l, i) => `<div class="layer ${activeLayer === i ? "active" : ""}" style="--layer:${COLORS[i]}"><button class="layer-select" data-layer="${i}" aria-pressed="${activeLayer === i}"><span class="layer-symbol">${["✧", "⌁", "◌"][i]}</span><span><strong>${esc(l.name)}</strong><small>${score.stars.filter((s) => s.layer === i).length} ${t("stars")}</small></span></button><div class="layer-controls"><label class="sr-only" for="voice-${i}">${esc(l.name)} ${t("voice")}</label><select id="voice-${i}" data-voice="${i}" aria-label="${esc(l.name)} ${t("voice")}">${(["bell", "felt", "tide"] as Voice[]).map((v) => opt(v, t(v), l.voice)).join("")}</select><button data-mute="${i}" aria-label="${t("mute")} ${esc(l.name)}" aria-pressed="${l.mute}" class="small-button ${l.mute ? "on" : ""}">M</button><button data-solo="${i}" aria-label="${t("solo")} ${esc(l.name)}" aria-pressed="${l.solo}" class="small-button ${l.solo ? "on" : ""}">S</button></div></div>`).join("")}${button("add", t("add"), "plus", "add-button")}</section><section class="rail-section atlas"><h2><span>03</span>${t("library")}</h2><div class="saved-list">${library.length ? library.map((s) => `<div><button data-load="${esc(s.id)}">${esc(s.title)}</button><button data-delete-save="${esc(s.id)}" class="icon-button" aria-label="${t("saveddelete")} ${esc(s.title)}">${icon("cross")}</button></div>`).join("") : `<p class="quiet">${t("libraryempty")}</p>`}</div><button data-action="new" class="text-button">+ ${t("new")}</button></section></aside>
 <section class="sky-panel" aria-label="${t("observatory")}"><div class="sky-meta"><span>${t("angular")}</span><span>4/4 · 16 ${lang === "en" ? "BEATS" : "ДОЛЕЙ"}</span></div><div id="stage" class="stage"></div>${score.stars.length ? "" : `<p class="empty-sky">${t("empty")}</p>`}<div class="sky-caption"><span>${t("radial")}</span><p>${t("hint")}</p></div></section>
 <aside class="right-rail"><section class="inspector"><h2><span>✦</span>${t("inspector")}</h2>${n ? `<div class="selected-note" style="--layer:${COLORS[n.layer]}"><span>${noteName(score, n)}</span><small>${esc(score.layers[n.layer].name)}<br>0${n.layer + 1} / ${String(n.step + 1).padStart(2, "0")}</small></div><label for="note">${t("note")}</label><select id="note" data-field="degree">${Array.from({ length: 15 }, (_, i) => opt(i, noteName(score, { ...n, degree: i }), n.degree)).join("")}</select><label for="step">${t("position")}</label><div class="step-field"><button data-nudge="-1" aria-label="${t("position")} −">−</button><input id="step" type="number" min="1" max="32" value="${n.step + 1}"><button data-nudge="1" aria-label="${t("position")} +">+</button></div><label for="duration">${t("duration")}</label><select id="duration" data-field="duration">${[0.25, 0.5, 1, 2, 4].map((d) => opt(d, String(d), n.duration)).join("")}</select><label for="velocity">${t("velocity")}<span>${Math.round(n.velocity * 100)}%</span></label><input id="velocity" type="range" min="10" max="100" value="${n.velocity * 100}">${button("preview", t("preview"), "volume", "preview-button")}<button data-action="remove" class="text-button remove-button">${t("remove")}</button><p class="quiet note-foot">${t("octave")}</p>` : `<div class="inspector-empty">✧<p>${t("select")}</p></div>`}</section><section class="tuning"><h2><span>↳</span>${t("scale")}</h2><div class="tuning-row"><label for="root">${t("key")}</label><select id="root">${ROOTS.map((v, i) => opt(i, v, score.root)).join("")}</select></div><label class="sr-only" for="scale">${t("scale")}</label><select id="scale">${Object.keys(
   SCALES,
 )
   .map((s) => opt(s, t(s as Key), score.scale))
   .join("")}</select></section></aside></main>
 <section class="transport" aria-label="${t("play")}"><div class="play-controls">${button("play", t(engine.playing ? "pause" : "play"), engine.playing ? "pause" : "play", "play-button")}${button("stop", t("stop"), "stop", "icon-button", `aria-label="${t("stop")}"`)}<span id="beat-display" class="beat-display">01<span>/ 16</span></span></div><div class="tempo-control"><label for="tempo">${t("tempo")}<span>BPM</span></label><input id="tempo" type="number" min="40" max="180" value="${score.bpm}"><input id="tempo-range" type="range" min="40" max="180" value="${score.bpm}" aria-label="${t("tempo")}"></div><div class="master-control">${button("master", t(engine.muted ? "unmute" : "mute"), engine.muted ? "mute" : "volume", "icon-button", `aria-label="${t(engine.muted ? "unmute" : "mute")}" aria-pressed="${engine.muted}"`)}<label class="sr-only" for="master-volume">${t("volume")}</label><input id="master-volume" type="range" min="0" max="80" value="${engine.volume * 100}"><span class="master-label">${t("volume")}</span></div></section>
 <section class="timeline"><div class="timeline-heading"><h2>${t("timeline")}</h2><button data-action="table" class="text-button" aria-expanded="false">${t("table")} ↗</button></div><div class="ruler">${Array.from({ length: 16 }, (_, i) => `<span>${String(i + 1).padStart(2, "0")}</span>`).join("")}</div>${score.layers
   .map(
     (l, i) =>
       `<div class="timeline-track" style="--layer:${COLORS[i]};opacity:${audible(score, i) ? 1 : 0.3}"><span class="track-label">${esc(l.name)}</span><div class="track-line">${score.stars
         .filter((s) => s.layer === i)
         .map(
           (s) =>
             `<button data-select="${s.id}" class="note-block ${s.id === selected ? "selected" : ""}" style="left:${(s.step / 32) * 100}%;width:${Math.min((s.duration / 16) * 100, 100 - (s.step / 32) * 100)}%" aria-label="${esc(`${l.name} ${noteName(score, s)}, ${t("step")} ${s.step + 1}`)}"><span>${noteName(score, s)}</span></button>`,
         )
         .join("")}</div></div>`,
   )
   .join(
     "",
   )}<div id="star-table" hidden><table><thead><tr><th>${t("note")}</th><th>${t("layer")}</th><th>${t("step")}</th><th>${t("duration")}</th><th></th></tr></thead><tbody>${score.stars
   .slice()
   .sort((a, b) => a.step - b.step)
   .map(
     (s) =>
       `<tr><td>${noteName(score, s)}</td><td>${esc(score.layers[s.layer].name)}</td><td>${s.step + 1}</td><td>${s.duration}</td><td><button data-select="${s.id}" class="text-button">${t("inspector")} ↗</button></td></tr>`,
   )
   .join("")}</tbody></table></div></section>
 <footer><p id="status" role="status" aria-live="polite">${t(engine.playing ? "playing" : "paused")}</p><span>${t("local")}</span><a href="https://github.com/seoshiro/sidereal" target="_blank" rel="noopener">Beibars / ${t("source")} ↗</a></footer></div>
 <dialog id="help-dialog" aria-labelledby="help-title"><div class="dialog-top"><span class="eyebrow">SIDEREAL / ${t("fieldnotes")}</span><button data-action="close-help" class="icon-button" aria-label="${t("close")}">${icon("cross")}</button></div><h2 id="help-title">${t("help")}</h2>${[1, 2, 3, 4].map((i) => `<section><h3>${t((i === 4 ? "help4" : `help${i}`) as Key)}</h3><p>${t(`help${i}body` as Key)}</p></section>`).join("")}<button data-action="close-help" class="play-button">${t("close")}</button></dialog><dialog id="link-dialog" aria-labelledby="link-title"><h2 id="link-title">${t("link")}</h2><textarea id="share-link" readonly aria-label="${t("link")}"></textarea><button data-action="close-link">${t("close")}</button></dialog><input id="import-file" type="file" accept=".json,.sidereal,application/json" hidden>`;
  renderStage();
  if (focused) document.getElementById(focused)?.focus({ preventScroll: true });
  document
    .querySelector<HTMLInputElement>("#import-file")
    ?.addEventListener("change", async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        if (file.size > 60000) throw Error();
        const next = parseScore(await file.text());
        engine.stop();
        history(clone(score));
        score = { ...next, id: uid() };
        selected = score.stars[0]?.id ?? "";
        persist();
        render();
        toast("loaded");
      } catch {
        toast("invalid");
      }
    });
}
function presetTitle(p: (typeof PRESETS)[number]) {
  return p === "evening"
    ? "Evening atlas"
    : p === "glass"
      ? "Glass meridian"
      : "A slow departure";
}
function add(pos = { step: Math.floor(engine.beat * 2) % 32, degree: 6 }) {
  if (score.stars.length >= 96) {
    toast("limit");
    return;
  }
  change(() => {
    const s: Star = {
      id: uid(),
      layer: activeLayer,
      ...pos,
      duration: 0.5,
      velocity: 0.65,
    };
    score.stars.push(s);
    selected = s.id;
  });
  document.getElementById(`star-${selected}`)?.focus({ preventScroll: true });
}
async function togglePlay() {
  try {
    if (engine.playing) engine.pause();
    else await engine.play();
    render();
  } catch {
    toast("failed");
  }
}
function download(blob: Blob, extension: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${score.title.replace(/[^\p{L}\p{N}-]+/gu, "-") || "sidereal"}.${extension}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function exportPNG() {
  const svg = document
    .querySelector<SVGSVGElement>("#sky")!
    .cloneNode(true) as SVGSVGElement;
  svg.querySelector("#sweep")?.remove();
  svg
    .querySelectorAll(".selection-ring,.pulse-ring,.hit,.note-label")
    .forEach((el) => el.remove());
  svg.querySelectorAll("[style]").forEach((el) => {
    el.removeAttribute("style");
  });
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent =
    ".orbit-ring,.center-ring{fill:none;stroke:#344447;stroke-width:1}.spoke,.tick,.center-cross{stroke:#344447;fill:none}.major{stroke:#607074}.star-cross{stroke:#dbbb87;stroke-width:.7}.map-label,.center-label{fill:#a3b0af;font:12px monospace}.note-label{fill:#efe5d2}";
  svg.prepend(style);
  const src = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(svg)], {
      type: "image/svg+xml",
    }),
  );
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 1880;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#111f23";
    ctx.fillRect(0, 0, 1600, 1880);
    ctx.fillStyle = "#e7e2d5";
    ctx.font = "24px monospace";
    ctx.fillText("S I D E R E A L  /  MUSICAL OBSERVATORY", 100, 100);
    ctx.font = "64px Georgia";
    ctx.fillText(score.title, 100, 205, 1400);
    ctx.drawImage(img, 100, 240, 1400, 1400);
    ctx.font = "26px monospace";
    ctx.fillStyle = "#b2bdb8";
    ctx.fillText(
      `${score.bpm} BPM  ·  ${ROOTS[score.root]} ${score.scale}  ·  4/4  ·  16 beats`,
      100,
      1740,
    );
    ctx.font = "22px monospace";
    ctx.fillText(
      score.layers
        .map(
          (l) =>
            `${l.name} / ${l.voice}${l.mute ? " [muted]" : ""}${l.solo ? " [solo]" : ""}`,
        )
        .join("   ·   "),
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
app.addEventListener("click", async (e) => {
  const target = (e.target as Element).closest<HTMLElement>(
    "button,[data-star]",
  );
  if (!target) return;
  if (target.dataset.star) {
    selected = target.dataset.star;
    activeLayer = star()!.layer;
    render();
    document.getElementById(`star-${selected}`)?.focus({ preventScroll: true });
    return;
  }
  if (target.dataset.select) {
    selected = target.dataset.select;
    activeLayer = star()!.layer;
    render();
    document.getElementById("note")?.focus({ preventScroll: true });
    return;
  }
  if (target.dataset.layer) {
    activeLayer = +target.dataset.layer;
    render();
    return;
  }
  if (target.dataset.preset) {
    engine.stop();
    history(clone(score));
    score = preset(target.dataset.preset as (typeof PRESETS)[number]);
    selected = score.stars[2]?.id ?? "";
    persist();
    render();
    return;
  }
  if (target.dataset.mute !== undefined) {
    change(
      () =>
        (score.layers[+target.dataset.mute!].mute =
          !score.layers[+target.dataset.mute!].mute),
    );
    return;
  }
  if (target.dataset.solo !== undefined) {
    change(
      () =>
        (score.layers[+target.dataset.solo!].solo =
          !score.layers[+target.dataset.solo!].solo),
    );
    return;
  }
  if (target.dataset.nudge) {
    change(() => {
      const n = star();
      if (n) n.step = (n.step + +target.dataset.nudge! + 32) % 32;
    });
    return;
  }
  if (target.dataset.load) {
    engine.stop();
    history(clone(score));
    score = clone(library.find((s) => s.id === target.dataset.load)!);
    selected = score.stars[0]?.id ?? "";
    persist();
    render();
    return;
  }
  if (target.dataset.deleteSave) {
    if (confirm(t("discard"))) {
      library = library.filter((s) => s.id !== target.dataset.deleteSave);
      try {
        localStorage.setItem(LIBRARY, JSON.stringify(library));
        render();
      } catch {
        toast("storage");
      }
    }
    return;
  }
  const action = target.dataset.action;
  switch (action) {
    case "language":
      lang = lang === "en" ? "ru" : "en";
      try {
        localStorage.setItem("sidereal.language", lang);
      } catch {}
      render();
      break;
    case "help":
      document.querySelector<HTMLDialogElement>("#help-dialog")!.showModal();
      break;
    case "close-help":
      document.querySelector<HTMLDialogElement>("#help-dialog")!.close();
      break;
    case "close-link":
      document.querySelector<HTMLDialogElement>("#link-dialog")!.close();
      break;
    case "add":
      add();
      break;
    case "remove":
      change(() => {
        score.stars = score.stars.filter((s) => s.id !== selected);
        selected = "";
      });
      break;
    case "preview":
      if (star())
        try {
          await engine.preview(star()!);
        } catch {
          toast("failed");
        }
      break;
    case "play":
      await togglePlay();
      break;
    case "stop":
      engine.stop();
      render();
      break;
    case "master":
      engine.toggleMute();
      render();
      toast(engine.muted ? "soundoff" : "soundon");
      break;
    case "undo":
      if (undo.length) {
        engine.stop();
        redo.push(clone(score));
        score = undo.pop()!;
        selected = score.stars[0]?.id ?? "";
        persist();
        render();
      }
      break;
    case "redo":
      if (redo.length) {
        engine.stop();
        undo.push(clone(score));
        score = redo.pop()!;
        selected = score.stars[0]?.id ?? "";
        persist();
        render();
      }
      break;
    case "save": {
      const index = library.findIndex((s) => s.id === score.id);
      if (index < 0 && library.length >= 24) {
        toast("librarylimit");
        break;
      }
      if (index < 0) library.push(clone(score));
      else library[index] = clone(score);
      try {
        localStorage.setItem(LIBRARY, JSON.stringify(library));
        persist();
        render();
        toast("savedtoast");
      } catch {
        toast("storage");
      }
      break;
    }
    case "new":
      engine.stop();
      history(clone(score));
      score = {
        ...preset("evening"),
        id: uid(),
        title: t("untitled"),
        stars: [],
      };
      selected = "";
      persist();
      render();
      break;
    case "table": {
      const table = document.querySelector<HTMLElement>("#star-table")!;
      table.hidden = !table.hidden;
      target.setAttribute("aria-expanded", String(!table.hidden));
      break;
    }
    case "json":
      download(
        new Blob([JSON.stringify(score, null, 2)], {
          type: "application/json",
        }),
        "sidereal.json",
      );
      toast("exported");
      break;
    case "import":
      document.querySelector<HTMLInputElement>("#import-file")!.click();
      break;
    case "share":
      try {
        const url = `${location.href.split("#")[0]}#score=${shareEncode(score)}`;
        try {
          await navigator.clipboard.writeText(url);
          toast("copied");
        } catch {
          const dialog =
            document.querySelector<HTMLDialogElement>("#link-dialog")!;
          const input =
            document.querySelector<HTMLTextAreaElement>("#share-link")!;
          input.value = url;
          dialog.showModal();
          input.select();
          toast("copyfailed");
        }
      } catch {
        toast("sharelarge");
      }
      break;
    case "png":
    case "wav":
      if (busy) break;
      busy = true;
      toast("rendering");
      try {
        if (action === "png") await exportPNG();
        else download(await renderAudio(clone(score), engine.volume), "wav");
        toast("exported");
      } catch {
        toast("failed");
      } finally {
        busy = false;
      }
      break;
  }
});
app.addEventListener("change", (e) => {
  const el = e.target as HTMLInputElement;
  const n = star();
  if (el.id === "title")
    change(() => (score.title = el.value.trim() || t("untitled")));
  if (el.id === "root") change(() => (score.root = +el.value));
  if (el.id === "scale") change(() => (score.scale = el.value as Scale));
  if (el.id === "tempo" || el.id === "tempo-range")
    change(() => (score.bpm = clamp(Number(el.value) || 76, 40, 180)), true);
  if (el.dataset.voice !== undefined)
    change(() => (score.layers[+el.dataset.voice!].voice = el.value as Voice));
  if (el.dataset.field && n)
    change(() => {
      if (el.dataset.field === "degree") n.degree = +el.value;
      else n.duration = +el.value;
    });
  if (el.id === "step" && n)
    change(() => (n.step = clamp(Math.round(+el.value || 1) - 1, 0, 31)));
  if (el.id === "velocity" && n)
    change(() => (n.velocity = clamp(+el.value / 100, 0.1, 1)));
});
app.addEventListener("input", (e) => {
  const el = e.target as HTMLInputElement;
  if (el.id === "master-volume") engine.setVolume(+el.value / 100);
  if (el.id === "tempo-range") {
    document.querySelector<HTMLInputElement>("#tempo")!.value = el.value;
  }
});
app.addEventListener("pointerdown", (e) => {
  const target = (e.target as Element).closest<SVGElement>("[data-star]");
  if (!target || e.button !== 0) return;
  selected = target.dataset.star!;
  activeLayer = star()!.layer;
  drag = {
    id: selected,
    before: clone(score),
    changed: false,
    pointer: e.pointerId,
  };
  if (e.pointerType === "mouse") e.preventDefault();
});
window.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.pointer) return;
  const svg = document.querySelector<SVGSVGElement>("#sky")!;
  const rect = svg.getBoundingClientRect();
  const p = fromPoint(
    ((e.clientX - rect.left) / rect.width) * 800,
    ((e.clientY - rect.top) / rect.height) * 800,
  );
  const n = score.stars.find((s) => s.id === drag!.id)!;
  if (n.step !== p.step || n.degree !== p.degree) {
    Object.assign(n, p);
    drag.changed = true;
    renderStage();
  }
});
function endDrag() {
  if (!drag) return;
  if (drag.changed) {
    history(drag.before);
    engine.silence();
  }
  drag = null;
  render();
}
window.addEventListener("pointerup", endDrag);
window.addEventListener("pointercancel", endDrag);
app.addEventListener("click", (e) => {
  if ((e.target as Element).closest("[data-star]")) return;
  const svg = (e.target as Element).closest<SVGSVGElement>("#sky");
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 800,
    y = ((e.clientY - rect.top) / rect.height) * 800;
  if (Math.hypot(x - 400, y - 400) >= 65 && Math.hypot(x - 400, y - 400) <= 328)
    add(fromPoint(x, y));
});
window.addEventListener("keydown", (e) => {
  const el = e.target as HTMLElement;
  const editing = el.matches("input,select,textarea") || !!el.closest("dialog");
  if (e.key === "Escape") {
    engine.stop();
    if (!editing) render();
    else {
      const play = document.querySelector<HTMLButtonElement>(
        '[data-action="play"]',
      );
      if (play) play.innerHTML = icon("play") + `<span>${t("play")}</span>`;
      document
        .querySelector("#sweep")
        ?.setAttribute("transform", "rotate(0 400 400)");
      const display = document.querySelector("#beat-display");
      if (display) display.innerHTML = "01<span>/ 16</span>";
    }
    return;
  }
  if (editing) return;
  if (
    e.code === "Space" &&
    (!el.matches("button,summary,a") || el.closest("#sky"))
  ) {
    e.preventDefault();
    void togglePlay();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "z") {
    e.preventDefault();
    document
      .querySelector<HTMLButtonElement>(
        `[data-action="${e.shiftKey ? "redo" : "undo"}"]`,
      )
      ?.click();
  }
  if (el.dataset.star) selected = el.dataset.star;
  if (el.closest("#sky") && star()) {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
      change(() => {
        const n = star()!;
        if (e.key === "ArrowLeft") n.step = (n.step + 31) % 32;
        if (e.key === "ArrowRight") n.step = (n.step + 1) % 32;
        if (e.key === "ArrowUp") n.degree = clamp(n.degree + 1, 0, 14);
        if (e.key === "ArrowDown") n.degree = clamp(n.degree - 1, 0, 14);
      });
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      document
        .querySelector<HTMLButtonElement>('[data-action="remove"]')
        ?.click();
    }
    if (e.key === "Enter" && el.dataset.star) {
      selected = el.dataset.star;
      render();
      document.getElementById("note")?.focus();
    }
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && engine.playing) {
    engine.pause();
    render();
    toast("hidden");
  }
});
function animate() {
  if (engine.playing) {
    const sweep = document.querySelector("#sweep");
    if (!reduced.matches)
      sweep?.setAttribute(
        "transform",
        `rotate(${(engine.beat / 16) * 360} 400 400)`,
      );
    const display = document.querySelector("#beat-display");
    if (display)
      display.innerHTML = `${String(Math.floor(engine.beat) + 1).padStart(2, "0")}<span>/ 16</span>`;
  }
  requestAnimationFrame(animate);
}
render();
persist();
if (startup) toast(startup);
requestAnimationFrame(animate);
// Read-only diagnostics help verify a real audio context without shipping test controls.
Object.defineProperty(window, "siderealDiagnostics", {
  get: () => ({
    playing: engine.playing,
    beat: engine.beat,
    activeVoices: engine.nodes,
    contextState: engine.ctx?.state ?? "not-created",
    muted: engine.muted,
    score: clone(score),
    saved,
  }),
});
