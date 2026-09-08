import type { Diagnostic, VoiceRole } from "@refrain/air-schema";
import type { AirSourceV1 } from "@refrain/air-schema/v1";
import { compileAirV1, type CompiledAirV1 } from "@refrain/compiler/v1";
import { createExecutionBundle } from "@refrain/audio-engine/execution";
import { SHA256_ID } from "@refrain/renderer/identity";
import { createInlinePresentationRef } from "@refrain/renderer/presentation-ref";
import {
  performanceStatusForSource,
  type ExactPerformanceBinding,
} from "@refrain/soundpack/binding-status";
import type {
  AirLineage,
  ContinuationRelation,
  RefrainArtifactV3,
} from "@refrain/renderer";
import {
  createRefrainArtifactV3,
  parseRefrainArtifact,
} from "@refrain/renderer/portable";
import {
  AIR_RECEIPT_V1_FORMAT,
  createEmbodimentLineage,
  receiptIdOfV1,
  sourceReceiptIntegrityErrorsV1,
  sourceRevisionOfV1,
  verifyMusicalRelationV1,
  type AirReceiptV1,
  type EmbodimentLineage,
  type MusicalRelationVerificationV1,
  type RelationEvidenceAssertionsV1,
} from "@refrain/renderer/v1";
import { rendererPlaybackCapability } from "@refrain/renderer/playback-capability";
import type { RendererAssetConfig } from "@refrain/renderer";
import {
  COMPLETE_PIECE_PERFORMANCE_BINDING,
  performanceBindingById,
  validateHistoricalPerformanceBinding,
  type PerformanceBinding,
  type PerformanceBindingRuntimeStatus,
} from "@refrain/soundpack";
import {
  PERFORMANCE_BINDING_V1_FORMAT,
  validateHistoricalPerformanceBindingV1,
  type PerformanceBindingV1,
} from "@refrain/soundpack/vnext";

interface HumFromCommonV1 {
  relation: ContinuationRelation;
  expectedSourceRevision?: string;
  evidence?: RelationEvidenceAssertionsV1;
}

type HumArtifactFromV1 = HumFromCommonV1 & {
  parentArtifact: RefrainArtifactV3;
  embodiment?: {
    instrumentMap: EmbodimentLineage["instrumentMap"];
  };
};

type HumLegacyFromV1 = HumFromCommonV1 & {
  air: string | unknown;
  receipt: AirReceiptV1;
  embodiment?: {
    parentPerformanceBinding: PerformanceBinding;
    childPerformanceBinding: PerformanceBinding;
    instrumentMap: EmbodimentLineage["instrumentMap"];
  };
};

type HumFromV1 = HumArtifactFromV1 | HumLegacyFromV1;

export interface HumInputV1 {
  air: string | unknown;
  caption?: string;
  performance?: { bindingId: string };
  from?: HumFromV1;
}

export interface HumV1Defaults {
  defaultPerformanceBindingId?: string;
  playbackAssets?: RendererAssetConfig;
  /** File-based authoring may explicitly supply an exact binding, never a hidden default. */
  explicitPerformanceBinding?: ExactPerformanceBinding;
}

export interface CompiledAirSummaryV1 {
  format: "compiled-air-summary@1-experimental";
  durationBeats: number;
  durationSeconds: number;
  tempo: number;
  pickupBeats: number;
  meters: Array<{ bar: number; meter: string; startBeat: number }>;
  eventCount: number;
  voices: Array<{
    voiceId: string;
    role: VoiceRole;
    instrument: string;
    eventCount: number;
  }>;
  motifOccurrences: Array<{
    motif: string;
    count: number;
    voiceIds: string[];
    anchors: string[];
  }>;
  phraseOccurrences: Array<{
    phrase: string;
    count: number;
    voiceIds: string[];
    anchors: string[];
  }>;
  authoring: {
    literalVoiceCount: number;
    realizedVoiceCount: number;
    harmonyPlanCount: number;
    phraseDefinitionCount: number;
    grooveDefinitionCount: number;
    segmentCount: number;
    techniqueIds: string[];
    grooveIds: string[];
    sectionLabels: string[];
    vocabularyId: string;
  };
}

