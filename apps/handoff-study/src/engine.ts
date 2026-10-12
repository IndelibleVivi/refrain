import type { StudyManifest, StudySession } from "./contracts";
import { durationSeconds, phraseSeconds, routeChunks } from "./model";
import { assemble, decodePhrase, type PhrasePcm } from "./wav";
export type Status = "ready" | "preparing" | "playing" | "paused" | "ended";
export class StudyEngine {
  status: Status = "ready";
  private context?: AudioContext;
  private output?: GainNode;
  private pcm = new Map<string, PhrasePcm>();
  private buffers = new Map<string, AudioBuffer>();
  private loading?: Promise<void>;
  private sources = new Set<AudioBufferSourceNode>();
  private scheduled = new Set<number>();
  private timer?: number;
  private anchor = 0;
  private position = 0;
  private epoch = 0;
  private monitor = 0.8;
  constructor(
    private manifest: StudyManifest,
    private session: () => StudySession,
    private original: () => boolean,
    private update: () => void,
    private notice: (message: string) => void,
  ) {}
  get time(): number {
    if (this.status !== "playing" || !this.context) return this.position;
    return Math.max(
      0,
      Math.min(this.duration, this.context.currentTime - this.anchor),
    );
  }
  get duration(): number {
    return durationSeconds(this.session(), this.original());
  }
  get beat(): number {
    return (this.time * this.manifest.score.tempo) / 60;
  }
  canChoose(gate: 0 | 1): boolean {
    const step = gate === 0 ? 2 : 5;
    return (
      !this.original() &&
      this.status !== "preparing" &&
      this.status !== "ended" &&
      !this.scheduled.has(step) &&
      this.time < step * phraseSeconds(this.manifest.score) - 0.16
    );
  }
  setVolume(value: number): void {
    this.monitor = value;
    if (this.output && this.context)
      this.output.gain.setTargetAtTime(
        value * this.manifest.mixGain,
        this.context.currentTime,
        0.015,
      );
  }
  private load(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const { verifyAssetBytes } =
        await import("../../../packages/audio-engine/src/digest");
      const ids = Object.keys(this.manifest.audio).filter(
        (id) => !this.pcm.has(id),
      );
      let completed = Object.keys(this.manifest.audio).length - ids.length;
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(3, ids.length) }, async () => {
          while (next < ids.length) {
            const id = ids[next++]!,
              ref = this.manifest.audio[id]!;
            const response = await fetch(
              new URL(`./${ref.file}`, document.baseURI),
            );
            if (!response.ok)
              throw new Error(`声音 ${id} 读取失败（${response.status}）。`);
            const bytes = await response.arrayBuffer();
            await verifyAssetBytes(
              { assetId: id, bytes: ref.bytes, sha256: ref.sha256 },
              bytes,
            );
            this.pcm.set(id, decodePhrase(bytes, ref.frames));
            completed++;
            this.notice(
              `正在准备声音 ${completed} / ${Object.keys(this.manifest.audio).length}`,
            );
          }
        }),
      );
    })().finally(() => {
      this.loading = undefined;
    });
    return this.loading;
  }
  async play(): Promise<void> {
    if (this.status === "playing" || this.status === "preparing") return;
    if (this.status === "ended") this.position = 0;
    const epoch = ++this.epoch;
    this.status = "preparing";
    this.update();
    try {
      this.context ??= new AudioContext();
      this.output ??= this.context.createGain();
      this.output.gain.value = this.monitor * this.manifest.mixGain;
      this.output.connect(this.context.destination);
      await this.context.resume();
      if (this.context.state !== "running")
        throw new Error("浏览器未开启声音，请再次点聆听。");
      await this.load();
      if (epoch !== this.epoch) return;
      for (const [id, pcm] of this.pcm)
        if (!this.buffers.has(id)) {
          const buffer = this.context.createBuffer(2, pcm.left.length, 44100);
          buffer.copyToChannel(pcm.left as Float32Array<ArrayBuffer>, 0);
          buffer.copyToChannel(pcm.right as Float32Array<ArrayBuffer>, 1);
          this.buffers.set(id, buffer);
        }
      this.anchor = this.context.currentTime + 0.06 - this.position;
      this.status = "playing";
      this.scheduled.clear();
      this.schedule(true);
      this.timer = window.setInterval(() => this.schedule(), 35);
      this.notice("");
      this.update();
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.status = this.position > 0 ? "paused" : "ready";
      this.notice(
        error instanceof Error ? error.message : "声音准备失败。可以再次聆听。",
      );
      this.update();
    }
  }
  private schedule(initial = false): void {
    if (this.status !== "playing" || !this.context || !this.output) return;
    const now = this.context.currentTime,
      stride = phraseSeconds(this.manifest.score),
      time = this.time;
    const chunks = routeChunks(this.session(), this.original());
    chunks.forEach((id, step) => {
      if (this.scheduled.has(step)) return;
      const buffer = this.buffers.get(id)!,
        start = step * stride,
        end = start + buffer.duration;
      if (end <= this.position) {
        this.scheduled.add(step);
        return;
      }
      if (start > time + 0.16 && !(initial && start <= this.position)) return;
      this.scheduled.add(step);
      const when = Math.max(
        now + 0.005,
        this.anchor + start,
        initial ? this.anchor + this.position : 0,
      );
      // Seeking/resuming reconstructs every still-decaying phrase with its exact offset.
      const offset = Math.max(0, when - this.anchor - start);
      if (offset >= buffer.duration) return;
      const source = this.context!.createBufferSource();
      source.buffer = buffer;
      source.connect(this.output!);
      this.sources.add(source);
      source.onended = () => {
        source.disconnect();
        this.sources.delete(source);
      };
      source.start(when, offset);
    });
    if (time >= this.duration - 0.01) {
      this.position = this.duration;
      this.halt();
      this.status = "ended";
      this.update();
    } else this.update();
  }
  private halt(): void {
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {}
      source.disconnect();
    }
    this.sources.clear();
  }
  pause(): void {
    this.position = this.time;
    ++this.epoch;
    this.halt();
    this.status = this.position > 0 ? "paused" : "ready";
    this.update();
  }
  stop(): void {
    this.pause();
    this.position = 0;
    this.scheduled.clear();
    this.status = "ready";
    this.update();
  }
  async seek(seconds: number): Promise<void> {
    const playing = this.status === "playing";
    this.pause();
    this.position = Math.min(this.duration, Math.max(0, seconds));
    this.scheduled.clear();
    this.status =
      this.position === this.duration
        ? "ended"
        : this.position > 0
          ? "paused"
          : "ready";
    this.update();
    if (playing && this.status !== "ended") await this.play();
  }
  async wav(): Promise<ArrayBuffer> {
    const snapshot = structuredClone(this.session()),
      original = this.original();
    await this.load();
    const { encodeWav } = await import("./wav-encoder");
    return encodeWav(assemble(snapshot, this.pcm, original));
  }
  dispose(): void {
    this.pause();
    void this.context?.close();
  }
}
