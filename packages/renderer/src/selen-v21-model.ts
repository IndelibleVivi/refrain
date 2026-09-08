import { instrumentById } from "@refrain/soundpack";
import type { AnyAirArtifact } from "./types.js";
import type { StructureViewModel } from "./view-model.js";

export type SelenV21ThemeId =
  "paper-sonata" | "prism" | "nocturne-ink" | "herbarium";

export interface SelenV21Section {
  id: string;
  label: string;
  startBeat: number;
  endBeat: number;
}

export interface SelenV21Voice {
  id: "lead" | "echo" | "bass" | "pulse";
  label: string;
  role: string;
}

export interface SelenV21MotifAtom {
  t: number;
  d: number;
  p: number;
}

export interface SelenV21MotifOccurrence {
  anchor: string;
  motif: string;
  occurrence: number;
  voiceId: string;
  sourceVoiceId: string;
  startBeat: number;
  durationBeats: number;
  registerMidi: number;
  transpose: number;
  stretch: number;
  inversion: boolean;
  retrograde: boolean;
  section?: string;
}

export interface SelenV21Event {
  id: string;
  voiceId: string;
  sourceVoiceId: string;
  startBeat: number;
  durationBeats: number;
  soundingDurationBeats: number;
  midi: number;
  velocity: number;
}

export interface SelenV21DensityBin {
  start: number;
  end: number;
  activeCount: number;
  onsetCount: number;
  velocity: number;
  averageMidi: number;
}

export interface SelenV21Piece {
  format: "refrain-air-visual-model@0-experimental";
  sourceRevision: string;
  receiptId: string;
  title: string;
  caption: string;
  tempo: number;
  meter: string;
  durationBeats: number;
  durationSeconds: number;
  sections: SelenV21Section[];
  voices: SelenV21Voice[];
  sourceVoiceCount: number;
  motifDefinitions: Record<string, { atoms: SelenV21MotifAtom[] }>;
  motifOccurrences: SelenV21MotifOccurrence[];
  exactEventCount: number;
  events: SelenV21Event[];
  densityByCount: Record<string, SelenV21DensityBin[]>;
  lineage?: {
    relation: string;
    parentReceiptId: string;
  };
}

export const SELEN_V21_DENSITY_BIN_COUNTS = [
  11, 26, 30, 34, 38, 40, 42, 46, 52,
] as const;
export const MAX_SELEN_V21_VISUAL_EVENTS_PER_LANE = 192;

