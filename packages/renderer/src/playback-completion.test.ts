import { describe, expect, it } from "vitest";
import { PlaybackCompletionGate } from "./playback-completion.js";

describe("natural playback completion", () => {
  it("admits exactly one ended snapshot after the same generation played", () => {
    const gate = new PlaybackCompletionGate();
    const run = gate.begin("receipt:binding");
    expect(
      gate.observe(run, { status: "playing", generation: 2 }),
    ).toBeUndefined();
    expect(gate.observe(run, { status: "ended", generation: 2 })).toEqual({
      ...run,
      reason: "natural",
    });
    expect(
      gate.observe(run, { status: "ended", generation: 2 }),
    ).toBeUndefined();
  });

  it("rejects ready, pause, error, and stale engine callbacks", () => {
    for (const status of ["ready", "paused", "error"] as const) {
      const gate = new PlaybackCompletionGate();
      const run = gate.begin("work");
      gate.observe(run, { status: "playing", generation: 4 });
      gate.observe(run, { status, generation: 5 });
      expect(
        gate.observe(run, { status: "ended", generation: 5 }),
      ).toBeUndefined();
    }

    const gate = new PlaybackCompletionGate();
    const old = gate.begin("old");
    gate.observe(old, { status: "playing", generation: 1 });
    const current = gate.begin("current");
    gate.observe(current, { status: "playing", generation: 1 });
    expect(
      gate.observe(old, { status: "ended", generation: 1 }),
    ).toBeUndefined();
    expect(
      gate.observe(current, { status: "ended", generation: 1 }),
    ).toMatchObject({
      identity: "current",
    });
  });

  it("does not let an old failed action cancel a newer run", () => {
    const gate = new PlaybackCompletionGate();
    const old = gate.begin("old");
    const current = gate.begin("current");
    gate.observe(current, { status: "playing", generation: 3 });
    gate.cancel(old);
    expect(
      gate.observe(current, { status: "ended", generation: 3 }),
    ).toMatchObject({
      runId: current.runId,
    });
  });

  it("keeps buffering inside a run but rejects older generations", () => {
    const gate = new PlaybackCompletionGate();
    const run = gate.begin("work");
    gate.observe(run, { status: "playing", generation: 3 });
    gate.observe(run, { status: "buffering", generation: 4 });
    gate.observe(run, { status: "playing", generation: 5 });
    expect(
      gate.observe(run, { status: "ended", generation: 3 }),
    ).toBeUndefined();
    expect(gate.observe(run, { status: "ended", generation: 5 })).toMatchObject(
      {
        reason: "natural",
      },
    );
  });
});
