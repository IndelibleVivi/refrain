import type { SynthPatch } from "@refrain/soundpack";

export function heldEnvelopeLevel(time: number, patch: SynthPatch): number {
  if (time < 0) return 0;
  if (patch.attack > 0 && time < patch.attack) return time / patch.attack;
  if (patch.format === "refrain-synth-modal@0-experimental") return 1;
  const decayTime = time - patch.attack;
  if (patch.decay > 0 && decayTime < patch.decay) {
    return 1 - (1 - patch.sustain) * (decayTime / patch.decay);
  }
  return patch.sustain;
}

export function envelopeLevel(
  time: number,
  noteDuration: number,
  patch: SynthPatch,
): number {
  if (time < 0) return 0;
  if (time <= noteDuration) return heldEnvelopeLevel(time, patch);
  const noteOffLevel = heldEnvelopeLevel(noteDuration, patch);
  if (patch.release <= 0) return 0;
  const releaseProgress = (time - noteDuration) / patch.release;
  return releaseProgress >= 1 ? 0 : noteOffLevel * (1 - releaseProgress) ** 2;
}