function readableLabel(id: string): string {
  return id.replace(/[_-]+/g, " ");
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

type VisualVoiceId = SelenV21Voice["id"];

function visualVoiceId(role: string): VisualVoiceId {
  if (role === "bass") return "bass";
  if (role === "percussion") return "pulse";
  if (role === "lead" || role === "melody") return "lead";
  return "echo";
}

function densityBins(
  events: readonly SelenV21Event[],
  durationBeats: number,
  count: number,
): SelenV21DensityBin[] {
  return Array.from({ length: count }, (_, index) => {
    const start = (durationBeats * index) / count;
    const end = (durationBeats * (index + 1)) / count;
    const active = events.filter(
      (event) =>
        event.startBeat < end &&
        event.startBeat + event.soundingDurationBeats > start,
    );
    const onsets = events.filter(
      (event) => event.startBeat >= start && event.startBeat < end,
    );
    const weightedMidi = active.reduce(
      (sum, event) => sum + event.midi * Math.max(0.05, event.velocity),
      0,
    );
    const weight = active.reduce(
      (sum, event) => sum + Math.max(0.05, event.velocity),
      0,
    );
    return {
      start,
      end,
      activeCount: active.length,
      onsetCount: onsets.length,
      velocity: active.length
        ? active.reduce((sum, event) => sum + event.velocity, 0) / active.length
        : 0,
      averageMidi: weight ? weightedMidi / weight : 60,
    };
  });
}

export function boundSelenV21VisualEvents(
  events: readonly SelenV21Event[],
  durationBeats: number,
): SelenV21Event[] {
  const bounded: SelenV21Event[] = [];
  const visualLanes: VisualVoiceId[] = ["lead", "echo", "bass", "pulse"];

  for (const voiceId of visualLanes) {
    const laneEvents = events.filter((event) => event.voiceId === voiceId);
    if (laneEvents.length <= MAX_SELEN_V21_VISUAL_EVENTS_PER_LANE) {
      bounded.push(...laneEvents);
      continue;
    }

    const binWidth = durationBeats / MAX_SELEN_V21_VISUAL_EVENTS_PER_LANE;
    for (
      let index = 0;
      index < MAX_SELEN_V21_VISUAL_EVENTS_PER_LANE;
      index += 1
    ) {
      const binStart = index * binWidth;
      const binEnd = (index + 1) * binWidth;
      const onsets = laneEvents.filter(
        (event) => event.startBeat >= binStart && event.startBeat < binEnd,
      );
      const active = laneEvents.filter(
        (event) =>
          event.startBeat < binEnd &&
          event.startBeat + event.soundingDurationBeats > binStart,
      );
      const candidates = onsets.length ? onsets : active;
      if (!candidates.length) continue;
      const weight = candidates.reduce(
        (sum, event) => sum + Math.max(0.05, event.velocity),
        0,
      );
      const startBeat = onsets.length
        ? onsets.reduce(
            (sum, event) =>
              sum + event.startBeat * Math.max(0.05, event.velocity),
            0,
          ) / weight
        : binStart;
      const durationBeats = Math.max(
        binWidth * 0.7,
        candidates.reduce((sum, event) => sum + event.durationBeats, 0) /
          candidates.length,
      );
      const soundingDurationBeats = Math.max(
        binWidth * 0.7,
        candidates.reduce(
          (sum, event) => sum + event.soundingDurationBeats,
          0,
        ) / candidates.length,
      );
      bounded.push({
        id: `visual:${voiceId}:${index}`,
        voiceId,
        sourceVoiceId: [
          ...new Set(candidates.map((event) => event.sourceVoiceId)),
        ]
          .sort()
          .join("+"),
        startBeat,
        durationBeats,
        soundingDurationBeats,
        midi:
          candidates.reduce(
            (sum, event) => sum + event.midi * Math.max(0.05, event.velocity),
            0,
          ) / weight,
        velocity:
          candidates.reduce((sum, event) => sum + event.velocity, 0) /
          candidates.length,
      });
    }
  }

  return bounded.sort(
    (left, right) =>
      left.startBeat - right.startBeat ||
      left.voiceId.localeCompare(right.voiceId),
  );
}

export function buildSelenV21Piece(
  artifact: AnyAirArtifact,
  structure: StructureViewModel,
  options?: { transportDurationSeconds?: number },
): SelenV21Piece {
  const sections = structure.sections
    .filter((section) => section.boundaryAuthority === "authored")
    .map((section) => ({
      id: section.id,
      label: section.authoredLabel,
      startBeat: section.startBeat,
      endBeat: section.endBeat,
    }));
  const visualVoiceBySourceId = new Map(
    artifact.source.voices.map((voice) => [
      voice.id,
      visualVoiceId(voice.role),
    ]),
  );
  const visualVoices = (["lead", "echo", "bass", "pulse"] as const).flatMap(
    (id) => {
      const members = artifact.source.voices.filter(
        (voice) => visualVoiceBySourceId.get(voice.id) === id,
      );
      if (members.length === 0) return [];
      return [
        {
          id,
          label: members
            .map(
              (voice) =>
                instrumentById.get(voice.instrument)?.label ??
                readableLabel(voice.id),
            )
            .join(" · "),
          role: id,
        },
      ];
    },
  );

  const exactEvents = artifact.compiled.events.map((event) => ({
    id: event.id,
    voiceId: visualVoiceBySourceId.get(event.voiceId) ?? "echo",
    sourceVoiceId: event.voiceId,
    startBeat: event.startBeat,
    durationBeats: event.durationBeats,
    soundingDurationBeats: event.soundingDurationBeats,
    midi: event.midi,
    velocity: event.velocity,
  }));

  return {
    format: "refrain-air-visual-model@0-experimental",
    sourceRevision: artifact.receipt.sourceRevision,
    receiptId: artifact.receipt.receiptId,
    title: artifact.source.title,
    caption: artifact.caption ?? "",
    tempo: artifact.compiled.tempo,
    meter: artifact.compiled.meter,
    durationBeats: artifact.compiled.durationBeats,
    durationSeconds:
      options?.transportDurationSeconds ?? artifact.compiled.durationSeconds,
    sections,
    voices: visualVoices,
    sourceVoiceCount: artifact.source.voices.length,
    motifDefinitions: Object.fromEntries(
      artifact.compiled.motifFamilies.map((family) => [
        family.familyId,
        {
          atoms: family.atoms.map((atom) => ({
            t: atom.relativeStartBeat,
            d: atom.durationBeats,
            p: mean(atom.pitchDeltas),
          })),
        },
      ]),
    ),
    motifOccurrences: structure.motifOccurrences.map((occurrence) => {
      const sectionId = sections.find(
        (section) =>
          occurrence.startBeat >= section.startBeat &&
          occurrence.startBeat < section.endBeat,
      )?.id;
      return {
        anchor: occurrence.anchor,
        motif: occurrence.motif,
        occurrence: occurrence.occurrence,
        voiceId: visualVoiceBySourceId.get(occurrence.voiceId) ?? "echo",
        sourceVoiceId: occurrence.voiceId,
        startBeat: occurrence.startBeat,
        durationBeats: occurrence.durationBeats,
        registerMidi: mean(occurrence.material.flatMap((atom) => atom.notes)),
        transpose: occurrence.transpose,
        stretch: occurrence.stretch,
        inversion: occurrence.inversion,
        retrograde: occurrence.retrograde,
        ...(sectionId ? { section: sectionId } : {}),
      };
    }),
    exactEventCount: exactEvents.length,
    events: boundSelenV21VisualEvents(
      exactEvents,
      artifact.compiled.durationBeats,
    ),
    densityByCount: Object.fromEntries(
      SELEN_V21_DENSITY_BIN_COUNTS.map((count) => [
        String(count),
        densityBins(exactEvents, artifact.compiled.durationBeats, count),
      ]),
    ),
    ...(artifact.receipt.lineage
      ? {
          lineage: {
            relation: artifact.receipt.lineage.relation,
            parentReceiptId: artifact.receipt.lineage.parentReceiptId,
          },
        }
      : {}),
  };
}
