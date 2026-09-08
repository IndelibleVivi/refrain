import {
  COMPLETE_PIECE_RENDER_ADAPTERS,
  INSTRUMENT_VOCABULARY,
  candidateContentSha256,
  soundObjectContentSha256,
  type CandidatePin,
  type InstrumentDefinition,
  type SoundProfileSelection,
  type SoundpackManifest,
  type PerformanceBindingRuntimeStatus,
} from "./index.js";

export const AUTHORING_VOCABULARY_CLOSURE_FORMAT =
  "refrain-authoring-vocabulary-closure@0-experimental" as const;
export const SOUND_PROFILE_V2_FORMAT =
  "refrain-sound-profile@2-experimental" as const;
export const RENDER_SCENE_V1_FORMAT =
  "refrain-render-scene@1-experimental" as const;
export const PALETTE_RECIPE_FORMAT =
  "refrain-palette-recipe@0-experimental" as const;
export const SOUND_PALETTE_V1_FORMAT =
  "refrain-sound-palette@1-experimental" as const;
export const PERFORMANCE_BINDING_V1_FORMAT =
  "refrain-performance-binding@1-experimental" as const;
export const NEXT_RENDERER_CONTRACT =
  "refrain-renderer@2-experimental" as const;
export const PERFORMANCE_PLAN_V4_FORMAT =
  "performance-plan@4-experimental" as const;
export const EXTENSION_PACK_FORMAT =
  "refrain-extension-pack@0-experimental" as const;
export const EXTENSION_PACK_V1_FORMAT =
  "refrain-extension-pack@1-experimental" as const;

const SHA256 = /^[0-9a-f]{64}$/;
const ID = /^[a-z0-9][a-z0-9_.@-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  return (
    JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify([...expected].sort())
  );
}

function hasExactIdentity(value: unknown): value is ExactModuleReference {
  return (
    isRecord(value) &&
    exactKeys(value, ["id", "sha256"]) &&
    typeof value.id === "string" &&
    ID.test(value.id) &&
    typeof value.sha256 === "string" &&
    SHA256.test(value.sha256)
  );
}

function contentDigestError(
  value: Record<string, unknown>,
  label: string,
): string | undefined {
  if (
    typeof value.contentSha256 !== "string" ||
    !SHA256.test(value.contentSha256)
  )
    return `${label} needs a lowercase content SHA-256.`;
  if (value.contentSha256 !== soundObjectContentSha256(value))
    return `${label} content SHA-256 does not match its content.`;
  return undefined;
}

export interface ExactModuleReference {
  id: string;
  sha256: string;
}

export interface AuthoringVocabularyClosure {
  format: typeof AUTHORING_VOCABULARY_CLOSURE_FORMAT;
  id: string;
  contentSha256: string;
  instruments: InstrumentDefinition[];
}

export function validateAuthoringVocabularyClosure(value: unknown): string[] {
  if (!isRecord(value))
    return ["AuthoringVocabularyClosure must be an object."];
  const errors: string[] = [];
  if (!exactKeys(value, ["contentSha256", "format", "id", "instruments"]))
    errors.push("AuthoringVocabularyClosure must use its closed contract.");
  if (value.format !== AUTHORING_VOCABULARY_CLOSURE_FORMAT)
    errors.push("Invalid AuthoringVocabularyClosure format.");
  if (typeof value.id !== "string" || !ID.test(value.id))
    errors.push("Invalid AuthoringVocabularyClosure ID.");
  if (!Array.isArray(value.instruments) || value.instruments.length === 0) {
    errors.push("AuthoringVocabularyClosure must contain instruments.");
  } else {
    const ids = value.instruments.flatMap((instrument) =>
      isRecord(instrument) && typeof instrument.id === "string"
        ? [instrument.id]
        : [],
    );
    if (
      ids.length !== value.instruments.length ||
      new Set(ids).size !== ids.length
    )
      errors.push(
        "AuthoringVocabularyClosure instrument IDs must be present and unique.",
      );
    for (const instrument of value.instruments) {
      if (
        !isRecord(instrument) ||
        typeof instrument.id !== "string" ||
        !ID.test(instrument.id) ||
        typeof instrument.label !== "string" ||
        !["pitched", "percussion", "texture"].includes(
          String(instrument.family),
        ) ||
        !Number.isInteger(instrument.midiMin) ||
        !Number.isInteger(instrument.midiMax) ||
        Number(instrument.midiMin) < 0 ||
        Number(instrument.midiMax) > 127 ||
        Number(instrument.midiMin) > Number(instrument.midiMax) ||
        !["active", "deprecated"].includes(String(instrument.status)) ||
        typeof instrument.authoringMeaning !== "string"
      )
        errors.push(
          "AuthoringVocabularyClosure contains an invalid instrument.",
        );
    }
  }
  const digestError = contentDigestError(value, "AuthoringVocabularyClosure");
  if (digestError) errors.push(digestError);
  return errors;
}

export function createAuthoringVocabularyClosure(input: {
  id: string;
  instruments: readonly InstrumentDefinition[];
}): AuthoringVocabularyClosure {
  const core = {
    format: AUTHORING_VOCABULARY_CLOSURE_FORMAT,
    id: input.id,
    instruments: structuredClone([...input.instruments]).sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
  };
  const value: AuthoringVocabularyClosure = {
    ...core,
    contentSha256: soundObjectContentSha256(core),
  };
  const errors = validateAuthoringVocabularyClosure(value);
  if (errors.length) throw new Error(errors.join("\n"));
  return Object.freeze(value);
}

