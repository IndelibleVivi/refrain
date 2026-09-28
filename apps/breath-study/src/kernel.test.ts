import { describe, expect, it } from "vitest";
import type { Program } from "./contracts";
import { compileWork, parseWork } from "./model";
import { renderStereo, renderWav } from "./kernel";

const raw = () => ({
  format: "breath-study-work@0",
  title: "Breath study",
  tempo: 120,
  lengthBeats: 8,
  notes: [
    {
      id: "n1",
      at: 0,
      beats: 1,
      midi: 60,
      velocity: 0.9,
      pan: -0.2,
      part: "melody",
    },
    {
      id: "n2",
      at: 0,
      beats: 2,
      midi: 55,
      velocity: 0.7,
      pan: 0.3,
      part: "harmony",
    },
    {
      id: "n3",
      at: 1.5,
      beats: 0.5,
      midi: 67,
      velocity: 0.8,
      pan: 0,
      part: "melody",
    },
    {
      id: "n4",
      at: 3,
      beats: 1,
      midi: 48,
      velocity: 0.85,
      pan: 0,
      part: "bass",
    },
    {
      id: "n5",
      at: 5,
      beats: 2,
      midi: 72,
      velocity: 0.6,
      pan: 0.1,
      part: "melody",
    },
  ],
  breaths: [3],
  settings: { breath: 0.4, color: 0.5, space: 0.5 },
});

const work = (overrides: Record<string, unknown> = {}) =>
  parseWork(JSON.stringify({ ...raw(), ...overrides }));

const rms = (values: Float32Array) => {
  let sum = 0;
  for (const value of values) sum += value * value;
  return Math.sqrt(sum / values.length);
};
const peak = (values: Float32Array) => {
  let top = 0;
  for (const value of values) top = Math.max(top, Math.abs(value));
  return top;
};
const brightness = (values: Float32Array) => {
  let sum = 0;
  for (let i = 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    sum += d * d;
  }
  return sum / values.length;
};

