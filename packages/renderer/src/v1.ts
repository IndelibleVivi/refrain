import { canonicalAirV1Json, type AirSourceV1 } from "@refrain/air-schema/v1";
import { transformNormalizedMotifMaterial } from "@refrain/compiler";
import type { CompiledAirV1, CompiledEventV1 } from "@refrain/compiler/v1";
import { sha256Id } from "@refrain/identity";
import type {
  AirLineage,
  ContinuationRelation,
  MotifLinkEvidence,
} from "./types.js";
import { SHA256_ID } from "./identity.js";

export const MUSICAL_RELATION_V1_FORMAT =
  "musical-relation@1-experimental" as const;
export const AIR_RECEIPT_V1_FORMAT = "refrain-receipt@1-experimental" as const;
export const EMBODIMENT_LINEAGE_FORMAT =
  "refrain-embodiment-lineage@0-experimental" as const;

export interface OrchestrationLinkEvidence {
  parentAnchor: string;
  childAnchor: string;
  parentVoiceId: string;
  childVoiceId: string;
  parentInstrument: string;
  childInstrument: string;
}

export interface RecurrenceEvidence {
  motif: string;
  parentCount: number;
  childCount: number;
}

export type ContrastDimension = "register" | "density" | "instrumentation";

export interface SectionContrastEvidence {
  parentSection: string;
  childSection: string;
  dimensions: ContrastDimension[];
}

export interface MeaningfulAbsenceEvidence {
  motif: string;
  parentAnchor: string;
  childSection: string;
}

export interface RelationEvidenceAssertionsV1 {
  motifLinks?: MotifLinkEvidence[];
  orchestrationLinks?: OrchestrationLinkEvidence[];
  recurrences?: Array<{ motif: string; minimumChildCount: number }>;
  contrasts?: SectionContrastEvidence[];
  absences?: MeaningfulAbsenceEvidence[];
}

export interface MusicalRelationVerificationV1 {
  contract: typeof MUSICAL_RELATION_V1_FORMAT;
  status: "not_applicable" | "declared" | "verified";
  motifLinks: MotifLinkEvidence[];
  orchestrationLinks: OrchestrationLinkEvidence[];
  recurrences: RecurrenceEvidence[];
  contrasts: SectionContrastEvidence[];
  absences: MeaningfulAbsenceEvidence[];
  prefix?: {
    parentEventCount: number;
    childEventCount: number;
    parentDurationBeats: number;
    childDurationBeats: number;
  };
  evidenceId?: string;
}

export interface EmbodimentLineage {
  contract: typeof EMBODIMENT_LINEAGE_FORMAT;
  parentPerformanceBindingDigest: string;
  childPerformanceBindingDigest: string;
  instrumentMap: Array<{
    parentInstrument: string;
    childInstrument: string;
  }>;
  evidenceId: string;
}

export interface AirReceiptV1 {
  format: typeof AIR_RECEIPT_V1_FORMAT;
  sourceRevision: string;
  airId: string;
  receiptId: string;
  sourceFormat: AirSourceV1["format"];
  verification: MusicalRelationVerificationV1;
  lineage?: AirLineage;
  embodiment?: EmbodimentLineage;
}

