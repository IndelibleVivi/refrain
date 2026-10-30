import type {
  StaticSynthPatch,
  SynthPatch,
  VelocityRange,
} from "@refrain/soundpack";
import { BiquadLowPass } from "./filter.js";

export const SYNTH_KERNEL_CONTRACT =
  "refrain-synth-kernel@0-experimental" as const;

/**
 * The one note-on execution of a versioned patch's velocity response. No sound
 * lookup or taste choice happens here. All adapters use the plan's effective
 * performance velocity; the plan's patch and its fixed lifecycle stay intact.
 * Frequency interpolates in octaves, partial amplitude linearly. Historical
 * patches are returned unchanged, preserving their exact execution.
 */
export function synthNotePatch(
  patch: SynthPatch,
  velocity: number,
): StaticSynthPatch {
  if (
    patch.format === "refrain-synth-subtractive@0-experimental" ||
    patch.format === "refrain-synth-modal@0-experimental"
  )
    return patch;
  if (!Number.isFinite(velocity))
    throw new Error("Synth note velocity must be finite.");
  const amount = Math.max(0, Math.min(1, velocity)) ** patch.velocityExponent;
  const gain = (range: VelocityRange) =>
    range.soft + (range.hard - range.soft) * amount;
  if (patch.format === "refrain-synth-subtractive@1-experimental") {
    return {
      format: "refrain-synth-subtractive@0-experimental",
      attack: patch.attack,
      decay: patch.decay,
      sustain: patch.sustain,
      release: patch.release,
      filterHz:
        patch.filterHz.soft *
        (patch.filterHz.hard / patch.filterHz.soft) ** amount,
      filterQ: patch.filterQ,
      oscillators: patch.oscillators.map((layer) => ({
        ...layer,
        gain: gain(layer.gain),
      })),
    };
  }
  return {
    format: "refrain-synth-modal@0-experimental",
    attack: patch.attack,
    release: patch.release,
    modes: patch.modes.map((mode) => ({ ...mode, gain: gain(mode.gain) })),
  };
}

export interface SynthOscillatorProjection {
  type: OscillatorType;
  ratio: number;
  gain: number;
  detune: number;
  decaySeconds?: number;
}

export function synthOscillatorProjection(
  patch: StaticSynthPatch,
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
  patch: StaticSynthPatch,
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
  patch: StaticSynthPatch,
  sampleRate: number,
): BiquadLowPass | undefined {
  return patch.format === "refrain-synth-subtractive@0-experimental"
    ? new BiquadLowPass(patch.filterHz, patch.filterQ, sampleRate)
    : undefined;
}

export function processSynthSample(
  patch: StaticSynthPatch,
  filter: BiquadLowPass | undefined,
  time: number,
  frequency: number,
): number {
  const raw = synthRawSample(patch, time, frequency);
  return filter?.process(raw) ?? raw;
}
