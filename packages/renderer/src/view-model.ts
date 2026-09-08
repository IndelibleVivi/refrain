import type { AirSource } from "@refrain/air-schema";
import { rationalToNumber, type AirSourceV1 } from "@refrain/air-schema/v1";
import type {
  CompiledAir,
  CompiledSegment,
  MotifOccurrence,
} from "@refrain/compiler";
import type { CompiledAirV1, CompiledSegmentV1 } from "@refrain/compiler/v1";
import type { AirReceipt, MusicalRelationVerification } from "./types.js";
import type { AirReceiptV1, MusicalRelationVerificationV1 } from "./v1.js";

type AnyAirSource = AirSource | AirSourceV1;
type AnyCompiledAir = CompiledAir | CompiledAirV1;
type AnyCompiledSegment = CompiledSegment | CompiledSegmentV1;

export const MAX_WHOLE_FORM_BINS = 192;
export const MAX_STRUCTURE_ITEMS = 2_048;
export const MAX_DETAIL_EVENTS = 512;

export interface StructureSection {
  anchor: string;
  id: string;
  authoredLabel: string;
  boundaryAuthority: "authored" | "derived-segment-label";
  index: number;
  startBeat: number;
  endBeat: number;
  segmentAnchors: string[];
}

export interface VisualVoiceDensity {
  voiceId: string;
  activeCount: number;
  onsetCount: number;
  averageMidi?: number;
  lowerMidi?: number;
  upperMidi?: number;
}

export interface VisualDensityBin {
  index: number;
  startBeat: number;
  endBeat: number;
  activeCount: number;
  onsetCount: number;
  averageMidi?: number;
  lowerMidi?: number;
  upperMidi?: number;
  voices: VisualVoiceDensity[];
}

export interface AirVisualFacts {
  format: "refrain-air-visual-facts@0-experimental";
  motifFamilies: AnyCompiledAir["motifFamilies"];
  densityBins: VisualDensityBin[];
  sections: Array<{
    anchor: string;
    authoredLabel: string;
    index: number;
    startBeat: number;
    endBeat: number;
  }>;
  upperEnvelope: Array<{
    startBeat: number;
    endBeat: number;
    upperMidi?: number;
  }>;
}

export interface StructureDetailWindow {
  format: "refrain-structure-detail@0-experimental";
  startBeat: number;
  endBeat: number;
  totalEventCount: number;
  truncated: boolean;
  events: Array<{
    eventId: string;
    voiceId: string;
    startBeat: number;
    durationBeats: number;
    soundingDurationBeats: number;
    midi: number;
    motif?: string;
  }>;
}

export interface StructureHarmonySpan {
  anchor: string;
  planId: string;
  symbol: string;
  startBeat: number;
  endBeat: number;
  segmentAnchor: string;
  voiceId: string;
}

export interface StructureVoice {
  voiceId: string;
  role: string;
  instrument: string;
  authoring: "part" | "realize";
  segmentAnchors: string[];
}

export interface StructureViewModel {
  format: "refrain-structure@1-experimental";
  sourceRevision: string;
  receiptId: string;
  title: string;
  tempo: number;
  meter: string;
  durationBeats: number;
  sections: StructureSection[];
  harmonySpans: StructureHarmonySpan[];
  voices: StructureVoice[];
  segments: AnyCompiledSegment[];
  segmentCount: number;
  motifOccurrences: MotifOccurrence[];
  motifOccurrenceCount: number;
  structureItemsTruncated: boolean;
  visualFacts: AirVisualFacts;
  expression: Array<{
    segmentAnchor: string;
    voiceId: string;
    startBeat: number;
    endBeat: number;
    value: AnyCompiledSegment["expression"];
  }>;
  playbackTimeline: {
    durationBeats: number;
    durationSeconds: number;
    eventCount: number;
  };
  relationEvidence: MusicalRelationVerification | MusicalRelationVerificationV1;
}

