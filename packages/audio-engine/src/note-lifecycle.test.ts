import { compileAir } from "@refrain/compiler";
import { describe, expect, it } from "vitest";
import { createNoteLifecycle } from "./note-lifecycle.js";
import { createPerformancePlan } from "./performance.js";

function planFor(realize: unknown[]) {
  const compiled = compileAir({
    format: "air@0-experimental",
    title: "Lifecycle",
    tempo: 80,
    meter: "4/4",
    motifs: {},
    voices: [
      {
        id: "lead",
        instrument: "warm_piano",
        role: "lead",
        realize,
      },
    ],
  }).compiled;
  if (!compiled) throw new Error("Lifecycle fixture did not compile.");
  return createPerformancePlan(compiled);
}

describe("sampled/MIDI note lifecycle", () => {
  it("keeps overlapping legato rearticulation but suppresses the stale release", () => {
    const plan = planFor([
      { id: "first", kind: "literal", part: "C4/2", articulation: "legato" },
      { id: "second", kind: "literal", part: "C4/2", articulation: "legato" },
    ]);
    expect(plan.events).toHaveLength(2);
    expect(
      createNoteLifecycle(plan.events).map(({ beat, type }) => [beat, type]),
    ).toEqual([
      [0, "noteOn"],
      [2, "noteOn"],
      [4.1, "noteOff"],
    ]);
  });

  it("keeps an explicit tie as one attack and one release", () => {
    const plan = planFor([
      { id: "first", kind: "literal", part: "C4/2", tieToNext: true },
      { id: "second", kind: "literal", part: "C4/2" },
    ]);
    expect(plan.events).toHaveLength(1);
    expect(
      createNoteLifecycle(plan.events).map(({ beat, type }) => [beat, type]),
    ).toEqual([
      [0, "noteOn"],
      [4, "noteOff"],
    ]);
  });
});