describe("Breath study shared audio kernel", () => {
  it("renders identical PCM for any partition of the same whole block", () => {
    const program = compileWork(work());
    const sampleRate = 8000;
    const total = Math.ceil(program.duration * sampleRate);
    const whole = renderStereo(program, 0, total, sampleRate);
    const left = new Float32Array(total);
    const right = new Float32Array(total);
    const sizes = [1, 7, 64, 127, 256, 999];
    let cursor = 0;
    let step = 0;
    while (cursor < total) {
      const count = Math.min(sizes[step % sizes.length], total - cursor);
      const slice = renderStereo(program, cursor, count, sampleRate);
      left.set(slice.left, cursor);
      right.set(slice.right, cursor);
      cursor += count;
      step++;
    }
    expect(left).toEqual(whole.left);
    expect(right).toEqual(whole.right);
  });

  it("is deterministic and click-free at start and at the finite end", () => {
    const program = compileWork(work());
    const sampleRate = 8000;
    const total = Math.ceil(program.duration * sampleRate);
    const once = renderStereo(program, 0, total, sampleRate);
    const twice = renderStereo(program, 0, total, sampleRate);
    expect(once.left).toEqual(twice.left);
    expect(once.left.every((value) => Number.isFinite(value))).toBe(true);
    expect(once.right.every((value) => Number.isFinite(value))).toBe(true);
    expect(peak(once.left)).toBeLessThanOrEqual(1);
    expect(peak(once.right)).toBeLessThanOrEqual(1);
    expect(Math.abs(once.left[0])).toBeLessThan(1e-6);
    expect(Math.abs(once.left[total - 1])).toBeLessThan(0.02);
    const past = renderStereo(program, total, 512, sampleRate);
    expect(past.left.every((value) => value === 0)).toBe(true);
    expect(past.right.every((value) => value === 0)).toBe(true);
  });

  it("shifts a score from warm string to bell/glass with audible colour", () => {
    const sampleRate = 8000;
    const warm = compileWork(
      work({ settings: { breath: 0.4, color: 0, space: 0.5 } }),
    );
    const glass = compileWork(
      work({ settings: { breath: 0.4, color: 1, space: 0.5 } }),
    );
    const total = Math.ceil(warm.duration * sampleRate);
    const a = renderStereo(warm, 0, total, sampleRate);
    const b = renderStereo(glass, 0, total, sampleRate);
    expect(a.left).not.toEqual(b.left);
    expect(brightness(b.left)).toBeGreaterThan(brightness(a.left));
  });

  it("moves onset energy when a breath inserts a real gap", () => {
    const sampleRate = 8000;
    const gapped = compileWork(work());
    const plain = compileWork(work({ breaths: [] }));
    const total = Math.ceil(gapped.duration * sampleRate);
    expect(renderStereo(gapped, 0, total, sampleRate).left).not.toEqual(
      renderStereo(plain, 0, total, sampleRate).left,
    );
    const window = Math.round(0.35 * sampleRate);
    const atBeat = Math.round(1.5 * sampleRate);
    const delayed = Math.round((1.5 + 0.4) * sampleRate);
    const plainAt = renderStereo(plain, atBeat, window, sampleRate);
    const gappedAt = renderStereo(gapped, atBeat, window, sampleRate);
    const gappedLater = renderStereo(gapped, delayed, window, sampleRate);
    expect(rms(gappedAt.left)).toBeLessThan(rms(plainAt.left) * 0.2);
    expect(rms(gappedLater.left)).toBeGreaterThan(rms(gappedAt.left) * 4);
  });

  it("preserves reference rendering across differing authored settings", () => {
    const sampleRate = 8000;
    const loud = compileWork(
      work({ settings: { breath: 1.8, color: 1, space: 1 } }),
      true,
    );
    const quiet = compileWork(
      work({ settings: { breath: 0, color: 0, space: 0 } }),
      true,
    );
    expect(loud.settings).toEqual({ breath: 0, color: 0, space: 0.18 });
    expect(loud.notes).toEqual(quiet.notes);
    const total = Math.ceil(loud.duration * sampleRate);
    expect(renderStereo(loud, 0, total, sampleRate).left).toEqual(
      renderStereo(quiet, 0, total, sampleRate).left,
    );
  });

  it("never normalizes a quiet section upward", () => {
    const sampleRate = 8000;
    const notes = work().notes.map((note) => ({ ...note }));
    const quiet = compileWork(
      work({ notes: notes.map((note) => ({ ...note, velocity: 0.05 })) }),
    );
    const loud = compileWork(
      work({ notes: notes.map((note) => ({ ...note, velocity: 1 })) }),
    );
    const total = Math.ceil(loud.duration * sampleRate);
    const quietPeak = peak(renderStereo(quiet, 0, total, sampleRate).left);
    const loudPeak = peak(renderStereo(loud, 0, total, sampleRate).left);
    expect(quietPeak).toBeGreaterThan(0);
    expect(quietPeak).toBeLessThan(loudPeak * 0.4);
  });

  it("reports native peak and RMS for the test score", () => {
    const sampleRate = 32000;
    const program = compileWork(work());
    const total = Math.ceil(program.duration * sampleRate);
    const pcm = renderStereo(program, 0, total, sampleRate);
    const top = Math.max(peak(pcm.left), peak(pcm.right));
    const energy = (rms(pcm.left) + rms(pcm.right)) / 2;
    console.log(
      `breath-study kernel: duration=${program.duration.toFixed(2)}s ` +
        `peak=${top.toFixed(4)} rms=${energy.toFixed(4)}`,
    );
    expect(top).toBeGreaterThan(0.02);
    expect(top).toBeLessThanOrEqual(1);
    expect(energy).toBeGreaterThan(0.005);
    expect(energy).toBeLessThan(0.6);
  });

  it("writes a bounded stereo 16-bit WAV of the whole work", () => {
    const sampleRate = 8000;
    const program = compileWork(work());
    const frames = Math.ceil(program.duration * sampleRate);
    const bytes = renderWav(program, sampleRate);
    const view = new DataView(bytes.buffer);
    const label = (at: number) =>
      String.fromCharCode(
        bytes[at],
        bytes[at + 1],
        bytes[at + 2],
        bytes[at + 3],
      );
    expect(label(0)).toBe("RIFF");
    expect(label(8)).toBe("WAVE");
    expect(label(12)).toBe("fmt ");
    expect(label(36)).toBe("data");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(sampleRate);
    expect(view.getUint32(28, true)).toBe(sampleRate * 4);
    expect(view.getUint16(32, true)).toBe(4);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(frames * 4);
    expect(bytes.length).toBe(44 + frames * 4);
    let top = 0;
    let nonzero = false;
    for (let i = 0; i < frames; i++) {
      const l = Math.abs(view.getInt16(44 + i * 4, true));
      const r = Math.abs(view.getInt16(46 + i * 4, true));
      top = Math.max(top, l, r);
      if (l > 0 || r > 0) nonzero = true;
    }
    expect(nonzero).toBe(true);
    expect(top).toBeLessThanOrEqual(32767);
    expect(view.getInt16(bytes.length - 4, true)).toBe(0);
    expect(view.getInt16(bytes.length - 2, true)).toBe(0);
  });

  it("renders a single isolated audition note as finite bounded PCM", () => {
    const sampleRate = 8000;
    const isolated: Program = {
      notes: [
        {
          id: "solo",
          at: 0,
          beats: 1,
          midi: 64,
          velocity: 0.9,
          pan: 0,
          part: "melody",
          start: 0,
          duration: 0.5,
        },
      ],
      duration: 6,
      musicEnd: 0.5,
      settings: { breath: 0, color: 0.5, space: 0.4 },
      gaps: [],
    };
    const pcm = renderStereo(isolated, 0, 6 * sampleRate, sampleRate);
    expect(peak(pcm.left)).toBeGreaterThan(0);
    expect(peak(pcm.left)).toBeLessThanOrEqual(1);
    expect(pcm.left.every((value) => Number.isFinite(value))).toBe(true);
    expect(pcm.left[pcm.left.length - 1]).toBe(0);
  });
});
