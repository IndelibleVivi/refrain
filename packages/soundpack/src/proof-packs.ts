import {
  F_ACOUSTIC_CHAMBER_SOUND_PROFILE,
  F_SYNTHETIC_BEAT_SOUND_PROFILE,
  SOUND_REGISTRY,
  type SoundProfileSelection,
} from "./index.js";
import { CANDIDATE_SHARDS } from "./factory.js";
import {
  CORE_AUTHORING_VOCABULARY,
  createExtensionPack,
  createPaletteRecipe,
  createRenderSceneV1,
  createSoundProfileV2,
  type ExtensionPack,
  type PaletteRecipe,
  type RenderSceneV1,
  type SoundProfileV2,
} from "./vnext.js";

function selectionsOf(
  profile: { selections: Readonly<Record<string, SoundProfileSelection>> },
  instrumentIds: readonly string[],
): Record<string, SoundProfileSelection> {
  return Object.fromEntries(
    instrumentIds.map((instrumentId) => {
      const selection = profile.selections[instrumentId];
      if (!selection)
        throw new Error(`Proof pack profile is missing ${instrumentId}.`);
      return [instrumentId, selection];
    }),
  );
}

function proofPack(input: {
  id: string;
  label: string;
  profile: SoundProfileV2;
  scene: RenderSceneV1;
  recipe: PaletteRecipe;
}): ExtensionPack {
  const candidatePins = Object.values(input.profile.selections).flatMap(
    (selection) => selection.candidateChain,
  );
  const shards = candidatePins.map((pin) => {
    const shard = CANDIDATE_SHARDS.find(
      (candidate) => candidate.candidateContentSha256 === pin.sha256,
    );
    if (!shard)
      throw new Error(`Proof pack cannot find candidate shard ${pin.id}.`);
    return shard;
  });
  const assets = new Map<
    string,
    { id: string; sha256: string; bytes: number }
  >();
  for (const shard of shards)
    for (const asset of shard.assets)
      assets.set(asset.id, {
        id: asset.id,
        sha256: asset.sha256,
        bytes: asset.bytes,
      });
  return createExtensionPack({
    id: input.id,
    version: "0.0.1",
    label: input.label,
    modules: [
      ...shards.map((shard) => ({
        kind: "candidate-shard" as const,
        id: shard.id,
        sha256: shard.contentSha256,
      })),
      {
        kind: "sound-profile",
        id: input.profile.id,
        sha256: input.profile.contentSha256,
      },
      {
        kind: "render-scene",
        id: input.scene.id,
        sha256: input.scene.contentSha256,
      },
      {
        kind: "palette-recipe",
        id: input.recipe.id,
        sha256: input.recipe.contentSha256,
      },
    ],
    assets: [...assets.values()],
  });
}

export const ACOUSTIC_COLORS_PROFILE: SoundProfileV2 = createSoundProfileV2({
  id: "refrain-acoustic-colors@2",
  vocabulary: CORE_AUTHORING_VOCABULARY,
  selections: selectionsOf(F_ACOUSTIC_CHAMBER_SOUND_PROFILE, [
    "warm_piano",
    "nylon_guitar",
    "solo_cello",
    "clarinet",
  ]),
  manifest: SOUND_REGISTRY,
});

export const ACOUSTIC_COLORS_SCENE: RenderSceneV1 = createRenderSceneV1({
  id: "refrain-acoustic-colors-room@1",
  master: { gainDb: -11, peakCeiling: 0.72, velocityScale: 1 },
  buses: [
    {
      id: "chamber",
      output: "master",
      processors: [
        { id: "place", type: "gain-pan", gainDb: -1.5, pan: 0, width: 1.15 },
        { id: "air", type: "lowpass", frequencyHz: 13_000, q: 0.72 },
        { id: "room", type: "room", decaySeconds: 1.35, mix: 0.18 },
      ],
    },
  ],
  routes: [{ id: "all", bus: "chamber", match: {} }],
});