function buildSections(
  source: AnyAirSource,
  compiled: AnyCompiledAir,
): StructureSection[] {
  const byId = new Map<string, StructureSection>();
  for (const section of source.sections ?? []) {
    const exact = compiled.sections.find(
      (candidate) => candidate.id === section.id,
    );
    if (!exact) continue;
    byId.set(section.id, {
      anchor: `section:${section.id}`,
      id: section.id,
      authoredLabel: section.id,
      boundaryAuthority: "authored",
      index: byId.size + 1,
      startBeat: exact.startBeat,
      endBeat: exact.endBeat,
      segmentAnchors: [],
    });
  }
  for (const segment of compiled.segments) {
    if (!segment.section) continue;
    const existing = byId.get(segment.section);
    if (existing) {
      existing.segmentAnchors.push(segment.anchor);
    } else {
      byId.set(segment.section, {
        anchor: `section:${segment.section}`,
        id: segment.section,
        authoredLabel: segment.section,
        boundaryAuthority: "derived-segment-label",
        index: byId.size + 1,
        startBeat: segment.startBeat,
        endBeat: segment.endBeat,
        segmentAnchors: [segment.anchor],
      });
    }
  }
  return [...byId.values()].sort(
    (left, right) =>
      left.startBeat - right.startBeat || left.id.localeCompare(right.id),
  );
}

function roundedAverage(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  return Number(
    (values.reduce((total, value) => total + value, 0) / values.length).toFixed(
      3,
    ),
  );
}

function densityFacts(compiled: AnyCompiledAir): VisualDensityBin[] {
  const binCount = Math.min(
    MAX_WHOLE_FORM_BINS,
    Math.max(1, Math.ceil(compiled.durationBeats / compiled.beatsPerBar)),
  );
  const binBeats = compiled.durationBeats / binCount;
  const voiceIds = [...new Set(compiled.events.map((event) => event.voiceId))];
  return Array.from({ length: binCount }, (_, index) => {
    const startBeat = index * binBeats;
    const endBeat =
      index === binCount - 1 ? compiled.durationBeats : startBeat + binBeats;
    const active = compiled.events.filter(
      (event) =>
        event.startBeat < endBeat &&
        event.startBeat + event.soundingDurationBeats > startBeat,
    );
    const onsetCount = active.filter(
      (event) => event.startBeat >= startBeat && event.startBeat < endBeat,
    ).length;
    const midis = active.map((event) => event.midi);
    const voices = voiceIds.flatMap((voiceId) => {
      const voiceEvents = active.filter((event) => event.voiceId === voiceId);
      if (voiceEvents.length === 0) return [];
      const voiceMidis = voiceEvents.map((event) => event.midi);
      return [
        {
          voiceId,
          activeCount: voiceEvents.length,
          onsetCount: voiceEvents.filter(
            (event) =>
              event.startBeat >= startBeat && event.startBeat < endBeat,
          ).length,
          averageMidi: roundedAverage(voiceMidis),
          lowerMidi: Math.min(...voiceMidis),
          upperMidi: Math.max(...voiceMidis),
        },
      ];
    });
    return {
      index,
      startBeat,
      endBeat,
      activeCount: active.length,
      onsetCount,
      ...(midis.length === 0
        ? {}
        : {
            averageMidi: roundedAverage(midis),
            lowerMidi: Math.min(...midis),
            upperMidi: Math.max(...midis),
          }),
      voices,
    };
  });
}

export function buildStructureDetailWindow(
  compiled: AnyCompiledAir,
  startBeat: number,
  endBeat: number,
  maximumEvents = MAX_DETAIL_EVENTS,
): StructureDetailWindow {
  if (
    !Number.isFinite(startBeat) ||
    !Number.isFinite(endBeat) ||
    startBeat < 0 ||
    endBeat <= startBeat ||
    endBeat > compiled.durationBeats
  )
    throw new Error("A structure detail window must fit inside the air.");
  if (!Number.isInteger(maximumEvents) || maximumEvents < 1)
    throw new Error("maximumEvents must be a positive integer.");
  const matching = compiled.events.filter(
    (event) =>
      event.startBeat < endBeat &&
      event.startBeat + event.soundingDurationBeats > startBeat,
  );
  return {
    format: "refrain-structure-detail@0-experimental",
    startBeat,
    endBeat,
    totalEventCount: matching.length,
    truncated: matching.length > maximumEvents,
    events: matching.slice(0, maximumEvents).map((event) => ({
      eventId: event.id,
      voiceId: event.voiceId,
      startBeat: event.startBeat,
      durationBeats: event.durationBeats,
      soundingDurationBeats: event.soundingDurationBeats,
      midi: event.midi,
      ...(event.motif === undefined ? {} : { motif: event.motif }),
    })),
  };
}

