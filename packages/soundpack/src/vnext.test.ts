import { describe, expect, it } from "vitest";
import {
  F_LUMINOUS_HYBRID_SOUND_PROFILE,
  INSTRUMENT_VOCABULARY,
  SOUND_REGISTRY,
  soundObjectContentSha256,
} from "./index.js";
import {
  createAuthoringVocabularyClosure,
  createExtensionPack,
  createExtensionPackV1,
  createPaletteRecipe,
  createPerformanceBindingV1,
  createRenderSceneV1,
  createSoundPaletteV1,
  createSoundProfileV2,
  resolvePaletteRecipe,
  validateAnyExtensionPack,
  validateExtensionPackAuthoringVocabulary,
  validateExtensionPack,
  validateExtensionPackV1,
  validatePerformanceBindingV1,
  validateHistoricalPerformanceBindingV1,
} from "./vnext.js";

describe("extension-pack exact contracts", () => {
  const vocabulary = createAuthoringVocabularyClosure({
    id: "refrain-core-authoring@0",
    instruments: INSTRUMENT_VOCABULARY.instruments,
  });
  const profile = createSoundProfileV2({
    id: "proof-luminous-subset@2",
    vocabulary,
    selections: {
      air_pad: F_LUMINOUS_HYBRID_SOUND_PROFILE.selections.air_pad!,
      prism_lead: F_LUMINOUS_HYBRID_SOUND_PROFILE.selections.prism_lead!,
    },
    manifest: SOUND_REGISTRY,
  });
  const scene = createRenderSceneV1({
    id: "proof-luminous-room@1",
    master: { gainDb: -12, peakCeiling: 0.68, velocityScale: 0.95 },
    buses: [
      {
        id: "music",
        output: "master",
        processors: [
          { id: "soften", type: "lowpass", frequencyHz: 8_000, q: 0.7 },
          { id: "air", type: "room", decaySeconds: 1.2, mix: 0.16 },
        ],
      },
    ],
    routes: [{ id: "all", bus: "music", match: {} }],
  });
  const recipe = createPaletteRecipe({
    id: "proof-luminous@0",
    profile: { id: profile.id, sha256: profile.contentSha256 },
    scene: { id: scene.id, sha256: scene.contentSha256 },
    authoringGuide: "Use breath, register and decay as part of the phrase.",
    descriptors: ["luminous", "breathing"],
  });

  it("rejects re-identified override violations and contradictory palette authorities", () => {
    const palette = createSoundPaletteV1({
      id: "exact-palette@1",
      status: "engineering",
      soundProfile: profile,
      renderScene: scene,
      authoringGuide: "Explicit room.",
    });
    const binding = createPerformanceBindingV1({
      id: "exact-binding@1",
      requiredInstrumentIds: ["air_pad"],
      soundProfile: profile,
      renderScene: scene,
      soundPalette: palette,
      manifest: SOUND_REGISTRY,
    });
    expect(validateHistoricalPerformanceBindingV1(binding)).toEqual([]);
    const reidentify = (value: Record<string, unknown>) => ({
      ...value,
      contentSha256: soundObjectContentSha256(value),
    });
    for (const overrides of [
      { masterGainDb: -5 },
      { imaginary: 1 },
      { velocityScale: "1" },
      { peakCeiling: 2 },
    ]) {
      const bad = reidentify({ ...binding, overrides });
      expect(
        validateHistoricalPerformanceBindingV1(bad).some((e) =>
          e.includes("override"),
        ),
      ).toBe(true);
    }
    const badPermissions = reidentify({
      ...binding,
      permittedOverrides: ["masterGainDb", "masterGainDb"],
    });
    expect(
      validateHistoricalPerformanceBindingV1(badPermissions).some((e) =>
        e.includes("permittedOverrides"),
      ),
    ).toBe(true);
    const badPalette = reidentify({
      ...palette,
      renderScene: { ...palette.renderScene, sha256: "0".repeat(64) },
    });
    const contradicted = reidentify({
      ...binding,
      soundPalette: badPalette,
      soundPaletteSha256: badPalette.contentSha256,
    });
    expect(validateHistoricalPerformanceBindingV1(contradicted)).toContain(
      "SoundPalette@1 scene does not match its binding.",
    );
    const badDigest = reidentify({
      ...binding,
      soundPalette: { ...palette, authoringGuide: "Changed without identity" },
    });
    expect(validateHistoricalPerformanceBindingV1(badDigest)).toContain(
      "SoundPalette@1 content SHA-256 does not match its content.",
    );
  });

  it("keeps sparse profile, scene and recipe identities independent of the pack", () => {
    const pack = createExtensionPack({
      id: "proof-luminous@0",
      version: "0.0.1",
      label: "Luminous proof pack",
      modules: [
        {
          kind: "sound-profile",
          id: profile.id,
          sha256: profile.contentSha256,
        },
        { kind: "render-scene", id: scene.id, sha256: scene.contentSha256 },
        { kind: "palette-recipe", id: recipe.id, sha256: recipe.contentSha256 },
      ],
      assets: [],
    });
    expect(validateExtensionPack(pack)).toEqual([]);
    expect(pack.contentSha256).not.toBe(profile.contentSha256);
    expect(pack.modules.map((module) => module.sha256)).toContain(
      scene.contentSha256,
    );
  });

  it("resolves a recipe once into an exact palette and binding", () => {
    const palette = resolvePaletteRecipe(recipe, profile, scene);
    expect(palette).toEqual(
      createSoundPaletteV1({
        id: recipe.id,
        status: "engineering",
        soundProfile: profile,
        renderScene: scene,
        authoringGuide: recipe.authoringGuide,
        descriptors: recipe.descriptors,
      }),
    );
    const binding = createPerformanceBindingV1({
      id: "proof-luminous@1",
      requiredInstrumentIds: ["air_pad", "prism_lead"],
      soundProfile: profile,
      renderScene: scene,
      soundPalette: palette,
      manifest: SOUND_REGISTRY,
    });
    expect(validatePerformanceBindingV1(binding, SOUND_REGISTRY)).toEqual([]);
    expect(() =>
      createPerformanceBindingV1({
        id: "missing-coverage@1",
        requiredInstrumentIds: ["air_pad", "flute"],
        soundProfile: profile,
        renderScene: scene,
        manifest: SOUND_REGISTRY,
      }),
    ).toThrow(/does not cover flute/);
  });

  it("binds pack-contributed AIR vocabulary definitions only in ExtensionPack@1", () => {
    const authoringVocabulary = {
      format: "refrain-air-vocabulary-closure@0-experimental" as const,
      id: "crooked-meter-language@0",
      contentSha256: "a".repeat(64),
    };
    const pack = createExtensionPackV1({
      id: "crooked-meter-kit@1",
      version: "1.0.0",
      label: "Crooked meter authoring kit",
      modules: [
        {
          kind: "authoring-vocabulary",
          id: authoringVocabulary.id,
          sha256: authoringVocabulary.contentSha256,
        },
      ],
      assets: [],
    });

    expect(validateExtensionPackV1(pack)).toEqual([]);
    expect(validateAnyExtensionPack(pack)).toEqual([]);
    expect(validateExtensionPack(pack)).toContain(
      "Invalid ExtensionPack format.",
    );
    expect(
      validateExtensionPackAuthoringVocabulary(pack, authoringVocabulary),
    ).toEqual([]);
    expect(
      validateExtensionPackAuthoringVocabulary(pack, {
        ...authoringVocabulary,
        contentSha256: "b".repeat(64),
      }),
    ).toContain(
      "ExtensionPack@1 does not contain this exact authoring vocabulary closure.",
    );
  });
});
