import { LeafWind } from "./ambience";
import { verifyAssetBytes } from "../../../packages/audio-engine/src/digest";
import {
  VOICE_IDS,
  type Manifest,
  type Session,
  type VoiceId,
} from "./contracts";
import {
  durationSeconds,
  parseSession,
  sectionSeconds,
  sectionFrame,
  stemKey,
} from "./model";
import { assemble, decodePhrase, encodeWav, type PhrasePcm } from "./wav";
export class DeskEngine {
  status: "ready" | "preparing" | "playing" | "paused" | "ended" = "ready";
  private context?: AudioContext;
  private wind?: LeafWind;
  private windEpoch = 0;
  windOn = false;
  private windLevel = 0.42;
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
  private volume = 0.8;
  private closed = false;
  private auditionState?: { section: number; voice: VoiceId; start: number };
  constructor(
    private manifest: Manifest,
    private session: () => Session,
    private update: () => void,
    private notice: (message: string) => void,
  ) {}
  get time() {
    return this.status === "playing" && this.context
      ? Math.min(
          this.duration,
          Math.max(0, this.context.currentTime - this.anchor),
        )
      : this.position;
  }
  get beat() {
    return (this.time * this.manifest.score.tempo) / 60;
  }
  get duration() {
    return durationSeconds(this.manifest, this.session());
  }
  get auditionPosition() {
    return this.auditionState && this.context
      ? {
          section: this.auditionState.section,
          voice: this.auditionState.voice,
          beat:
            (Math.max(0, this.context.currentTime - this.auditionState.start) *
              this.manifest.score.tempo) /
            60,
        }
      : undefined;
  }
  async toggleWind() {
    const epoch = ++this.windEpoch;
    this.windOn = !this.windOn;
    this.update();
    if (!this.windOn) {
      this.wind?.stop();
      return;
    }
    try {
      await this.unlock();
      if (epoch !== this.windEpoch || this.closed || !this.windOn) return;
      this.wind ??= new LeafWind(this.context!, this.output!);
      this.wind.setVolume(this.windLevel);
      this.wind.start();
      this.notice("风穿过叶子。");
    } catch (error) {
      if (epoch !== this.windEpoch) return;
      this.windOn = false;
      this.notice(error instanceof Error ? error.message : "风声未开始。");
    }
    this.update();
  }
  stopWind() {
    ++this.windEpoch;
    this.windOn = false;
    this.wind?.stop();
    this.update();
  }
  setWindVolume(value: number) {
    if (Number.isFinite(value) && value >= 0 && value <= 1) {
      this.windLevel = value;
      this.wind?.setVolume(value);
    }
  }
  canEdit(section: number) {
    return (
      this.status !== "preparing" &&
      (this.status !== "playing" ||
        (!this.scheduled.has(section) &&
          section * sectionSeconds() > this.time + 0.16))
    );
  }
  setVolume(value: number) {
    if (!Number.isFinite(value) || value < 0 || value > 1) return;
    this.volume = value;
    if (this.output && this.context)
      this.output.gain.setTargetAtTime(
        value * this.manifest.mixGain,
        this.context.currentTime,
        0.015,
      );
  }
  private async unlock() {
    if (this.closed) throw new Error("这张桌子已关闭，请刷新页面。");
    if (!this.context) {
      this.context = new AudioContext();
      this.output = this.context.createGain();
      this.output.gain.value = this.volume * this.manifest.mixGain;
      this.output.connect(this.context.destination);
    }
    await this.context.resume();
    if (this.context.state !== "running")
      throw new Error("浏览器没有开启声音，请再点一次播放。");
  }
  private load() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const ids = Object.keys(this.manifest.audio).filter(
        (k) => !this.pcm.has(k),
      );
      let next = 0,
        completed = 24 - ids.length;
      const results = await Promise.allSettled(
        Array.from({ length: Math.min(3, ids.length) }, async () => {
          while (next < ids.length && !this.closed) {
            const key = ids[next++]!,
              ref = this.manifest.audio[key]!;
            const response = await fetch(
              new URL(`./${ref.file}`, document.baseURI),
            );
            if (!response.ok)
              throw new Error(
                `声音读取失败（${response.status}），可重新播放。`,
              );
            const bytes = await response.arrayBuffer();
            await verifyAssetBytes(
              { assetId: key, bytes: ref.bytes, sha256: ref.sha256 },
              bytes,
            );
            if (this.closed) return;
            this.pcm.set(key, decodePhrase(bytes, ref.frames));
            completed++;
            if (this.status === "preparing")
              this.notice(`正在准备乐器 ${completed} / 24`);
          }
        }),
      );
      const failure = results.find((r) => r.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    })().finally(() => {
      this.loading = undefined;
    });
    return this.loading;
  }
  private buffer(key: string) {
    let buffer = this.buffers.get(key);
    if (buffer) return buffer;
    const pcm = this.pcm.get(key);
    if (!pcm || !this.context) throw new Error("声音尚未准备好。");
    buffer = this.context.createBuffer(2, pcm.left.length, 44100);
    buffer.copyToChannel(pcm.left as Float32Array<ArrayBuffer>, 0);
    buffer.copyToChannel(pcm.right as Float32Array<ArrayBuffer>, 1);
    this.buffers.set(key, buffer);
    // Share the AudioBuffer's owned channel arrays with export; don't retain a second decoded copy.
    this.pcm.set(key, {
      left: buffer.getChannelData(0),
      right: buffer.getChannelData(1),
    });
    return buffer;
  }
  private startSource(key: string, when: number, offset: number) {
    const buffer = this.buffer(key);
    if (offset >= buffer.duration) return undefined;
    const source = this.context!.createBufferSource();
    source.buffer = buffer;
    source.connect(this.output!);
    this.sources.add(source);
    source.onended = () => {
      source.disconnect();
      this.sources.delete(source);
    };
    source.start(when, offset);
    return source;
  }
  async play(): Promise<void> {
    if (this.closed || this.status === "playing" || this.status === "preparing")
      return;
    this.halt();
    if (this.status === "ended" || this.position >= this.duration)
      this.position = 0;
    const epoch = ++this.epoch;
    this.status = "preparing";
    this.update();
    try {
      await this.unlock();
      await this.load();
      if (epoch !== this.epoch || this.closed) return;
      this.anchor = this.context!.currentTime + 0.06 - this.position;
      this.scheduled.clear();
      this.status = "playing";
      this.schedule(true);
      this.timer = window.setInterval(() => this.schedule(), 35);
      this.notice("");
      this.update();
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.halt();
      this.status = this.position > 0 ? "paused" : "ready";
      this.notice(
        error instanceof Error ? error.message : "声音未准备好，请重试。",
      );
      this.update();
    }
  }
  private schedule(initial = false) {
    if (this.status !== "playing" || !this.context) return;
    const now = this.context.currentTime,
      time = this.time,
      session = this.session();
    session.arrangement.forEach((row, s) => {
      if (this.scheduled.has(s)) return;
      const start = sectionFrame(s) / 44100;
      if (start > time + 0.16 && !(initial && start <= this.position)) return;
      this.scheduled.add(s);
      row.forEach((on, v) => {
        if (!on) return;
        const key = stemKey(s, VOICE_IDS[v]!),
          end = start + this.manifest.audio[key]!.frames / 44100;
        if (end <= this.position) return;
        const when = Math.max(
            now + 0.005,
            this.anchor + start,
            initial ? this.anchor + this.position : 0,
          ),
          offset = Math.max(0, when - this.anchor - start);
        this.startSource(key, when, offset);
      });
    });
    if (time >= this.duration) {
      this.position = this.duration;
      this.halt();
      this.status = "ended";
      this.update();
    } else this.update();
  }
  private halt() {
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
    this.auditionState = undefined;
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {}
      source.disconnect();
    }
    this.sources.clear();
  }
  pause() {
    this.position = this.time;
    ++this.epoch;
    this.halt();
    this.status = this.position > 0 ? "paused" : "ready";
    this.update();
  }
  stop() {
    this.stopWind();
    this.pause();
    this.position = 0;
    this.scheduled.clear();
    this.status = "ready";
    this.update();
  }
  async seek(seconds: number) {
    if (!Number.isFinite(seconds)) return;
    const playing = this.status === "playing";
    this.pause();
    this.position = Math.max(0, Math.min(this.duration, seconds));
    this.scheduled.clear();
    this.status =
      this.position >= this.duration
        ? "ended"
        : this.position > 0
          ? "paused"
          : "ready";
    this.update();
    if (playing && this.status !== "ended") await this.play();
  }
  async audition(section: number, voice: VoiceId): Promise<boolean> {
    if (
      !Number.isInteger(section) ||
      section < 0 ||
      section > 5 ||
      !VOICE_IDS.includes(voice)
    )
      return false;
    this.pause();
    const epoch = ++this.epoch;
    this.status = "preparing";
    this.update();
    try {
      await this.unlock();
      await this.load();
      if (epoch !== this.epoch || this.closed) return false;
      const when = this.context!.currentTime + 0.03;
      const source = this.startSource(stemKey(section, voice), when, 0)!;
      this.auditionState = { section, voice, start: when };
      source.onended = () => {
        source.disconnect();
        this.sources.delete(source);
        if (epoch === this.epoch) {
          this.auditionState = undefined;
          this.notice("这一句试听完了。");
          this.update();
        }
      };
      this.status = this.position > 0 ? "paused" : "ready";
      this.update();
      return true;
    } catch (error) {
      if (epoch !== this.epoch) return false;
      this.status = this.position > 0 ? "paused" : "ready";
      this.notice(error instanceof Error ? error.message : "试听未开始。");
      this.update();
      return false;
    }
  }
  async exportWav(session: Session) {
    const snapshot = parseSession(
      structuredClone(session),
      this.manifest.score,
    );
    await this.load();
    return encodeWav(assemble(this.manifest, snapshot, this.pcm));
  }
  dispose() {
    this.stopWind();
    this.pause();
    this.closed = true;
    void this.context?.close();
    this.buffers.clear();
    this.pcm.clear();
  }
}
