import { oscillatorSample } from "../../../packages/audio-engine/src/synth-kernel";
import type { PCM, Program } from "./contracts";

/** One shared, stateless gain and timbre authority for every listen path. */
const ATTACK = 0.0055;
const RELEASE = 0.45;
const RING_FADE = 0.09;
const FADE_IN = 0.004;
const TAIL_FADE = 0.6;
const PARTIALS = 7;
const BASE_GAIN = 0.3;
const MAX_FREQ_RATIO = 0.45;
const CEIL = 0.98;
const KNEE = 0.86 * CEIL;

const BODY = [
  { hz: 196.0, decay: 0.34, gain: 0.9 },
  { hz: 293.66, decay: 0.22, gain: 0.62 },
];
const ECHO = [
  { delay: 0.043, gain: 0.26, pan: -0.34 },
  { delay: 0.071, gain: 0.2, pan: 0.36 },
  { delay: 0.127, gain: 0.15, pan: 0.08 },
  { delay: 0.211, gain: 0.1, pan: -0.14 },
];
const PART_GAIN = { melody: 1, harmony: 0.82, bass: 1.08 } as const;

interface Partial {
  freq: number;
  gain: number;
  decay: number;
  phase: number;
}
interface Voice {
  start: number;
  left: number;
  right: number;
  gain: number;
  gateEnd: number;
  ringEnd: number;
  bodyGain: number;
  partials: Partial[];
}

const clamp = (value: number, min: number, max: number) =>
  value < min ? min : value > max ? max : value;

/** Identity below the knee, attenuation-only above it, always within ±CEIL. */
function limit(value: number): number {
  const magnitude = Math.abs(value);
  if (magnitude <= KNEE) return value;
  const span = CEIL - KNEE;
  const compressed = KNEE + span * (1 - Math.exp(-(magnitude - KNEE) / span));
  return Math.sign(value) * Math.min(compressed, CEIL);
}

/** Analytic pluck partials, morphed from warm string to bell/glass by colour. */
function voicesFor(program: Program, sampleRate: number): Voice[] {
  const color = clamp(program.settings.color, 0, 1);
  const damping = 0.72 - 0.55 * color;
  const exponent = 1.4 - 0.9 * color;
  const density = program.notes.map(
    (note) => note.start + clamp(note.duration, 0.2, 1.2),
  );
  let maxPolyphony = 1;
  for (const note of program.notes) {
    let count = 0;
    program.notes.forEach((other, j) => {
      if (other.start <= note.start + 1e-9 && note.start < density[j] - 1e-9)
        count++;
    });
    if (count > maxPolyphony) maxPolyphony = count;
  }
  const polyphony = clamp(1 / Math.sqrt(maxPolyphony), 0.34, 1);

  return program.notes.map((note) => {
    const fundamental = 440 * 2 ** ((note.midi - 69) / 12);
    const pitch = clamp((note.midi - 36) / 60, 0, 1);
    const tau0 = (1.45 - 0.95 * pitch) * (1 + 0.35 * color);
    const partials: Partial[] = [];
    for (let k = 1; k <= PARTIALS; k++) {
      const stretched = k * Math.sqrt(1 + 0.02 * k * k);
      const freq = fundamental * (k + color * (stretched - k));
      if (freq >= sampleRate * MAX_FREQ_RATIO) continue;
      const rolloff = clamp(
        (sampleRate * MAX_FREQ_RATIO - freq) / (sampleRate * 0.03),
        0,
        1,
      );
      partials.push({
        freq,
        gain: (1 / k) ** exponent * rolloff,
        decay: Math.max(0.02, tau0 / (1 + (k - 1) * damping)),
        phase: k * 0.62,
      });
    }
    const pan = clamp(note.pan, -1, 1);
    return {
      start: note.start,
      left: Math.sqrt((1 - pan) / 2),
      right: Math.sqrt((1 + pan) / 2),
      gain: BASE_GAIN * note.velocity * polyphony * PART_GAIN[note.part],
      gateEnd: note.duration,
      ringEnd: Math.min(6 * tau0, note.duration + RELEASE),
      bodyGain: 0.085 * (1 - 0.8 * color) * (0.55 + 0.45 * (1 - pitch)),
      partials,
    };
  });
}

function bodyAt(time: number): number {
  return (
    BODY[0].gain *
      Math.exp(-time / BODY[0].decay) *
      oscillatorSample("sine", BODY[0].hz * time) +
    BODY[1].gain *
      Math.exp(-time / BODY[1].decay) *
      oscillatorSample("sine", BODY[1].hz * time)
  );
}