export const CORE_AUTHORING_VOCABULARY: AuthoringVocabularyClosure =
  createAuthoringVocabularyClosure({
    id: "refrain-core-instruments@0",
    instruments: INSTRUMENT_VOCABULARY.instruments,
  });

export interface SoundProfileV2 {
  format: typeof SOUND_PROFILE_V2_FORMAT;
  id: string;
  contentSha256: string;
  vocabulary: ExactModuleReference;
  coverage: string[];
  selections: Readonly<Record<string, SoundProfileSelection>>;
}

function validateSelection(
  instrumentId: string,
  value: unknown,
  errors: string[],
): value is SoundProfileSelection {
  if (!isRecord(value)) {
    errors.push(`Selection for ${instrumentId} must be an object.`);
    return false;
  }
  if (
    !exactKeys(value, [
      "candidateChain",
      "fallbackPolicy",
      ...(value.profileGainDb === undefined ? [] : ["profileGainDb"]),
    ])
  )
    errors.push(`Selection for ${instrumentId} must use its closed contract.`);
  if (
    !Array.isArray(value.candidateChain) ||
    value.candidateChain.length === 0 ||
    !value.candidateChain.every(hasExactIdentity)
  )
    errors.push(`Selection for ${instrumentId} needs exact candidate pins.`);
  if (
    !["strict", "whole-identity-audition"].includes(
      String(value.fallbackPolicy),
    )
  )
    errors.push(
      `Selection for ${instrumentId} has an invalid fallback policy.`,
    );
  if (
    value.fallbackPolicy === "strict" &&
    Array.isArray(value.candidateChain) &&
    value.candidateChain.length !== 1
  )
    errors.push(`Strict selection for ${instrumentId} needs one candidate.`);
  if (
    value.profileGainDb !== undefined &&
    (typeof value.profileGainDb !== "number" ||
      !Number.isFinite(value.profileGainDb))
  )
    errors.push(`Selection for ${instrumentId} has invalid profile gain.`);
  return true;
}

export function validateSoundProfileV2(
  value: unknown,
  manifest?: SoundpackManifest,
  vocabulary?: AuthoringVocabularyClosure,
): string[] {
  if (!isRecord(value)) return ["SoundProfile@2 must be an object."];
  const errors: string[] = [];
  if (
    !exactKeys(value, [
      "contentSha256",
      "coverage",
      "format",
      "id",
      "selections",
      "vocabulary",
    ])
  )
    errors.push("SoundProfile@2 must use its closed contract.");
  if (value.format !== SOUND_PROFILE_V2_FORMAT)
    errors.push("Invalid SoundProfile@2 format.");
  if (typeof value.id !== "string" || !ID.test(value.id))
    errors.push("Invalid SoundProfile@2 ID.");
  if (!hasExactIdentity(value.vocabulary))
    errors.push("SoundProfile@2 needs an exact vocabulary reference.");
  if (
    !Array.isArray(value.coverage) ||
    value.coverage.length === 0 ||
    !value.coverage.every((id) => typeof id === "string" && ID.test(id)) ||
    new Set(value.coverage).size !== value.coverage.length ||
    JSON.stringify([...value.coverage].sort()) !==
      JSON.stringify(value.coverage)
  )
    errors.push("SoundProfile@2 coverage must be a sorted unique ID list.");
  if (!isRecord(value.selections)) {
    errors.push("SoundProfile@2 selections must be an object.");
  } else {
    for (const [instrumentId, selection] of Object.entries(value.selections))
      validateSelection(instrumentId, selection, errors);
    if (
      Array.isArray(value.coverage) &&
      JSON.stringify(Object.keys(value.selections).sort()) !==
        JSON.stringify(value.coverage)
    )
      errors.push("SoundProfile@2 coverage must equal its selection keys.");
  }
  if (vocabulary && hasExactIdentity(value.vocabulary)) {
    if (
      value.vocabulary.id !== vocabulary.id ||
      value.vocabulary.sha256 !== vocabulary.contentSha256
    )
      errors.push("SoundProfile@2 vocabulary reference does not match.");
    if (Array.isArray(value.coverage)) {
      for (const id of value.coverage)
        if (!vocabulary.instruments.some((instrument) => instrument.id === id))
          errors.push(
            `SoundProfile@2 selects unknown instrument ${String(id)}.`,
          );
    }
  }
  if (manifest && isRecord(value.selections)) {
    const candidates = new Map(
      manifest.candidates.map((candidate) => [candidate.id, candidate]),
    );
    for (const [instrumentId, selection] of Object.entries(value.selections)) {
      if (!isRecord(selection) || !Array.isArray(selection.candidateChain))
        continue;
      for (const rawPin of selection.candidateChain) {
        if (!hasExactIdentity(rawPin)) continue;
        const candidate = candidates.get(rawPin.id);
        if (!candidate)
          errors.push(
            `SoundProfile@2 references unknown candidate ${rawPin.id}.`,
          );
        else if (candidate.instrumentId !== instrumentId)
          errors.push(
            `Candidate ${rawPin.id} does not implement ${instrumentId}.`,
          );
        else if (candidateContentSha256(candidate, manifest) !== rawPin.sha256)
          errors.push(
            `SoundProfile@2 candidate pin does not match ${rawPin.id}.`,
          );
      }
    }
  }
  const digestError = contentDigestError(value, "SoundProfile@2");
  if (digestError) errors.push(digestError);
  return errors;
}

