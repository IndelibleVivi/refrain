import type { SynthPatch } from "@refrain/soundpack";
import { BiquadLowPass } from "./filter.js";

export const SYNTH_KERNEL_CONTRACT =
  "refrain-synth-kernel@0-experimental" as const;

export interface SynthOscillatorProjection {
  type: OscillatorType;
  ratio: number;
  gain: number;
  detune: number;
  decaySeconds?: number;
}

export function synthOscillatorProjection(
  patch: SynthPatch,
): SynthOscillatorProjection[] {
  return patch.format === "refrain-synth-subtractive@0-experimental"
    ? patch.oscillators.map((layer) => ({
        type: layer.type,
        ratio: layer.ratio,
        gain: layer.gain,
        detune: layer.detune ?? 0,
      }))
    : patch.modes.map((mode) => ({
        type: "sine",
        ratio: mode.ratio,
        gain: mode.gain,
        detune: mode.detune ?? 0,
        decaySeconds: mode.decaySeconds,
      }));
}

export function oscillatorSample(type: OscillatorType, cycles: number): number {
  const sine = Math.sin(cycles * Math.PI * 2);
  if (type === "sine") return sine;
  if (type === "triangle") return (2 / Math.PI) * Math.asin(sine);
  if (type === "square") return sine >= 0 ? 1 : -1;
  return 2 * (cycles - Math.floor(cycles + 0.5));
}

export function synthRawSample(
  patch: SynthPatch,
  time: number,
  frequency: number,
): number {
  if (patch.format === "refrain-synth-subtractive@0-experimental") {
    let sample = 0;
    for (const layer of patch.oscillators) {
      const detuneRatio = 2 ** ((layer.detune ?? 0) / 1200);
      sample +=
        oscillatorSample(
          layer.type,
          time * frequency * layer.ratio * detuneRatio,
        ) * layer.gain;
    }
    return sample;
  }
  let sample = 0;
  for (const mode of patch.modes) {
    const detuneRatio = 2 ** ((mode.detune ?? 0) / 1200);
    sample +=
      Math.sin(time * frequency * mode.ratio * detuneRatio * Math.PI * 2) *
      mode.gain *
      Math.exp(-time / mode.decaySeconds);
  }
  return sample;
}

export function synthFilter(
  patch: SynthPatch,
  sampleRate: number,
): BiquadLowPass | undefined {
  return patch.format === "refrain-synth-subtractive@0-experimental"
    ? new BiquadLowPass(patch.filterHz, patch.filterQ, sampleRate)
    : undefined;
}

export function processSynthSample(
  patch: SynthPatch,
  filter: BiquadLowPass | undefined,
  time: number,
  frequency: number,
): number {
  const raw = synthRawSample(patch, time, frequency);
  return filter?.process(raw) ?? raw;
}
