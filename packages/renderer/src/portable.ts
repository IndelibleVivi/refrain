import { parseAir, type AirSource } from "@refrain/air-schema";
import { parseAirV1, type AirSourceV1 } from "@refrain/air-schema/v1";
import {
  renderReceiptShapeIsValid,
  type RenderReceipt,
} from "@refrain/audio-engine/receipt";
import {
  performanceBindingShapeIsValid,
  type PerformanceBinding,
} from "@refrain/soundpack";
import {
  validateHistoricalPerformanceBindingV1,
  type PerformanceBindingV1,
} from "@refrain/soundpack/vnext";
import {
  receiptIntegrityErrors,
  sourceReceiptIntegrityErrors,
  SHA256_ID,
} from "./identity.js";
import {
  sourceReceiptIntegrityErrorsV1,
  receiptIntegrityErrorsV1,
  type AirReceiptV1,
} from "./v1.js";
import type {
  AirReceipt,
  ProjectionReference,
  RefrainArtifact,
  RefrainArtifactV1,
  RefrainArtifactV2,
  RefrainArtifactV3,
} from "./types.js";

export const LEGACY_REFRAIN_ARTIFACT_FORMAT =
  "refrain-artifact@0-experimental" as const;
export const REFRAIN_ARTIFACT_FORMAT =
  "refrain-artifact@1-experimental" as const;
export const REFRAIN_ARTIFACT_V2_FORMAT =
  "refrain-artifact@2-experimental" as const;
export const REFRAIN_ARTIFACT_V3_FORMAT =
  "refrain-artifact@3-experimental" as const;

export interface CreateRefrainArtifactInput {
  source: AirSource;
  receipt: AirReceipt;
  caption?: string;
  performanceBinding?: PerformanceBinding;
  performanceBindings?: readonly PerformanceBinding[];
  defaultBindingId?: string;
  renderReceipts?: readonly RenderReceipt[];
  projections?: readonly ProjectionReference[];
}

export interface CreateRefrainArtifactV2Input {
  source: AirSource;
  receipt: AirReceipt;
  caption?: string;
  performanceBinding?: PerformanceBindingV1;
  performanceBindings?: readonly PerformanceBindingV1[];
  defaultBindingId?: string;
  renderReceipts?: readonly import("@refrain/audio-engine/receipt").RenderReceiptV3[];
  projections?: readonly ProjectionReference[];
}

export interface CreateRefrainArtifactV3Input {
  source: AirSourceV1;
  receipt: AirReceiptV1;
  caption?: string;
  performanceBinding?: PerformanceBinding | PerformanceBindingV1;
  performanceBindings?: readonly (PerformanceBinding | PerformanceBindingV1)[];
  defaultBindingId?: string;
  renderReceipts?: readonly import("@refrain/audio-engine/receipt").RenderReceiptV3[];
  projections?: readonly ProjectionReference[];
}

export type RefrainArtifactParseResult =
  | { ok: true; artifact: RefrainArtifact; continuity: "valid" }
  | { ok: false; errors: string[] };