export interface HumSuccessV1 {
  ok: true;
  source: AirSourceV1;
  summary: CompiledAirSummaryV1;
  diagnostics: Diagnostic[];
  receipt: AirReceiptV1;
  performanceBinding?: ExactPerformanceBinding;
  performanceStatus: PerformanceBindingRuntimeStatus;
  caption?: string;
  presentation?: { url: string };
}

export type HumResultV1 =
  { ok: false; diagnostics: Diagnostic[] } | HumSuccessV1;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function withPrefix(diagnostics: Diagnostic[], prefix: string): Diagnostic[] {
  return diagnostics.map((item) => ({
    ...item,
    path: item.path === "$" ? prefix : `${prefix}${item.path.slice(1)}`,
  }));
}

export function summarizeCompiledAirV1(
  source: AirSourceV1,
  compiled: CompiledAirV1,
): CompiledAirSummaryV1 {
  const byVoice = new Map<string, number>();
  for (const event of compiled.events)
    byVoice.set(event.voiceId, (byVoice.get(event.voiceId) ?? 0) + 1);
  const motifs = new Map<
    string,
    { count: number; voiceIds: Set<string>; anchors: Set<string> }
  >();
  for (const occurrence of compiled.motifOccurrences) {
    const item = motifs.get(occurrence.motif) ?? {
      count: 0,
      voiceIds: new Set<string>(),
      anchors: new Set<string>(),
    };
    item.count += 1;
    item.voiceIds.add(occurrence.voiceId);
    item.anchors.add(occurrence.anchor);
    motifs.set(occurrence.motif, item);
  }
  const phrases = new Map<
    string,
    { count: number; voiceIds: Set<string>; anchors: Set<string> }
  >();
  for (const occurrence of compiled.phraseOccurrences) {
    const item = phrases.get(occurrence.phrase) ?? {
      count: 0,
      voiceIds: new Set<string>(),
      anchors: new Set<string>(),
    };
    item.count += 1;
    item.voiceIds.add(occurrence.voiceId);
    item.anchors.add(occurrence.anchor);
    phrases.set(occurrence.phrase, item);
  }
  return {
    format: "compiled-air-summary@1-experimental",
    durationBeats: compiled.durationBeats,
    durationSeconds: compiled.durationSeconds,
    tempo: compiled.tempo,
    pickupBeats: compiled.pickupBeats,
    meters: compiled.meterChanges.map(({ bar, meter, startBeat }) => ({
      bar,
      meter,
      startBeat,
    })),
    eventCount: compiled.events.length,
    voices: source.voices.map((voice) => ({
      voiceId: voice.id,
      role: voice.role,
      instrument: voice.instrument,
      eventCount: byVoice.get(voice.id) ?? 0,
    })),
    motifOccurrences: [...motifs]
      .sort(([left], [right]) => compareText(left, right))
      .map(([motif, item]) => ({
        motif,
        count: item.count,
        voiceIds: [...item.voiceIds].sort(compareText),
        anchors: [...item.anchors].sort(compareText),
      })),
    phraseOccurrences: [...phrases]
      .sort(([left], [right]) => compareText(left, right))
      .map(([phrase, item]) => ({
        phrase,
        count: item.count,
        voiceIds: [...item.voiceIds].sort(compareText),
        anchors: [...item.anchors].sort(compareText),
      })),
    authoring: {
      literalVoiceCount: source.voices.filter(
        (voice) => typeof voice.part === "string",
      ).length,
      realizedVoiceCount: source.voices.filter((voice) =>
        Array.isArray(voice.realize),
      ).length,
      harmonyPlanCount: source.harmony?.length ?? 0,
      phraseDefinitionCount: source.phrases?.length ?? 0,
      grooveDefinitionCount: source.grooves?.length ?? 0,
      segmentCount: source.voices.reduce(
        (total, voice) => total + (voice.realize?.length ?? 0),
        0,
      ),
      techniqueIds: [...compiled.techniquesUsed],
      grooveIds: [...compiled.groovesUsed],
      sectionLabels: (source.sections ?? [])
        .map((section) => section.id)
        .sort(compareText),
      vocabularyId: source.vocabulary.id,
    },
  };
}

