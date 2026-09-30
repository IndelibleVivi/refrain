import {
  candidateContentSha256,
  soundObjectContentSha256,
  validateSoundpackManifest,
  type CandidatePin,
  type InstrumentCandidate,
  type InstrumentDefinition,
  type InstrumentVocabulary,
  type SoundAssetDefinition,
  type SoundpackManifest,
} from "./index.js";
import {
  CANDIDATE_SHARD_FORMAT,
  SOUND_CATALOG_FORMAT,
  ShardCandidateProvider,
  validateCandidateShard,
  validateSoundCatalog,
  type CandidateShard,
  type SoundCatalog,
} from "./factory.js";
import {
  CORE_AUTHORING_VOCABULARY,
  createAuthoringVocabularyClosure,
  createExtensionPackV1,
  createPerformanceBindingV1,
  createRenderSceneV1,
  createSoundProfileV2,
  validateExtensionPackV1,
  validatePerformanceBindingV1,
  validateRenderSceneV1,
  validateSoundProfileV2,
  type AuthoringVocabularyClosure,
  type ExtensionPackV1,
  type PerformanceBindingV1,
  type RenderSceneV1,
  type SoundProfileV2,
} from "./vnext.js";
import {
  createAirVocabularyClosure,
  type AirVocabularyClosure,
} from "@refrain/air-schema/v1";

/**
 * Pack-carried archtop-guitar authoring identity.
 *
 * This is the microphone/acoustic side of Karoryfer Shinyguitar only. It is a
 * new identity and is deliberately separate from `nylon_guitar`; it is not a
 * replacement for or an alias of any core instrument, and it does not edit the
 * core instrument vocabulary.
 */
export const ARCHTOP_GUITAR_INSTRUMENT: InstrumentDefinition = {
  id: "archtop_guitar",
  label: "Archtop guitar",
  family: "pitched",
  midiMin: 33,
  midiMax: 91,
  status: "active",
  authoringMeaning:
    "A microphone-captured archtop guitar with a firm plucked attack and short natural decay, distinct from the core nylon_guitar voice.",
};

export const SHINYGUITAR_ACOUSTIC_CANDIDATE_ID =
  "archtop-guitar-shinyguitar-acoustic";
export const SHINYGUITAR_ACOUSTIC_PACK_ID = "refrain-shinyguitar-archtop@0";
export const SHINYGUITAR_VOCABULARY_ID = "refrain-shinyguitar-archtop@0";
export const SHINYGUITAR_AIR_VOCABULARY_ID =
  "refrain-shinyguitar-archtop-language@1";
export const SHINYGUITAR_SOUND_PROFILE_ID = "refrain-shinyguitar-archtop@2";
export const SHINYGUITAR_SCENE_ID = "refrain-shinyguitar-archtop-room@1";
export const SHINYGUITAR_BINDING_ID = "refrain-shinyguitar-archtop@1";
export const SHINYGUITAR_SOURCE = Object.freeze({
  repository: "https://github.com/sfzinstruments/karoryfer.shinyguitar",
  ref: "57243cca85277dbcc120ce17c6178032f93c80f3",
  sfzPath: "Programs/acoustic.sfz",
  sfzSha256: "266d9e6aeeda988590b911f83a5656db5d3f93e9c9ce5cd46de7e2cfea992a2e",
  licensePath: "LICENSE",
  licenseSha256:
    "a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499",
  licenseExpression: "CC0-1.0",
  rawUrlRoot:
    "https://raw.githubusercontent.com/sfzinstruments/karoryfer.shinyguitar/57243cca85277dbcc120ce17c6178032f93c80f3",
});

/**
 * The pack's carried authoring vocabulary: every core instrument entry is
 * preserved exactly and `archtop_guitar` is appended. This closure is what a
 * pack-authored AIR@1 must carry; the core vocabulary file is untouched.
 */
