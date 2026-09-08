import {
  type AirSource,
  type Diagnostic,
  type VoiceRole,
} from "@refrain/air-schema";
import {
  compileAir,
  transformNormalizedMotifMaterial,
  type CompiledAir,
  type CompiledEvent,
  type MotifOccurrence,
  type NormalizedMotifAtom,
} from "@refrain/compiler";
import {
  evidenceIdOf,
  MAX_PRESENTATION_FRAGMENT_CHARS,
  receiptIdOf,
  receiptIntegrityIsValid,
  SHA256_ID,
  sourceRevisionOf,
} from "@refrain/renderer/identity";
import type {
  AirLineage,
  AirReceipt,
  ContinuationRelation,
  MotifLinkEvidence,
  MusicalRelationVerification,
  PresentationEnvelope,
  VerifiedMotifLink,
} from "@refrain/renderer";
import {
  DEFAULT_PERFORMANCE_BINDING,
  performanceBindingById,
  type InstrumentId,
  type PerformanceBinding,
} from "@refrain/soundpack";

export interface HumInput {
  air: string | unknown;
  caption?: string;
  performance?: {
    bindingId: string;
  };
  from?: {
    air: string | unknown;
    receipt: AirReceipt;
    relation: ContinuationRelation;
    expectedSourceRevision?: string;
    motifLinks?: MotifLinkEvidence[];
  };
}

export interface CompiledVoiceSummary {
  voiceId: string;
  role: VoiceRole;
  instrument: InstrumentId;
  eventCount: number;
}

export interface CompiledMotifSummary {
  motif: string;
  count: number;
  voiceIds: string[];
  anchors: string[];
}

export interface CompiledAirSummary {
  format: "compiled-air-summary@0-experimental";
  durationBeats: number;
  durationSeconds: number;
  meter: string;
  tempo: number;
  eventCount: number;
  voices: CompiledVoiceSummary[];
  motifOccurrences: CompiledMotifSummary[];
  authoring: {
    literalVoiceCount: number;
    realizedVoiceCount: number;
    harmonyPlanCount: number;
    segmentCount: number;
    sectionLabels: string[];
  };
}

export interface HumSuccess {
  ok: true;
  source: AirSource;
  summary: CompiledAirSummary;
  diagnostics: Diagnostic[];
  receipt: AirReceipt;
  performanceBinding: PerformanceBinding;
  caption?: string;
  presentation?: { url: string };
}

export type HumResult = { ok: false; diagnostics: Diagnostic[] } | HumSuccess;

export { receiptIdOf, sourceRevisionOf };

export function receiptIsValid(receipt: unknown): receipt is AirReceipt {
  return receiptIntegrityIsValid(receipt);
}