export function createSoundProfileV2(input: {
  id: string;
  vocabulary: AuthoringVocabularyClosure;
  selections: Readonly<Record<string, SoundProfileSelection>>;
  manifest?: SoundpackManifest;
}): SoundProfileV2 {
  const selections = Object.fromEntries(
    Object.entries(input.selections)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, selection]) => [id, structuredClone(selection)]),
  );
  const core = {
    format: SOUND_PROFILE_V2_FORMAT,
    id: input.id,
    vocabulary: {
      id: input.vocabulary.id,
      sha256: input.vocabulary.contentSha256,
    },
    coverage: Object.keys(selections),
    selections,
  };
  const value: SoundProfileV2 = {
    ...core,
    contentSha256: soundObjectContentSha256(core),
  };
  const errors = validateSoundProfileV2(
    value,
    input.manifest,
    input.vocabulary,
  );
  if (errors.length) throw new Error(errors.join("\n"));
  return Object.freeze(value);
}

export type SceneProcessor =
  | { id: string; type: "gain-pan"; gainDb: number; pan: number; width: number }
  | { id: string; type: "lowpass"; frequencyHz: number; q: number }
  | { id: string; type: "saturation"; drive: number; mix: number }
  | {
      id: string;
      type: "delay";
      delayMs: number;
      feedback: number;
      mix: number;
    }
  | { id: string; type: "room"; decaySeconds: number; mix: number }
  | {
      id: string;
      type: "fade";
      inSeconds: number;
      outSeconds: number;
      tailSeconds: number;
    };

export interface RenderSceneV1 {
  format: typeof RENDER_SCENE_V1_FORMAT;
  id: string;
  contentSha256: string;
  master: { gainDb: number; peakCeiling: number; velocityScale: number };
  buses: Array<{
    id: string;
    output: "master" | string;
    processors: SceneProcessor[];
  }>;
  routes: Array<{
    id: string;
    bus: "master" | string;
    match: { instrumentIds?: string[]; roles?: string[] };
  }>;
}

function validateProcessor(value: unknown, errors: string[]): void {
  if (!isRecord(value) || typeof value.id !== "string" || !ID.test(value.id)) {
    errors.push("RenderScene@1 processor needs a valid ID.");
    return;
  }
  const numberIn = (key: string, min: number, max: number) =>
    typeof value[key] === "number" &&
    Number.isFinite(value[key]) &&
    Number(value[key]) >= min &&
    Number(value[key]) <= max;
  switch (value.type) {
    case "gain-pan":
      if (!exactKeys(value, ["gainDb", "id", "pan", "type", "width"]))
        errors.push("gain-pan processor must use its closed contract.");
      if (
        !numberIn("gainDb", -60, 12) ||
        !numberIn("pan", -1, 1) ||
        !numberIn("width", 0, 2)
      )
        errors.push("gain-pan processor parameters are out of range.");
      break;
    case "lowpass":
      if (!exactKeys(value, ["frequencyHz", "id", "q", "type"]))
        errors.push("lowpass processor must use its closed contract.");
      if (!numberIn("frequencyHz", 40, 20_000) || !numberIn("q", 0.1, 12))
        errors.push("lowpass processor parameters are out of range.");
      break;
    case "saturation":
      if (!exactKeys(value, ["drive", "id", "mix", "type"]))
        errors.push("saturation processor must use its closed contract.");
      if (!numberIn("drive", 1, 12) || !numberIn("mix", 0, 1))
        errors.push("saturation processor parameters are out of range.");
      break;
    case "delay":
      if (!exactKeys(value, ["delayMs", "feedback", "id", "mix", "type"]))
        errors.push("delay processor must use its closed contract.");
      if (
        !numberIn("delayMs", 1, 2_000) ||
        !numberIn("feedback", 0, 0.85) ||
        !numberIn("mix", 0, 1)
      )
        errors.push("delay processor parameters are out of range.");
      break;
    case "room":
      if (!exactKeys(value, ["decaySeconds", "id", "mix", "type"]))
        errors.push("room processor must use its closed contract.");
      if (!numberIn("decaySeconds", 0.05, 8) || !numberIn("mix", 0, 1))
        errors.push("room processor parameters are out of range.");
      break;
    case "fade":
      if (
        !exactKeys(value, [
          "id",
          "inSeconds",
          "outSeconds",
          "tailSeconds",
          "type",
        ])
      )
        errors.push("fade processor must use its closed contract.");
      if (
        !numberIn("inSeconds", 0, 30) ||
        !numberIn("outSeconds", 0, 30) ||
        !numberIn("tailSeconds", 0, 30)
      )
        errors.push("fade processor parameters are out of range.");
      break;
    default:
      errors.push(`Unsupported RenderScene@1 processor ${String(value.type)}.`);
  }
}

