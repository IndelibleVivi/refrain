import type { Session } from "./contracts";
import { prepare, renderStereo } from "./kernel";

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  port: MessagePort;
}
declare function registerProcessor(
  name: string,
  constructor: typeof DriftProcessor,
): void;

class DriftProcessor extends AudioWorkletProcessor {
  private session?: Session;
  private frame = 0;
  private playing = false;
  private generation = 0;
  private reportedFrames = 0;
  private frames = 0;
  private peak = 0;
  private transition = 0;
  private previous = [0, 0];
  private held = [0, 0];
  constructor() {
    super();
    this.port.onmessage = (event) => {
      const data = event.data;
      if (data.type === "load") {
        this.session = data.session;
        prepare(this.session!);
        this.frame = Math.round(data.position * sampleRate);
        this.generation = data.generation;
        this.playing = data.playing;
        this.held = [...this.previous];
        this.transition = 0;
      } else if (data.type === "pause") {
        this.playing = false;
        this.previous = [0, 0];
      }
    };
  }
  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const channels = outputs[0];
    if (!this.session || !this.playing || !channels?.[0]) return true;
    const pcm = renderStereo(
      this.session,
      this.frame / sampleRate,
      channels[0].length,
      sampleRate,
    );
    const smoothing = Math.round(sampleRate * 0.015);
    for (let i = 0; i < channels[0].length; i++) {
      const mix = Math.min(1, this.transition++ / smoothing);
      channels[0][i] = this.held[0] * (1 - mix) + pcm.left[i] * mix;
      if (channels[1])
        channels[1][i] = this.held[1] * (1 - mix) + pcm.right[i] * mix;
      this.peak = Math.max(
        this.peak,
        Math.abs(channels[0][i]),
        Math.abs(channels[1]?.[i] ?? 0),
      );
    }
    this.previous = [channels[0].at(-1)!, channels[1]?.at(-1) ?? 0];
    this.frame += channels[0].length;
    this.frames += channels[0].length;
    const ended =
      this.frame >= Math.ceil(this.session.work.duration * sampleRate);
    if (this.frames - this.reportedFrames >= sampleRate / 10 || ended) {
      this.port.postMessage({
        generation: this.generation,
        frames: this.frames,
        peak: this.peak,
        ended,
      });
      this.reportedFrames = this.frames;
    }
    if (ended) this.playing = false;
    return true;
  }
}
registerProcessor("drift-study", DriftProcessor);