function withPrefix(diagnostics: Diagnostic[], prefix: string): Diagnostic[] {
  return diagnostics.map((item) => ({
    ...item,
    path: item.path === "$" ? prefix : `${prefix}${item.path.slice(1)}`,
  }));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function summarizeCompiledAir(
  source: AirSource,
  compiled: CompiledAir,
): CompiledAirSummary {
  const eventsByVoice = new Map<string, number>();
  for (const event of compiled.events) {
    eventsByVoice.set(
      event.voiceId,
      (eventsByVoice.get(event.voiceId) ?? 0) + 1,
    );
  }

  const motifs = new Map<
    string,
    { count: number; voiceIds: Set<string>; anchors: Set<string> }
  >();
  for (const occurrence of compiled.motifOccurrences) {
    const summary = motifs.get(occurrence.motif) ?? {
      count: 0,
      voiceIds: new Set<string>(),
      anchors: new Set<string>(),
    };
    summary.count += 1;
    summary.voiceIds.add(occurrence.voiceId);
    summary.anchors.add(occurrence.anchor);
    motifs.set(occurrence.motif, summary);
  }

  return {
    format: "compiled-air-summary@0-experimental",
    durationBeats: compiled.durationBeats,
    durationSeconds: compiled.durationSeconds,
    meter: compiled.meter,
    tempo: compiled.tempo,
    eventCount: compiled.events.length,
    voices: source.voices.map((voice) => ({
      voiceId: voice.id,
      role: voice.role,
      instrument: voice.instrument as InstrumentId,
      eventCount: eventsByVoice.get(voice.id) ?? 0,
    })),
    motifOccurrences: [...motifs]
      .sort(([left], [right]) => compareText(left, right))
      .map(([motif, summary]) => ({
        motif,
        count: summary.count,
        voiceIds: [...summary.voiceIds].sort(compareText),
        anchors: [...summary.anchors].sort(compareText),
      })),
    authoring: {
      literalVoiceCount: source.voices.filter(
        (voice) => "part" in voice && typeof voice.part === "string",
      ).length,
      realizedVoiceCount: source.voices.filter(
        (voice) => "realize" in voice && Array.isArray(voice.realize),
      ).length,
      harmonyPlanCount: source.harmony?.length ?? 0,
      segmentCount: source.voices.reduce(
        (total, voice) =>
          total +
          ("realize" in voice && Array.isArray(voice.realize)
            ? voice.realize.length
            : 0),
        0,
      ),
      sectionLabels: [
        ...new Set([
          ...(source.sections?.map((section) => section.id) ?? []),
          ...source.voices.flatMap((voice) =>
            "realize" in voice && Array.isArray(voice.realize)
              ? voice.realize.flatMap((segment) =>
                  segment.section ? [segment.section] : [],
                )
              : [],
          ),
        ]),
      ].sort(compareText),
    },
  };
}

function motifEvidence(
  compiled: CompiledAir,
  motif: string,
  anchor: string,
):
  { occurrence: MotifOccurrence; material: NormalizedMotifAtom[] } | undefined {
  const occurrence = compiled.motifOccurrences.find(
    (item) => item.motif === motif && item.anchor === anchor,
  );
  if (!occurrence) return undefined;
  return { occurrence, material: occurrence.material };
}

function evidenceSequencesEqual(
  left: NormalizedMotifAtom[],
  right: NormalizedMotifAtom[],
): boolean {
  return (
    left.length === right.length &&
    left.every((atom, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        atom.notes.length === other.notes.length &&
        atom.notes.every(
          (midi, noteIndex) => midi === other.notes[noteIndex],
        ) &&
        Math.abs(atom.relativeStartBeat - other.relativeStartBeat) < 0.0001 &&
        Math.abs(atom.durationBeats - other.durationBeats) < 0.0001
      );
    })
  );
}

function relationDiagnostic(code: string, message: string): Diagnostic {
  return {
    severity: "error",
    code,
    path: "$.from.motifLinks",
    message,
  };
}

function verifyMotifLinks(
  parent: CompiledAir,
  child: CompiledAir,
  relation: ContinuationRelation,
  links: MotifLinkEvidence[],
): { links?: VerifiedMotifLink[]; diagnostic?: Diagnostic } {
  if (relation === "variation") {
    const hasTransform = links.some(
      (link) =>
        link.transform.transpose !== 0 ||
        link.transform.stretch !== 1 ||
        link.transform.invert ||
        link.transform.retrograde,
    );
    if (!hasTransform) {
      return {
        diagnostic: relationDiagnostic(
          "variation_requires_transform",
          "variation needs at least one non-identity deterministic transform.",
        ),
      };
    }
  }
  const verified: VerifiedMotifLink[] = [];
  for (const link of links) {
    const parentMotif = motifEvidence(parent, link.parent, link.parentAnchor);
    const childMotif = motifEvidence(child, link.child, link.childAnchor);
    if (!parentMotif || !childMotif) {
      return {
        diagnostic: relationDiagnostic(
          "motif_anchor_not_found",
          `Could not resolve compiled occurrences ${link.parentAnchor} → ${link.childAnchor}.`,
        ),
      };
    }
    const identity =
      link.transform.transpose === 0 &&
      link.transform.stretch === 1 &&
      !link.transform.invert &&
      !link.transform.retrograde;
    if (relation === "quote" && !identity) {
      return {
        diagnostic: relationDiagnostic(
          "quote_requires_exact_link",
          "quote links must use the identity transform.",
        ),
      };
    }
    const expected = transformNormalizedMotifMaterial(
      parentMotif.material,
      link.transform,
    );
    if (!evidenceSequencesEqual(expected, childMotif.material)) {
      return {
        diagnostic: relationDiagnostic(
          "motif_evidence_mismatch",
          `Compiled motif ${link.child} is not the declared transform of ${link.parent}.`,
        ),
      };
    }
    verified.push(link);
  }
  return {
    links: verified.sort(
      (left, right) =>
        compareText(left.parent, right.parent) ||
        compareText(left.child, right.child) ||
        compareText(left.parentAnchor, right.parentAnchor) ||
        compareText(left.childAnchor, right.childAnchor),
    ),
  };
}