export function createRefrainArtifact(
  input: CreateRefrainArtifactInput,
): RefrainArtifactV1 {
  const byId = new Map<string, PerformanceBinding>();
  for (const binding of input.performanceBindings ?? []) {
    const present = byId.get(binding.id);
    if (present && present.contentSha256 !== binding.contentSha256)
      throw new Error(`Conflicting PerformanceBindings use ID ${binding.id}.`);
    byId.set(binding.id, binding);
  }
  if (input.performanceBinding) {
    const present = byId.get(input.performanceBinding.id);
    if (
      present &&
      present.contentSha256 !== input.performanceBinding.contentSha256
    )
      throw new Error(
        `Conflicting PerformanceBindings use ID ${input.performanceBinding.id}.`,
      );
    byId.set(input.performanceBinding.id, input.performanceBinding);
  }
  const performanceBindings = [...byId.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const defaultBindingId =
    input.defaultBindingId ?? input.performanceBinding?.id;
  if (
    defaultBindingId !== undefined &&
    !performanceBindings.some((binding) => binding.id === defaultBindingId)
  )
    throw new Error(
      `Default PerformanceBinding ${defaultBindingId} is absent from the artifact.`,
    );
  const artifact: RefrainArtifactV1 = {
    format: REFRAIN_ARTIFACT_FORMAT,
    source: input.source,
    receipt: input.receipt,
    performanceBindings,
    ...(defaultBindingId === undefined ? {} : { defaultBindingId }),
    ...(input.renderReceipts === undefined
      ? {}
      : { renderReceipts: [...input.renderReceipts] }),
    ...(input.projections === undefined
      ? {}
      : { projections: [...input.projections] }),
    ...(input.caption !== undefined ? { caption: input.caption } : {}),
  };
  const parsed = parseRefrainArtifact(artifact);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return artifact;
}

export function createRefrainArtifactV2(
  input: CreateRefrainArtifactV2Input,
): RefrainArtifactV2 {
  const byId = new Map<string, PerformanceBindingV1>();
  for (const binding of input.performanceBindings ?? []) {
    const present = byId.get(binding.id);
    if (present && present.contentSha256 !== binding.contentSha256)
      throw new Error(`Conflicting PerformanceBindings use ID ${binding.id}.`);
    byId.set(binding.id, binding);
  }
  if (input.performanceBinding) {
    const present = byId.get(input.performanceBinding.id);
    if (
      present &&
      present.contentSha256 !== input.performanceBinding.contentSha256
    )
      throw new Error(
        `Conflicting PerformanceBindings use ID ${input.performanceBinding.id}.`,
      );
    byId.set(input.performanceBinding.id, input.performanceBinding);
  }
  const performanceBindings = [...byId.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const defaultBindingId =
    input.defaultBindingId ?? input.performanceBinding?.id;
  if (
    defaultBindingId !== undefined &&
    !performanceBindings.some((binding) => binding.id === defaultBindingId)
  )
    throw new Error(
      `Default PerformanceBinding ${defaultBindingId} is absent from the artifact.`,
    );
  const artifact: RefrainArtifactV2 = {
    format: REFRAIN_ARTIFACT_V2_FORMAT,
    source: input.source,
    receipt: input.receipt,
    performanceBindings,
    ...(defaultBindingId === undefined ? {} : { defaultBindingId }),
    ...(input.renderReceipts === undefined
      ? {}
      : { renderReceipts: [...input.renderReceipts] }),
    ...(input.projections === undefined
      ? {}
      : { projections: [...input.projections] }),
    ...(input.caption === undefined ? {} : { caption: input.caption }),
  };
  const parsed = parseRefrainArtifact(artifact);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return artifact;
}

export function createRefrainArtifactV3(
  input: CreateRefrainArtifactV3Input,
): RefrainArtifactV3 {
  const byId = new Map<string, PerformanceBinding | PerformanceBindingV1>();
  for (const binding of input.performanceBindings ?? []) {
    const present = byId.get(binding.id);
    if (present && present.contentSha256 !== binding.contentSha256)
      throw new Error(`Conflicting PerformanceBindings use ID ${binding.id}.`);
    byId.set(binding.id, binding);
  }
  if (input.performanceBinding) {
    const present = byId.get(input.performanceBinding.id);
    if (
      present &&
      present.contentSha256 !== input.performanceBinding.contentSha256
    )
      throw new Error(
        `Conflicting PerformanceBindings use ID ${input.performanceBinding.id}.`,
      );
    byId.set(input.performanceBinding.id, input.performanceBinding);
  }
  const performanceBindings = [...byId.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const defaultBindingId =
    input.defaultBindingId ?? input.performanceBinding?.id;
  if (
    defaultBindingId !== undefined &&
    !performanceBindings.some((binding) => binding.id === defaultBindingId)
  )
    throw new Error(
      `Default PerformanceBinding ${defaultBindingId} is absent from the artifact.`,
    );
  const artifact: RefrainArtifactV3 = {
    format: REFRAIN_ARTIFACT_V3_FORMAT,
    source: input.source,
    receipt: input.receipt,
    performanceBindings,
    ...(defaultBindingId === undefined ? {} : { defaultBindingId }),
    ...(input.renderReceipts === undefined
      ? {}
      : { renderReceipts: [...input.renderReceipts] }),
    ...(input.projections === undefined
      ? {}
      : { projections: [...input.projections] }),
    ...(input.caption === undefined ? {} : { caption: input.caption }),
  };
  const parsed = parseRefrainArtifact(artifact);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return artifact;
}

export function stringifyRefrainArtifact(artifact: RefrainArtifact): string {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

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

function captionIsValid(value: unknown): boolean {
  return (
    value === undefined || (typeof value === "string" && value.length <= 1000)
  );
}

function legacyArtifactErrors(value: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (
    !exactKeys(value, [
      "format",
      "receipt",
      "source",
      ...(value.caption === undefined ? [] : ["caption"]),
    ])
  )
    errors.push("Legacy Refrain artifact must use its closed contract.");
  if (value.format !== LEGACY_REFRAIN_ARTIFACT_FORMAT)
    errors.push("Invalid legacy Refrain artifact format.");
  if (!captionIsValid(value.caption)) errors.push("Invalid artifact caption.");
  const parsedSource = parseAir(value.source).source;
  if (!parsedSource) errors.push("The artifact AIR source is invalid.");
  const receiptErrors = parsedSource
    ? sourceReceiptIntegrityErrors(parsedSource, value.receipt)
    : receiptIntegrityErrors(value.receipt);
  if (receiptErrors.length > 0)
    errors.push(
      `The artifact musical receipt failed integrity: ${receiptErrors.join(", ")}.`,
    );
  return errors;
}

function projectionError(
  value: unknown,
  receiptById: Map<string, RenderReceipt>,
): string | undefined {
  if (!isRecord(value)) return "Artifact projection must be an object.";
  if (
    !exactKeys(value, ["filename", "format", "kind", "renderReceiptId"]) ||
    value.format !== "refrain-projection-reference@0-experimental" ||
    !["midi", "native-wav", "audition-matched-wav"].includes(
      String(value.kind),
    ) ||
    typeof value.filename !== "string" ||
    value.filename.length === 0 ||
    value.filename.includes("/") ||
    typeof value.renderReceiptId !== "string" ||
    !SHA256_ID.test(value.renderReceiptId)
  )
    return "Artifact projection is malformed.";
  const receipt = receiptById.get(value.renderReceiptId);
  if (!receipt)
    return `Artifact projection ${value.filename} refers to a missing RenderReceipt.`;
  if (!receipt.outputSha256)
    return `Artifact projection ${value.filename} requires an output digest.`;
  if (value.kind === "midi" && receipt.adapter !== "midi")
    return `MIDI projection ${value.filename} must refer to a MIDI RenderReceipt.`;
  if (
    value.kind === "native-wav" &&
    (receipt.adapter !== "wav" ||
      receipt.outputAmplitude?.mode !== "native-gain")
  )
    return `Native WAV projection ${value.filename} must refer to a native-gain WAV RenderReceipt.`;
  if (
    value.kind === "audition-matched-wav" &&
    (receipt.adapter !== "wav" ||
      receipt.outputAmplitude?.mode !== "audition-peak-matched")
  )
    return `Audition-matched projection ${value.filename} must refer to an audition-matched WAV RenderReceipt.`;
  return undefined;
}

function bindingReceiptGraphError(
  receipt: RenderReceipt,
  bindingByDigest: Map<string, PerformanceBinding | PerformanceBindingV1>,
): string | undefined {
  const binding = bindingByDigest.get(receipt.performanceBindingDigest);
  if (!binding)
    return `RenderReceipt ${receipt.renderReceiptId} refers to an absent PerformanceBinding.`;
  if (
    receipt.soundProfileDigest !== `sha256:${binding.soundProfileSha256}` ||
    receipt.renderSceneDigest !==
      `sha256:${binding.renderScene.contentSha256}` ||
    receipt.rendererContract !== binding.renderer.contract ||
    receipt.vocabularyDigest !==
      `sha256:${binding.soundProfile.vocabulary.sha256}`
  )
    return `RenderReceipt ${receipt.renderReceiptId} contradicts its PerformanceBinding authorities.`;
  const paletteDigest = binding.soundPalette
    ? `sha256:${binding.soundPalette.contentSha256}`
    : undefined;
  if (receipt.soundPaletteDigest !== paletteDigest)
    return `RenderReceipt ${receipt.renderReceiptId} contradicts its PerformanceBinding palette.`;
  for (const candidate of receipt.selectedCandidates) {
    const selection = binding.soundProfile.selections[candidate.instrumentId];
    const candidateIndex = selection?.candidateChain.findIndex(
      (pin) => pin.id === candidate.candidateId,
    );
    if (candidateIndex === undefined || candidateIndex < 0)
      return `RenderReceipt ${receipt.renderReceiptId} selects candidate ${candidate.candidateId} outside the ${candidate.instrumentId} SoundProfile chain.`;
    if (candidate.fallbackUsed !== candidateIndex > 0)
      return `RenderReceipt ${receipt.renderReceiptId} contradicts fallback resolution for ${candidate.instrumentId}.`;
    if (
      binding.candidateDigests[candidate.candidateId] === undefined ||
      candidate.candidateDigest !==
        `sha256:${binding.candidateDigests[candidate.candidateId]}`
    )
      return `RenderReceipt ${receipt.renderReceiptId} contradicts candidate ${candidate.candidateId}.`;
  }
  return undefined;
}

function v2ArtifactErrors(value: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (
    !exactKeys(value, [
      "format",
      "performanceBindings",
      "receipt",
      "source",
      ...(value.caption === undefined ? [] : ["caption"]),
      ...(value.defaultBindingId === undefined ? [] : ["defaultBindingId"]),
      ...(value.renderReceipts === undefined ? [] : ["renderReceipts"]),
      ...(value.projections === undefined ? [] : ["projections"]),
    ])
  )
    errors.push("Refrain artifact v2 must use its closed contract.");
  if (value.format !== REFRAIN_ARTIFACT_V2_FORMAT)
    errors.push("Invalid Refrain artifact v2 format.");
  if (!captionIsValid(value.caption)) errors.push("Invalid artifact caption.");
  const parsedSource = parseAir(value.source).source;
  if (!parsedSource) errors.push("The artifact AIR source is invalid.");
  const musicalErrors = parsedSource
    ? sourceReceiptIntegrityErrors(parsedSource, value.receipt)
    : receiptIntegrityErrors(value.receipt);
  if (musicalErrors.length > 0)
    errors.push(
      `The artifact musical receipt failed integrity: ${musicalErrors.join(", ")}.`,
    );
  if (!Array.isArray(value.performanceBindings)) {
    errors.push("Refrain artifact v2 needs a PerformanceBinding@1 array.");
    return errors;
  }
  const bindingsAreValid = value.performanceBindings.every(
    (binding) => validateHistoricalPerformanceBindingV1(binding).length === 0,
  );
  if (!bindingsAreValid) {
    errors.push(
      "Refrain artifact v2 contains an internally invalid PerformanceBinding@1.",
    );
    return errors;
  }
  const bindings = value.performanceBindings as PerformanceBindingV1[];
  if (new Set(bindings.map((binding) => binding.id)).size !== bindings.length)
    errors.push(
      "Refrain artifact v2 contains duplicate PerformanceBinding IDs.",
    );
  const bindingByDigest = new Map(
    bindings.map((binding) => [`sha256:${binding.contentSha256}`, binding]),
  );
  if (bindingByDigest.size !== bindings.length)
    errors.push(
      "Refrain artifact v2 contains duplicate PerformanceBinding digests.",
    );
  if (
    value.defaultBindingId !== undefined &&
    (typeof value.defaultBindingId !== "string" ||
      !bindings.some((binding) => binding.id === value.defaultBindingId))
  )
    errors.push("The default PerformanceBinding is absent from the artifact.");
  const receiptsAreValid =
    value.renderReceipts === undefined ||
    (Array.isArray(value.renderReceipts) &&
      value.renderReceipts.every(
        (receipt) =>
          renderReceiptShapeIsValid(receipt) &&
          receipt.format === "refrain-render-receipt@3-experimental",
      ));
  if (!receiptsAreValid) {
    errors.push("Refrain artifact v2 contains an invalid RenderReceipt@3.");
    return errors;
  }
  const receipts = (value.renderReceipts ?? []) as RenderReceipt[];
  const receiptById = new Map(
    receipts.map((receipt) => [receipt.renderReceiptId, receipt]),
  );
  if (receiptById.size !== receipts.length)
    errors.push("Refrain artifact v2 contains duplicate RenderReceipt IDs.");
  const sourceRevision = isRecord(value.receipt)
    ? value.receipt.sourceRevision
    : undefined;
  if (receipts.some((receipt) => receipt.sourceRevision !== sourceRevision))
    errors.push("A RenderReceipt refers to a different AIR source revision.");
  for (const receipt of receipts) {
    const graphError = bindingReceiptGraphError(receipt, bindingByDigest);
    if (graphError) errors.push(graphError);
  }
  if (value.projections !== undefined && !Array.isArray(value.projections)) {
    errors.push("Refrain artifact v2 projections must be an array.");
  } else if (Array.isArray(value.projections)) {
    for (const projection of value.projections) {
      const error = projectionError(projection, receiptById);
      if (error) errors.push(error);
    }
  }
  return errors;
}

function v3ArtifactErrors(value: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (
    !exactKeys(value, [
      "format",
      "performanceBindings",
      "receipt",
      "source",
      ...(value.caption === undefined ? [] : ["caption"]),
      ...(value.defaultBindingId === undefined ? [] : ["defaultBindingId"]),
      ...(value.renderReceipts === undefined ? [] : ["renderReceipts"]),
      ...(value.projections === undefined ? [] : ["projections"]),
    ])
  )
    errors.push("Refrain artifact v3 must use its closed contract.");
  if (value.format !== REFRAIN_ARTIFACT_V3_FORMAT)
    errors.push("Invalid Refrain artifact v3 format.");
  if (!captionIsValid(value.caption)) errors.push("Invalid artifact caption.");
  const parsedSource = parseAirV1(value.source).source;
  if (!parsedSource) errors.push("The artifact AIR@1 source is invalid.");
  const receiptErrors = parsedSource
    ? sourceReceiptIntegrityErrorsV1(parsedSource, value.receipt)
    : receiptIntegrityErrorsV1(value.receipt);
  if (receiptErrors.length > 0)
    errors.push(
      `The artifact AIR@1 receipt failed integrity: ${receiptErrors.join(", ")}.`,
    );
  if (!Array.isArray(value.performanceBindings)) {
    errors.push("Refrain artifact v3 needs a PerformanceBinding array.");
    return errors;
  }
  const bindings = value.performanceBindings as Array<
    PerformanceBinding | PerformanceBindingV1
  >;
  const bindingIsValid = (binding: unknown): boolean =>
    performanceBindingShapeIsValid(binding) ||
    validateHistoricalPerformanceBindingV1(binding).length === 0;
  if (!bindings.every(bindingIsValid)) {
    errors.push("Refrain artifact v3 contains an invalid PerformanceBinding.");
    return errors;
  }
  if (new Set(bindings.map((binding) => binding.id)).size !== bindings.length)
    errors.push(
      "Refrain artifact v3 contains duplicate PerformanceBinding IDs.",
    );
  const bindingByDigest = new Map(
    bindings.map((binding) => [`sha256:${binding.contentSha256}`, binding]),
  );
  if (
    value.defaultBindingId !== undefined &&
    (typeof value.defaultBindingId !== "string" ||
      !bindings.some((binding) => binding.id === value.defaultBindingId))
  )
    errors.push("The default PerformanceBinding is absent from the artifact.");
  const receiptsAreValid =
    value.renderReceipts === undefined ||
    (Array.isArray(value.renderReceipts) &&
      value.renderReceipts.every(
        (receipt) =>
          renderReceiptShapeIsValid(receipt) &&
          receipt.format === "refrain-render-receipt@3-experimental",
      ));
  if (!receiptsAreValid) {
    errors.push("Refrain artifact v3 contains an invalid RenderReceipt@3.");
    return errors;
  }
  const receipts = (value.renderReceipts ?? []) as RenderReceipt[];
  const receiptById = new Map(
    receipts.map((receipt) => [receipt.renderReceiptId, receipt]),
  );
  if (receiptById.size !== receipts.length)
    errors.push("Refrain artifact v3 contains duplicate RenderReceipt IDs.");
  const sourceRevision = isRecord(value.receipt)
    ? value.receipt.sourceRevision
    : undefined;
  if (receipts.some((receipt) => receipt.sourceRevision !== sourceRevision))
    errors.push("A RenderReceipt refers to a different AIR source revision.");
  for (const receipt of receipts) {
    const graphError = bindingReceiptGraphError(receipt, bindingByDigest);
    if (graphError) errors.push(graphError);
  }
  if (value.projections !== undefined && !Array.isArray(value.projections))
    errors.push("Refrain artifact v3 projections must be an array.");
  else if (Array.isArray(value.projections))
    for (const projection of value.projections) {
      const error = projectionError(projection, receiptById);
      if (error) errors.push(error);
    }
  return errors;
}

function currentArtifactErrors(value: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (
    !exactKeys(value, [
      "format",
      "performanceBindings",
      "receipt",
      "source",
      ...(value.caption === undefined ? [] : ["caption"]),
      ...(value.defaultBindingId === undefined ? [] : ["defaultBindingId"]),
      ...(value.renderReceipts === undefined ? [] : ["renderReceipts"]),
      ...(value.projections === undefined ? [] : ["projections"]),
    ])
  )
    errors.push("Refrain artifact v1 must use its closed contract.");
  if (value.format !== REFRAIN_ARTIFACT_FORMAT)
    errors.push("Invalid Refrain artifact v1 format.");
  if (!captionIsValid(value.caption)) errors.push("Invalid artifact caption.");
  const parsedSource = parseAir(value.source).source;
  if (!parsedSource) errors.push("The artifact AIR source is invalid.");
  const receiptErrors = parsedSource
    ? sourceReceiptIntegrityErrors(parsedSource, value.receipt)
    : receiptIntegrityErrors(value.receipt);
  if (receiptErrors.length > 0)
    errors.push(
      `The artifact musical receipt failed integrity: ${receiptErrors.join(", ")}.`,
    );
  if (!Array.isArray(value.performanceBindings)) {
    errors.push("Refrain artifact v1 needs a PerformanceBinding array.");
    return errors;
  }
  const bindingsAreValid = value.performanceBindings.every(
    performanceBindingShapeIsValid,
  );
  if (!bindingsAreValid)
    errors.push(
      "Refrain artifact v1 contains an internally invalid PerformanceBinding.",
    );
  if (!bindingsAreValid) return errors;
  const bindings = value.performanceBindings as PerformanceBinding[];
  if (new Set(bindings.map((binding) => binding.id)).size !== bindings.length)
    errors.push(
      "Refrain artifact v1 contains duplicate PerformanceBinding IDs.",
    );
  const bindingByDigest = new Map(
    bindings.map((binding) => [`sha256:${binding.contentSha256}`, binding]),
  );
  if (bindingByDigest.size !== bindings.length)
    errors.push(
      "Refrain artifact v1 contains duplicate PerformanceBinding digests.",
    );
  if (
    value.defaultBindingId !== undefined &&
    (typeof value.defaultBindingId !== "string" ||
      !bindings.some((binding) => binding.id === value.defaultBindingId))
  )
    errors.push("The default PerformanceBinding is absent from the artifact.");
  const receiptsAreValid =
    value.renderReceipts === undefined ||
    (Array.isArray(value.renderReceipts) &&
      value.renderReceipts.every(renderReceiptShapeIsValid));
  if (!receiptsAreValid)
    errors.push("Refrain artifact v1 contains an invalid RenderReceipt.");
  if (!receiptsAreValid) return errors;
  const receipts = (value.renderReceipts ?? []) as RenderReceipt[];
  const receiptById = new Map(
    receipts.map((receipt) => [receipt.renderReceiptId, receipt]),
  );
  if (receiptById.size !== receipts.length)
    errors.push("Refrain artifact v1 contains duplicate RenderReceipt IDs.");
  const sourceRevision = isRecord(value.receipt)
    ? value.receipt.sourceRevision
    : undefined;
  if (receipts.some((receipt) => receipt.sourceRevision !== sourceRevision))
    errors.push("A RenderReceipt refers to a different AIR source revision.");
  for (const receipt of receipts) {
    const graphError = bindingReceiptGraphError(receipt, bindingByDigest);
    if (graphError) errors.push(graphError);
  }
  if (value.projections !== undefined && !Array.isArray(value.projections)) {
    errors.push("Refrain artifact v1 projections must be an array.");
  } else if (Array.isArray(value.projections)) {
    for (const projection of value.projections) {
      const error = projectionError(projection, receiptById);
      if (error) errors.push(error);
    }
  }
  return errors;
}

export function parseRefrainArtifact(
  value: unknown,
): RefrainArtifactParseResult {
  if (!isRecord(value))
    return { ok: false, errors: ["Refrain artifact must be an object."] };
  if (value.format === LEGACY_REFRAIN_ARTIFACT_FORMAT) {
    const errors = legacyArtifactErrors(value);
    return errors.length
      ? { ok: false, errors }
      : {
          ok: true,
          artifact: value as unknown as RefrainArtifact,
          continuity: "valid",
        };
  }
  if (value.format === REFRAIN_ARTIFACT_FORMAT) {
    const errors = currentArtifactErrors(value);
    return errors.length
      ? { ok: false, errors }
      : {
          ok: true,
          artifact: value as unknown as RefrainArtifact,
          continuity: "valid",
        };
  }
  if (value.format === REFRAIN_ARTIFACT_V2_FORMAT) {
    const errors = v2ArtifactErrors(value);
    return errors.length
      ? { ok: false, errors }
      : {
          ok: true,
          artifact: value as unknown as RefrainArtifact,
          continuity: "valid",
        };
  }
  if (value.format === REFRAIN_ARTIFACT_V3_FORMAT) {
    const errors = v3ArtifactErrors(value);
    return errors.length
      ? { ok: false, errors }
      : {
          ok: true,
          artifact: value as unknown as RefrainArtifact,
          continuity: "valid",
        };
  }
  return { ok: false, errors: ["Unsupported Refrain artifact format."] };
}

export function refrainArtifactShapeIsValid(
  value: unknown,
): value is RefrainArtifact {
  return parseRefrainArtifact(value).ok;
}
