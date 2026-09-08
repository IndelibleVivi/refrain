import { describe, expect, it } from "vitest";
import { INSTRUMENT_VOCABULARY } from "@refrain/soundpack";
import { createAuthoringVocabularyClosure } from "@refrain/soundpack/vnext";
import { compileAir } from "./index.js";

const air = {
  format: "air@0-experimental",
  title: "Explicit closure",
  tempo: 84,
  meter: "4/4",
  key: "C major",
  motifs: {},
  voices: [
    {
      id: "lead",
      instrument: "warm_piano",
      role: "lead",
      part: "C4/4 r/4 E4/4 r/4",
    },
  ],
};

describe("explicit authoring vocabulary closure", () => {
  it("compiles against the supplied immutable closure", () => {
    const core = createAuthoringVocabularyClosure({
      id: "core@0",
      instruments: INSTRUMENT_VOCABULARY.instruments,
    });
    expect(compileAir(air, { vocabulary: core }).compiled?.events).toHaveLength(
      2,
    );
    const withoutPiano = createAuthoringVocabularyClosure({
      id: "without-piano@0",
      instruments: INSTRUMENT_VOCABULARY.instruments.filter(
        (instrument) => instrument.id !== "warm_piano",
      ),
    });
    expect(
      compileAir(air, { vocabulary: withoutPiano }).diagnostics.some(
        (item) => item.code === "unknown_instrument",
      ),
    ).toBe(true);
  });
});
