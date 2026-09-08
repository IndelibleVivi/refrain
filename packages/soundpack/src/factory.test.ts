import { describe, expect, it } from "vitest";
import {
  BUILT_IN_PERFORMANCE_BINDINGS,
  BUILT_IN_SOUND_PROFILES,
  DEFAULT_RENDER_SCENE,
  INSTRUMENT_VOCABULARY,
  SOUND_REGISTRY,
  candidateContentSha256,
  createPerformanceBinding,
  soundObjectContentSha256,
  validatePerformanceBinding,
  validateSoundProfile,
  type SoundpackManifest,
  type SoundProfile,
} from "./index.js";
import {
  CANDIDATE_SHARDS,
  SHARD_CANDIDATE_PROVIDER,
  SOUND_CATALOG,
  ShardCandidateProvider,
  collectCandidateFullClosure,
  collectPaletteFullClosure,
  collectProfileFullClosure,
  resolveSoundpackClosure,
  validateCandidateShard,
  validateSoundCatalog,
  type CandidateShard,
  type SoundCatalog,
} from "./factory.js";

describe("source-plural sound factory", () => {
  it("validates the lightweight catalog, immutable shards, and canonical profiles", () => {
    expect(validateSoundCatalog(SOUND_CATALOG)).toEqual([]);
    for (const shard of CANDIDATE_SHARDS)
      expect(validateCandidateShard(shard)).toEqual([]);
    for (const profile of BUILT_IN_SOUND_PROFILES)
      expect(
        validateSoundProfile(profile, SHARD_CANDIDATE_PROVIDER.registry()),
      ).toEqual([]);
    expect(SHARD_CANDIDATE_PROVIDER.registry()).toEqual(SOUND_REGISTRY);
  });

  it("resolves every binding pin directly from its immutable shard", () => {
    for (const binding of BUILT_IN_PERFORMANCE_BINDINGS) {
      for (const [id, sha256] of Object.entries(binding.candidateDigests)) {
        const resolved = SHARD_CANDIDATE_PROVIDER.resolveExact({ id, sha256 });
        expect(resolved.candidate.id).toBe(id);
        expect(resolved.pin.sha256).toBe(sha256);
        expect(resolved.shard.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });

  it("builds one exact scoped closure for profile, palette, binding, and execution", () => {
    const profile = BUILT_IN_SOUND_PROFILES[0]!;
    const closure = collectProfileFullClosure(
      profile,
      SHARD_CANDIDATE_PROVIDER,
    );
    const resolved = resolveSoundpackClosure(profile, SHARD_CANDIDATE_PROVIDER);
    const binding = createPerformanceBinding(
      {
        id: "source-plural-direct@0",
        soundProfile: profile,
        renderScene: DEFAULT_RENDER_SCENE,
      },
      resolved,
    );
    expect(validatePerformanceBinding(binding, resolved)).toEqual([]);
    expect(binding.candidateDigests).toEqual(
      Object.fromEntries(
        closure.candidatePins.map((pin) => [pin.id, pin.sha256]),
      ),
    );
    const builtIn = BUILT_IN_PERFORMANCE_BINDINGS.find(
      (candidate) => candidate.soundPalette,
    )!;
    expect(
      collectPaletteFullClosure(
        builtIn.soundPalette!,
        builtIn,
        SHARD_CANDIDATE_PROVIDER,
      ).candidatePins,
    ).toEqual(
      collectProfileFullClosure(builtIn.soundProfile, SHARD_CANDIDATE_PROVIDER)
        .candidatePins,
    );
  });

  it("derives candidate closure without profile or catalog-wide assets", () => {
    const entry = SOUND_CATALOG.candidates.find(
      (candidate) => candidate.candidateId === "air-pad-subtractive-original",
    )!;
    const closure = collectCandidateFullClosure(
      {
        id: entry.candidateId,
        sha256: entry.candidateContentSha256,
      },
      SHARD_CANDIDATE_PROVIDER,
    );
    expect(closure.candidatePins).toHaveLength(1);
    expect(closure.shards).toHaveLength(1);
    expect(closure.assets).toEqual([]);
    expect(closure.bytes).toBe(0);
  });

  it("keeps profile and scoped closure identity invariant under unrelated catalog growth", () => {
    const profile = BUILT_IN_SOUND_PROFILES[0]!;
    const original = resolveSoundpackClosure(profile, SHARD_CANDIDATE_PROVIDER);
    const base = structuredClone(
      CANDIDATE_SHARDS.find(
        (shard) => shard.id === "air-pad-subtractive-original",
      )!,
    );
    base.id = "unrelated-texture-pilot";
    base.candidate.id = base.id;
    const validationCore = {
      format: "refrain-soundpack@1-experimental" as const,
      id: "unrelated-shard-validation",
      status: "development-candidates" as const,
      assets: base.assets,
      candidates: [base.candidate],
    };
    const validationManifest: SoundpackManifest = {
      ...validationCore,
      contentSha256: soundObjectContentSha256(validationCore),
    };
    base.candidateContentSha256 = candidateContentSha256(
      base.candidate,
      validationManifest,
    );
    base.contentSha256 = soundObjectContentSha256(base);
    const addedShard = base as CandidateShard;
    expect(validationManifest.candidates[0]?.id).toBe(addedShard.id);
    const catalogCore = {
      format: SOUND_CATALOG.format,
      id: SOUND_CATALOG.id,
      candidates: [
        ...SOUND_CATALOG.candidates,
        {
          candidateId: addedShard.id,
          instrumentId: addedShard.candidate.instrumentId,
          engine: addedShard.candidate.engine,
          releaseStatus: addedShard.candidate.releaseStatus,
          candidateContentSha256: addedShard.candidateContentSha256,
          shard: {
            path: `./candidates/sha256/${addedShard.contentSha256}.json`,
            sha256: addedShard.contentSha256,
          },
        },
      ],
    };
    const expandedCatalog: SoundCatalog = {
      ...catalogCore,
      contentSha256: soundObjectContentSha256(catalogCore),
    };
    const expanded = new ShardCandidateProvider(expandedCatalog, [
      ...CANDIDATE_SHARDS,
      addedShard,
    ]);
    expect(expandedCatalog.contentSha256).not.toBe(SOUND_CATALOG.contentSha256);
    expect(resolveSoundpackClosure(profile, expanded)).toEqual(original);
  });

  it("fails closed on false pins and open nested profile fields", () => {
    const falsePin = structuredClone(BUILT_IN_SOUND_PROFILES[0]!);
    falsePin.selections.flute!.candidateChain[0]!.sha256 = "0".repeat(64);
    falsePin.contentSha256 = soundObjectContentSha256(falsePin);
    expect(
      validateSoundProfile(falsePin, SHARD_CANDIDATE_PROVIDER.registry()),
    ).toContain(
      `SoundProfile candidate pin does not match ${falsePin.selections.flute!.candidateChain[0]!.id}.`,
    );

    const open = structuredClone(
      BUILT_IN_SOUND_PROFILES[0]!,
    ) as SoundProfile & {
      selections: Record<string, Record<string, unknown>>;
    };
    open.selections.flute!.mutableAlias = "latest";
    open.contentSha256 = soundObjectContentSha256(open);
    expect(
      validateSoundProfile(open, SHARD_CANDIDATE_PROVIDER.registry()),
    ).toContain("Selection for flute must use the closed current contract.");
  });

  it("keeps four complete F palettes strict and independent of GeneralUser", () => {
    const active = INSTRUMENT_VOCABULARY.instruments
      .filter((instrument) => instrument.status === "active")
      .map((instrument) => instrument.id)
      .sort();
    const bindings = BUILT_IN_PERFORMANCE_BINDINGS.filter((binding) =>
      binding.id.startsWith("f-"),
    );
    expect(bindings).toHaveLength(4);
    for (const binding of bindings) {
      expect(binding.soundPalette?.status).toBe("listening-candidate");
      expect(Object.keys(binding.soundProfile.selections).sort()).toEqual(
        active,
      );
      for (const selection of Object.values(binding.soundProfile.selections)) {
        expect(selection.fallbackPolicy).toBe("strict");
        expect(selection.candidateChain).toHaveLength(1);
        expect(selection.candidateChain[0]!.id).not.toMatch(/generaluser/i);
      }
      expect(binding.soundProfile.selections.flute?.candidateChain[0]?.id).toBe(
        "flute-vsco-susnv-full",
      );
    }
  });
});