function presentationUrl(artifact: RefrainArtifactV3): {
  url?: string;
  diagnostic?: Diagnostic;
} {
  const base = process.env.REFRAIN_PRESENTATION_BASE_URL;
  if (!base) return {};
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return {
      diagnostic: {
        severity: "warning",
        code: "invalid_presentation_base",
        path: "$runtime.presentation",
        message: "REFRAIN_PRESENTATION_BASE_URL is not an absolute URL.",
      },
    };
  }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password ||
    url.hash
  )
    return {
      diagnostic: {
        severity: "warning",
        code: "invalid_presentation_base",
        path: "$runtime.presentation",
        message:
          "The presentation base must be HTTPS or loopback HTTP without credentials or a fragment.",
      },
    };
  const delivery = createInlinePresentationRef(artifact);
  if (!delivery.ok)
    return {
      diagnostic: {
        severity: "note",
        code: "presentation_too_large",
        path: "$runtime.presentation",
        message: `The presentation fragment is ${delivery.fragmentChars} characters; Tier 0 and export remain available.`,
      },
    };
  url.hash = new URLSearchParams({
    artifact: delivery.ref.artifactSha256,
    bytes: delivery.ref.delivery.fragment,
  }).toString();
  return { url: url.href };
}

function selectPerformanceBinding(
  source: AirSourceV1,
  bindingId: string | undefined,
  defaults: HumV1Defaults,
  parent?: RefrainArtifactV3,
): {
  binding?: ExactPerformanceBinding;
  status: PerformanceBindingRuntimeStatus;
  diagnostic?: Diagnostic;
} {
  // A carried identity is authoritative even when the installed catalogue changes.
  // Root defaults must never fill an unbound or ambiguous parent implicitly.
  const requested =
    defaults.explicitPerformanceBinding ??
    (bindingId !== undefined
      ? (parent?.performanceBindings.find((b) => b.id === bindingId) ??
        performanceBindingById.get(bindingId))
      : parent
        ? artifactBinding(parent)
        : defaults.defaultPerformanceBindingId
          ? performanceBindingById.get(defaults.defaultPerformanceBindingId)
          : COMPLETE_PIECE_PERFORMANCE_BINDING);
  if (!requested) {
    const unknown =
      bindingId !== undefined ||
      (!parent && defaults.defaultPerformanceBindingId !== undefined);
    const message = unknown
      ? `Unknown performance binding ${bindingId ?? defaults.defaultPerformanceBindingId}.`
      : "The parent has no selected exact performance binding. Choose a carried binding explicitly to add sound.";
    return {
      status: {
        status: "unavailable",
        reason: "performance-binding-invalid",
        message,
        errors: [message],
      },
      diagnostic: {
        severity: unknown ? "error" : "note",
        code: unknown
          ? "unknown_performance_binding"
          : "exact_sound_unavailable",
        path: "$.performance.bindingId",
        message,
      },
    };
  }
  const errors = bindingIntegrityErrors(requested);
  if (errors.length)
    return {
      status: {
        status: "unavailable",
        reason: "performance-binding-invalid",
        message: errors.join(" "),
        errors,
      },
      diagnostic: {
        severity: "error",
        code: "invalid_performance_binding",
        path: "$.performance",
        message: errors.join(" "),
      },
    };
  const status = performanceStatusForSource(requested, source);
  return {
    binding: requested,
    status,
    ...(status.status === "unavailable"
      ? {
          diagnostic: {
            severity: "note" as const,
            code: "exact_sound_unavailable",
            path: "$.performance",
            message: status.message,
          },
        }
      : {}),
  };
}

function embodimentDiagnostic(
  code: string,
  path: string,
  message: string,
): HumResultV1 {
  return {
    ok: false,
    diagnostics: [{ severity: "error", code, path, message }],
  };
}

