import processorUrl from "./processor.ts?worker&url";
import type { PlaybackStatus, Session } from "./contracts";

/** User-gesture-only owner for this experimental instrument, not the native AIR engine. */
export class DriftEngine {
  private session: Session;
  private context?: AudioContext;
  private node?: AudioWorkletNode;
  private gain?: GainNode;
  private ready?: Promise<void>;
  private state: PlaybackStatus = "idle";
  private offset = 0;
  private clock = 0;
  private action = 0;
  private generation = 0;
  private disposed = false;
  private volume = 0.65;
  private frames = 0;
  private peak = 0;
  constructor(session: Session) {
    this.session = session;
    this.offset = session.cursor;
  }
  get position() {
    return Math.min(
      this.session.work.duration,
      this.offset +
        (this.state === "playing" && this.context
          ? this.context.currentTime - this.clock
          : 0),
    );
  }
  get status(): PlaybackStatus {
    if (
      this.state === "playing" &&
      this.position >= this.session.work.duration
    ) {
      this.state = "ended";
      this.offset = this.session.work.duration;
    }
    return this.state;
  }
  get evidence() {
    return {
      contextState: this.context?.state ?? "uncreated",
      frames: this.frames,
      peak: this.peak,
    };
  }
  private async ensure() {
    if (this.disposed) throw new Error("声音实验已关闭，请重新打开页面。");
    if (this.ready) return this.ready;
    const context = (this.context = new AudioContext({
      latencyHint: "interactive",
    }));
    this.ready = (async () => {
      await context.audioWorklet.addModule(processorUrl);
      if (this.disposed) return;
      this.node = new AudioWorkletNode(context, "drift-study", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      this.gain = context.createGain();
      this.gain.gain.value = this.volume;
      this.node.connect(this.gain).connect(context.destination);
      this.node.port.onmessage = (event) => {
        if (event.data.generation !== this.generation) return;
        this.frames = event.data.frames;
        this.peak = event.data.peak;
        if (event.data.ended && this.state === "playing") {
          this.state = "ended";
          this.offset = this.session.work.duration;
        }
      };
    })();
    try {
      await this.ready;
    } catch (error) {
      this.ready = undefined;
      this.context = undefined;
      await context.close();
      throw error;
    }
  }
  private send() {
    this.node?.port.postMessage({
      type: "load",
      session: this.session,
      position: this.offset,
      playing: this.state === "playing",
      generation: ++this.generation,
    });
  }
  async play() {
    const action = ++this.action;
    await this.ensure();
    if (action !== this.action || this.disposed) return;
    await this.context!.resume();
    if (action !== this.action || this.disposed) return;
    if (this.context!.state !== "running")
      throw new Error("音频尚未解锁，请再按一次播放。");
    if (this.offset >= this.session.work.duration) this.offset = 0;
    this.clock = this.context!.currentTime;
    this.state = "playing";
    this.send();
  }
  pause() {
    ++this.action;
    this.offset = this.position;
    this.state = this.offset > 0 ? "paused" : "idle";
    this.node?.port.postMessage({ type: "pause" });
  }
  stop() {
    this.pause();
    this.offset = 0;
    this.state = "idle";
  }
  seek(seconds: number) {
    this.offset = Math.max(0, Math.min(this.session.work.duration, seconds));
    if (this.state === "ended" && this.offset < this.session.work.duration)
      this.state = "paused";
    this.clock = this.context?.currentTime ?? 0;
    this.send();
  }
  setSession(session: Session, seconds = this.position) {
    this.session = session;
    this.seek(seconds);
  }
  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.gain && this.context)
      this.gain.gain.setTargetAtTime(
        this.volume,
        this.context.currentTime,
        0.02,
      );
  }
  dispose() {
    if (this.disposed) return;
    this.pause();
    this.disposed = true;
    this.node?.disconnect();
    this.gain?.disconnect();
    void this.context?.close();
  }
}
