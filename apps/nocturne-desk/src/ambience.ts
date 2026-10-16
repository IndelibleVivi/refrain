/** A locally authored, deterministic noise texture; no recording or generated music. */
export function leafNoise(frames: number, sampleRate: number): Float32Array {
  const data = new Float32Array(frames);
  let seed = 0x4c454146,
    low = 0;
  const fade = Math.min(Math.floor(sampleRate * 0.06), Math.floor(frames / 4));
  for (let i = 0; i < frames; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const white = seed / 2147483648 - 1;
    low = 0.985 * low + 0.015 * white;
    const phase = (i / frames) * Math.PI * 2,
      gust = 0.62 + 0.17 * Math.sin(phase) + 0.12 * Math.sin(phase * 3 + 0.7);
    const edge = Math.min(1, i / fade, (frames - 1 - i) / fade);
    data[i] = (low * 0.8 + white * 0.025) * gust * Math.max(0, edge);
  }
  return data;
}
export class LeafWind {
  private source?: AudioBufferSourceNode;
  private gain?: GainNode;
  private filter?: BiquadFilterNode;
  private buffer?: AudioBuffer;
  private level = 0.42;
  constructor(
    private context: AudioContext,
    private destination: AudioNode,
  ) {}
  setVolume(level: number) {
    if (!Number.isFinite(level) || level < 0 || level > 1) return;
    this.level = level;
    this.gain?.gain.setTargetAtTime(level, this.context.currentTime, 0.08);
  }
  start() {
    this.stop();
    if (!this.buffer) {
      this.buffer = this.context.createBuffer(
        1,
        this.context.sampleRate * 24,
        this.context.sampleRate,
      );
      this.buffer.copyToChannel(
        leafNoise(
          this.buffer.length,
          this.context.sampleRate,
        ) as Float32Array<ArrayBuffer>,
        0,
      );
    }
    const source = this.context.createBufferSource(),
      gain = this.context.createGain(),
      filter = this.context.createBiquadFilter();
    source.buffer = this.buffer;
    source.loop = true;
    filter.type = "lowpass";
    filter.frequency.value = 2600;
    filter.Q.value = 0.45;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.destination);
    gain.gain.setValueAtTime(0, this.context.currentTime);
    gain.gain.linearRampToValueAtTime(
      this.level,
      this.context.currentTime + 0.5,
    );
    source.start();
    this.source = source;
    this.gain = gain;
    this.filter = filter;
  }
  stop() {
    const source = this.source,
      gain = this.gain,
      filter = this.filter;
    if (!source || !gain) return;
    this.source = undefined;
    this.gain = undefined;
    this.filter = undefined;
    gain.gain.cancelScheduledValues(this.context.currentTime);
    gain.gain.setTargetAtTime(0, this.context.currentTime, 0.04);
    source.stop(this.context.currentTime + 0.25);
    source.onended = () => {
      source.disconnect();
      filter?.disconnect();
      gain.disconnect();
    };
  }
}