export function validateRenderSceneV1(value: unknown): string[] {
  if (!isRecord(value)) return ["RenderScene@1 must be an object."];
  const errors: string[] = [];
  if (
    !exactKeys(value, [
      "buses",
      "contentSha256",
      "format",
      "id",
      "master",
      "routes",
    ])
  )
    errors.push("RenderScene@1 must use its closed contract.");
  if (value.format !== RENDER_SCENE_V1_FORMAT)
    errors.push("Invalid RenderScene@1 format.");
  if (typeof value.id !== "string" || !ID.test(value.id))
    errors.push("Invalid RenderScene@1 ID.");
  if (
    !isRecord(value.master) ||
    !exactKeys(value.master, ["gainDb", "peakCeiling", "velocityScale"]) ||
    typeof value.master.gainDb !== "number" ||
    value.master.gainDb < -60 ||
    value.master.gainDb > 6 ||
    typeof value.master.peakCeiling !== "number" ||
    value.master.peakCeiling < 0.05 ||
    value.master.peakCeiling > 1 ||
    typeof value.master.velocityScale !== "number" ||
    value.master.velocityScale < 0.05 ||
    value.master.velocityScale > 2
  )
    errors.push("RenderScene@1 master parameters are invalid.");
  const buses = Array.isArray(value.buses) ? value.buses : [];
  if (buses.length === 0 || buses.length > 8)
    errors.push("RenderScene@1 needs 1-8 buses.");
  const busIds = new Set<string>();
  const outputs = new Map<string, string>();
  for (const bus of buses) {
    if (
      !isRecord(bus) ||
      !exactKeys(bus, ["id", "output", "processors"]) ||
      typeof bus.id !== "string" ||
      !ID.test(bus.id) ||
      bus.id === "master" ||
      busIds.has(bus.id)
    ) {
      errors.push("RenderScene@1 bus IDs must be unique and valid.");
      continue;
    }
    busIds.add(bus.id);
    if (typeof bus.output !== "string")
      errors.push(`RenderScene@1 bus ${bus.id} needs an output.`);
    else outputs.set(bus.id, bus.output);
    if (!Array.isArray(bus.processors) || bus.processors.length > 8)
      errors.push(`RenderScene@1 bus ${bus.id} has invalid processors.`);
    else
      bus.processors.forEach((processor) =>
        validateProcessor(processor, errors),
      );
  }
  for (const [id, output] of outputs)
    if (output !== "master" && !busIds.has(output))
      errors.push(`RenderScene@1 bus ${id} targets unknown bus ${output}.`);
  for (const id of busIds) {
    const seen = new Set<string>();
    let cursor: string | undefined = id;
    while (cursor !== undefined && cursor !== "master") {
      if (seen.has(cursor)) {
        errors.push(`RenderScene@1 bus graph cycles at ${cursor}.`);
        break;
      }
      seen.add(cursor);
      cursor = outputs.get(cursor);
    }
  }
  if (
    !Array.isArray(value.routes) ||
    value.routes.length === 0 ||
    value.routes.length > 32
  )
    errors.push("RenderScene@1 needs 1-32 routes.");
  else {
    const routeIds = new Set<string>();
    for (const route of value.routes) {
      if (
        !isRecord(route) ||
        !exactKeys(route, ["bus", "id", "match"]) ||
        typeof route.id !== "string" ||
        !ID.test(route.id) ||
        routeIds.has(route.id) ||
        typeof route.bus !== "string" ||
        (route.bus !== "master" && !busIds.has(route.bus)) ||
        !isRecord(route.match) ||
        !exactKeys(route.match, [
          ...(route.match.instrumentIds === undefined ? [] : ["instrumentIds"]),
          ...(route.match.roles === undefined ? [] : ["roles"]),
        ]) ||
        (route.match.instrumentIds !== undefined &&
          (!Array.isArray(route.match.instrumentIds) ||
            !route.match.instrumentIds.every(
              (item) => typeof item === "string" && ID.test(item),
            ))) ||
        (route.match.roles !== undefined &&
          (!Array.isArray(route.match.roles) ||
            !route.match.roles.every(
              (item) => typeof item === "string" && item.length > 0,
            )))
      )
        errors.push("RenderScene@1 contains an invalid route.");
      else routeIds.add(route.id);
    }
  }
  const digestError = contentDigestError(value, "RenderScene@1");
  if (digestError) errors.push(digestError);
  return errors;
}

export function createRenderSceneV1(
  input: Omit<RenderSceneV1, "contentSha256" | "format">,
): RenderSceneV1 {
  const core = { format: RENDER_SCENE_V1_FORMAT, ...structuredClone(input) };
  const value: RenderSceneV1 = {
    ...core,
    contentSha256: soundObjectContentSha256(core),
  };
  const errors = validateRenderSceneV1(value);
  if (errors.length) throw new Error(errors.join("\n"));
  return Object.freeze(value);
}

export interface PaletteRecipe {
  format: typeof PALETTE_RECIPE_FORMAT;
  id: string;
  contentSha256: string;
  profile: ExactModuleReference;
  scene: ExactModuleReference;
  authoringGuide: string;
  descriptors: string[];
}

export function createPaletteRecipe(
  input: Omit<PaletteRecipe, "contentSha256" | "format">,
): PaletteRecipe {
  const core = { format: PALETTE_RECIPE_FORMAT, ...structuredClone(input) };
  const value: PaletteRecipe = {
    ...core,
    contentSha256: soundObjectContentSha256(core),
  };
  if (
    !ID.test(value.id) ||
    !hasExactIdentity(value.profile) ||
    !hasExactIdentity(value.scene) ||
    value.authoringGuide.length === 0 ||
    value.authoringGuide.length > 2_000 ||
    !value.descriptors.every((item) => item.length > 0)
  )
    throw new Error("PaletteRecipe is invalid.");
  return Object.freeze(value);
}

export interface SoundPaletteV1 {
  format: typeof SOUND_PALETTE_V1_FORMAT;
  id: string;
  contentSha256: string;
  status:
    | "engineering"
    | "listening-candidate"
    | "listening-accepted"
    | "release-candidate";
  soundProfile: ExactModuleReference;
  renderScene: ExactModuleReference;
  authoringGuide: string;
  descriptors: string[];
}