function voiceAt(voice: Voice, time: number): number {
  if (time < 0 || time >= voice.ringEnd) return 0;
  let sum = 0;
  for (const partial of voice.partials)
    sum +=
      partial.gain *
      oscillatorSample("sine", partial.freq * time + partial.phase) *
      Math.exp(-time / partial.decay);
  if (voice.bodyGain > 0) sum += voice.bodyGain * bodyAt(time);

  let gate = 1;
  if (time > voice.gateEnd) {
    const progress = (time - voice.gateEnd) / RELEASE;
    if (progress >= 1) return 0;
    gate = 0.5 * (1 + Math.cos(Math.PI * progress));
  }
  const tail = clamp((voice.ringEnd - time) / RING_FADE, 0, 1);
  const attack = 1 - Math.exp(-time / ATTACK);
  return sum * attack * gate * tail * voice.gain;
}

/**
 * Exact stereo block rendering: analytic, stateless and deterministic, so any
 * partition of a whole render is sample-identical. The spatial tail is a
 * feedforward analytic copy of the dry mix, which equals delaying every voice.
 */
export function renderStereo(
  program: Program,
  startFrame: number,
  frames: number,
  sampleRate: number,
): PCM {
  const left = new Float32Array(Math.max(0, frames));
  const right = new Float32Array(Math.max(0, frames));
  if (frames <= 0) return { left, right };
  if (!Number.isFinite(sampleRate) || sampleRate < 8000)
    throw new Error("Unsupported experiment sample rate.");

  const voices = voicesFor(program, sampleRate);
  const space = clamp(program.settings.space, 0, 1);
  const taps = ECHO.map((tap) => ({
    frames: Math.round(tap.delay * sampleRate),
    gain: tap.gain * space,
    left: Math.sqrt((1 - tap.pan) / 2),
    right: Math.sqrt((1 + tap.pan) / 2),
  })).filter((tap) => tap.gain > 0);
  const depth = taps.length
    ? Math.max(...taps.map((tap) => tap.frames)) + 1
    : 0;
  const extended = frames + depth;
  const first = startFrame - depth;
  const dryLeft = new Float32Array(extended);
  const dryRight = new Float32Array(extended);

  for (const voice of voices) {
    const from = Math.max(first, Math.ceil(voice.start * sampleRate));
    const until = Math.min(
      first + extended,
      Math.floor((voice.start + voice.ringEnd) * sampleRate) + 1,
    );
    for (let frame = from; frame < until; frame++) {
      const value = voiceAt(voice, frame / sampleRate - voice.start);
      const index = frame - first;
      dryLeft[index] += value * voice.left;
      dryRight[index] += value * voice.right;
    }
  }

  const duration = program.duration;
  for (let index = 0; index < frames; index++) {
    const frame = startFrame + index;
    const time = frame / sampleRate;
    let l = dryLeft[index + depth];
    let r = dryRight[index + depth];
    for (const tap of taps) {
      const source = index + depth - tap.frames;
      l += dryLeft[source] * tap.gain * tap.left;
      r += dryRight[source] * tap.gain * tap.right;
    }
    if (time >= duration) continue;
    let fade = time < FADE_IN ? time / FADE_IN : 1;
    const closing = (duration - time) / TAIL_FADE;
    if (closing < 1)
      fade *= closing <= 0 ? 0 : closing * closing * (3 - 2 * closing);
    left[index] = limit(l * fade);
    right[index] = limit(r * fade);
  }
  return { left, right };
}

/** Whole-work stereo 16-bit PCM WAV, rendered block by block through the kernel. */
export function renderWav(program: Program, sampleRate = 32000): Uint8Array {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000)
    throw new Error("Unsupported experiment sample rate.");
  const frames = Math.ceil(program.duration * sampleRate);
  const bytes = new Uint8Array(44 + frames * 4);
  const view = new DataView(bytes.buffer);
  const label = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++)
      view.setUint8(at + i, value.charCodeAt(i));
  };
  label(0, "RIFF");
  view.setUint32(4, 36 + frames * 4, true);
  label(8, "WAVE");
  label(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  label(36, "data");
  view.setUint32(40, frames * 4, true);
  for (let first = 0; first < frames; first += 8192) {
    const count = Math.min(8192, frames - first);
    const pcm = renderStereo(program, first, count, sampleRate);
    for (let i = 0; i < count; i++) {
      view.setInt16(
        44 + (first + i) * 4,
        Math.round(clamp(pcm.left[i], -1, 1) * 32767),
        true,
      );
      view.setInt16(
        46 + (first + i) * 4,
        Math.round(clamp(pcm.right[i], -1, 1) * 32767),
        true,
      );
    }
  }
  return bytes;
}