function instrumentMapMatchesSources(
  parent: AirSourceV1,
  child: AirSourceV1,
  map: EmbodimentLineage["instrumentMap"],
): boolean {
  const parentInstruments = [
    ...new Set(parent.voices.map((voice) => voice.instrument)),
  ].sort(compareText);
  const childInstruments = [
    ...new Set(child.voices.map((voice) => voice.instrument)),
  ].sort(compareText);
  const mappedParents = map.map((entry) => entry.parentInstrument);
  const mappedChildren = [
    ...new Set(map.map((entry) => entry.childInstrument)),
  ].sort(compareText);
  return (
    map.length > 0 &&
    new Set(mappedParents).size === map.length &&
    JSON.stringify([...mappedParents].sort(compareText)) ===
      JSON.stringify(parentInstruments) &&
    JSON.stringify(mappedChildren) === JSON.stringify(childInstruments)
  );
}

function artifactBinding(
  artifact: RefrainArtifactV3,
): PerformanceBinding | PerformanceBindingV1 | undefined {
  if (artifact.defaultBindingId)
    return artifact.performanceBindings.find(
      (binding) => binding.id === artifact.defaultBindingId,
    );
  return artifact.performanceBindings.length === 1
    ? artifact.performanceBindings[0]
    : undefined;
}

function bindingIntegrityErrors(
  binding: PerformanceBinding | PerformanceBindingV1,
): string[] {
  return binding.format === PERFORMANCE_BINDING_V1_FORMAT
    ? validateHistoricalPerformanceBindingV1(binding)
    : validateHistoricalPerformanceBinding(binding);
}