export interface VerifyRelationV1Result {
  verification?: MusicalRelationVerificationV1;
  diagnostic?: {
    severity: "error";
    code: string;
    path: string;
    message: string;
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSorted<T>(
  values: readonly T[],
  identity: (value: T) => string,
): T[] {
  return [...new Map(values.map((value) => [identity(value), value])).entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([, value]) => value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify([...keys].sort())
  );
}

function relationError(
  code: string,
  path: string,
  message: string,
): VerifyRelationV1Result {
  return { diagnostic: { severity: "error", code, path, message } };
}

function evidenceSequencesEqual(
  left: ReturnType<typeof transformNormalizedMotifMaterial>,
  right: ReturnType<typeof transformNormalizedMotifMaterial>,
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

function eventForAnchor(
  compiled: CompiledAirV1,
  anchor: string,
): CompiledEventV1 | undefined {
  const occurrence = compiled.motifOccurrences.find(
    (item) => item.anchor === anchor,
  );
  if (!occurrence) return undefined;
  return compiled.events.find(
    (event) =>
      event.voiceId === occurrence.voiceId &&
      event.motif === occurrence.motif &&
      (event.notatedStartBeat ?? event.startBeat) >=
        occurrence.startBeat - 0.0001 &&
      (event.notatedStartBeat ?? event.startBeat) <
        occurrence.startBeat + occurrence.durationBeats + 0.0001,
  );
}

function sectionMetrics(
  compiled: CompiledAirV1,
  sectionId: string,
):
  | {
      averageMidi: number;
      density: number;
      instruments: string[];
    }
  | undefined {
  const section = compiled.sections.find(
    (candidate) => candidate.id === sectionId,
  );
  if (!section) return undefined;
  const events = compiled.events.filter((event) => {
    const beat = event.notatedStartBeat ?? event.startBeat;
    return (
      beat >= section.startBeat - 0.0001 && beat < section.endBeat - 0.0001
    );
  });
  return {
    averageMidi:
      events.length === 0
        ? 0
        : events.reduce((total, event) => total + event.midi, 0) /
          events.length,
    density:
      events.length / Math.max(0.0001, section.endBeat - section.startBeat),
    instruments: [...new Set(events.map((event) => event.instrument))].sort(
      compareText,
    ),
  };
}

function eventPrefix(event: CompiledEventV1): unknown {
  return {
    voiceId: event.voiceId,
    role: event.role,
    instrument: event.instrument,
    midi: event.midi,
    startBeat: event.startBeat,
    notatedStartBeat: event.notatedStartBeat,
    timingOffsetBeats: event.timingOffsetBeats ?? null,
    durationBeats: event.durationBeats,
    soundingDurationBeats: event.soundingDurationBeats,
    velocity: event.velocity,
    gainDb: event.gainDb,
    pan: event.pan,
    bar: event.bar,
    articulation: event.articulation,
    gate: event.gate,
    motif: event.motif ?? null,
  };
}

export function verifyMusicalRelationV1(
  parent: CompiledAirV1,
  child: CompiledAirV1,
  relation: ContinuationRelation,
  assertions: RelationEvidenceAssertionsV1 = {},
): VerifyRelationV1Result {
  const motifLinks = uniqueSorted(
    (assertions.motifLinks ?? []).map((link) => ({
      parent: link.parent,
      child: link.child,
      parentAnchor: link.parentAnchor,
      childAnchor: link.childAnchor,
      transform: {
        transpose: link.transform.transpose,
        stretch: link.transform.stretch,
        invert: link.transform.invert,
        retrograde: link.transform.retrograde,
      },
    })),
    (link) => JSON.stringify(link),
  );
  if (
    (relation === "quote" || relation === "variation") &&
    motifLinks.length === 0
  )
    return relationError(
      "missing_relation_evidence",
      "$.from.evidence.motifLinks",
      `${relation} requires at least one explicit motif link.`,
    );
  if (
    relation === "variation" &&
    !motifLinks.some(
      (link) =>
        link.transform.transpose !== 0 ||
        link.transform.stretch !== 1 ||
        link.transform.invert ||
        link.transform.retrograde,
    )
  )
    return relationError(
      "variation_requires_transform",
      "$.from.evidence.motifLinks",
      "variation requires a non-identity deterministic transform.",
    );
  for (const link of motifLinks) {
    const parentOccurrence = parent.motifOccurrences.find(
      (item) => item.anchor === link.parentAnchor && item.motif === link.parent,
    );
    const childOccurrence = child.motifOccurrences.find(
      (item) => item.anchor === link.childAnchor && item.motif === link.child,
    );
    if (!parentOccurrence || !childOccurrence)
      return relationError(
        "motif_anchor_not_found",
        "$.from.evidence.motifLinks",
        `Could not resolve ${link.parentAnchor} -> ${link.childAnchor}.`,
      );
    const identity =
      link.transform.transpose === 0 &&
      link.transform.stretch === 1 &&
      !link.transform.invert &&
      !link.transform.retrograde;
    if (relation === "quote" && !identity)
      return relationError(
        "quote_requires_exact_link",
        "$.from.evidence.motifLinks",
        "quote links must use the identity transform.",
      );
    const expected = transformNormalizedMotifMaterial(
      parentOccurrence.material,
      link.transform,
    );
    if (!evidenceSequencesEqual(expected, childOccurrence.material))
      return relationError(
        "motif_evidence_mismatch",
        "$.from.evidence.motifLinks",
        `${link.childAnchor} is not the declared transform of ${link.parentAnchor}.`,
      );
  }

  const orchestrationLinks = uniqueSorted(
    (assertions.orchestrationLinks ?? []).map((link) => ({
      parentAnchor: link.parentAnchor,
      childAnchor: link.childAnchor,
      parentVoiceId: link.parentVoiceId,
      childVoiceId: link.childVoiceId,
      parentInstrument: link.parentInstrument,
      childInstrument: link.childInstrument,
    })),
    (link) => JSON.stringify(link),
  );
  for (const link of orchestrationLinks) {
    const parentEvent = eventForAnchor(parent, link.parentAnchor);
    const childEvent = eventForAnchor(child, link.childAnchor);
    if (
      !parentEvent ||
      !childEvent ||
      parentEvent.voiceId !== link.parentVoiceId ||
      childEvent.voiceId !== link.childVoiceId ||
      parentEvent.instrument !== link.parentInstrument ||
      childEvent.instrument !== link.childInstrument
    )
      return relationError(
        "orchestration_evidence_mismatch",
        "$.from.evidence.orchestrationLinks",
        "An orchestration link does not match the compiled voices and instruments.",
      );
  }

  const recurrenceAssertions = uniqueSorted(
    (assertions.recurrences ?? []).map((assertion) => ({
      motif: assertion.motif,
      minimumChildCount: assertion.minimumChildCount,
    })),
    (assertion) => JSON.stringify(assertion),
  );
  const recurrences: RecurrenceEvidence[] = [];
  for (const assertion of recurrenceAssertions) {
    const parentCount = parent.motifOccurrences.filter(
      (item) => item.motif === assertion.motif,
    ).length;
    const childCount = child.motifOccurrences.filter(
      (item) => item.motif === assertion.motif,
    ).length;
    if (childCount < assertion.minimumChildCount || childCount <= parentCount)
      return relationError(
        "recurrence_evidence_mismatch",
        "$.from.evidence.recurrences",
        `${assertion.motif} does not recur more often in the child as declared.`,
      );
    recurrences.push({ motif: assertion.motif, parentCount, childCount });
  }

  const contrasts = uniqueSorted(
    (assertions.contrasts ?? []).map((assertion) => ({
      parentSection: assertion.parentSection,
      childSection: assertion.childSection,
      dimensions: [...new Set(assertion.dimensions)].sort(compareText),
    })),
    (assertion) => JSON.stringify(assertion),
  );
  for (const assertion of contrasts) {
    const parentMetric = sectionMetrics(parent, assertion.parentSection);
    const childMetric = sectionMetrics(child, assertion.childSection);
    if (!parentMetric || !childMetric)
      return relationError(
        "contrast_section_not_found",
        "$.from.evidence.contrasts",
        "A declared contrast section is absent from the compiled scores.",
      );
    const differs = assertion.dimensions.every((dimension) => {
      if (dimension === "register")
        return (
          Math.abs(parentMetric.averageMidi - childMetric.averageMidi) >= 3
        );
      if (dimension === "density")
        return Math.abs(parentMetric.density - childMetric.density) >= 0.2;
      return (
        JSON.stringify(parentMetric.instruments) !==
        JSON.stringify(childMetric.instruments)
      );
    });
    if (!differs)
      return relationError(
        "contrast_evidence_mismatch",
        "$.from.evidence.contrasts",
        "A declared contrast is not present in every selected compiled dimension.",
      );
  }

  const absences = uniqueSorted(
    (assertions.absences ?? []).map((assertion) => ({
      motif: assertion.motif,
      parentAnchor: assertion.parentAnchor,
      childSection: assertion.childSection,
    })),
    (assertion) => JSON.stringify(assertion),
  );
  for (const assertion of absences) {
    const parentOccurrence = parent.motifOccurrences.find(
      (item) =>
        item.anchor === assertion.parentAnchor &&
        item.motif === assertion.motif,
    );
    const childSection = child.sections.find(
      (candidate) => candidate.id === assertion.childSection,
    );
    const present = child.motifOccurrences.some(
      (item) =>
        item.motif === assertion.motif &&
        childSection &&
        item.startBeat >= childSection.startBeat - 0.0001 &&
        item.startBeat < childSection.endBeat - 0.0001,
    );
    if (!parentOccurrence || !childSection || present)
      return relationError(
        "absence_evidence_mismatch",
        "$.from.evidence.absences",
        "A meaningful-absence assertion is not supported by the compiled parent and child windows.",
      );
  }

  let prefix: MusicalRelationVerificationV1["prefix"];
  if (relation === "extend") {
    if (child.durationBeats <= parent.durationBeats)
      return relationError(
        "extension_not_longer",
        "$.air",
        "extend requires a longer compiled child schedule.",
      );
    const conductorPrefix = parent.meterChanges.every((entry, index) => {
      const childEntry = child.meterChanges[index];
      return (
        childEntry !== undefined &&
        JSON.stringify(entry) === JSON.stringify(childEntry)
      );
    });
    const eventPrefixMatches = parent.events.every((event, index) => {
      const childEvent = child.events[index];
      return (
        childEvent !== undefined &&
        JSON.stringify(eventPrefix(event)) ===
          JSON.stringify(eventPrefix(childEvent))
      );
    });
    if (!conductorPrefix || !eventPrefixMatches || parent.tempo !== child.tempo)
      return relationError(
        "extension_prefix_mismatch",
        "$.air",
        "extend requires the prior conductor and performed event schedule as an exact prefix.",
      );
    prefix = {
      parentEventCount: parent.events.length,
      childEventCount: child.events.length,
      parentDurationBeats: parent.durationBeats,
      childDurationBeats: child.durationBeats,
    };
  }

  const hasEvidence =
    motifLinks.length > 0 ||
    orchestrationLinks.length > 0 ||
    recurrences.length > 0 ||
    contrasts.length > 0 ||
    absences.length > 0 ||
    prefix !== undefined;
  const core: Omit<MusicalRelationVerificationV1, "evidenceId"> = {
    contract: MUSICAL_RELATION_V1_FORMAT,
    status: hasEvidence ? "verified" : "declared",
    motifLinks,
    orchestrationLinks,
    recurrences,
    contrasts,
    absences,
    ...(prefix === undefined ? {} : { prefix }),
  };
  return {
    verification: hasEvidence
      ? { ...core, evidenceId: musicalEvidenceIdV1(core) }
      : core,
  };
}

export function sourceRevisionOfV1(source: AirSourceV1): string {
  return sha256Id(canonicalAirV1Json(source));
}

function motifLinkIdentityValue(link: MotifLinkEvidence) {
  return {
    parent: link.parent,
    child: link.child,
    parentAnchor: link.parentAnchor,
    childAnchor: link.childAnchor,
    transform: {
      transpose: link.transform.transpose,
      stretch: link.transform.stretch,
      invert: link.transform.invert,
      retrograde: link.transform.retrograde,
    },
  };
}

function verificationIdentityValue(
  verification:
    | MusicalRelationVerificationV1
    | Omit<MusicalRelationVerificationV1, "evidenceId">,
  includeEvidenceId: boolean,
) {
  const evidenceId =
    "evidenceId" in verification ? verification.evidenceId : undefined;
  return {
    contract: verification.contract,
    status: verification.status,
    motifLinks: verification.motifLinks.map(motifLinkIdentityValue),
    orchestrationLinks: verification.orchestrationLinks.map((link) => ({
      parentAnchor: link.parentAnchor,
      childAnchor: link.childAnchor,
      parentVoiceId: link.parentVoiceId,
      childVoiceId: link.childVoiceId,
      parentInstrument: link.parentInstrument,
      childInstrument: link.childInstrument,
    })),
    recurrences: verification.recurrences.map((recurrence) => ({
      motif: recurrence.motif,
      parentCount: recurrence.parentCount,
      childCount: recurrence.childCount,
    })),
    contrasts: verification.contrasts.map((contrast) => ({
      parentSection: contrast.parentSection,
      childSection: contrast.childSection,
      dimensions: [...contrast.dimensions],
    })),
    absences: verification.absences.map((absence) => ({
      motif: absence.motif,
      parentAnchor: absence.parentAnchor,
      childSection: absence.childSection,
    })),
    ...(verification.prefix === undefined
      ? {}
      : {
          prefix: {
            parentEventCount: verification.prefix.parentEventCount,
            childEventCount: verification.prefix.childEventCount,
            parentDurationBeats: verification.prefix.parentDurationBeats,
            childDurationBeats: verification.prefix.childDurationBeats,
          },
        }),
    ...(includeEvidenceId && evidenceId !== undefined ? { evidenceId } : {}),
  };
}

function embodimentIdentityValue(
  embodiment: EmbodimentLineage | Omit<EmbodimentLineage, "evidenceId">,
  includeEvidenceId: boolean,
) {
  const evidenceId =
    "evidenceId" in embodiment ? embodiment.evidenceId : undefined;
  return {
    contract: embodiment.contract,
    parentPerformanceBindingDigest: embodiment.parentPerformanceBindingDigest,
    childPerformanceBindingDigest: embodiment.childPerformanceBindingDigest,
    instrumentMap: embodiment.instrumentMap.map((entry) => ({
      parentInstrument: entry.parentInstrument,
      childInstrument: entry.childInstrument,
    })),
    ...(includeEvidenceId && evidenceId !== undefined ? { evidenceId } : {}),
  };
}

export function musicalEvidenceIdV1(
  verification: Omit<MusicalRelationVerificationV1, "evidenceId">,
): string {
  return sha256Id(
    JSON.stringify(verificationIdentityValue(verification, false)),
  );
}

export function embodimentEvidenceId(
  value: Omit<EmbodimentLineage, "evidenceId">,
): string {
  return sha256Id(JSON.stringify(embodimentIdentityValue(value, false)));
}

export function createEmbodimentLineage(
  input: Omit<EmbodimentLineage, "contract" | "evidenceId">,
): EmbodimentLineage {
  const core: Omit<EmbodimentLineage, "evidenceId"> = {
    contract: EMBODIMENT_LINEAGE_FORMAT,
    parentPerformanceBindingDigest: input.parentPerformanceBindingDigest,
    childPerformanceBindingDigest: input.childPerformanceBindingDigest,
    instrumentMap: uniqueSorted(
      input.instrumentMap.map((entry) => ({
        parentInstrument: entry.parentInstrument,
        childInstrument: entry.childInstrument,
      })),
      (entry) => `${entry.parentInstrument}\u0000${entry.childInstrument}`,
    ),
  };
  if (
    !SHA256_ID.test(core.parentPerformanceBindingDigest) ||
    !SHA256_ID.test(core.childPerformanceBindingDigest) ||
    core.instrumentMap.length === 0 ||
    core.instrumentMap.some(
      (entry) => !entry.parentInstrument || !entry.childInstrument,
    )
  )
    throw new Error(
      "Embodiment lineage needs exact performance-binding digests.",
    );
  return { ...core, evidenceId: embodimentEvidenceId(core) };
}

export function receiptIdentityJsonV1(
  receipt: Omit<AirReceiptV1, "receiptId">,
): string {
  return JSON.stringify({
    format: "refrain-receipt-identity@1-experimental",
    sourceRevision: receipt.sourceRevision,
    airId: receipt.airId,
    sourceFormat: receipt.sourceFormat,
    verification: verificationIdentityValue(receipt.verification, true),
    lineage: receipt.lineage
      ? {
          relation: receipt.lineage.relation,
          parentSourceRevision: receipt.lineage.parentSourceRevision,
          parentReceiptId: receipt.lineage.parentReceiptId,
          parentAirId: receipt.lineage.parentAirId,
        }
      : null,
    embodiment: receipt.embodiment
      ? embodimentIdentityValue(receipt.embodiment, true)
      : null,
  });
}

export function receiptIdOfV1(
  receipt: Omit<AirReceiptV1, "receiptId">,
): string {
  return sha256Id(receiptIdentityJsonV1(receipt));
}

function isClosedMotifLink(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "child",
      "childAnchor",
      "parent",
      "parentAnchor",
      "transform",
    ])
  )
    return false;
  if (
    ![value.parent, value.child, value.parentAnchor, value.childAnchor].every(
      (item) => typeof item === "string" && item.length > 0,
    ) ||
    !isRecord(value.transform) ||
    !hasExactKeys(value.transform, [
      "invert",
      "retrograde",
      "stretch",
      "transpose",
    ])
  )
    return false;
  return (
    typeof value.transform.transpose === "number" &&
    Number.isFinite(value.transform.transpose) &&
    typeof value.transform.stretch === "number" &&
    Number.isFinite(value.transform.stretch) &&
    value.transform.stretch > 0 &&
    typeof value.transform.invert === "boolean" &&
    typeof value.transform.retrograde === "boolean"
  );
}