function prefixEvent(event: CompiledEvent): unknown {
  return {
    voiceId: event.voiceId,
    role: event.role,
    instrument: event.instrument,
    midi: event.midi,
    startBeat: event.startBeat,
    durationBeats: event.durationBeats,
    soundingDurationBeats: event.soundingDurationBeats,
    velocity: event.velocity,
    gainDb: event.gainDb,
    pan: event.pan,
    bar: event.bar,
    articulation: event.articulation,
    gate: event.gate,
    source: event.source,
    motif: event.motif ?? null,
    motifOccurrence: event.motifOccurrence ?? null,
  };
}

function verifyRelation(
  parent: CompiledAir,
  child: CompiledAir,
  relation: ContinuationRelation,
  links: MotifLinkEvidence[] | undefined,
): { verification?: MusicalRelationVerification; diagnostic?: Diagnostic } {
  if ((relation === "quote" || relation === "variation") && !links?.length) {
    return {
      diagnostic: relationDiagnostic(
        "missing_relation_evidence",
        `${relation} requires at least one motifLinks assertion.`,
      ),
    };
  }
  if (relation === "extend") {
    if (child.durationBeats <= parent.durationBeats) {
      return {
        diagnostic: {
          severity: "error",
          code: "extension_not_longer",
          path: "$.air",
          message:
            "extend requires a child compiled schedule longer than its parent.",
        },
      };
    }
    const prefixMatches =
      child.tempo === parent.tempo &&
      child.meter === parent.meter &&
      parent.events.every((event, index) => {
        const childEvent = child.events[index];
        return (
          childEvent !== undefined &&
          JSON.stringify(prefixEvent(event)) ===
            JSON.stringify(prefixEvent(childEvent))
        );
      });
    if (!prefixMatches) {
      return {
        diagnostic: {
          severity: "error",
          code: "extension_prefix_mismatch",
          path: "$.air",
          message:
            "extend requires the complete prior compiled event schedule as an exact prefix.",
        },
      };
    }
    const core: Omit<MusicalRelationVerification, "evidenceId"> = {
      contract: "musical-relation@0-experimental",
      status: "verified",
      motifLinks: [],
      prefix: {
        parentEventCount: parent.events.length,
        childEventCount: child.events.length,
        parentDurationBeats: parent.durationBeats,
        childDurationBeats: child.durationBeats,
      },
    };
    return { verification: { ...core, evidenceId: evidenceIdOf(core) } };
  }
  if (links?.length) {
    const result = verifyMotifLinks(parent, child, relation, links);
    if (result.diagnostic) return { diagnostic: result.diagnostic };
    const core: Omit<MusicalRelationVerification, "evidenceId"> = {
      contract: "musical-relation@0-experimental",
      status: "verified",
      motifLinks: result.links ?? [],
    };
    return { verification: { ...core, evidenceId: evidenceIdOf(core) } };
  }
  return {
    verification: {
      contract: "musical-relation@0-experimental",
      status: "declared",
      motifLinks: [],
    },
  };
}

function presentationUrl(envelope: PresentationEnvelope): {
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
  ) {
    return {
      diagnostic: {
        severity: "warning",
        code: "invalid_presentation_base",
        path: "$runtime.presentation",
        message:
          "The presentation base must be HTTPS or loopback HTTP and must not contain credentials or a fragment.",
      },
    };
  }
  const payload = Buffer.from(JSON.stringify(envelope), "utf8").toString(
    "base64url",
  );
  if (payload.length > MAX_PRESENTATION_FRAGMENT_CHARS) {
    return {
      diagnostic: {
        severity: "note",
        code: "presentation_too_large",
        path: "$runtime.presentation",
        message: `The compact presentation fragment is ${payload.length} characters; the experimental limit is ${MAX_PRESENTATION_FRAGMENT_CHARS}. Tier 0 and export remain available.`,
      },
    };
  }
  url.hash = `air=${payload}`;
  return { url: url.href };
}