export function validateSoundPaletteV1(
  value: unknown,
  profile?: SoundProfileV2,
  scene?: RenderSceneV1,
): string[] {
  if (!isRecord(value)) return ["SoundPalette@1 must be an object."];
  const errors: string[] = [];
  if (
    !exactKeys(value, [
      "format",
      "id",
      "contentSha256",
      "status",
      "soundProfile",
      "renderScene",
      "authoringGuide",
      "descriptors",
    ]) ||
    value.format !== SOUND_PALETTE_V1_FORMAT ||
    typeof value.id !== "string" ||
    !ID.test(value.id) ||
    ![
      "engineering",
      "listening-candidate",
      "listening-accepted",
      "release-candidate",
    ].includes(String(value.status)) ||
    !hasExactIdentity(value.soundProfile) ||
    !hasExactIdentity(value.renderScene) ||
    typeof value.authoringGuide !== "string" ||
    value.authoringGuide.length === 0 ||
    value.authoringGuide.length > 2000 ||
    !Array.isArray(value.descriptors) ||
    !value.descriptors.every((d) => typeof d === "string")
  )
    errors.push("SoundPalette@1 must use its closed contract.");
  if (
    profile &&
    hasExactIdentity(value.soundProfile) &&
    (value.soundProfile.id !== profile.id ||
      value.soundProfile.sha256 !== profile.contentSha256)
  )
    errors.push("SoundPalette@1 profile does not match its binding.");
  if (
    scene &&
    hasExactIdentity(value.renderScene) &&
    (value.renderScene.id !== scene.id ||
      value.renderScene.sha256 !== scene.contentSha256)
  )
    errors.push("SoundPalette@1 scene does not match its binding.");
  const digestError = contentDigestError(value, "SoundPalette@1");
  if (digestError) errors.push(digestError);
  return errors;
}

export function createSoundPaletteV1(input: {
  id: string;
  status: SoundPaletteV1["status"];
  soundProfile: SoundProfileV2;
  renderScene: RenderSceneV1;
  authoringGuide: string;
  descriptors?: readonly string[];
}): SoundPaletteV1 {
  const core = {
    format: SOUND_PALETTE_V1_FORMAT,
    id: input.id,
    status: input.status,
    soundProfile: {
      id: input.soundProfile.id,
      sha256: input.soundProfile.contentSha256,
    },
    renderScene: {
      id: input.renderScene.id,
      sha256: input.renderScene.contentSha256,
    },
    authoringGuide: input.authoringGuide,
    descriptors: [...(input.descriptors ?? [])],
  };
  if (
    !ID.test(core.id) ||
    core.authoringGuide.length === 0 ||
    core.authoringGuide.length > 2_000
  )
    throw new Error("SoundPalette@1 is invalid.");
  const value = {
    ...core,
    contentSha256: soundObjectContentSha256(core),
  };
  const errors = validateSoundPaletteV1(
    value,
    input.soundProfile,
    input.renderScene,
  );
  if (errors.length) throw new Error(errors.join("\n"));
  return Object.freeze(value);
}

export function resolvePaletteRecipe(
  recipe: PaletteRecipe,
  profile: SoundProfileV2,
  scene: RenderSceneV1,
): SoundPaletteV1 {
  if (
    recipe.profile.id !== profile.id ||
    recipe.profile.sha256 !== profile.contentSha256
  )
    throw new Error("PaletteRecipe profile is unavailable or changed.");
  if (
    recipe.scene.id !== scene.id ||
    recipe.scene.sha256 !== scene.contentSha256
  )
    throw new Error("PaletteRecipe scene is unavailable or changed.");
  return createSoundPaletteV1({
    id: recipe.id,
    status: "engineering",
    soundProfile: profile,
    renderScene: scene,
    authoringGuide: recipe.authoringGuide,
    descriptors: recipe.descriptors,
  });
}

export type PerformanceOverrideKeyV1 =
  "masterGainDb" | "peakCeiling" | "velocityScale";

export interface PerformanceBindingV1 {
  format: typeof PERFORMANCE_BINDING_V1_FORMAT;
  id: string;
  contentSha256: string;
  requiredInstrumentIds: string[];
  soundProfile: SoundProfileV2;
  soundProfileSha256: string;
  renderScene: RenderSceneV1;
  soundPalette?: SoundPaletteV1;
  soundPaletteSha256?: string;
  candidateDigests: Readonly<Record<string, string>>;
  permittedOverrides: PerformanceOverrideKeyV1[];
  overrides: Partial<Record<PerformanceOverrideKeyV1, number>>;
  renderer: {
    contract: typeof NEXT_RENDERER_CONTRACT;
    performancePlanFormat: typeof PERFORMANCE_PLAN_V4_FORMAT;
    adapters: Array<(typeof COMPLETE_PIECE_RENDER_ADAPTERS)[number]>;
  };
}

function expectedCandidateDigestsV2(
  profile: SoundProfileV2,
  manifest: SoundpackManifest,
): Record<string, string> {
  const byId = new Map(
    manifest.candidates.map((candidate) => [candidate.id, candidate]),
  );
  return Object.fromEntries(
    Object.values(profile.selections)
      .flatMap((selection) => selection.candidateChain)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((pin: CandidatePin) => {
        const candidate = byId.get(pin.id);
        if (!candidate) throw new Error(`Unknown sound candidate ${pin.id}.`);
        const digest = candidateContentSha256(candidate, manifest);
        if (digest !== pin.sha256)
          throw new Error(
            `SoundProfile@2 candidate pin does not match ${pin.id}.`,
          );
        return [pin.id, digest];
      }),
  );
}