function isClosedOrchestrationLink(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "childAnchor",
      "childInstrument",
      "childVoiceId",
      "parentAnchor",
      "parentInstrument",
      "parentVoiceId",
    ]) &&
    Object.values(value).every(
      (item) => typeof item === "string" && item.length > 0,
    )
  );
}

function isClosedRecurrence(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["childCount", "motif", "parentCount"]) &&
    typeof value.motif === "string" &&
    value.motif.length > 0 &&
    Number.isInteger(value.parentCount) &&
    Number(value.parentCount) >= 0 &&
    Number.isInteger(value.childCount) &&
    Number(value.childCount) >= 0
  );
}

function isClosedContrast(value: unknown): boolean {
  const dimensions =
    isRecord(value) && Array.isArray(value.dimensions) ? value.dimensions : [];
  return (
    isRecord(value) &&
    hasExactKeys(value, ["childSection", "dimensions", "parentSection"]) &&
    typeof value.parentSection === "string" &&
    value.parentSection.length > 0 &&
    typeof value.childSection === "string" &&
    value.childSection.length > 0 &&
    dimensions.length > 0 &&
    new Set(dimensions).size === dimensions.length &&
    dimensions.every((item) =>
      ["register", "density", "instrumentation"].includes(String(item)),
    )
  );
}

