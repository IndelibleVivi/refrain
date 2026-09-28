import type { Program, ScoreNote, Status, Work } from "./contracts";
import { compileWork } from "./model";

type RenderReply =
  | { id: number; kind: "pcm"; left: Float32Array; right: Float32Array }
  | { id: number; kind: "wav"; bytes: Uint8Array }
  | { id: number; error: string };

const MAX_SECONDS = 150;
const DEFAULT_VOLUME = 0.7;
const AUDITION_TAIL = 5;
const AUDITION_MAX_NOTE = 12;

const clamp = (value: number, min: number, max: number) =>
  value < min ? min : value > max ? max : value;

interface CacheEntry {
  reference: boolean;
  sampleRate: number;
  program: Program;
  buffer: AudioBuffer;
}

/**
 * User-gesture-only owner for the local Breath study instrument. It renders a
 * completed work through the shared kernel worker into a stereo AudioBuffer and
 * plays it back with AudioBufferSource; it is not the native AIR engine.
 */
export class BreathEngine {
  private readonly onState: (status: Status) => void;
  private context?: AudioContext;
  private master?: GainNode;
  private worker?: Worker;
  private pending = new Map<number, (reply: RenderReply | undefined) => void>();
  private requestId = 0;
  private source?: AudioBufferSourceNode;
  private auditionSource?: AudioBufferSourceNode;
  private state: Status = "idle";
  private offset = 0;
  private clock = 0;
  private durationSeconds = 0;
  private generation = 0;
  private auditionGeneration = 0;
  private disposed = false;
  private volumeValue = DEFAULT_VOLUME;
  private work?: Work;
  private reference = false;
  private readonly cache = new WeakMap<Work, CacheEntry>();
  private readonly auditionCache = new WeakMap<
    Work,
    Map<string, AudioBuffer>
  >();

  constructor(onState: (status: Status) => void) {
    this.onState = onState;
  }

  get status(): Status {
    this.refresh();
    return this.state;
  }

  get time(): number {
    this.refresh();
    return this.position();
  }

  get duration(): number {
    return this.durationSeconds;
  }

  get volume(): number {
    return this.volumeValue;
  }

  /** Monitor loudness only; it never reaches the rendered buffer or exports. */
  set volume(value: number) {
    this.volumeValue = clamp(Number.isFinite(value) ? value : 0, 0, 1);
    if (this.master && this.context)
      this.master.gain.setTargetAtTime(
        this.volumeValue,
        this.context.currentTime,
        0.02,
      );
  }

  async play(work: Work, reference = false, offset = 0): Promise<void> {
    this.assertOpen();
    const generation = ++this.generation;
    const context = this.ensureContext();
    this.work = work;
    this.reference = reference;
    this.setState("preparing");
    try {
      // resume() stays inside this try so a rejected (or throwing) unlock
      // cannot strand the UI on "preparing"; the guard keeps a newer action.
      await context.resume();
      if (generation !== this.generation || this.disposed) return;
      const entry = await this.bufferFor(work, reference, context.sampleRate);
      if (!entry || generation !== this.generation || this.disposed) return;
      this.durationSeconds = entry.program.duration;
      let target = clamp(
        Number.isFinite(offset) ? offset : 0,
        0,
        entry.program.duration,
      );
      if (target >= entry.program.duration) target = 0;
      this.startSource(entry.buffer, target);
      this.offset = target;
      this.clock = context.currentTime;
      this.setState("playing");
    } catch (error) {
      if (generation === this.generation && !this.disposed)
        this.setState(this.offset > 0 ? "paused" : "idle");
      throw error;
    }
  }

  pause(): void {
    if (this.disposed) return;
    ++this.generation;
    ++this.auditionGeneration;
    if (this.state === "playing") this.offset = this.position();
    this.stopSource();
    this.stopAudition();
    this.setState(this.offset > 0 ? "paused" : "idle");
    // Any in-flight render belongs to the play/audition this pause just
    // invalidated; terminating the worker never disturbs a decoded buffer.
    if (this.pending.size > 0) this.resetWorker();
  }