function pinnedCandidateDigestsV2(
  profile: SoundProfileV2,
): Record<string, string> {
  return Object.fromEntries(
    Object.values(profile.selections)
      .flatMap((selection) => selection.candidateChain)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((pin) => [pin.id, pin.sha256]),
  );
}

export function validateHistoricalPerformanceBindingV1(
  value: unknown,
): string[] {
  return validatePerformanceBindingV1Internal(value);
}

function validatePerformanceBindingV1Internal(
  value: unknown,
  manifest?: SoundpackManifest,
): string[] {
  if (!isRecord(value)) return ["PerformanceBinding@1 must be an object."];
  const errors: string[] = [];
  const hasPalette = value.soundPalette !== undefined;
  if (
    !exactKeys(value, [
      "candidateDigests",
      "contentSha256",
      "format",
      "id",
      "overrides",
      "permittedOverrides",
      "renderScene",
      "renderer",
      "requiredInstrumentIds",
      "soundProfile",
      "soundProfileSha256",
      ...(hasPalette ? ["soundPalette", "soundPaletteSha256"] : []),
    ])
  )
    errors.push("PerformanceBinding@1 must use its closed contract.");
  if (value.format !== PERFORMANCE_BINDING_V1_FORMAT)
    errors.push("Invalid PerformanceBinding@1 format.");
  if (typeof value.id !== "string" || !ID.test(value.id))
    errors.push("Invalid PerformanceBinding@1 ID.");
  const required = Array.isArray(value.requiredInstrumentIds)
    ? value.requiredInstrumentIds
    : [];
  if (
    required.length === 0 ||
    !required.every((id) => typeof id === "string" && ID.test(id)) ||
    new Set(required).size !== required.length ||
    JSON.stringify([...required].sort()) !== JSON.stringify(required)
  )
    errors.push(
      "PerformanceBinding@1 required instruments must be a sorted unique list.",
    );
  const profileErrors = validateSoundProfileV2(value.soundProfile, manifest);
  errors.push(...profileErrors);
  if (isRecord(value.soundProfile)) {
    if (value.soundProfileSha256 !== value.soundProfile.contentSha256)
      errors.push("PerformanceBinding@1 SoundProfile digest does not match.");
    const coverage = new Set(
      Array.isArray(value.soundProfile.coverage)
        ? value.soundProfile.coverage
        : [],
    );
    for (const id of required)
      if (!coverage.has(id))
        errors.push(`SoundProfile@2 does not cover ${id}.`);
  }
  errors.push(...validateRenderSceneV1(value.renderScene));
  if (hasPalette) {
    errors.push(
      ...validateSoundPaletteV1(
        value.soundPalette,
        isRecord(value.soundProfile)
          ? (value.soundProfile as unknown as SoundProfileV2)
          : undefined,
        isRecord(value.renderScene)
          ? (value.renderScene as unknown as RenderSceneV1)
          : undefined,
      ),
    );
    if (
      !isRecord(value.soundPalette) ||
      value.soundPaletteSha256 !== value.soundPalette.contentSha256
    )
      errors.push("PerformanceBinding@1 SoundPalette digest does not match.");
  }
  const allowedOverrides = ["masterGainDb", "peakCeiling", "velocityScale"];
  if (
    !Array.isArray(value.permittedOverrides) ||
    !value.permittedOverrides.every(
      (key) => typeof key === "string" && allowedOverrides.includes(key),
    ) ||
    new Set(value.permittedOverrides).size !==
      value.permittedOverrides.length ||
    JSON.stringify([...value.permittedOverrides].sort()) !==
      JSON.stringify(value.permittedOverrides)
  )
    errors.push(
      "PerformanceBinding@1 permittedOverrides must be a sorted unique subset of supported controls.",
    );
  if (!isRecord(value.overrides))
    errors.push("PerformanceBinding@1 overrides must be an object.");
  else
    for (const [key, parameter] of Object.entries(value.overrides)) {
      if (
        !allowedOverrides.includes(key) ||
        !Array.isArray(value.permittedOverrides) ||
        !value.permittedOverrides.includes(key)
      )
        errors.push(`PerformanceBinding@1 override ${key} is not permitted.`);
      const [min, max] =
        key === "masterGainDb"
          ? [-60, 6]
          : key === "peakCeiling"
            ? [0.05, 1]
            : [0.05, 2];
      if (
        typeof parameter !== "number" ||
        !Number.isFinite(parameter) ||
        parameter < min! ||
        parameter > max!
      )
        errors.push(`PerformanceBinding@1 override ${key} is out of range.`);
    }
  if (!isRecord(value.candidateDigests))
    errors.push("PerformanceBinding@1 needs candidate digests.");
  else if (isRecord(value.soundProfile)) {
    try {
      const expected = manifest
        ? expectedCandidateDigestsV2(
            value.soundProfile as unknown as SoundProfileV2,
            manifest,
          )
        : pinnedCandidateDigestsV2(
            value.soundProfile as unknown as SoundProfileV2,
          );
      if (JSON.stringify(expected) !== JSON.stringify(value.candidateDigests))
        errors.push(
          "PerformanceBinding@1 candidate digests do not match its profile.",
        );
    } catch (cause) {
      errors.push(
        cause instanceof Error ? cause.message : "Invalid candidates.",
      );
    }
  }
  if (
    !isRecord(value.renderer) ||
    value.renderer.contract !== NEXT_RENDERER_CONTRACT ||
    value.renderer.performancePlanFormat !== PERFORMANCE_PLAN_V4_FORMAT ||
    JSON.stringify(value.renderer.adapters) !==
      JSON.stringify(COMPLETE_PIECE_RENDER_ADAPTERS)
  )
    errors.push("PerformanceBinding@1 renderer compatibility does not match.");
  const digestError = contentDigestError(value, "PerformanceBinding@1");
  if (digestError) errors.push(digestError);
  return [...new Set(errors)];
}