function buildHarmonySpans(
  source: AnyAirSource,
  compiled: AnyCompiledAir,
): StructureHarmonySpan[] {
  const planById = new Map(
    (source.harmony ?? []).map((plan) => [plan.id, plan]),
  );
  return compiled.segments.flatMap((segment) => {
    if (!segment.harmony) return [];
    const plan = planById.get(segment.harmony);
    if (!plan) return [];
    let cursor = segment.startBeat;
    return plan.chords.map((chord, index) => {
      const span: StructureHarmonySpan = {
        anchor: `${segment.anchor}:harmony:${index + 1}`,
        planId: plan.id,
        symbol: chord.symbol,
        startBeat: cursor,
        endBeat:
          cursor +
          ("beats" in chord ? chord.beats : rationalToNumber(chord.duration)),
        segmentAnchor: segment.anchor,
        voiceId: segment.voiceId,
      };
      cursor +=
        "beats" in chord ? chord.beats : rationalToNumber(chord.duration);
      return span;
    });
  });
}

export function buildStructureViewModel(
  source: AnyAirSource,
  compiled: AnyCompiledAir,
  receipt: AirReceipt | AirReceiptV1,
): StructureViewModel {
  const sections = buildSections(source, compiled);
  const densityBins = densityFacts(compiled);
  return {
    format: "refrain-structure@1-experimental",
    sourceRevision: receipt.sourceRevision,
    receiptId: receipt.receiptId,
    title: source.title,
    tempo: compiled.tempo,
    meter: compiled.meter,
    durationBeats: compiled.durationBeats,
    sections,
    harmonySpans: buildHarmonySpans(source, compiled),
    voices: source.voices.map((voice) => ({
      voiceId: voice.id,
      role: voice.role,
      instrument: voice.instrument,
      authoring: "part" in voice ? "part" : "realize",
      segmentAnchors: compiled.segments
        .filter((segment) => segment.voiceId === voice.id)
        .map((segment) => segment.anchor),
    })),
    segments: compiled.segments.slice(0, MAX_STRUCTURE_ITEMS),
    segmentCount: compiled.segments.length,
    motifOccurrences: compiled.motifOccurrences.slice(0, MAX_STRUCTURE_ITEMS),
    motifOccurrenceCount: compiled.motifOccurrences.length,
    structureItemsTruncated:
      compiled.segments.length > MAX_STRUCTURE_ITEMS ||
      compiled.motifOccurrences.length > MAX_STRUCTURE_ITEMS,
    visualFacts: {
      format: "refrain-air-visual-facts@0-experimental",
      motifFamilies: compiled.motifFamilies,
      densityBins,
      sections: sections.map((section) => ({
        anchor: section.anchor,
        authoredLabel: section.authoredLabel,
        index: section.index,
        startBeat: section.startBeat,
        endBeat: section.endBeat,
      })),
      upperEnvelope: densityBins.map((bin) => ({
        startBeat: bin.startBeat,
        endBeat: bin.endBeat,
        ...(bin.upperMidi === undefined ? {} : { upperMidi: bin.upperMidi }),
      })),
    },
    expression: compiled.segments.map((segment) => ({
      segmentAnchor: segment.anchor,
      voiceId: segment.voiceId,
      startBeat: segment.startBeat,
      endBeat: segment.endBeat,
      value: segment.expression,
    })),
    playbackTimeline: {
      durationBeats: compiled.durationBeats,
      durationSeconds: compiled.durationSeconds,
      eventCount: compiled.events.length,
    },
    relationEvidence: receipt.verification,
  };
}