export const SHINYGUITAR_AUTHORING_VOCABULARY: AuthoringVocabularyClosure =
  createAuthoringVocabularyClosure({
    id: SHINYGUITAR_VOCABULARY_ID,
    instruments: [
      ...CORE_AUTHORING_VOCABULARY.instruments,
      ARCHTOP_GUITAR_INSTRUMENT,
    ],
  });

/** Exact AIR@1 closure referenced by ExtensionPack@1 and carried by source. */
export const SHINYGUITAR_AIR_VOCABULARY: AirVocabularyClosure =
  createAirVocabularyClosure({
    id: SHINYGUITAR_AIR_VOCABULARY_ID,
    instruments: SHINYGUITAR_AUTHORING_VOCABULARY.instruments.map(
      (instrument) => ({
        id: instrument.id,
        label: instrument.label,
        family: instrument.family,
        midiMin: instrument.midiMin,
        midiMax: instrument.midiMax,
        status: instrument.status,
        authoringMeaning: instrument.authoringMeaning,
        ...(instrument.supportedNotes === undefined
          ? {}
          : { supportedNotes: [...instrument.supportedNotes] }),
      }),
    ),
    techniques: [],
  });

/**
 * Bridged `InstrumentVocabulary` view of the carried closure so the existing
 * manifest/profile/catalog validators (which take an `InstrumentVocabulary`)
 * can validate pack material without a second authority. The digest is the
 * carried closure digest so both surfaces agree on one identity.
 */
export const SHINYGUITAR_INSTRUMENT_VOCABULARY: InstrumentVocabulary = {
  format: "refrain-instrument-vocabulary@0-experimental",
  id: SHINYGUITAR_AUTHORING_VOCABULARY.id,
  contentSha256: SHINYGUITAR_AUTHORING_VOCABULARY.contentSha256,
  instruments: [...SHINYGUITAR_AUTHORING_VOCABULARY.instruments],
};

export interface ShinyguitarAcousticMaterial {
  candidate: InstrumentCandidate;
  assets: readonly SoundAssetDefinition[];
}

export interface ShinyguitarAcousticPackMaterial {
  vocabulary: AuthoringVocabularyClosure;
  candidateShard: CandidateShard;
  catalog: SoundCatalog;
  soundProfile: SoundProfileV2;
  renderScene: RenderSceneV1;
  binding: PerformanceBindingV1;
  extensionPack: ExtensionPackV1;
}

function manifestOf(
  id: string,
  candidate: InstrumentCandidate,
  assets: readonly SoundAssetDefinition[],
): SoundpackManifest {
  const core = {
    format: "refrain-soundpack@1-experimental" as const,
    id,
    status: "development-candidates" as const,
    assets: [...assets],
    candidates: [candidate],
  };
  return { ...core, contentSha256: soundObjectContentSha256(core) };
}

/**
 * Builds the exact pack material from a compiled Shinyguitar acoustic
 * candidate: the immutable candidate shard, the pack-relative catalog, the
 * sparse SoundProfile@2, a restrained RenderScene@1, the complete Binding@1,
 * and the ExtensionPack@1 module references.
 *
 * The candidate is validated against the carried vocabulary, so a missing or
 * mismatched vocabulary fails closed instead of silently falling back to the
 * core instrument list.
 */
