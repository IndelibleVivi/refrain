import { describe, expect, it } from "vitest";
import type { AirSource } from "@refrain/air-schema";
import { compileAir } from "@refrain/compiler";
import windPilotAir from "../../../fixtures/valid/e-wind-pilot.air.json" with { type: "json" };
import {
  DEFAULT_RENDER_SCENE,
  E_VSCO_WIND_PILOT_PERFORMANCE_BINDING,
  G3B_VCSL_LISTENING_SOUND_PROFILE,
  SOUND_REGISTRY,
  candidateContentSha256,
  createPerformanceBinding,
  soundObjectContentSha256,
  type SoundpackManifest,
  type SoundProfile,
} from "@refrain/soundpack";
import { createPerformancePlan } from "./performance.js";

function compile(part: string) {
  return compileAir({
    format: "air@0-experimental",
    title: "Resolution fixture",
    tempo: 80,
    meter: "4/4",
    motifs: {},
    voices: [
      {
        id: "keys",
        instrument: "warm_piano",
        role: "lead",
        part,
      },
    ],
  }).compiled!;
}

function compileInstrument(instrument: string, part: string) {
  return compileAir({
    format: "air@0-experimental",
    title: `${instrument} resolution fixture`,
    tempo: 80,
    meter: "4/4",
    motifs: {},
    voices: [{ id: "voice", instrument, role: "lead", part }],
  }).compiled!;
}

function bindingFor(
  soundProfile: SoundProfile,
  manifest: SoundpackManifest = SOUND_REGISTRY,
) {
  return createPerformanceBinding(
    {
      id: `test-${soundProfile.id}`,
      soundProfile,
      renderScene: DEFAULT_RENDER_SCENE,
    },
    manifest,
  );
}

function repinProfile(
  profile: SoundProfile,
  manifest: SoundpackManifest,
): SoundProfile {
  const candidates = new Map(
    manifest.candidates.map((candidate) => [candidate.id, candidate]),
  );
  const selections = Object.fromEntries(
    Object.entries(profile.selections).map(([instrumentId, selection]) => [
      instrumentId,
      {
        ...selection,
        candidateChain: selection.candidateChain.map((pin) => {
          const candidate = candidates.get(pin.id);
          if (!candidate)
            throw new Error(`Missing fixture candidate ${pin.id}.`);
          return {
            id: pin.id,
            sha256: candidateContentSha256(candidate, manifest),
          };
        }),
      },
    ]),
  );
  const core = {
    format: profile.format,
    id: `${profile.id}-repinned-test`,
    vocabulary: profile.vocabulary,
    selections,
  };
  return { ...core, contentSha256: soundObjectContentSha256(core) };
}