export function validatePerformanceBindingV1(
  value: unknown,
  manifest: SoundpackManifest,
): string[] {
  return validatePerformanceBindingV1Internal(value, manifest);
}

export function createPerformanceBindingV1(input: {
  id: string;
  requiredInstrumentIds: readonly string[];
  soundProfile: SoundProfileV2;
  renderScene: RenderSceneV1;
  soundPalette?: SoundPaletteV1;
  permittedOverrides?: readonly PerformanceOverrideKeyV1[];
  overrides?: Partial<Record<PerformanceOverrideKeyV1, number>>;
  manifest: SoundpackManifest;
}): PerformanceBindingV1 {
  const core = {
    format: PERFORMANCE_BINDING_V1_FORMAT,
    id: input.id,
    requiredInstrumentIds: [...input.requiredInstrumentIds].sort(),
    soundProfile: structuredClone(input.soundProfile),
    soundProfileSha256: input.soundProfile.contentSha256,
    renderScene: structuredClone(input.renderScene),
    ...(input.soundPalette
      ? {
          soundPalette: structuredClone(input.soundPalette),
          soundPaletteSha256: input.soundPalette.contentSha256,
        }
      : {}),
    candidateDigests: expectedCandidateDigestsV2(
      input.soundProfile,
      input.manifest,
    ),
    permittedOverrides: [...(input.permittedOverrides ?? [])].sort(),
    overrides: { ...(input.overrides ?? {}) },
    renderer: {
      contract: NEXT_RENDERER_CONTRACT,
      performancePlanFormat: PERFORMANCE_PLAN_V4_FORMAT,
      adapters: [...COMPLETE_PIECE_RENDER_ADAPTERS],
    },
  };
  const value: PerformanceBindingV1 = {
    ...core,
    contentSha256: soundObjectContentSha256(core),
  };
  const errors = validatePerformanceBindingV1(value, input.manifest);
  if (errors.length) throw new Error(errors.join("\n"));
  return Object.freeze(value);
}

export function resolvePerformanceBindingV1AgainstRuntime(
  value: unknown,
  manifest: SoundpackManifest,
  vocabulary: AuthoringVocabularyClosure = CORE_AUTHORING_VOCABULARY,
): PerformanceBindingRuntimeStatus {
  const historical = validateHistoricalPerformanceBindingV1(value);
  if (historical.length || !isRecord(value))
    return {
      status: "unavailable",
      reason: "performance-binding-invalid",
      message: "The historical PerformanceBinding@1 is not internally valid.",
      errors: historical,
    };
  const binding = value as unknown as PerformanceBindingV1;
  if (
    binding.soundProfile.vocabulary.id !== vocabulary.id ||
    binding.soundProfile.vocabulary.sha256 !== vocabulary.contentSha256
  )
    return {
      status: "unavailable",
      reason: "instrument-vocabulary-not-installed",
      message: `Authoring vocabulary ${binding.soundProfile.vocabulary.id} sha256:${binding.soundProfile.vocabulary.sha256} is not installed.`,
      errors: ["The exact authoring vocabulary closure is unavailable."],
    };
  const candidates = new Map(
    manifest.candidates.map((candidate) => [candidate.id, candidate]),
  );
  for (const [candidateId, digest] of Object.entries(
    binding.candidateDigests,
  )) {
    const candidate = candidates.get(candidateId);
    if (!candidate)
      return {
        status: "unavailable",
        reason: "candidate-not-installed",
        message: `Sound candidate ${candidateId} is not installed.`,
        errors: [`Sound candidate ${candidateId} is not installed.`],
      };
    if (candidateContentSha256(candidate, manifest) !== digest)
      return {
        status: "unavailable",
        reason: "candidate-content-mismatch",
        message: `Sound candidate ${candidateId} does not match the historical content digest.`,
        errors: [`Sound candidate ${candidateId} has changed.`],
      };
  }
  const errors = validatePerformanceBindingV1(binding, manifest);
  return errors.length
    ? {
        status: "unavailable",
        reason: "runtime-validation-failed",
        message: "PerformanceBinding@1 cannot be resolved by this runtime.",
        errors,
      }
    : { status: "available" };
}

export type ExtensionModuleKind =
  "candidate-shard" | "sound-profile" | "render-scene" | "palette-recipe";
export type ExtensionModuleKindV1 =
  ExtensionModuleKind | "authoring-vocabulary";

export interface ExtensionPackModule<
  Kind extends string = ExtensionModuleKind,
> {
  kind: Kind;
  id: string;
  sha256: string;
}

export interface ExtensionPackAsset {
  id: string;
  sha256: string;
  bytes: number;
}

export interface ExtensionPack {
  format: typeof EXTENSION_PACK_FORMAT;
  id: string;
  version: string;
  label: string;
  contentSha256: string;
  modules: Array<ExtensionPackModule>;
  assets: ExtensionPackAsset[];
}

export interface ExtensionPackV1 {
  format: typeof EXTENSION_PACK_V1_FORMAT;
  id: string;
  version: string;
  label: string;
  contentSha256: string;
  modules: Array<ExtensionPackModule<ExtensionModuleKindV1>>;
  assets: ExtensionPackAsset[];
}

export type AnyExtensionPack = ExtensionPack | ExtensionPackV1;

