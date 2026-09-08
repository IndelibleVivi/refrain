import type { AnyCompiledAir } from "@refrain/compiler/v1";
import { canonicalJson, sha256Hex } from "./digest.js";

export const LISTENING_REPORT_FORMAT =
  "refrain-listening-report@0-experimental" as const;

export interface ListeningEmbodimentInput {
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
  peakCeiling: number;
  sceneTailSeconds: number;
}

export interface StructuralListeningFacts {
  durationSeconds: number;
  voiceCount: number;
  eventCount: number;
  sectionCount: number;
  registerByInstrument: Array<{
    instrument: string;
    minMidi: number;
    maxMidi: number;
    eventCount: number;
  }>;
  attackDensityBins: number[];
  motifRecurrences: Array<{ motif: string; occurrences: number }>;
  soundingCoverage: number;
  silenceRatio: number;
}

export interface EmbodimentListeningFacts {
  sampleRate: number;
  frameCount: number;
  durationSeconds: number;
  peak: number;
  rms: number;
  peakCeiling: number;
  headroomDb: number | null;
  clippedFrames: number;
  ceilingExceedingFrames: number;
  silentFrames: number;
  sceneTailSeconds: number;
}

export interface ListeningReportV0 {
  format: typeof LISTENING_REPORT_FORMAT;
  reportId: string;
  compiledAirDigest: string;
  structural: StructuralListeningFacts;
  embodiment?: EmbodimentListeningFacts;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function soundingCoverage(compiled: AnyCompiledAir): number {
  if (compiled.durationBeats <= 0 || compiled.events.length === 0) return 0;
  const intervals = compiled.events
    .map(
      (event) =>
        [
          Math.max(0, event.startBeat),
          Math.min(
            compiled.durationBeats,
            event.startBeat + event.soundingDurationBeats,
          ),
        ] as const,
    )
    .filter(([start, end]) => end > start)
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  let covered = 0;
  let start = intervals[0]?.[0];
  let end = intervals[0]?.[1];
  if (start === undefined || end === undefined) return 0;
  for (const [nextStart, nextEnd] of intervals.slice(1)) {
    if (nextStart <= end) end = Math.max(end, nextEnd);
    else {
      covered += end - start;
      start = nextStart;
      end = nextEnd;
    }
  }
  covered += end - start;
  return round(Math.min(1, covered / compiled.durationBeats));
}

function structuralFacts(compiled: AnyCompiledAir): StructuralListeningFacts {
  const byInstrument = new Map<
    string,
    { minMidi: number; maxMidi: number; eventCount: number }
  >();
  const motifs = new Map<string, Set<number>>();
  const binCount = Math.max(
    1,
    Math.min(32, Math.ceil(compiled.durationSeconds / 4)),
  );
  const attackDensityBins = Array.from({ length: binCount }, () => 0);
  for (const event of compiled.events) {
    const register = byInstrument.get(event.instrument) ?? {
      minMidi: event.midi,
      maxMidi: event.midi,
      eventCount: 0,
    };
    register.minMidi = Math.min(register.minMidi, event.midi);
    register.maxMidi = Math.max(register.maxMidi, event.midi);
    register.eventCount += 1;
    byInstrument.set(event.instrument, register);
    const progress =
      compiled.durationBeats <= 0
        ? 0
        : event.startBeat / compiled.durationBeats;
    const bin = Math.max(
      0,
      Math.min(binCount - 1, Math.floor(progress * binCount)),
    );
    attackDensityBins[bin]! += 1;
    if (event.motif) {
      const occurrences = motifs.get(event.motif) ?? new Set<number>();
      occurrences.add(event.motifOccurrence ?? 1);
      motifs.set(event.motif, occurrences);
    }
  }
  const coverage = soundingCoverage(compiled);
  return {
    durationSeconds: round(compiled.durationSeconds),
    voiceCount: new Set(compiled.events.map((event) => event.voiceId)).size,
    eventCount: compiled.events.length,
    sectionCount: compiled.sections.length,
    registerByInstrument: [...byInstrument]
      .map(([instrument, facts]) => ({ instrument, ...facts }))
      .sort((left, right) => left.instrument.localeCompare(right.instrument)),
    attackDensityBins,
    motifRecurrences: [...motifs]
      .map(([motif, occurrences]) => ({ motif, occurrences: occurrences.size }))
      .sort((left, right) => left.motif.localeCompare(right.motif)),
    soundingCoverage: coverage,
    silenceRatio: round(1 - coverage),
  };
}

function embodimentFacts(
  input: ListeningEmbodimentInput,
): EmbodimentListeningFacts {
  if (
    !Number.isInteger(input.sampleRate) ||
    input.sampleRate <= 0 ||
    input.left.length !== input.right.length ||
    !Number.isFinite(input.peakCeiling) ||
    input.peakCeiling <= 0 ||
    input.peakCeiling > 1 ||
    !Number.isFinite(input.sceneTailSeconds) ||
    input.sceneTailSeconds < 0
  )
    throw new Error("Listening embodiment input is malformed.");
  let peak = 0;
  let energy = 0;
  let clippedFrames = 0;
  let ceilingExceedingFrames = 0;
  let silentFrames = 0;
  for (let index = 0; index < input.left.length; index += 1) {
    const left = input.left[index]!;
    const right = input.right[index]!;
    const framePeak = Math.max(Math.abs(left), Math.abs(right));
    peak = Math.max(peak, framePeak);
    energy += (left * left + right * right) / 2;
    if (framePeak > 1) clippedFrames += 1;
    if (framePeak > input.peakCeiling) ceilingExceedingFrames += 1;
    if (framePeak < 0.00001) silentFrames += 1;
  }
  const headroomDb =
    peak === 0 ? null : round(20 * Math.log10(input.peakCeiling / peak));
  return {
    sampleRate: input.sampleRate,
    frameCount: input.left.length,
    durationSeconds: round(input.left.length / input.sampleRate),
    peak: round(peak),
    rms: round(Math.sqrt(energy / Math.max(1, input.left.length))),
    peakCeiling: input.peakCeiling,
    headroomDb,
    clippedFrames,
    ceilingExceedingFrames,
    silentFrames,
    sceneTailSeconds: round(input.sceneTailSeconds),
  };
}

export function createListeningReport(
  compiled: AnyCompiledAir,
  embodiment?: ListeningEmbodimentInput,
): ListeningReportV0 {
  const compiledAirDigest = `sha256:${sha256Hex(canonicalJson(compiled))}`;
  const core = {
    format: LISTENING_REPORT_FORMAT,
    compiledAirDigest,
    structural: structuralFacts(compiled),
    ...(embodiment === undefined
      ? {}
      : { embodiment: embodimentFacts(embodiment) }),
  };
  return Object.freeze({
    ...core,
    reportId: `sha256:${sha256Hex(canonicalJson(core))}`,
  });
}