  stop(): void {
    if (this.disposed) return;
    ++this.generation;
    ++this.auditionGeneration;
    this.stopSource();
    this.stopAudition();
    this.offset = 0;
    this.setState("idle");
    if (this.pending.size > 0) this.resetWorker();
  }

  async seek(seconds: number): Promise<void> {
    if (this.disposed) return;
    const target = clamp(
      Number.isFinite(seconds) ? seconds : 0,
      0,
      Math.max(0, this.durationSeconds),
    );
    if (this.state === "playing" && this.work) {
      await this.play(this.work, this.reference, target);
      return;
    }
    this.offset = target;
    if (this.state === "ended" && target < this.durationSeconds)
      this.setState("paused");
  }

  async audition(work: Work, noteId: string, reference = false): Promise<void> {
    this.assertOpen();
    const note = work.notes.find((candidate) => candidate.id === noteId);
    if (!note) throw new Error("找不到这个音符。");
    const generation = ++this.auditionGeneration;
    const context = this.ensureContext();
    const resumed = context.resume();
    await resumed;
    if (generation !== this.auditionGeneration || this.disposed) return;

    const program = this.auditionProgram(work, note, reference);
    const buffer = await this.auditionBuffer(
      work,
      note,
      program,
      reference,
      context.sampleRate,
    );
    if (!buffer || generation !== this.auditionGeneration || this.disposed)
      return;
    this.stopAudition();
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.master!);
    source.onended = () => {
      if (this.auditionSource === source) this.auditionSource = undefined;
    };
    source.start();
    this.auditionSource = source;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    ++this.generation;
    ++this.auditionGeneration;
    this.stopSource();
    this.stopAudition();
    this.resetWorker();
    this.offset = 0;
    this.state = "idle";
    const context = this.context;
    this.context = undefined;
    this.master = undefined;
    if (context) void context.close();
  }

  private assertOpen() {
    if (this.disposed) throw new Error("声音实验已关闭，请重新打开页面。");
  }

  private refresh() {
    if (
      this.state === "playing" &&
      this.durationSeconds > 0 &&
      this.position() >= this.durationSeconds
    ) {
      this.state = "ended";
      this.offset = this.durationSeconds;
    }
  }

  private position(): number {
    if (this.state === "playing" && this.context)
      return clamp(
        this.offset + (this.context.currentTime - this.clock),
        0,
        this.durationSeconds,
      );
    return this.offset;
  }

  private setState(next: Status) {
    if (this.state === next) return;
    this.state = next;
    this.onState(next);
  }

  private ensureContext(): AudioContext {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: "interactive" });
      this.master = this.context.createGain();
      this.master.gain.value = this.volumeValue;
      this.master.connect(this.context.destination);
    }
    return this.context;
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL("./render-worker.ts", import.meta.url), {
        type: "module",
      });
      this.worker.onmessage = (event: MessageEvent<RenderReply>) =>
        this.settle(event.data);
      this.worker.onerror = () => this.failWorker();
    }
    return this.worker;
  }

  private settle(reply: RenderReply) {
    const resolve = this.pending.get(reply.id);
    if (!resolve) return;
    this.pending.delete(reply.id);
    resolve(reply);
  }

  private render(
    kind: "pcm" | "wav",
    program: Program,
    sampleRate: number,
  ): Promise<RenderReply | undefined> {
    const worker = this.ensureWorker();
    const id = ++this.requestId;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      try {
        worker.postMessage({ id, kind, program, sampleRate });
      } catch {
        this.pending.delete(id);
        resolve({ id, error: "渲染任务无法发送。" });
      }
    });
  }

  private cancelPending() {
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const resolve of pending) resolve(undefined);
  }

  private failWorker() {
    const pending = [...this.pending.entries()];
    this.pending.clear();
    for (const [id, resolve] of pending)
      resolve({ id, error: "声音渲染失败，请重新点下聆听。" });
    this.worker?.terminate();
    this.worker = undefined;
  }

  private resetWorker() {
    this.cancelPending();
    this.worker?.terminate();
    this.worker = undefined;
  }

  private async bufferFor(
    work: Work,
    reference: boolean,
    sampleRate: number,
  ): Promise<CacheEntry | undefined> {
    const program = compileWork(work, reference);
    if (program.duration > MAX_SECONDS + 1e-9)
      throw new Error("作品渲染长度不能超过 150 秒。");
    const cached = this.cache.get(work);
    if (
      cached &&
      cached.reference === reference &&
      cached.sampleRate === sampleRate &&
      cached.program.duration === program.duration
    )
      return cached;
    const frames = Math.max(1, Math.ceil(program.duration * sampleRate));
    const reply = await this.render("pcm", program, sampleRate);
    if (!reply) return undefined;
    if ("error" in reply) throw new Error(reply.error);
    if (reply.kind !== "pcm") throw new Error("渲染返回了意外结果。");
    const buffer = this.context!.createBuffer(2, frames, sampleRate);
    buffer.getChannelData(0).set(reply.left);
    buffer.getChannelData(1).set(reply.right);
    const entry: CacheEntry = { reference, sampleRate, program, buffer };
    this.cache.set(work, entry);
    return entry;
  }

  private auditionProgram(
    work: Work,
    note: ScoreNote,
    reference: boolean,
  ): Program {
    const duration = Math.min(
      AUDITION_MAX_NOTE,
      note.beats * (60 / work.tempo),
    );
    return {
      notes: [{ ...note, start: 0, duration }],
      duration: duration + AUDITION_TAIL,
      musicEnd: duration,
      settings: reference
        ? { breath: 0, color: 0, space: 0.18 }
        : { ...work.settings },
      gaps: [],
    };
  }

  private async auditionBuffer(
    work: Work,
    note: ScoreNote,
    program: Program,
    reference: boolean,
    sampleRate: number,
  ): Promise<AudioBuffer | undefined> {
    let map = this.auditionCache.get(work);
    const key = `${reference ? 1 : 0}:${sampleRate}:${note.id}`;
    const cached = map?.get(key);
    if (cached) return cached;
    const reply = await this.render("pcm", program, sampleRate);
    if (!reply) return undefined;
    if ("error" in reply) throw new Error(reply.error);
    if (reply.kind !== "pcm") throw new Error("渲染返回了意外结果。");
    const frames = Math.max(1, Math.ceil(program.duration * sampleRate));
    const buffer = this.context!.createBuffer(2, frames, sampleRate);
    buffer.getChannelData(0).set(reply.left);
    buffer.getChannelData(1).set(reply.right);
    if (!map) {
      map = new Map();
      this.auditionCache.set(work, map);
    }
    map.set(key, buffer);
    return buffer;
  }

  private startSource(buffer: AudioBuffer, offset: number) {
    this.stopSource();
    const context = this.context!;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.master!);
    source.onended = () => {
      if (this.source !== source) return;
      this.source = undefined;
      if (this.state === "playing") {
        this.state = "ended";
        this.offset = this.durationSeconds;
        this.onState("ended");
      }
    };
    source.start(0, offset);
    this.source = source;
  }

  private stopSource() {
    const source = this.source;
    this.source = undefined;
    if (!source) return;
    source.onended = null;
    try {
      source.stop();
    } catch {
      // Already stopped.
    }
    source.disconnect();
  }

  private stopAudition() {
    const source = this.auditionSource;
    this.auditionSource = undefined;
    if (!source) return;
    source.onended = null;
    try {
      source.stop();
    } catch {
      // Already stopped.
    }
    source.disconnect();
  }
}