function isClosedAbsence(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["childSection", "motif", "parentAnchor"]) &&
    Object.values(value).every(
      (item) => typeof item === "string" && item.length > 0,
    )
  );
}

function isClosedPrefix(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "childDurationBeats",
      "childEventCount",
      "parentDurationBeats",
      "parentEventCount",
    ]) &&
    Number.isInteger(value.parentEventCount) &&
    Number(value.parentEventCount) >= 0 &&
    Number.isInteger(value.childEventCount) &&
    Number(value.childEventCount) >= 0 &&
    typeof value.parentDurationBeats === "number" &&
    Number.isFinite(value.parentDurationBeats) &&
    value.parentDurationBeats >= 0 &&
    typeof value.childDurationBeats === "number" &&
    Number.isFinite(value.childDurationBeats) &&
    value.childDurationBeats >= 0
  );
}

function isClosedVerification(
  value: unknown,
): value is MusicalRelationVerificationV1 {
  if (!isRecord(value)) return false;
  const keys = [
    "absences",
    "contract",
    "contrasts",
    "motifLinks",
    "orchestrationLinks",
    "recurrences",
    "status",
    ...(value.prefix === undefined ? [] : ["prefix"]),
    ...(value.evidenceId === undefined ? [] : ["evidenceId"]),
  ];
  return (
    hasExactKeys(value, keys) &&
    value.contract === MUSICAL_RELATION_V1_FORMAT &&
    ["not_applicable", "declared", "verified"].includes(String(value.status)) &&
    Array.isArray(value.motifLinks) &&
    value.motifLinks.every(isClosedMotifLink) &&
    Array.isArray(value.orchestrationLinks) &&
    value.orchestrationLinks.every(isClosedOrchestrationLink) &&
    Array.isArray(value.recurrences) &&
    value.recurrences.every(isClosedRecurrence) &&
    Array.isArray(value.contrasts) &&
    value.contrasts.every(isClosedContrast) &&
    Array.isArray(value.absences) &&
    value.absences.every(isClosedAbsence) &&
    (value.prefix === undefined || isClosedPrefix(value.prefix)) &&
    (value.evidenceId === undefined ||
      (typeof value.evidenceId === "string" &&
        SHA256_ID.test(value.evidenceId)))
  );
}

