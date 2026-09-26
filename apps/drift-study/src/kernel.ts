import { oscillatorSample } from "../../../packages/audio-engine/src/synth-kernel";
import type { Session } from "./contracts";
import { momentAt, trajectory } from "./model";

interface Note {
  at: number;
  end: number;
  frequency: number;
  attack: number;
  decay: number;
  erosion: number;
  bloom: number;
  layer: 0 | 1;
  left: number;
  right: number;
}
interface Level {
  at: number;
  from: [number, number];
  to: [number, number];
}
interface Program {
  notes: Note[];
  levels: Level[];
  duration: number;
}
const programs = new WeakMap<Session, Program>();
const levelRamp = 0.035;
function levelAt(level: Level | undefined, at: number, layer: number) {
  if (!level) return 1;
  const phase = Math.min(1, Math.max(0, (at - level.at) / levelRamp));
  return level.from[layer] + (level.to[layer] - level.from[layer]) * phase;
}
/** Resolve the finite rule performance once. It stays a local experiment projection. */
export function prepare(session: Session): Program {
  const cached = programs.get(session);
  if (cached) return cached;
  const notes: Note[] = [];
  const add = (at: number, index: number, layer: 0 | 1) => {
    if (at < 0 || at >= session.work.duration) return;
    const material = session.work.notes[index],
      m = momentAt(session, at);
    const attack =
      layer === 0 ? 0.008 + m.erosion * 0.22 : 0.028 + m.bloom * 0.08;
    const decay =
      layer === 0
        ? material.duration * (0.8 + m.erosion * 0.7)
        : material.duration + 0.5 + m.bloom * 1.3;
    const tail = layer === 0 ? Math.min(3, decay * 5) : Math.min(6, decay * 4);
    const pan = layer === 0 ? -0.33 : 0.33;
    notes.push({
      at,
      end: at + tail,
      frequency: 440 * 2 ** ((material.midi - 69) / 12),
      attack,
      decay,
      erosion: m.erosion,
      bloom: m.bloom,
      layer,
      left: Math.sqrt((1 - pan) / 2),
      right: Math.sqrt((1 + pan) / 2),
    });
  };
  for (
    let cycle = 0;
    cycle < session.work.duration / session.work.loopSeconds;
    cycle++
  ) {
    session.work.notes.forEach((note, index) =>
      add((cycle + note.at) * session.work.loopSeconds, index, 0),
    );
  }
  for (const span of trajectory(session)) {
    const phase = span.start / session.work.loopSeconds + span.offset;
    const rate =
      1 / session.work.loopSeconds + (span.frozen ? 0 : span.rules.drift / 30);
    const endPhase = phase + (span.end - span.start) * rate;
    for (
      let cycle = Math.floor(phase);
      cycle <= Math.floor(endPhase);
      cycle++
    ) {
      session.work.notes.forEach((note, index) => {
        const at = span.start + (cycle + note.at - phase) / rate;
        if (at >= span.start - 1e-9 && at < span.end - 1e-9)
          add(Math.max(span.start, at), index, 1);
      });
    }
  }
  notes.sort((a, b) => a.at - b.at);
  const levels: Level[] = [];
  for (const gesture of session.gestures) {
    if (gesture.kind !== "layers") continue;
    const last = levels.at(-1);
    levels.push({
      at: gesture.at,
      from: [levelAt(last, gesture.at, 0), levelAt(last, gesture.at, 1)],
      to: [gesture.layers === "b" ? 0 : 1, gesture.layers === "a" ? 0 : 1],
    });
  }
  const program = { notes, levels, duration: session.work.duration };
  programs.set(session, program);
  return program;
}
/** Same block kernel in the AudioWorklet, offline worker, and local tests. */
export function renderStereo(
  session: Session,
  start: number,
  frames: number,
  sampleRate: number,
) {
  const program = prepare(session),
    left = new Float32Array(frames),
    right = new Float32Array(frames);
  const firstFrame = Math.round(start * sampleRate),
    end = (firstFrame + frames) / sampleRate;
  const gains = [new Float32Array(frames), new Float32Array(frames)];
  let levelIndex = 0;
  while (
    levelIndex < program.levels.length &&
    program.levels[levelIndex].at <= firstFrame / sampleRate
  )
    levelIndex++;
  for (let i = 0; i < frames; i++) {
    const at = (firstFrame + i) / sampleRate;
    while (
      levelIndex < program.levels.length &&
      program.levels[levelIndex].at <= at
    )
      levelIndex++;
    const level = program.levels[levelIndex - 1];
    gains[0][i] = levelAt(level, at, 0);
    gains[1][i] = levelAt(level, at, 1);
  }
  for (const note of program.notes) {
    if (note.at >= end) break;
    if (note.end <= firstFrame / sampleRate) continue;
    const from = Math.max(0, Math.ceil(note.at * sampleRate) - firstFrame);
    const until = Math.min(
      frames,
      Math.ceil(note.end * sampleRate) - firstFrame,
    );
    for (let i = from; i < until; i++) {
      const at = (firstFrame + i) / sampleRate;
      const value = voiceValue(note, at - note.at, at) * gains[note.layer][i];
      left[i] += value * note.left;
      right[i] += value * note.right;
    }
  }
  finish(left, right, firstFrame, sampleRate, program.duration);
  return { left, right };
}
function voiceValue(note: Note, t: number, at: number) {
  if (t < 0 || at >= note.end) return 0;
  const color = note.layer === 0 ? 1 - note.erosion : 0.55;
  const envelope = (1 - Math.exp(-t / note.attack)) * Math.exp(-t / note.decay);
  const fade = Math.min(1, Math.max(0, (note.end - at) / 0.06));
  return (
    (oscillatorSample("sine", note.frequency * t) +
      oscillatorSample("sine", note.frequency * 2 * t) *
        0.17 *
        color *
        Math.exp(-t * 3) +
      oscillatorSample("sine", note.frequency * 3 * t) *
        0.055 *
        color *
        Math.exp(-t * 5) +
      (note.layer === 1
        ? oscillatorSample("sine", note.frequency * 1.002 * t) *
          0.15 *
          note.bloom
        : 0)) *
    envelope *
    fade *
    0.17
  );
}
function finish(
  left: Float32Array,
  right: Float32Array,
  first: number,
  rate: number,
  duration: number,
) {
  for (let i = 0; i < left.length; i++) {
    const t = (first + i) / rate;
    const gate = Math.max(
      0,
      Math.min(1, t / 0.25, (duration - t) / Math.min(5, duration / 5)),
    );
    left[i] = Math.tanh(left[i]) * 0.8 * gate;
    right[i] = Math.tanh(right[i]) * 0.8 * gate;
  }
}
export function renderWav(session: Session, sampleRate = 22050): Uint8Array {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 48000)
    throw new Error("Unsupported experiment sample rate.");
  const frames = Math.ceil(session.work.duration * sampleRate),
    bytes = new Uint8Array(44 + frames * 4),
    view = new DataView(bytes.buffer);
  const label = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
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
  for (let first = 0; first < frames; first += 4096) {
    const count = Math.min(4096, frames - first),
      pcm = renderStereo(session, first / sampleRate, count, sampleRate);
    for (let i = 0; i < count; i++) {
      view.setInt16(
        44 + (first + i) * 4,
        Math.round(Math.max(-1, Math.min(1, pcm.left[i])) * 32767),
        true,
      );
      view.setInt16(
        46 + (first + i) * 4,
        Math.round(Math.max(-1, Math.min(1, pcm.right[i])) * 32767),
        true,
      );
    }
  }
  return bytes;
}
