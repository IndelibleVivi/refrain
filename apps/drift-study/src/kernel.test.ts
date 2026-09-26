import { describe, expect, it } from "vitest";
import { createSession, withGesture } from "./model";
import { prepare, renderStereo, renderWav, voicesAt } from "./kernel";

const energy = (values: Float32Array) =>
  values.reduce((sum, v) => sum + v * v, 0) / values.length;
describe("Drift study shared audio kernel", () => {
  it("produces finite, bounded, non-silent stereo sound", () => {
    const pcm = renderStereo(createSession(), 0, 24000, 8000);
    expect(energy(pcm.left)).toBeGreaterThan(0.0001);
    expect(pcm.left.every((n) => Number.isFinite(n) && Math.abs(n) < 0.8)).toBe(
      true,
    );
    expect(pcm.left).not.toEqual(pcm.right);
  });
  it("resolves audible attacks onto the same phase path as the visual clock", () => {
    const s = createSession(),
      p = prepare(s);
    const attack = p.notes.find((n) => n.layer === 1 && n.at > 5)!;
    const cycle =
      attack.at / s.work.loopSeconds + (attack.at * s.work.rules.drift) / 30;
    expect(s.work.notes.some((n) => Math.abs((cycle % 1) - n.at) < 1e-8)).toBe(
      true,
    );
  });
  it("changes the actual signal when a layer is kept, including its existing tail", () => {
    const base = createSession();
    const solo = withGesture(base, { at: 1.1, kind: "layers", layers: "a" });
    const full = renderStereo(base, 1.2, 4000, 8000);
    const kept = renderStereo(solo, 1.2, 4000, 8000);
    expect(kept.left).not.toEqual(full.left);
    expect(energy(kept.right)).toBeLessThan(energy(full.right));
  });
  it("freezing and timbral growth produce different later audio", () => {
    const moving = createSession(),
      held = withGesture(moving, { at: 0, kind: "freeze", frozen: true });
    expect(renderStereo(moving, 30, 4000, 8000).left).not.toEqual(
      renderStereo(held, 30, 4000, 8000).left,
    );
    const early = prepare(moving).notes.find((n) => n.layer === 0)!;
    const late = prepare(moving).notes.find((n) => n.layer === 0 && n.at > 50)!;
    expect(late.attack).toBeGreaterThan(early.attack);
    expect(
      prepare(moving).notes.find((n) => n.layer === 1 && n.at > 50)!.decay,
    ).toBeGreaterThan(prepare(moving).notes.find((n) => n.layer === 1)!.decay);
  });
  it("reconstructs tails and control ramps identically across block boundaries and seek", () => {
    let s = withGesture(createSession(), {
      at: 1.1,
      kind: "layers",
      layers: "b",
    });
    s = withGesture(s, { at: 1.12, kind: "layers", layers: "both" });
    const whole = renderStereo(s, 0, 24000, 8000);
    const pieces = new Float32Array(24000);
    for (let i = 0; i < 24000; i += 128)
      pieces.set(
        renderStereo(s, i / 8000, Math.min(128, 24000 - i), 8000).left,
        i,
      );
    expect(pieces).toEqual(whole.left);
    expect(renderStereo(s, 1.113, 2000, 8000).left).toEqual(
      whole.left.slice(8904, 10904),
    );
  });
  it("ends in silence, and WAV exports the whole performance independent of cursor", () => {
    const s = createSession();
    s.work.duration = 12;
    const before = renderWav(s, 8000);
    s.cursor = 7;
    expect(renderWav(s, 8000)).toEqual(before);
    const view = new DataView(before.buffer);
    expect(before.length).toBe(44 + 12 * 8000 * 4);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(8000);
    expect(renderStereo(s, 12, 128, 8000).left.every((n) => n === 0)).toBe(
      true,
    );
    expect(
      Math.abs(view.getInt16(before.length - 2, true)),
    ).toBeLessThanOrEqual(1);
  });
});
describe("Drift study plucks and visual voice projection", () => {
  const short = (session = createSession()) => {
    session.work.duration = 12;
    return session;
  };
  it("keeps no-pluck rendering identical across the historical and current labels", () => {
    const historical = short({
      ...createSession(),
      format: "drift-study-session@0",
    });
    const current = short(createSession());
    expect(prepare(historical).notes.every((note) => !note.manual)).toBe(true);
    expect(renderStereo(historical, 0, 8000, 8000)).toEqual(
      renderStereo(current, 0, 8000, 8000),
    );
  });
  it("adds an audible pluck attack and changes the finite PCM and WAV", () => {
    const base = short(createSession());
    const plucked = short(
      withGesture(createSession(), {
        at: 2.4,
        kind: "pluck",
        note: 0,
        layers: "both",
      }),
    );
    const before = renderStereo(base, 2.4, 4096, 8000);
    const after = renderStereo(plucked, 2.4, 4096, 8000);
    expect(after.left).not.toEqual(before.left);
    expect(after.right).not.toEqual(before.right);
    expect(energy(after.left)).toBeGreaterThan(energy(before.left));
    const reference = renderWav(base, 8000),
      withPluck = renderWav(plucked, 8000);
    expect(withPluck.length).toBe(reference.length);
    expect(withPluck).not.toEqual(reference);
  });
  it("reconstructs plucks identically across block boundaries and seeks", () => {
    let s = short(createSession());
    s = withGesture(s, { at: 1.05, kind: "pluck", note: 3, layers: "b" });
    s = withGesture(s, { at: 2.7, kind: "pluck", note: 0, layers: "a" });
    const whole = renderStereo(s, 0, 24000, 8000);
    const pieces = new Float32Array(24000);
    for (let i = 0; i < 24000; i += 128)
      pieces.set(
        renderStereo(s, i / 8000, Math.min(128, 24000 - i), 8000).left,
        i,
      );
    expect(pieces).toEqual(whole.left);
    expect(renderStereo(s, 1.05, 1600, 8000).left).toEqual(
      whole.left.slice(8400, 10000),
    );
  });
  it("reports bounded, envelope-true voices and nothing after the finite end", () => {
    const s = short(createSession());
    for (const t of [0, 0.3, 1.2, 2.4, 6, 11.9]) {
      const voices = voicesAt(s, t);
      expect(voices.length).toBeLessThanOrEqual(32);
      const keys = voices.map((voice) => voice.note + ":" + voice.layer);
      expect(new Set(keys).size).toBe(keys.length);
      for (const voice of voices) {
        expect(voice.level).toBeGreaterThan(0);
        expect(voice.level).toBeLessThanOrEqual(1);
        expect(voice.age).toBeGreaterThanOrEqual(0);
        expect(voice.duration).toBeGreaterThan(0);
        expect(voice.manual).toBe(false);
        expect(["a", "b"]).toContain(voice.layer);
        expect(voice.note).toBeGreaterThanOrEqual(0);
        expect(voice.note).toBeLessThan(s.work.notes.length);
      }
    }
    const muted = withGesture(s, { at: 1, kind: "layers", layers: "b" });
    const at = voicesAt(muted, 2.4);
    expect(at.some((voice) => voice.layer === "a")).toBe(false);
    expect(at.some((voice) => voice.layer === "b")).toBe(true);
    expect(voicesAt(s, 12)).toEqual([]);
    expect(voicesAt(s, 20)).toEqual([]);
    expect(voicesAt(s, -3)).toEqual([]);
  });
  it("marks direct pluck voices for the field view", () => {
    const s = withGesture(createSession(), {
      at: 0.9,
      kind: "pluck",
      note: 0,
      layers: "both",
    });
    const voices = voicesAt(s, 0.95);
    const manual = voices.filter((voice) => voice.manual);
    expect(manual.map((voice) => voice.layer).sort()).toEqual(["a", "b"]);
    expect(manual.every((voice) => voice.note === 0)).toBe(true);
    expect(
      voices.every(
        (voice) => voice.note >= 0 && voice.note < s.work.notes.length,
      ),
    ).toBe(true);
  });
});