export function humV1(
  input: HumInputV1,
  defaults: HumV1Defaults = {},
): HumResultV1 {
  if (
    input.caption !== undefined &&
    (typeof input.caption !== "string" || input.caption.length > 1000)
  )
    return {
      ok: false,
      diagnostics: [
        {
          severity: "error",
          code: "caption_too_long",
          path: "$.caption",
          message: "Caption must be at most 1000 characters.",
        },
      ],
    };
  const current = compileAirV1(input.air);
  if (!current.source || !current.compiled)
    return { ok: false, diagnostics: current.diagnostics };
  let exactParent: RefrainArtifactV3 | undefined;
  if (input.from && "parentArtifact" in input.from) {
    const parsed = parseRefrainArtifact(input.from.parentArtifact);
    if (
      !parsed.ok ||
      parsed.artifact.format !== "refrain-artifact@3-experimental"
    )
      return embodimentDiagnostic(
        "invalid_parent_artifact",
        "$.from.parentArtifact",
        parsed.ok
          ? "AIR@1 continuation requires an exact Artifact@3 parent."
          : `The exact parent artifact failed integrity: ${parsed.errors.join(" ")}`,
      );
    exactParent = parsed.artifact;
  }
  let performance = selectPerformanceBinding(
    current.source,
    input.performance?.bindingId,
    defaults,
    exactParent,
  );
  if (performance.diagnostic?.severity === "error")
    return { ok: false, diagnostics: [performance.diagnostic] };
  const sourceRevision = sourceRevisionOfV1(current.source);
  let airId = sourceRevision;
  let lineage: AirLineage | undefined;
  let embodiment: EmbodimentLineage | undefined;
  let verification: MusicalRelationVerificationV1 = {
    contract: "musical-relation@1-experimental",
    status: "not_applicable",
    motifLinks: [],
    orchestrationLinks: [],
    recurrences: [],
    contrasts: [],
    absences: [],
  };
  if (input.from) {
    const artifactFrom: HumArtifactFromV1 | undefined =
      "parentArtifact" in input.from ? input.from : undefined;
    const legacyFrom: HumLegacyFromV1 | undefined = artifactFrom
      ? undefined
      : (input.from as HumLegacyFromV1);
    let parentAir: string | unknown;
    let parentReceipt: AirReceiptV1;
    let parentArtifact: RefrainArtifactV3 | undefined;
    if (artifactFrom) {
      parentArtifact = exactParent!;
      parentAir = parentArtifact.source;
      parentReceipt = parentArtifact.receipt;
    } else {
      parentAir = legacyFrom!.air;
      parentReceipt = legacyFrom!.receipt;
    }
    const parent = compileAirV1(parentAir);
    if (!parent.source || !parent.compiled)
      return {
        ok: false,
        diagnostics: withPrefix(
          parent.diagnostics,
          parentArtifact ? "$.from.parentArtifact.source" : "$.from.air",
        ),
      };
    const parentRevision = sourceRevisionOfV1(parent.source);
    if (sourceReceiptIntegrityErrorsV1(parent.source, parentReceipt).length > 0)
      return {
        ok: false,
        diagnostics: [
          {
            severity: "error",
            code: "invalid_parent_receipt",
            path: parentArtifact
              ? "$.from.parentArtifact.receipt"
              : "$.from.receipt",
            message:
              "The AIR@1 parent receipt failed its closed identity contract.",
          },
        ],
      };
    if (
      input.from.expectedSourceRevision !== undefined &&
      (!SHA256_ID.test(input.from.expectedSourceRevision) ||
        input.from.expectedSourceRevision !== parentRevision)
    )
      return {
        ok: false,
        diagnostics: [
          {
            severity: "error",
            code: "source_revision_mismatch",
            path: "$.from.expectedSourceRevision",
            message: `The exact parent source revision is ${parentRevision}.`,
          },
        ],
      };
    if (sourceRevision === parentRevision)
      return {
        ok: false,
        diagnostics: [
          {
            severity: "error",
            code: "same_source_continuation",
            path: "$.air",
            message: "A continuation must change the canonical AIR source.",
          },
        ],
      };
    const verified = verifyMusicalRelationV1(
      parent.compiled,
      current.compiled,
      input.from.relation,
      input.from.evidence,
    );
    if (!verified.verification)
      return { ok: false, diagnostics: [verified.diagnostic!] };
    verification = verified.verification;
    lineage = {
      relation: input.from.relation,
      parentSourceRevision: parentRevision,
      parentReceiptId: parentReceipt.receiptId,
      parentAirId: parentReceipt.airId,
    };
    if (input.from.relation === "revise" || input.from.relation === "extend")
      airId = parentReceipt.airId;
    if (input.from.embodiment) {
      const parentBinding = parentArtifact
        ? artifactBinding(parentArtifact)
        : legacyFrom?.embodiment?.parentPerformanceBinding;
      const childBinding = parentArtifact
        ? performance.binding
        : legacyFrom?.embodiment?.childPerformanceBinding;
      if (!parentBinding)
        return embodimentDiagnostic(
          "parent_embodiment_binding_unavailable",
          "$.from.parentArtifact.performanceBindings",
          "Embodiment lineage requires one exact default parent binding in the parent artifact.",
        );
      if (bindingIntegrityErrors(parentBinding).length > 0)
        return embodimentDiagnostic(
          "invalid_parent_embodiment_binding",
          parentArtifact
            ? "$.from.parentArtifact.performanceBindings"
            : "$.from.embodiment.parentPerformanceBinding",
          "The parent embodiment binding failed its exact content identity contract.",
        );
      if (!childBinding)
        return embodimentDiagnostic(
          "embodiment_sound_unavailable",
          "$.performance",
          "Embodiment lineage requires an available exact child performance binding.",
        );
      if (bindingIntegrityErrors(childBinding).length > 0)
        return embodimentDiagnostic(
          "invalid_child_embodiment_binding",
          parentArtifact
            ? "$.performance.bindingId"
            : "$.from.embodiment.childPerformanceBinding",
          "The child embodiment binding failed its exact content identity contract.",
        );
      if (performance.status.status !== "available" || !performance.binding)
        return embodimentDiagnostic(
          "embodiment_sound_unavailable",
          "$.from.embodiment.childPerformanceBinding",
          "Embodiment lineage requires an available exact child performance binding.",
        );
      if (childBinding.contentSha256 !== performance.binding.contentSha256)
        return embodimentDiagnostic(
          "embodiment_binding_mismatch",
          "$.from.embodiment.childPerformanceBinding",
          "The child embodiment binding is not the exact binding selected for this AIR.",
        );
      const parentMissing = [
        ...new Set(parent.source.voices.map((voice) => voice.instrument)),
      ].filter(
        (instrument) =>
          parentBinding.soundProfile.selections[instrument] === undefined,
      );
      const childMissing = [
        ...new Set(current.source.voices.map((voice) => voice.instrument)),
      ].filter(
        (instrument) =>
          childBinding.soundProfile.selections[instrument] === undefined,
      );
      if (parentMissing.length > 0 || childMissing.length > 0)
        return embodimentDiagnostic(
          "embodiment_instrument_unavailable",
          "$.from.embodiment",
          "Both exact bindings must embody every instrument used by their respective AIR sources.",
        );
      if (
        !instrumentMapMatchesSources(
          parent.source,
          current.source,
          input.from.embodiment.instrumentMap,
        )
      )
        return embodimentDiagnostic(
          "embodiment_instrument_map_mismatch",
          "$.from.embodiment.instrumentMap",
          "The embodiment instrument map must exactly cover the parent and child source instruments.",
        );
      embodiment = createEmbodimentLineage({
        parentPerformanceBindingDigest: `sha256:${parentBinding.contentSha256}`,
        childPerformanceBindingDigest: `sha256:${childBinding.contentSha256}`,
        instrumentMap: input.from.embodiment.instrumentMap,
      });
    }
  }

  if (performance.binding && performance.status.status === "available") {
    let executionError: string | undefined;
    let assetRequirements:
      ReadonlyArray<{ kind: "wav" | "soundfont" }> | undefined;
    try {
      assetRequirements = createExecutionBundle(current.compiled, {
        performanceBinding: performance.binding,
      }).plan.assetRequirements;
    } catch (cause) {
      executionError =
        cause instanceof Error
          ? cause.message
          : "The exact execution bundle could not be constructed.";
    }
    const capability = defaults.playbackAssets
      ? rendererPlaybackCapability({
          hasBinding: true,
          completePiece: [
            "performance-plan@3-experimental",
            "performance-plan@4-experimental",
          ].includes(performance.binding.renderer.performancePlanFormat),
          assetRequirements,
          executionError,
          assets: defaults.playbackAssets,
        })
      : executionError
        ? {
            status: "unavailable" as const,
            reason: "execution-bundle-invalid" as const,
            message: executionError,
          }
        : { status: "available" as const };
    if (capability.status === "unavailable") {
      const reason =
        capability.reason === "sample-origin-missing" ||
        capability.reason === "soundfont-origin-missing"
          ? capability.reason
          : "runtime-validation-failed";
      performance = {
        binding: performance.binding,
        status: {
          status: "unavailable",
          reason,
          message: capability.message,
          errors: [capability.message],
        },
        diagnostic: {
          severity: "note",
          code: "exact_sound_unavailable",
          path: "$.performance",
          message: `Canonical AIR, receipt, and exact binding remain valid. ${capability.message}`,
        },
      };
    }
  }

  const core: Omit<AirReceiptV1, "receiptId"> = {
    format: AIR_RECEIPT_V1_FORMAT,
    sourceRevision,
    airId,
    sourceFormat: current.source.format,
    verification,
    ...(lineage ? { lineage } : {}),
    ...(embodiment ? { embodiment } : {}),
  };
  const receipt: AirReceiptV1 = { ...core, receiptId: receiptIdOfV1(core) };
  const receiptErrors = sourceReceiptIntegrityErrorsV1(current.source, receipt);
  if (receiptErrors.length > 0)
    return {
      ok: false,
      diagnostics: [
        {
          severity: "error",
          code: "internal_receipt_integrity",
          path: "$.receipt",
          message: `Refrain refused to emit a non-reproducible receipt (${receiptErrors.join(", ")}).`,
        },
      ],
    };
  const presentation = presentationUrl(
    createRefrainArtifactV3({
      source: current.source,
      receipt,
      ...(performance.binding
        ? { performanceBinding: performance.binding }
        : {}),
      ...(input.caption === undefined ? {} : { caption: input.caption }),
    }),
  );
  return {
    ok: true,
    source: current.source,
    summary: summarizeCompiledAirV1(current.source, current.compiled),
    diagnostics: [
      ...current.diagnostics,
      ...(performance.diagnostic ? [performance.diagnostic] : []),
      ...(presentation.diagnostic ? [presentation.diagnostic] : []),
    ],
    receipt,
    ...(performance.binding ? { performanceBinding: performance.binding } : {}),
    performanceStatus: performance.status,
    ...(input.caption === undefined ? {} : { caption: input.caption }),
    ...(presentation.url ? { presentation: { url: presentation.url } } : {}),
  };
}