describe("expressive sound resolution", () => {
  it("executes the pinned SFZ wind pilots with multipoint phrase contours", () => {
    const compiled = compileAir(windPilotAir as unknown as AirSource).compiled!;
    const plan = createPerformancePlan(compiled, {
      performanceBinding: E_VSCO_WIND_PILOT_PERFORMANCE_BINDING,
    });
    expect(plan.voices.map((voice) => voice.candidateId).sort()).toEqual([
      "clarinet-vsco-suslong-sfz-pilot",
      "flute-vsco-susnv-sfz-pilot",
    ]);
    expect(plan.requiredAssets.length).toBeGreaterThan(0);
    expect(plan.requiredAssets.length).toBeLessThan(52);
    expect(plan.requiredAssets.every((asset) => asset.kind === "wav")).toBe(
      true,
    );
    const fluteVelocities = plan.events
      .filter((event) => event.voiceId === "flute")
      .map((event) => event.noteOnVelocity);
    expect(Math.max(...fluteVelocities)).toBeGreaterThan(fluteVelocities[0]!);
    expect(fluteVelocities.at(-1)).toBeLessThan(Math.max(...fluteVelocities));
  });

  it("resolves a sampler attack and exact sparse asset closure before adapters", () => {
    const plan = createPerformancePlan(compile("C4/1"), {
      performanceBinding: bindingFor(G3B_VCSL_LISTENING_SOUND_PROFILE),
    });

    expect(plan.voices[0]).toMatchObject({
      candidateId: "warm-piano-vcsl-kawai-c4",
      engine: "sampler",
      fallbackUsed: false,
    });
    expect(plan.events[0]?.sample).toMatchObject({
      candidateId: "warm-piano-vcsl-kawai-c4",
      regionId: "warm-piano-vcsl-kawai-c4-main",
      attackAssetId: "vcsl-kawai-piano-c4-rr1",
      requestedArticulation: "none",
      resolvedArticulation: "none",
      rootMidi: 60,
      playbackRate: 1,
    });
    expect(plan.requiredAssets).toEqual([
      expect.objectContaining({
        assetId: "vcsl-kawai-piano-c4-rr1",
        sha256:
          "69845de40a38ed6501746520f9f385ae56200a4372faed48178e64a32a75e58c",
      }),
    ]);
  });

  it("falls back once for the whole identity rather than mixing candidates per note", () => {
    const plan = createPerformancePlan(compile("C2/2 C4/2"), {
      performanceBinding: bindingFor(G3B_VCSL_LISTENING_SOUND_PROFILE),
    });
    expect(plan.voices[0]).toMatchObject({
      candidateId: "warm-piano-generaluser",
      engine: "soundfont",
      fallbackUsed: true,
    });
    expect(plan.events.every((event) => event.sample === undefined)).toBe(true);
    expect(plan.requiredAssets.map((asset) => asset.assetId)).toEqual([
      "generaluser-gs-2.0.3",
    ]);
  });

  it("rejects incomplete strict coverage", () => {
    const strictCore = {
      format: G3B_VCSL_LISTENING_SOUND_PROFILE.format,
      id: "strict-vcsl-test",
      vocabulary: G3B_VCSL_LISTENING_SOUND_PROFILE.vocabulary,
      selections: {
        ...G3B_VCSL_LISTENING_SOUND_PROFILE.selections,
        warm_piano: {
          candidateChain: [
            G3B_VCSL_LISTENING_SOUND_PROFILE.selections.warm_piano!
              .candidateChain[0]!,
          ],
          fallbackPolicy: "strict" as const,
        },
      },
    };
    const strict: SoundProfile = {
      ...strictCore,
      contentSha256: soundObjectContentSha256(strictCore),
    };
    expect(() =>
      createPerformancePlan(compile("C2/2 C4/2"), {
        performanceBinding: bindingFor(strict),
      }),
    ).toThrow(/does not cover/);
  });

  it("selects round robin by stable attack identity, never playback history", () => {
    const testManifest = structuredClone(SOUND_REGISTRY) as SoundpackManifest;
    const candidate = testManifest.candidates.find(
      (item) => item.id === "warm-piano-vcsl-kawai-c4",
    )!;
    if (candidate.mapping.type !== "sample-map")
      throw new Error("Fixture candidate must be a sample map.");
    const base = candidate.mapping.regions[0]!;
    candidate.mapping.regions = [
      {
        ...base,
        id: "piano-rr-0",
        roundRobin: { group: "main", index: 0, count: 2 },
      },
      {
        ...base,
        id: "piano-rr-1",
        roundRobin: { group: "main", index: 1, count: 2 },
      },
    ];
    testManifest.contentSha256 = soundObjectContentSha256(testManifest);
    const testProfile = repinProfile(
      G3B_VCSL_LISTENING_SOUND_PROFILE,
      testManifest,
    );
    const first = createPerformancePlan(compile("C4/4 C4/4 C4/4 C4/4"), {
      performanceBinding: bindingFor(testProfile, testManifest),
      soundRegistry: testManifest,
    });
    const second = createPerformancePlan(compile("C4/4 C4/4 C4/4 C4/4"), {
      performanceBinding: bindingFor(testProfile, testManifest),
      soundRegistry: testManifest,
    });
    expect(first.events.map((event) => event.sample?.regionId)).toEqual(
      second.events.map((event) => event.sample?.regionId),
    );
    expect(first.events.map((event) => event.sample?.roundRobinIndex)).toEqual(
      second.events.map((event) => event.sample?.roundRobinIndex),
    );
    const indexes = first.events.map(
      (event) => event.sample?.roundRobinIndex ?? -1,
    );
    expect(indexes).toHaveLength(4);
    for (let index = 1; index < indexes.length; index += 1) {
      expect(indexes[index]).toBe((indexes[index - 1]! + 1) % 2);
    }

    const unrelatedCatalogChange = structuredClone(
      testManifest,
    ) as SoundpackManifest;
    const unrelated = structuredClone(
      unrelatedCatalogChange.candidates.find(
        (item) => item.id === "harp-generaluser",
      )!,
    );
    unrelated.id = "unrelated-harp-color";
    unrelatedCatalogChange.candidates.push(unrelated);
    unrelatedCatalogChange.contentSha256 = soundObjectContentSha256(
      unrelatedCatalogChange,
    );
    const afterUnrelatedChange = createPerformancePlan(
      compile("C4/4 C4/4 C4/4 C4/4"),
      {
        performanceBinding: bindingFor(testProfile, unrelatedCatalogChange),
        soundRegistry: unrelatedCatalogChange,
      },
    );
    expect(
      afterUnrelatedChange.events.map((event) => event.sample?.roundRobinIndex),
    ).toEqual(first.events.map((event) => event.sample?.roundRobinIndex));
    expect(afterUnrelatedChange.soundpack).toEqual(first.soundpack);
  });

  it("resolves the acoustic percussion kit without loading the GM bank", () => {
    const plan = createPerformancePlan(
      compileInstrument(
        "soft_percussion",
        "C2/4 D2/4 F#2/4 A#2/4 | C#3/2 D#3/2",
      ),
      {
        performanceBinding: bindingFor(G3B_VCSL_LISTENING_SOUND_PROFILE),
      },
    );
    expect(plan.voices[0]).toMatchObject({
      candidateId: "soft-percussion-vcsl-acoustic-kit",
      engine: "sampler",
      fallbackUsed: false,
    });
    expect(
      plan.requiredAssets.some((asset) => asset.kind === "soundfont"),
    ).toBe(false);
    const eventAssets = [
      ...new Set(
        plan.events.flatMap((event) =>
          event.sample
            ? [
                event.sample.attackAssetId,
                ...(event.sample.releaseSample
                  ? [event.sample.releaseSample.assetId]
                  : []),
              ]
            : [],
        ),
      ),
    ].sort();
    expect(plan.requiredAssets.map((asset) => asset.assetId)).toEqual(
      eventAssets,
    );
    expect(
      plan.requiredAssets.reduce((total, asset) => total + asset.bytes, 0),
    ).toBeLessThan(32_319_396);
    expect(
      plan.events
        .filter((event) => [36, 38, 42, 46].includes(event.midi))
        .every((event) => event.sample?.roundRobinIndex !== undefined),
    ).toBe(true);
  });

  it("carries an explicit sustain loop into the resolved plan and falls back as one identity outside coverage", () => {
    const candidate = createPerformancePlan(
      compileInstrument("chamber_strings", "C5/1"),
      {
        performanceBinding: bindingFor(G3B_VCSL_LISTENING_SOUND_PROFILE),
      },
    );
    expect(candidate.voices[0]?.candidateId).toBe(
      "chamber-strings-vsco-loop-probe",
    );
    expect(candidate.events[0]?.sample?.loop).toEqual({
      mode: "sustain",
      startFrame: 88_200,
      endFrame: 352_800,
      crossfadeFrames: 4_410,
    });
    expect(candidate.requiredAssets.map((asset) => asset.assetId)).toEqual([
      "vsco2-violin-section-susvib-c4",
    ]);

    const fallback = createPerformancePlan(
      compileInstrument("chamber_strings", "C4/1 | C5/1"),
      {
        performanceBinding: bindingFor(G3B_VCSL_LISTENING_SOUND_PROFILE),
      },
    );
    expect(fallback.voices[0]).toMatchObject({
      candidateId: "chamber-strings-generaluser",
      fallbackUsed: true,
    });
    expect(fallback.requiredAssets.map((asset) => asset.assetId)).toEqual([
      "generaluser-gs-2.0.3",
    ]);
  });
});