export function hum(input: HumInput): HumResult {
  if (
    input.caption !== undefined &&
    (typeof input.caption !== "string" || input.caption.length > 1000)
  ) {
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
  }
  const performanceBinding = input.performance?.bindingId
    ? performanceBindingById.get(input.performance.bindingId)
    : DEFAULT_PERFORMANCE_BINDING;
  if (!performanceBinding) {
    return {
      ok: false,
      diagnostics: [
        {
          severity: "error",
          code: "unknown_performance_binding",
          path: "$.performance.bindingId",
          message: `Unknown performance binding ${input.performance?.bindingId}.`,
          hint: `Use one of: ${[...performanceBindingById.keys()].join(", ")}.`,
        },
      ],
    };
  }
  const current = compileAir(input.air);
  if (!current.source || !current.compiled) {
    return { ok: false, diagnostics: current.diagnostics };
  }

  const sourceRevision = sourceRevisionOf(current.source);
  let lineage: AirLineage | undefined;
  let verification: MusicalRelationVerification = {
    contract: "musical-relation@0-experimental",
    status: "not_applicable",
    motifLinks: [],
  };
  let airId = sourceRevision;
  if (input.from) {
    const parent = compileAir(input.from.air);
    if (!parent.source || !parent.compiled) {
      return {
        ok: false,
        diagnostics: withPrefix(parent.diagnostics, "$.from.air"),
      };
    }
    const parentSourceRevision = sourceRevisionOf(parent.source);
    if (!receiptIsValid(input.from.receipt)) {
      return {
        ok: false,
        diagnostics: [
          {
            severity: "error",
            code: "invalid_parent_receipt",
            path: "$.from.receipt",
            message:
              "The supplied parent receipt is malformed or its receiptId does not match its canonical identity.",
          },
        ],
      };
    }
    if (input.from.receipt.sourceRevision !== parentSourceRevision) {
      return {
        ok: false,
        diagnostics: [
          {
            severity: "error",
            code: "parent_source_mismatch",
            path: "$.from.receipt.sourceRevision",
            message: `The parent source compiles to ${parentSourceRevision}, not ${input.from.receipt.sourceRevision}.`,
          },
        ],
      };
    }
    if (
      input.from.expectedSourceRevision &&
      !SHA256_ID.test(input.from.expectedSourceRevision)
    ) {
      return {
        ok: false,
        diagnostics: [
          {
            severity: "error",
            code: "invalid_source_revision",
            path: "$.from.expectedSourceRevision",
            message:
              "expectedSourceRevision must be a complete lowercase sha256 identifier.",
          },
        ],
      };
    }
    if (
      input.from.expectedSourceRevision &&
      input.from.expectedSourceRevision !== parentSourceRevision
    ) {
      return {
        ok: false,
        diagnostics: [
          {
            severity: "error",
            code: "source_revision_mismatch",
            path: "$.from.expectedSourceRevision",
            message: `Expected ${input.from.expectedSourceRevision}, but the supplied parent source is ${parentSourceRevision}.`,
            hint: "Use the sourceRevision derived from the exact prior canonical source.",
          },
        ],
      };
    }
    if (sourceRevision === parentSourceRevision) {
      return {
        ok: false,
        diagnostics: [
          {
            severity: "error",
            code: "same_source_continuation",
            path: "$.air",
            message: `A ${input.from.relation} continuation must change the canonical source.`,
          },
        ],
      };
    }
    const relationVerification = verifyRelation(
      parent.compiled,
      current.compiled,
      input.from.relation,
      input.from.motifLinks,
    );
    if (!relationVerification.verification) {
      return {
        ok: false,
        diagnostics: [
          relationVerification.diagnostic ?? {
            severity: "error",
            code: "relation_verification_failed",
            path: "$.from",
            message: "The declared musical relation could not be verified.",
          },
        ],
      };
    }
    verification = relationVerification.verification;
    lineage = {
      relation: input.from.relation,
      parentSourceRevision,
      parentReceiptId: input.from.receipt.receiptId,
      parentAirId: input.from.receipt.airId,
    };
    if (input.from.relation === "revise" || input.from.relation === "extend") {
      airId = input.from.receipt.airId;
    }
  }

  const receiptCore: Omit<AirReceipt, "receiptId"> = {
    format: "refrain-receipt@0-experimental",
    sourceRevision,
    airId,
    sourceFormat: current.source.format,
    verification,
    ...(lineage ? { lineage } : {}),
  };
  const receipt: AirReceipt = {
    ...receiptCore,
    receiptId: receiptIdOf(receiptCore),
  };

  const envelope: PresentationEnvelope = {
    format: "refrain-presentation@1-experimental",
    source: current.source,
    receipt,
    performanceBinding,
    ...(input.caption !== undefined ? { caption: input.caption } : {}),
  };
  const presentation = presentationUrl(envelope);
  return {
    ok: true,
    source: current.source,
    summary: summarizeCompiledAir(current.source, current.compiled),
    diagnostics: [
      ...current.diagnostics,
      ...(presentation.diagnostic ? [presentation.diagnostic] : []),
    ],
    receipt,
    performanceBinding,
    ...(input.caption !== undefined ? { caption: input.caption } : {}),
    ...(presentation.url ? { presentation: { url: presentation.url } } : {}),
  };
}
