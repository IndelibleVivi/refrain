import { describe, expect, it } from "vitest";
import { createSession, withGesture } from "./model";
import { prepare, renderStereo, renderWav } from "./kernel";

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
