import { audible, midi, Score, Star, clamp } from "./model";
type Context = AudioContext | OfflineAudioContext;
let budgetKey = "",
  budget = 0.15;
function amplitudeBudget(score: Score) {
  const key = JSON.stringify([
    score.bpm,
    score.layers.map((l) => [l.voice, l.mute, l.solo]),
    score.stars.map((s) => [s.step, s.duration, s.layer]),
  ]);
  if (key === budgetKey) return budget;
  const stars = score.stars.filter((s) => audible(score, s.layer));
  let maximum = 1;
  for (const event of stars) {
    let count = 0;
    for (const s of stars) {
      const distance = ((event.step - s.step) / 2 + 16) % 16;
      const release =
        score.layers[s.layer].voice === "tide"
          ? 1.2
          : score.layers[s.layer].voice === "bell"
            ? 0.8
            : 0.4;
      if (distance < s.duration + (release * score.bpm) / 60) count++;
    }
    maximum = Math.max(maximum, count);
  }
  budgetKey = key;
  budget = Math.min(0.2, 0.6 / (maximum + 1));
  return budget;
}
export function graph(ctx: Context, volume: number) {
  const master = ctx.createGain();
  master.gain.value = volume;
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -16;
  compressor.knee.value = 12;
  compressor.ratio.value = 8;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.15;
  master.connect(compressor);
  compressor.connect(ctx.destination);
  return master;
}
export function voice(
  ctx: Context,
  output: AudioNode,
  score: Score,
  star: Star,
  at: number,
) {
  const type = score.layers[star.layer].voice;
  const duration = (star.duration * 60) / score.bpm;
  const release = type === "tide" ? 1.2 : type === "bell" ? 0.8 : 0.4;
  const end = at + duration + release;
  const gain = ctx.createGain();
  const pan = ctx.createStereoPanner();
  pan.pan.value = [-0.35, 0.3, 0][star.layer];
  // A hard amplitude budget remains below full scale even with all 96 stars together.
  const amount =
    star.velocity * score.layers[star.layer].volume * amplitudeBudget(score);
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(
    amount,
    at + (type === "tide" ? 0.12 : 0.012),
  );
  gain.gain.exponentialRampToValueAtTime(
    Math.max(0.0001, amount * (type === "bell" ? 0.25 : 0.65)),
    at + duration,
  );
  gain.gain.exponentialRampToValueAtTime(0.0001, end - 0.01);
  gain.gain.linearRampToValueAtTime(0, end);
  gain.connect(pan);
  pan.connect(output);
  const freq = 440 * 2 ** ((midi(score, star) - 69) / 12);
  const oscillators = [1, type === "bell" ? 2.001 : 1.003].map((ratio, i) => {
    const osc = ctx.createOscillator();
    const level = ctx.createGain();
    osc.type = type === "felt" ? "triangle" : "sine";
    osc.frequency.value = freq * ratio;
    level.gain.value = i ? (type === "bell" ? 0.2 : 0.25) : 0.75;
    osc.connect(level);
    level.connect(gain);
    osc.start(at);
    osc.stop(end);
    osc.onended = () => {
      osc.disconnect();
      level.disconnect();
    };
    return osc;
  });
  oscillators[0].addEventListener("ended", () => {
    gain.disconnect();
    pan.disconnect();
  });
  return {
    end,
    stop: () => {
      for (const o of oscillators) {
        try {
          o.stop();
        } catch {
          /* already stopped */
        }
      }
      gain.disconnect();
      pan.disconnect();
    },
  };
}
export class Engine {
  ctx: AudioContext | null = null;
  output: GainNode | null = null;
  playing = false;
  beat = 0;
  volume = 0.48;
  muted = false;
  private timer = 0;
  private nextBeat = 0;
  private nextTime = 0;
  private origin = 0;
  private currentBpm = 76;
  private active = new Set<ReturnType<typeof voice>>();
  private lastPreview = -Infinity;
  constructor(
    private getScore: () => Score,
    private onBeat: (step: number) => void,
  ) {}
  async ready() {
    if (!this.ctx) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctx) throw Error("Web Audio is unavailable");
      this.ctx = new Ctx();
      this.output = graph(this.ctx, this.muted ? 0 : this.volume);
    }
    await this.ctx.resume();
  }
  async play() {
    await this.ready();
    if (this.playing) return;
    const ctx = this.ctx!;
    this.currentBpm = this.getScore().bpm;
    this.playing = true;
    this.origin = ctx.currentTime - (this.beat * 60) / this.currentBpm;
    this.nextBeat = Math.ceil(this.beat * 2) / 2;
    this.nextTime = this.origin + (this.nextBeat * 60) / this.currentBpm;
    this.tick();
    this.timer = window.setInterval(() => this.tick(), 25);
  }
  private tick() {
    const ctx = this.ctx!;
    const score = this.getScore();
    for (const n of this.active)
      if (n.end < ctx.currentTime) this.active.delete(n);
    while (this.nextTime < ctx.currentTime + 0.1) {
      const step = Math.round(this.nextBeat * 2) % 32;
      score.stars
        .filter((s) => s.step === step && audible(score, s.layer))
        .forEach((s) =>
          this.active.add(
            voice(
              ctx,
              this.output!,
              score,
              s,
              Math.max(ctx.currentTime, this.nextTime),
            ),
          ),
        );
      this.onBeat(step);
      this.nextBeat += 0.5;
      this.nextTime += (0.5 * 60) / this.currentBpm;
    }
    this.beat = (((ctx.currentTime - this.origin) * this.currentBpm) / 60) % 16;
  }
  pause() {
    if (!this.playing) return;
    this.tick();
    this.playing = false;
    clearInterval(this.timer);
    this.silence();
  }
  stop() {
    this.pause();
    this.silence();
    this.beat = 0;
  }
  silence() {
    this.active.forEach((n) => n.stop());
    this.active.clear();
  }
  changeTempo() {
    if (this.playing) {
      this.pause();
      void this.play();
    }
  }
  setVolume(v: number) {
    this.volume = clamp(v, 0, 0.8);
    this.output?.gain.setTargetAtTime(
      this.muted ? 0 : this.volume,
      this.ctx!.currentTime,
      0.025,
    );
  }
  toggleMute() {
    this.muted = !this.muted;
    this.setVolume(this.volume);
  }
  async preview(star: Star) {
    await this.ready();
    if (this.ctx!.currentTime - this.lastPreview < 0.15) return;
    this.lastPreview = this.ctx!.currentTime;
    if (!this.playing) this.silence();
    this.active.add(
      voice(
        this.ctx!,
        this.output!,
        this.getScore(),
        star,
        this.ctx!.currentTime,
      ),
    );
    for (const n of this.active)
      if (n.end < this.ctx!.currentTime) this.active.delete(n);
  }
  get nodes() {
    return this.active.size;
  }
}
export function wav(buffer: AudioBuffer) {
  const frames = buffer.length;
  const channels = buffer.numberOfChannels;
  const bytes = new ArrayBuffer(44 + frames * channels * 2);
  const v = new DataView(bytes);
  const str = (o: number, s: string) =>
    [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + frames * channels * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, buffer.sampleRate, true);
  v.setUint32(28, buffer.sampleRate * channels * 2, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, frames * channels * 2, true);
  let peak = 0;
  const data = Array.from({ length: channels }, (_, c) =>
    buffer.getChannelData(c),
  );
  data.forEach((ch) => {
    for (const sample of ch) peak = Math.max(peak, Math.abs(sample));
  });
  const scale = peak > 0.9 ? 0.9 / peak : 1;
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < channels; c++) {
      const sample = clamp(data[c][i] * scale, -1, 1);
      v.setInt16(
        44 + (i * channels + c) * 2,
        sample * (sample < 0 ? 32768 : 32767),
        true,
      );
    }
  return new Blob([bytes], { type: "audio/wav" });
}
export async function renderAudio(score: Score, volume = 0.48) {
  const seconds = (20 * 60) / score.bpm + 1.5;
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * 44100), 44100);
  const output = graph(ctx, volume);
  for (const star of score.stars)
    if (audible(score, star.layer))
      voice(
        ctx,
        output,
        score,
        star,
        ((star.step / 2) * 60) / score.bpm + 0.05,
      );
  return wav(await ctx.startRendering());
}
