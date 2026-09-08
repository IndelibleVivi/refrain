import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  G3A_AUDITION_SOUND_PROFILE,
  G3B_VCSL_LISTENING_SOUND_PROFILE,
  INSTRUMENTS,
  INSTRUMENT_VOCABULARY,
  LISTENING_DECISIONS,
  SOUND_ASSETS,
  SOUND_REGISTRY,
  canonicalSoundObjectJson,
  candidateById,
  instrumentById,
  soundObjectContentSha256,
  validateSoundProfile,
  validateSoundpackManifest,
  validateSynthPatch,
  type SoundProfile,
} from "./index.js";

describe("soundpack", () => {
  it("pins vocabulary and manifest identities to their canonical content", () => {
    const digest = (value: unknown) =>
      createHash("sha256")
        .update(canonicalSoundObjectJson(value))
        .digest("hex");
    expect(INSTRUMENT_VOCABULARY.contentSha256).toBe(
      digest(INSTRUMENT_VOCABULARY),
    );
    expect(SOUND_REGISTRY.contentSha256).toBe(digest(SOUND_REGISTRY));
  });

  it("keeps model-facing identity independent from rendering engines and defaults", () => {
    expect(new Set(INSTRUMENTS.map((item) => item.id)).size).toBe(
      INSTRUMENTS.length,
    );
    expect(INSTRUMENTS.every((item) => !("gainDb" in item))).toBe(true);
    expect(INSTRUMENT_VOCABULARY.format).toBe(
      "refrain-instrument-vocabulary@0-experimental",
    );
    expect(instrumentById.get("warm_piano")).toMatchObject({
      family: "pitched",
      midiMin: 21,
      midiMax: 108,
    });
    expect(instrumentById.get("warm_piano")).not.toHaveProperty("kind");
    expect(instrumentById.get("warm_piano")).not.toHaveProperty(
      "defaultCandidateId",
    );
    expect(instrumentById.get("warm_piano")).not.toHaveProperty("candidates");
  });

  it("keeps implementation candidates and objective evidence in soundpack v1", () => {
    expect(SOUND_REGISTRY.format).toBe("refrain-soundpack@1-experimental");
    expect(SOUND_REGISTRY).not.toHaveProperty("instruments");
    expect(
      SOUND_ASSETS.every(
        (asset) =>
          /^[0-9a-f]{40}$/.test(asset.source.ref) ||
          (/^[0-9a-f]{64}$/.test(asset.source.ref) &&
            asset.source.container?.sha256 === asset.source.ref),
      ),
    ).toBe(true);
    expect(
      SOUND_ASSETS.every(
        (asset) =>
          asset.sha256.length === 64 &&
          asset.processingHistory.length > 0 &&
          asset.license.path.length > 0,
      ),
    ).toBe(true);
    expect(candidateById.get("warm-piano-generaluser")).toMatchObject({
      instrumentId: "warm_piano",
      engine: "soundfont",
      mapping: { type: "program", program: 0 },
    });
    expect(candidateById.get("warm-piano-vcsl-kawai-c4")).toMatchObject({
      instrumentId: "warm_piano",
      engine: "sampler",
      mapping: { type: "sample-map" },
      releaseStatus: "listening-accepted",
    });
    expect(
      LISTENING_DECISIONS.find(
        (decision) => decision.candidateId === "warm-piano-vcsl-kawai-c4",
      ),
    ).toMatchObject({ decision: "accepted", decidedBy: "Faye" });
  });

  it("accepts only the two closed versioned synth patch families", () => {
    const patches = SOUND_REGISTRY.candidates
      .filter((candidate) => candidate.engine === "synth")
      .map((candidate) => candidate.patch!);
    expect(new Set(patches.map((patch) => patch.format))).toEqual(
      new Set([
        "refrain-synth-modal@0-experimental",
        "refrain-synth-subtractive@0-experimental",
      ]),
    );
    expect(patches).toHaveLength(8);
    expect(patches.flatMap(validateSynthPatch)).toEqual([]);
    expect(
      validateSynthPatch({
        ...patches.find(
          (patch) =>
            patch.format === "refrain-synth-subtractive@0-experimental",
        ),
        mutableEngineDefault: true,
      }),
    ).toContain("Subtractive synth patch must use its closed contract.");
    expect(
      validateSynthPatch({
        format: "legacy-unversioned",
        attack: 0,
        release: 1,
      }),
    ).toContain("Unknown synth patch format.");
  });

  it("pins current audition behavior in one profile and keeps VCSL fallback whole-identity", () => {
    expect(
      G3A_AUDITION_SOUND_PROFILE.selections.warm_piano?.candidateChain[0]?.id,
    ).toBe("warm-piano-generaluser");
    expect(
      G3B_VCSL_LISTENING_SOUND_PROFILE.selections.warm_piano?.candidateChain.map(
        (pin) => pin.id,
      ),
    ).toEqual(["warm-piano-vcsl-kawai-c4", "warm-piano-generaluser"]);
    expect(
      G3B_VCSL_LISTENING_SOUND_PROFILE.selections.warm_piano?.fallbackPolicy,
    ).toBe("whole-identity-audition");
    expect(validateSoundProfile(G3A_AUDITION_SOUND_PROFILE)).toEqual([]);
    expect(validateSoundProfile(G3B_VCSL_LISTENING_SOUND_PROFILE)).toEqual([]);
  });

  it("rejects hidden hybrid fallback and candidate ownership errors", () => {
    const strictCore = {
      format: G3A_AUDITION_SOUND_PROFILE.format,
      id: "invalid-strict-chain",
      vocabulary: G3A_AUDITION_SOUND_PROFILE.vocabulary,
      selections: {
        ...G3A_AUDITION_SOUND_PROFILE.selections,
        warm_piano: {
          candidateChain:
            G3B_VCSL_LISTENING_SOUND_PROFILE.selections.warm_piano!
              .candidateChain,
          fallbackPolicy: "strict" as const,
        },
      },
    };
    const invalidStrict: SoundProfile = {
      ...strictCore,
      contentSha256: soundObjectContentSha256(strictCore),
    };
    expect(validateSoundProfile(invalidStrict)).toContain(
      "Strict selection for warm_piano must contain exactly one candidate.",
    );

    const wrongOwnerCore = {
      format: G3A_AUDITION_SOUND_PROFILE.format,
      id: "wrong-owner",
      vocabulary: G3A_AUDITION_SOUND_PROFILE.vocabulary,
      selections: {
        ...G3A_AUDITION_SOUND_PROFILE.selections,
        warm_piano: {
          candidateChain: [
            G3A_AUDITION_SOUND_PROFILE.selections.harp!.candidateChain[0]!,
          ],
          fallbackPolicy: "strict" as const,
        },
      },
    };
    const wrongOwner: SoundProfile = {
      ...wrongOwnerCore,
      contentSha256: soundObjectContentSha256(wrongOwnerCore),
    };
    expect(validateSoundProfile(wrongOwner)).toContain(
      "Candidate harp-generaluser does not implement warm_piano.",
    );
  });

  it("rejects unknown fallback policy and extra nested SoundProfile fields", () => {
    const openProfile = {
      ...G3A_AUDITION_SOUND_PROFILE,
      unexpected: true,
      vocabulary: {
        ...G3A_AUDITION_SOUND_PROFILE.vocabulary,
        mutableAlias: "current",
      },
      selections: {
        ...G3A_AUDITION_SOUND_PROFILE.selections,
        warm_piano: {
          ...G3A_AUDITION_SOUND_PROFILE.selections.warm_piano!,
          fallbackPolicy: "whole-identity-audtion",
          permitAnything: true,
        },
      },
    } as unknown as SoundProfile;
    expect(validateSoundProfile(openProfile)).toEqual(
      expect.arrayContaining([
        "SoundProfile must use the closed current contract.",
        "SoundProfile vocabulary reference must use the closed current contract.",
        "Selection for warm_piano must use the closed current contract.",
        "Selection for warm_piano has invalid fallback policy whole-identity-audtion.",
      ]),
    );
  });

  it("rejects ambiguous regions, broken round robin, bad loops, and release gaps", () => {
    const overlap = structuredClone(SOUND_REGISTRY);
    const overlapCandidate = overlap.candidates.find(
      (item) => item.id === "warm-piano-vcsl-kawai-c4",
    )!;
    if (overlapCandidate.mapping.type !== "sample-map")
      throw new Error("Expected a sample-map fixture.");
    const base = overlapCandidate.mapping.regions[0]!;
    overlapCandidate.mapping.regions.push({ ...base, id: "ambiguous-copy" });
    expect(validateSoundpackManifest(overlap)).toContain(
      "Candidate warm-piano-vcsl-kawai-c4 has overlapping attack regions warm-piano-vcsl-kawai-c4-main and ambiguous-copy.",
    );

    const releaseOverlap = structuredClone(SOUND_REGISTRY);
    const releaseOverlapCandidate = releaseOverlap.candidates.find(
      (item) => item.id === "warm-piano-vcsl-kawai-c4",
    )!;
    if (releaseOverlapCandidate.mapping.type !== "sample-map")
      throw new Error("Expected a sample-map fixture.");
    const releaseBase = releaseOverlapCandidate.mapping.regions[0]!;
    releaseOverlapCandidate.mapping.regions.push(
      {
        ...releaseBase,
        id: "release-one",
        trigger: "release",
        loop: { mode: "none" },
        release: undefined,
      },
      {
        ...releaseBase,
        id: "release-two",
        trigger: "release",
        loop: { mode: "none" },
        release: undefined,
      },
    );
    expect(validateSoundpackManifest(releaseOverlap)).toContain(
      "Candidate warm-piano-vcsl-kawai-c4 has overlapping release regions release-one and release-two.",
    );

    const missingSampleRelease = structuredClone(SOUND_REGISTRY);
    const missingSampleReleaseCandidate = missingSampleRelease.candidates.find(
      (item) => item.id === "warm-piano-vcsl-kawai-c4",
    )!;
    if (missingSampleReleaseCandidate.mapping.type !== "sample-map")
      throw new Error("Expected a sample-map fixture.");
    missingSampleReleaseCandidate.mapping.regions[0]!.release = {
      mode: "sample",
    };
    expect(validateSoundpackManifest(missingSampleRelease)).toContain(
      "Attack region warm-piano-vcsl-kawai-c4-main has no complete matching release-region coverage.",
    );

    const roundRobin = structuredClone(SOUND_REGISTRY);
    const rrCandidate = roundRobin.candidates.find(
      (item) => item.id === "warm-piano-vcsl-kawai-c4",
    )!;
    if (rrCandidate.mapping.type !== "sample-map")
      throw new Error("Expected a sample-map fixture.");
    rrCandidate.mapping.regions[0]!.roundRobin = {
      group: "main",
      index: 0,
      count: 2,
    };
    expect(validateSoundpackManifest(roundRobin)).toContain(
      "Candidate warm-piano-vcsl-kawai-c4 has an incomplete round-robin group main.",
    );

    const loop = structuredClone(SOUND_REGISTRY);
    const loopCandidate = loop.candidates.find(
      (item) => item.id === "warm-piano-vcsl-kawai-c4",
    )!;
    if (loopCandidate.mapping.type !== "sample-map")
      throw new Error("Expected a sample-map fixture.");
    loopCandidate.mapping.regions[0]!.loop = {
      mode: "sustain",
      startFrame: 100,
      endFrame: 900_000,
    };
    expect(validateSoundpackManifest(loop)).toContain(
      "Region warm-piano-vcsl-kawai-c4-main has invalid sustain-loop frames.",
    );

    const release = structuredClone(SOUND_REGISTRY);
    const releaseCandidate = release.candidates.find(
      (item) => item.id === "warm-piano-vcsl-kawai-c4",
    )!;
    releaseCandidate.releaseStatus = "release-candidate";
    expect(validateSoundpackManifest(release)).toEqual(
      expect.arrayContaining([
        "Release candidate warm-piano-vcsl-kawai-c4 must cover the complete warm_piano range.",
        expect.stringContaining(
          "Release candidate warm-piano-vcsl-kawai-c4 has a coverage gap",
        ),
      ]),
    );

    const percussion = structuredClone(SOUND_REGISTRY);
    const percussionCandidate = percussion.candidates.find(
      (item) => item.id === "soft-percussion-vcsl-acoustic-kit",
    )!;
    percussionCandidate.releaseStatus = "release-candidate";
    expect(
      validateSoundpackManifest(percussion).filter((error) =>
        error.includes("soft-percussion-vcsl-acoustic-kit has a coverage gap"),
      ),
    ).toEqual([]);
  });
});