function isClosedLineage(value: unknown): value is AirLineage {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "parentAirId",
      "parentReceiptId",
      "parentSourceRevision",
      "relation",
    ]) &&
    ["revise", "extend", "reply", "variation", "quote"].includes(
      String(value.relation),
    ) &&
    SHA256_ID.test(String(value.parentAirId)) &&
    SHA256_ID.test(String(value.parentReceiptId)) &&
    SHA256_ID.test(String(value.parentSourceRevision))
  );
}

function isClosedEmbodiment(value: unknown): value is EmbodimentLineage {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "childPerformanceBindingDigest",
      "contract",
      "evidenceId",
      "instrumentMap",
      "parentPerformanceBindingDigest",
    ]) &&
    value.contract === EMBODIMENT_LINEAGE_FORMAT &&
    SHA256_ID.test(String(value.parentPerformanceBindingDigest)) &&
    SHA256_ID.test(String(value.childPerformanceBindingDigest)) &&
    SHA256_ID.test(String(value.evidenceId)) &&
    Array.isArray(value.instrumentMap) &&
    value.instrumentMap.length > 0 &&
    value.instrumentMap.every(
      (entry) =>
        isRecord(entry) &&
        hasExactKeys(entry, ["childInstrument", "parentInstrument"]) &&
        typeof entry.parentInstrument === "string" &&
        entry.parentInstrument.length > 0 &&
        typeof entry.childInstrument === "string" &&
        entry.childInstrument.length > 0,
    )
  );
}