export const ACOUSTIC_COLORS_RECIPE: PaletteRecipe = createPaletteRecipe({
  id: "refrain-acoustic-colors@0",
  profile: {
    id: ACOUSTIC_COLORS_PROFILE.id,
    sha256: ACOUSTIC_COLORS_PROFILE.contentSha256,
  },
  scene: {
    id: ACOUSTIC_COLORS_SCENE.id,
    sha256: ACOUSTIC_COLORS_SCENE.contentSha256,
  },
  authoringGuide:
    "Write with breath, register, decay and handoff: piano and nylon articulate the room, cello and clarinet carry relation rather than doubling a generic melody.",
  descriptors: ["acoustic", "chamber", "breathing", "resonant"],
});

export const ACOUSTIC_COLORS_PROOF_PACK: ExtensionPack = proofPack({
  id: "refrain-acoustic-colors@0",
  label: "Refrain Acoustic Colors",
  profile: ACOUSTIC_COLORS_PROFILE,
  scene: ACOUSTIC_COLORS_SCENE,
  recipe: ACOUSTIC_COLORS_RECIPE,
});

export const SYNTHETIC_SPICES_PROFILE: SoundProfileV2 = createSoundProfileV2({
  id: "refrain-synthetic-spices@2",
  vocabulary: CORE_AUTHORING_VOCABULARY,
  selections: selectionsOf(F_SYNTHETIC_BEAT_SOUND_PROFILE, [
    "air_pad",
    "glass_bell",
    "sub_bass",
    "lattice_pluck",
    "prism_lead",
    "dust_texture",
    "rhythm_pulse",
  ]),
  manifest: SOUND_REGISTRY,
});

export const SYNTHETIC_SPICES_SCENE: RenderSceneV1 = createRenderSceneV1({
  id: "refrain-synthetic-spices-room@1",
  master: { gainDb: -13, peakCeiling: 0.64, velocityScale: 1.02 },
  buses: [
    {
      id: "pulse",
      output: "master",
      processors: [
        { id: "weight", type: "saturation", drive: 2.4, mix: 0.2 },
        { id: "echo", type: "delay", delayMs: 92, feedback: 0.22, mix: 0.12 },
      ],
    },
    {
      id: "air",
      output: "master",
      processors: [
        { id: "soften", type: "lowpass", frequencyHz: 9_500, q: 0.68 },
        { id: "space", type: "room", decaySeconds: 1.8, mix: 0.22 },
      ],
    },
  ],
  routes: [
    {
      id: "pulse",
      bus: "pulse",
      match: { instrumentIds: ["sub_bass", "rhythm_pulse", "lattice_pluck"] },
    },
    { id: "air", bus: "air", match: {} },
  ],
});

export const SYNTHETIC_SPICES_RECIPE: PaletteRecipe = createPaletteRecipe({
  id: "refrain-synthetic-spices@0",
  profile: {
    id: SYNTHETIC_SPICES_PROFILE.id,
    sha256: SYNTHETIC_SPICES_PROFILE.contentSha256,
  },
  scene: {
    id: SYNTHETIC_SPICES_SCENE.id,
    sha256: SYNTHETIC_SPICES_SCENE.contentSha256,
  },
  authoringGuide:
    "Let pulse answer rather than dominate. Use bell, pluck, pad, lead and dust as distinct relational gestures; silence and register separation remain part of the arrangement.",
  descriptors: ["synthetic", "pulse", "glass", "air", "textured"],
});

export const SYNTHETIC_SPICES_PROOF_PACK: ExtensionPack = proofPack({
  id: "refrain-synthetic-spices@0",
  label: "Refrain Synthetic Spices",
  profile: SYNTHETIC_SPICES_PROFILE,
  scene: SYNTHETIC_SPICES_SCENE,
  recipe: SYNTHETIC_SPICES_RECIPE,
});

export const PROOF_EXTENSION_PACKS = Object.freeze([
  ACOUSTIC_COLORS_PROOF_PACK,
  SYNTHETIC_SPICES_PROOF_PACK,
]);