export function createShinyguitarAcousticPack(
  input: ShinyguitarAcousticMaterial,
  options: { version?: string } = {},
): ShinyguitarAcousticPackMaterial {
  const { candidate, assets } = input;
  const manifest = manifestOf(
    `${SHINYGUITAR_ACOUSTIC_PACK_ID}-manifest`,
    candidate,
    assets,
  );
  const manifestErrors = validateSoundpackManifest(
    manifest,
    SHINYGUITAR_INSTRUMENT_VOCABULARY,
  );
  if (manifestErrors.length) throw new Error(manifestErrors.join("\n"));

  const candidateDigest = candidateContentSha256(candidate, manifest);
  const catalogCore = {
    format: SOUND_CATALOG_FORMAT,
    id: `${SHINYGUITAR_ACOUSTIC_PACK_ID}-catalog`,
    candidates: [
      {
        candidateId: candidate.id,
        instrumentId: candidate.instrumentId,
        engine: candidate.engine,
        releaseStatus: candidate.releaseStatus,
        candidateContentSha256: candidateDigest,
        shard: {
          path: `./candidates/sha256/${"0".repeat(64)}.json`,
          sha256: "0".repeat(64),
        },
      },
    ],
  };
  // Placeholder shard path/digest is replaced below once the shard is sealed.
  const soundProfile = createSoundProfileV2({
    id: SHINYGUITAR_SOUND_PROFILE_ID,
    vocabulary: SHINYGUITAR_AUTHORING_VOCABULARY,
    selections: {
      [candidate.instrumentId]: {
        candidateChain: [{ id: candidate.id, sha256: candidateDigest }],
        fallbackPolicy: "strict",
      },
    },
    manifest,
  });
  const profileErrors = validateSoundProfileV2(
    soundProfile,
    manifest,
    SHINYGUITAR_AUTHORING_VOCABULARY,
  );
  if (profileErrors.length) throw new Error(profileErrors.join("\n"));

  const renderScene = createRenderSceneV1({
    id: SHINYGUITAR_SCENE_ID,
    master: { gainDb: -12, peakCeiling: 0.7, velocityScale: 1 },
    buses: [
      {
        id: "guitar",
        output: "master",
        processors: [
          { id: "place", type: "gain-pan", gainDb: -1, pan: 0, width: 1.05 },
          { id: "air", type: "lowpass", frequencyHz: 12_000, q: 0.7 },
        ],
      },
    ],
    routes: [{ id: "all", bus: "guitar", match: {} }],
  });
  const sceneErrors = validateRenderSceneV1(renderScene);
  if (sceneErrors.length) throw new Error(sceneErrors.join("\n"));

  // Seal the shard with the exact content digest so the catalog can reference
  // its real `contentSha256`, never a placeholder.
  const shard = sealCandidateShard(candidate, assets, manifest);
  const catalog = sealCatalog(catalogCore, shard);

  const binding = createPerformanceBindingV1({
    id: SHINYGUITAR_BINDING_ID,
    requiredInstrumentIds: [candidate.instrumentId],
    soundProfile,
    renderScene,
    permittedOverrides: ["masterGainDb", "peakCeiling", "velocityScale"],
    manifest,
  });
  const bindingErrors = validatePerformanceBindingV1(binding, manifest);
  if (bindingErrors.length) throw new Error(bindingErrors.join("\n"));

  const moduleRefs = [
    {
      kind: "authoring-vocabulary" as const,
      id: SHINYGUITAR_AIR_VOCABULARY.id,
      sha256: SHINYGUITAR_AIR_VOCABULARY.contentSha256,
    },
    {
      kind: "candidate-shard" as const,
      id: shard.id,
      sha256: shard.contentSha256,
    },
    {
      kind: "sound-profile" as const,
      id: soundProfile.id,
      sha256: soundProfile.contentSha256,
    },
    {
      kind: "render-scene" as const,
      id: renderScene.id,
      sha256: renderScene.contentSha256,
    },
  ];
  const extensionPack = createExtensionPackV1({
    id: SHINYGUITAR_ACOUSTIC_PACK_ID,
    version: options.version ?? "0.0.1",
    label: "Refrain Shinyguitar Archtop (acoustic)",
    modules: moduleRefs,
    assets: assets
      .map((asset) => ({
        id: asset.id,
        sha256: asset.sha256,
        bytes: asset.bytes,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  });
  const packErrors = validateExtensionPackV1(extensionPack);
  if (packErrors.length) throw new Error(packErrors.join("\n"));

  return Object.freeze({
    vocabulary: structuredClone(SHINYGUITAR_AUTHORING_VOCABULARY),
    candidateShard: shard,
    catalog,
    soundProfile: structuredClone(soundProfile),
    renderScene: structuredClone(renderScene),
    binding: structuredClone(binding),
    extensionPack,
  });
}

function sealCandidateShard(
  candidate: InstrumentCandidate,
  assets: readonly SoundAssetDefinition[],
  manifest: SoundpackManifest,
): CandidateShard {
  const core = {
    format: CANDIDATE_SHARD_FORMAT,
    id: candidate.id,
    candidateContentSha256: candidateContentSha256(candidate, manifest),
    candidate,
    assets: [...assets],
  };
  const shard: CandidateShard = {
    ...core,
    contentSha256: soundObjectContentSha256(core),
  };
  const errors = validateCandidateShard(
    shard,
    SHINYGUITAR_INSTRUMENT_VOCABULARY,
  );
  if (errors.length) throw new Error(errors.join("\n"));
  return shard;
}

function sealCatalog(
  core: {
    format: typeof SOUND_CATALOG_FORMAT;
    id: string;
    candidates: SoundCatalog["candidates"];
  },
  shard: CandidateShard,
): SoundCatalog {
  const candidates = core.candidates.map((entry) => ({
    ...entry,
    candidateContentSha256: shard.candidateContentSha256,
    shard: {
      path: `./candidates/sha256/${shard.contentSha256}.json`,
      sha256: shard.contentSha256,
    },
  }));
  const catalogCore = { ...core, candidates };
  const catalog: SoundCatalog = {
    ...catalogCore,
    contentSha256: soundObjectContentSha256(catalogCore),
  };
  const errors = validateSoundCatalog(catalog);
  if (errors.length) throw new Error(errors.join("\n"));
  return catalog;
}

/**
 * A pack-specific provider that resolves the pack's exact candidate pins
 * against the carried vocabulary, leaving the global core provider unchanged.
 */
export function createShinyguitarAcousticProvider(
  pack: ShinyguitarAcousticPackMaterial,
): ShardCandidateProvider {
  return new ShardCandidateProvider(
    pack.catalog,
    [pack.candidateShard],
    SHINYGUITAR_INSTRUMENT_VOCABULARY,
  );
}

/** The ExtensionPack@1 projection of the pack's module/asset references. */
export function shinyguitarAcousticExtensionPack(
  pack: ShinyguitarAcousticPackMaterial,
): ExtensionPackV1 {
  return pack.extensionPack;
}

/**
 * The soundpack manifest the pack's Binding@1/profile must resolve against.
 * Exposed so the execution layer can build a plan@4 against the exact
 * pack-local candidate closure without touching the core registry.
 */
export function shinyguitarAcousticManifest(
  pack: ShinyguitarAcousticPackMaterial,
): SoundpackManifest {
  return manifestOf(
    `${pack.extensionPack.id}-manifest`,
    pack.candidateShard.candidate,
    pack.candidateShard.assets,
  );
}

/** Convenience pin for the pack's single exact candidate. */
export function shinyguitarAcousticPin(
  pack: ShinyguitarAcousticPackMaterial,
): CandidatePin {
  return {
    id: pack.candidateShard.id,
    sha256: pack.candidateShard.candidateContentSha256,
  };
}

/** Stable module-facing facts for the generated build record. */
export const SHINYGUITAR_MODULE_FACTS = Object.freeze({
  packId: SHINYGUITAR_ACOUSTIC_PACK_ID,
  candidateId: SHINYGUITAR_ACOUSTIC_CANDIDATE_ID,
  instrumentId: ARCHTOP_GUITAR_INSTRUMENT.id,
  vocabularyId: SHINYGUITAR_AUTHORING_VOCABULARY.id,
  vocabularySha256: SHINYGUITAR_AUTHORING_VOCABULARY.contentSha256,
  airVocabularyId: SHINYGUITAR_AIR_VOCABULARY.id,
  airVocabularySha256: SHINYGUITAR_AIR_VOCABULARY.contentSha256,
  soundProfileId: SHINYGUITAR_SOUND_PROFILE_ID,
  sceneId: SHINYGUITAR_SCENE_ID,
  bindingId: SHINYGUITAR_BINDING_ID,
  source: SHINYGUITAR_SOURCE,
});
