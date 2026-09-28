import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileAirV1 } from "../../../packages/compiler/src/v1";
import { initialWork } from "./seed";
import { parseWork, compileWork } from "./model";

const air = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/air-v1/breath-study.air.json", import.meta.url),
    "utf8",
  ),
);
const artifact = JSON.parse(
  readFileSync(
    new URL(
      "../../../examples/breath-study/a-little-room-between.refrain.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
describe("authored Breath study", () => {
  it("keeps the complete default composition portable", () => {
    const work = initialWork();
    expect(parseWork(JSON.stringify(work))).toEqual(work);
    expect(compileWork(work).notes).toHaveLength(80);
    expect(compileWork(work).gaps).toHaveLength(3);
  });
  it("preserves melody pitches and onsets in the native nylon companion", () => {
    const result = compileAirV1(air);
    expect(result.diagnostics).toEqual([]);
    const actual = result
      .compiled!.events.filter((e) => e.voiceId === "thread")
      .map((e) => [e.startBeat, e.midi]);
    const expected = initialWork()
      .notes.filter((n) => n.part === "melody")
      .map((n) => [n.at, n.midi]);
    expect(actual).toEqual(expected);
    expect(artifact.source).toEqual(air);
    expect(artifact.defaultBindingId).toBe("breath-close-room@1");
  });
});