function isClosedReceipt(value: unknown): value is AirReceiptV1 {
  if (!isRecord(value)) return false;
  const keys = [
    "airId",
    "format",
    "receiptId",
    "sourceFormat",
    "sourceRevision",
    "verification",
    ...(value.lineage === undefined ? [] : ["lineage"]),
    ...(value.embodiment === undefined ? [] : ["embodiment"]),
  ];
  return (
    hasExactKeys(value, keys) &&
    value.format === AIR_RECEIPT_V1_FORMAT &&
    value.sourceFormat === "air@1-experimental" &&
    SHA256_ID.test(String(value.sourceRevision)) &&
    SHA256_ID.test(String(value.airId)) &&
    SHA256_ID.test(String(value.receiptId)) &&
    isClosedVerification(value.verification) &&
    (value.lineage === undefined || isClosedLineage(value.lineage)) &&
    (value.embodiment === undefined || isClosedEmbodiment(value.embodiment))
  );
}

export function receiptIntegrityErrorsV1(receipt: unknown): string[] {
  if (!isClosedReceipt(receipt)) return ["shape"];
  const value = receipt;
  const errors: string[] = [];
  const { evidenceId, ...verificationCore } = value.verification;
  if (value.verification.status === "verified") {
    if (!evidenceId || evidenceId !== musicalEvidenceIdV1(verificationCore))
      errors.push("evidence-id");
  } else if (evidenceId !== undefined) errors.push("evidence-status");
  if (!value.lineage) {
    if (value.verification.status !== "not_applicable")
      errors.push("root-status");
    if (value.airId !== value.sourceRevision) errors.push("air-id");
  } else {
    if (value.verification.status === "not_applicable")
      errors.push("lineage-status");
    if (
      ["quote", "variation", "extend"].includes(value.lineage.relation) &&
      value.verification.status !== "verified"
    )
      errors.push("required-verification-status");
    const inheritsAir =
      value.lineage.relation === "revise" ||
      value.lineage.relation === "extend";
    if (
      value.airId !==
      (inheritsAir ? value.lineage.parentAirId : value.sourceRevision)
    )
      errors.push("air-id");
  }
  if (value.embodiment) {
    const { evidenceId: embodimentId, ...embodimentCore } = value.embodiment;
    if (
      value.embodiment.contract !== EMBODIMENT_LINEAGE_FORMAT ||
      !SHA256_ID.test(value.embodiment.parentPerformanceBindingDigest) ||
      !SHA256_ID.test(value.embodiment.childPerformanceBindingDigest) ||
      !Array.isArray(value.embodiment.instrumentMap) ||
      embodimentId !== embodimentEvidenceId(embodimentCore)
    )
      errors.push("embodiment");
  }
  const { receiptId: _receiptId, ...core } = value;
  if (value.receiptId !== receiptIdOfV1(core)) errors.push("receipt-id");
  return errors;
}

export function sourceReceiptIntegrityErrorsV1(
  source: AirSourceV1,
  receipt: unknown,
): string[] {
  const errors = receiptIntegrityErrorsV1(receipt);
  if (
    receipt &&
    typeof receipt === "object" &&
    !Array.isArray(receipt) &&
    (receipt as AirReceiptV1).sourceRevision !== sourceRevisionOfV1(source)
  )
    errors.push("source-revision");
  return errors;
}

export function createRootReceiptV1(source: AirSourceV1): AirReceiptV1 {
  const sourceRevision = sourceRevisionOfV1(source);
  const core: Omit<AirReceiptV1, "receiptId"> = {
    format: AIR_RECEIPT_V1_FORMAT,
    sourceRevision,
    airId: sourceRevision,
    sourceFormat: source.format,
    verification: {
      contract: MUSICAL_RELATION_V1_FORMAT,
      status: "not_applicable",
      motifLinks: [],
      orchestrationLinks: [],
      recurrences: [],
      contrasts: [],
      absences: [],
    },
  };
  return { ...core, receiptId: receiptIdOfV1(core) };
}
