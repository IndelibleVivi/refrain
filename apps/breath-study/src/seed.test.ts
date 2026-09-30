import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileAirV1 } from "../../../packages/compiler/src/v1";
import { parseRefrainArtifact } from "../../../packages/renderer/src/portable";
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
const archtopAir = JSON.parse(
  readFileSync(
    new URL(
      "../../../fixtures/air-v1/breath-study-archtop.air.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const archtopArtifact = JSON.parse(
  readFileSync(
    new URL(
      "../../../examples/breath-study/a-little-room-between-archtop.refrain.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

function melody(source: unknown) {
  const result = compileAirV1(source);
  expect(result.diagnostics).toEqual([]);
  return result
    .compiled!.events.filter((event) => event.voiceId === "thread")
    .map((event) => [event.startBeat, event.midi]);
}

describe("authored Breath study", () => {
  it("keeps the complete default composition portable", () => {
    const work = initialWork();
    expect(parseWork(JSON.stringify(work))).toEqual(work);
    expect(compileWork(work).notes).toHaveLength(80);
    expect(compileWork(work).gaps).toHaveLength(3);
  });
  it("preserves melody pitches and onsets in the native nylon companion", () => {
    const actual = melody(air);
    const expected = initialWork()
      .notes.filter((n) => n.part === "melody")
      .map((n) => [n.at, n.midi]);
    expect(actual).toEqual(expected);
    expect(artifact.source).toEqual(air);
    expect(artifact.defaultBindingId).toBe("breath-close-room@1");
  });

  it("keeps the archtop companion on the same authored melody with exact portable sound", () => {
    expect(melody(archtopAir)).toEqual(melody(air));
    expect(archtopArtifact.source).toEqual(archtopAir);
    expect(archtopArtifact.defaultBindingId).toBe(
      "refrain-shinyguitar-archtop@1",
    );
    expect(archtopArtifact.source.vocabulary).toMatchObject({
      id: "refrain-shinyguitar-archtop-language@1",
      contentSha256:
        "174f57a6ba2e7270f0b6ee2fffce49bace11bf3180f1a491ef5546399d5bb122",
    });
    expect(
      archtopArtifact.performanceBindings[0].candidateDigests,
    ).toMatchObject({
      "archtop-guitar-shinyguitar-acoustic":
        "7c4228273b9e3d4cca74b2489d2d835fb3d87913f08497242e9000f2765e479f",
    });
    expect(
      archtopArtifact.projections.map((item: { kind: string }) => item.kind),
    ).toEqual(["native-wav", "audition-matched-wav"]);
    expect(parseRefrainArtifact(archtopArtifact)).toMatchObject({
      ok: true,
      continuity: "valid",
    });
  });
});
