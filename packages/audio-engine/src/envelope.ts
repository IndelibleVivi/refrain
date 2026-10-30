import type { StaticSynthPatch } from "@refrain/soundpack";

export function heldEnvelopeLevel(
  time: number,
  patch: StaticSynthPatch,
): number {
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
  patch: StaticSynthPatch,
): number {
  if (time < 0) return 0;
  if (time <= noteDuration) return heldEnvelopeLevel(time, patch);
  const noteOffLevel = heldEnvelopeLevel(noteDuration, patch);
  if (patch.release <= 0) return 0;
  const releaseProgress = (time - noteDuration) / patch.release;
  return releaseProgress >= 1 ? 0 : noteOffLevel * (1 - releaseProgress) ** 2;
}

export interface EnvelopeAutomationParam {
  setValueAtTime(value: number, startTime: number): unknown;
  linearRampToValueAtTime(value: number, endTime: number): unknown;
}

export interface HeldEnvelopeSchedule {
  start: number;
  elapsedSeconds: number;
  noteOffSeconds: number;
  peak: number;
}

export function scheduleHeldEnvelope(
  param: EnvelopeAutomationParam,
  patch: StaticSynthPatch,
  schedule: HeldEnvelopeSchedule,
): void {
  const { start, elapsedSeconds, peak } = schedule;
  const noteOffSeconds = Math.max(elapsedSeconds, schedule.noteOffSeconds);
  const minimum = 0.0001;
  const scaledPeak = Math.max(minimum, peak);
  const levelAt = (time: number): number =>
    Math.max(minimum, scaledPeak * heldEnvelopeLevel(time, patch));
  const atElapsed = (time: number): number =>
    start + Math.max(0, time - elapsedSeconds);

  param.setValueAtTime(levelAt(elapsedSeconds), start);

  const attackEnd = Math.max(0, patch.attack);
  const advances = (endpoint: number): boolean =>
    atElapsed(endpoint) > start + Number.EPSILON;
  if (
    elapsedSeconds < attackEnd &&
    advances(Math.min(attackEnd, noteOffSeconds))
  ) {
    const endpoint = Math.min(attackEnd, noteOffSeconds);
    // A zero decay has a discontinuity at attackEnd: approach the peak from
    // the left, then enter sustain. Sampling the right-hand value alone would
    // incorrectly shrink the entire attack to the sustain level.
    param.linearRampToValueAtTime(
      endpoint === attackEnd ? scaledPeak : levelAt(endpoint),
      atElapsed(endpoint),
    );
    if (
      endpoint === attackEnd &&
      patch.format === "refrain-synth-subtractive@0-experimental" &&
      patch.decay === 0
    )
      param.setValueAtTime(levelAt(attackEnd), atElapsed(attackEnd));
  }

  if (patch.format !== "refrain-synth-subtractive@0-experimental") return;
  const decayEnd = attackEnd + Math.max(0, patch.decay);
  if (elapsedSeconds < decayEnd && noteOffSeconds > attackEnd) {
    const endpoint = Math.min(decayEnd, noteOffSeconds);
    if (endpoint > Math.max(elapsedSeconds, attackEnd) && advances(endpoint))
      param.linearRampToValueAtTime(levelAt(endpoint), atElapsed(endpoint));
  }
}