function validateExtensionPackContract(
  value: unknown,
  expectedFormat: string,
  moduleKinds: readonly string[],
  label: string,
): string[] {
  if (!isRecord(value)) return [`${label} must be an object.`];
  const errors: string[] = [];
  if (
    !exactKeys(value, [
      "assets",
      "contentSha256",
      "format",
      "id",
      "label",
      "modules",
      "version",
    ])
  )
    errors.push(`${label} must use its closed contract.`);
  if (value.format !== expectedFormat) errors.push(`Invalid ${label} format.`);
  if (typeof value.id !== "string" || !ID.test(value.id))
    errors.push(`Invalid ${label} ID.`);
  if (
    typeof value.version !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(value.version)
  )
    errors.push(`${label} version must be semver-like.`);
  if (
    typeof value.label !== "string" ||
    value.label.length === 0 ||
    value.label.length > 120
  )
    errors.push(`${label} label must contain 1-120 characters.`);
  if (!Array.isArray(value.modules) || value.modules.length === 0)
    errors.push(`${label} needs typed modules.`);
  else {
    const keys = new Set<string>();
    for (const module of value.modules) {
      if (
        !isRecord(module) ||
        !exactKeys(module, ["id", "kind", "sha256"]) ||
        !moduleKinds.includes(String(module.kind)) ||
        typeof module.id !== "string" ||
        !ID.test(module.id) ||
        typeof module.sha256 !== "string" ||
        !SHA256.test(module.sha256)
      )
        errors.push(`${label} contains an invalid module reference.`);
      else if (keys.has(`${module.kind}:${module.id}`))
        errors.push(`${label} repeats ${module.kind}:${module.id}.`);
      else keys.add(`${module.kind}:${module.id}`);
    }
  }
  if (!Array.isArray(value.assets))
    errors.push(`${label} assets must be an array.`);
  else
    for (const asset of value.assets)
      if (
        !isRecord(asset) ||
        !exactKeys(asset, ["bytes", "id", "sha256"]) ||
        typeof asset.id !== "string" ||
        !ID.test(asset.id) ||
        typeof asset.sha256 !== "string" ||
        !SHA256.test(asset.sha256) ||
        !Number.isInteger(asset.bytes) ||
        Number(asset.bytes) < 0
      )
        errors.push(`${label} contains an invalid asset reference.`);
  const digestError = contentDigestError(value, label);
  if (digestError) errors.push(digestError);
  return errors;
}

export function validateExtensionPack(value: unknown): string[] {
  return validateExtensionPackContract(
    value,
    EXTENSION_PACK_FORMAT,
    ["candidate-shard", "sound-profile", "render-scene", "palette-recipe"],
    "ExtensionPack",
  );
}

export function validateExtensionPackV1(value: unknown): string[] {
  return validateExtensionPackContract(
    value,
    EXTENSION_PACK_V1_FORMAT,
    [
      "authoring-vocabulary",
      "candidate-shard",
      "sound-profile",
      "render-scene",
      "palette-recipe",
    ],
    "ExtensionPack@1",
  );
}

export function validateAnyExtensionPack(value: unknown): string[] {
  if (!isRecord(value)) return ["ExtensionPack must be an object."];
  if (value.format === EXTENSION_PACK_FORMAT)
    return validateExtensionPack(value);
  if (value.format === EXTENSION_PACK_V1_FORMAT)
    return validateExtensionPackV1(value);
  return ["Unsupported ExtensionPack format."];
}

export function createExtensionPack(
  input: Omit<ExtensionPack, "contentSha256" | "format">,
): ExtensionPack {
  const core = {
    format: EXTENSION_PACK_FORMAT,
    ...structuredClone(input),
    modules: [...input.modules].sort((left, right) =>
      `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`),
    ),
    assets: [...input.assets].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
  };
  const value: ExtensionPack = {
    ...core,
    contentSha256: soundObjectContentSha256(core),
  };
  const errors = validateExtensionPack(value);
  if (errors.length) throw new Error(errors.join("\n"));
  return Object.freeze(value);
}

export function createExtensionPackV1(
  input: Omit<ExtensionPackV1, "contentSha256" | "format">,
): ExtensionPackV1 {
  const core = {
    format: EXTENSION_PACK_V1_FORMAT,
    ...structuredClone(input),
    modules: [...input.modules].sort((left, right) =>
      `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`),
    ),
    assets: [...input.assets].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
  };
  const value: ExtensionPackV1 = {
    ...core,
    contentSha256: soundObjectContentSha256(core),
  };
  const errors = validateExtensionPackV1(value);
  if (errors.length) throw new Error(errors.join("\n"));
  return Object.freeze(value);
}

export function validateExtensionPackAuthoringVocabulary(
  pack: ExtensionPackV1,
  vocabulary: {
    format: string;
    id: string;
    contentSha256: string;
  },
): string[] {
  const errors = validateExtensionPackV1(pack);
  if (errors.length) return errors;
  if (
    vocabulary.format !== "refrain-air-vocabulary-closure@0-experimental" ||
    !ID.test(vocabulary.id) ||
    !SHA256.test(vocabulary.contentSha256)
  )
    return ["The AIR authoring vocabulary identity is invalid."];
  return pack.modules.some(
    (module) =>
      module.kind === "authoring-vocabulary" &&
      module.id === vocabulary.id &&
      module.sha256 === vocabulary.contentSha256,
  )
    ? []
    : [
        "ExtensionPack@1 does not contain this exact authoring vocabulary closure.",
      ];
}
