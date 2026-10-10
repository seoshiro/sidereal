export const SCALES = {
  pentatonic: [0, 2, 4, 7, 9],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
} as const;
export const ROOTS = [
  "C",
  "C♯",
  "D",
  "E♭",
  "E",
  "F",
  "F♯",
  "G",
  "A♭",
  "A",
  "B♭",
  "B",
];
export const COLORS = ["#dcbb87", "#90baba", "#b7a7cb"];
export type Scale = keyof typeof SCALES;
export type Voice = "bell" | "felt" | "tide";
export interface Star {
  id: string;
  layer: number;
  step: number;
  degree: number;
  duration: number;
  velocity: number;
}
export interface Layer {
  name: string;
  voice: Voice;
  mute: boolean;
  solo: boolean;
  volume: number;
}
export interface Score {
  format: "sidereal";
  version: 1;
  id: string;
  title: string;
  bpm: number;
  root: number;
  scale: Scale;
  layers: Layer[];
  stars: Star[];
}
export const uid = () => crypto.randomUUID();
export const clone = <T>(value: T): T => structuredClone(value);
export const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));
export function midi(score: Score, star: Star) {
  const scale = SCALES[score.scale];
  return (
    48 +
    score.root +
    scale[star.degree % scale.length] +
    12 * Math.floor(star.degree / scale.length) +
    (score.layers[star.layer].voice === "bell"
      ? 12
      : score.layers[star.layer].voice === "tide"
        ? -12
        : 0)
  );
}
export function noteName(score: Score, star: Star) {
  const n = midi(score, star);
  return `${ROOTS[n % 12]}${Math.floor(n / 12) - 1}`;
}
export function audible(score: Score, layer: number) {
  return (
    !score.layers[layer].mute &&
    (!score.layers.some((l) => l.solo) || score.layers[layer].solo)
  );
}
export function point(star: Pick<Star, "step" | "degree">) {
  const a = (star.step / 32) * Math.PI * 2 - Math.PI / 2;
  const r = 80 + (star.degree / 14) * 240;
  return { x: 400 + Math.cos(a) * r, y: 400 + Math.sin(a) * r };
}
export function fromPoint(x: number, y: number) {
  const a =
    (Math.atan2(y - 400, x - 400) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
  return {
    step: Math.round((a / (Math.PI * 2)) * 32) % 32,
    degree: clamp(
      Math.round(((Math.hypot(x - 400, y - 400) - 80) / 240) * 14),
      0,
      14,
    ),
  };
}
export function validate(input: unknown): Score {
  if (!input || typeof input !== "object") throw Error("Invalid score");
  const s = input as Score;
  const number = (n: unknown, min: number, max: number, integer = false) =>
    typeof n === "number" &&
    Number.isFinite(n) &&
    n >= min &&
    n <= max &&
    (!integer || Number.isInteger(n));
  const str = (v: unknown, max: number) =>
    typeof v === "string" &&
    v.length > 0 &&
    v.length <= max &&
    !/[\u0000-\u001f]/.test(v);
  const id = (v: unknown) =>
    typeof v === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(v);
  if (
    s.format !== "sidereal" ||
    s.version !== 1 ||
    !id(s.id) ||
    !str(s.title, 80) ||
    !number(s.bpm, 40, 180) ||
    !number(s.root, 0, 11, true) ||
    !Object.hasOwn(SCALES, s.scale) ||
    !Array.isArray(s.layers) ||
    s.layers.length !== 3 ||
    !Array.isArray(s.stars) ||
    s.stars.length > 96
  )
    throw Error("Invalid score");
  const layers = s.layers.map((l) => {
    if (
      !l ||
      !str(l.name, 30) ||
      !["bell", "felt", "tide"].includes(l.voice) ||
      typeof l.mute !== "boolean" ||
      typeof l.solo !== "boolean" ||
      !number(l.volume, 0, 1)
    )
      throw Error("Invalid layer");
    return {
      name: l.name,
      voice: l.voice,
      mute: l.mute,
      solo: l.solo,
      volume: l.volume,
    };
  });
  const ids = new Set<string>();
  const stars = s.stars.map((n) => {
    if (
      !n ||
      !id(n.id) ||
      ids.has(n.id) ||
      !number(n.layer, 0, 2, true) ||
      !number(n.step, 0, 31, true) ||
      !number(n.degree, 0, 14, true) ||
      ![0.25, 0.5, 1, 2, 4].includes(n.duration) ||
      !number(n.velocity, 0.1, 1)
    )
      throw Error("Invalid star");
    ids.add(n.id);
    return {
      id: n.id,
      layer: n.layer,
      step: n.step,
      degree: n.degree,
      duration: n.duration,
      velocity: n.velocity,
    };
  });
  return {
    format: "sidereal",
    version: 1,
    id: s.id,
    title: s.title,
    bpm: s.bpm,
    root: s.root,
    scale: s.scale,
    layers,
    stars,
  };
}
export function parseScore(text: string) {
  if (text.length > 60000) throw Error("File too large");
  return validate(JSON.parse(text));
}
export function shareEncode(score: Score) {
  const bytes = new TextEncoder().encode(JSON.stringify(validate(score)));
  const raw = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  const code = btoa(raw)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  if (code.length > 12000) throw Error("Score too large to share");
  return code;
}
export function shareDecode(code: string) {
  if (code.length > 12000 || !/^[\w-]+$/.test(code))
    throw Error("Invalid link");
  const raw = atob(code.replaceAll("-", "+").replaceAll("_", "/"));
  return parseScore(
    new TextDecoder().decode(Uint8Array.from(raw, (c) => c.charCodeAt(0))),
  );
}
export const PRESETS = ["evening", "glass", "drift"] as const;
export function preset(name: (typeof PRESETS)[number]): Score {
  const score: Score = {
    format: "sidereal",
    version: 1,
    id: uid(),
    title:
      name === "evening"
        ? "Evening atlas"
        : name === "glass"
          ? "Glass meridian"
          : "A slow departure",
    bpm: name === "drift" ? 56 : name === "glass" ? 104 : 76,
    root: name === "glass" ? 2 : name === "drift" ? 9 : 0,
    scale: name === "drift" ? "minor" : "pentatonic",
    layers: [
      { name: "Lyra", voice: "bell", mute: false, solo: false, volume: 0.65 },
      { name: "Cygnus", voice: "felt", mute: false, solo: false, volume: 0.75 },
      { name: "Vela", voice: "tide", mute: false, solo: false, volume: 0.55 },
    ],
    stars: [],
  };
  const patterns =
    name === "evening"
      ? [
          [
            [0, 6],
            [3, 8],
            [7, 10],
            [12, 9],
            [16, 6],
            [20, 8],
            [25, 5],
            [29, 3],
          ],
          [
            [0, 2],
            [8, 4],
            [16, 3],
            [24, 1],
          ],
          [
            [0, 0],
            [16, 2],
          ],
        ]
      : name === "glass"
        ? [
            [
              [0, 5],
              [2, 7],
              [6, 9],
              [10, 6],
              [14, 10],
              [18, 7],
              [22, 8],
              [26, 4],
              [30, 6],
            ],
            [
              [0, 1],
              [6, 3],
              [12, 4],
              [18, 2],
              [24, 3],
              [30, 1],
            ],
            [
              [0, 0],
              [8, 2],
              [16, 1],
              [24, 0],
            ],
          ]
        : [
            [
              [0, 5],
              [5, 7],
              [11, 9],
              [18, 8],
              [23, 5],
              [28, 3],
            ],
            [
              [0, 2],
              [10, 4],
              [20, 3],
            ],
            [
              [0, 0],
              [16, 3],
            ],
          ];
  patterns.forEach((pattern, layer) =>
    pattern.forEach(([step, degree], i) =>
      score.stars.push({
        id: `${name}-${layer}-${i}`,
        layer,
        step,
        degree,
        duration: layer === 2 ? 4 : layer === 1 ? 2 : 0.5,
        velocity: layer === 0 ? 0.65 : 0.55,
      }),
    ),
  );
  return score;
}
