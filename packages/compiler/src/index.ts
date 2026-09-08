import {
  MAX_BARS,
  MAX_EVENTS,
  MAX_EXPANDED_ATOMS,
  MAX_SCORE_SECONDS,
  parseAir,
  type AirSource,
  type Articulation,
  type Diagnostic,
  type DynamicCurve,
  type PitchRegister,
  type RealizationSegment,
} from "@refrain/air-schema";
import {
  CORE_AUTHORING_VOCABULARY,
  type AuthoringVocabularyClosure,
} from "@refrain/soundpack/vnext";

export const MAX_MOTIF_DEPTH = 16;
export {
  MAX_BARS,
  MAX_EVENTS,
  MAX_EXPANDED_ATOMS,
  MAX_SCORE_SECONDS,
} from "@refrain/air-schema";

export interface CompiledEvent {
  id: string;
  voiceId: string;
  role: string;
  instrument: string;
  midi: number;
  note: string;
  startBeat: number;
  durationBeats: number;
  soundingDurationBeats: number;
  velocity: number;
  gainDb: number;
  pan: number;
  bar: number;
  articulation: "none" | Articulation;
  gate: number;
  source: {
    voiceId: string;
    authoring: "part" | "realize";
    segmentId?: string;
    segmentIndex?: number;
    repeatIndex?: number;
    section?: string;
  };
  motif?: string;
  motifOccurrence?: number;
}

export interface MotifOccurrence {
  anchor: string;
  motif: string;
  familyId: string;
  voiceId: string;
  occurrence: number;
  startBeat: number;
  durationBeats: number;
  transpose: number;
  stretch: number;
  inversion: boolean;
  retrograde: boolean;
  material: NormalizedMotifAtom[];
  segmentId?: string;
}

export interface CompiledMotifFamily {
  familyId: string;
  durationBeats: number;
  atoms: Array<{
    relativeStartBeat: number;
    durationBeats: number;
    pitchDeltas: number[];
  }>;
}

export interface NormalizedMotifAtom {
  relativeStartBeat: number;
  durationBeats: number;
  notes: number[];
}

export interface CompiledSegment {
  anchor: string;
  voiceId: string;
  segmentId: string;
  segmentIndex: number;
  repeatIndex: number;
  kind: RealizationSegment["kind"];
  startBeat: number;
  endBeat: number;
  section?: string;
  motif?: string;
  harmony?: string;
  expression: {
    dynamic?: string;
    dynamicCurve?: DynamicCurve;
    articulation: "none" | Articulation;
    gate: number;
    tieToNext: boolean;
  };
}

export interface CompiledSection {
  id: string;
  startBeat: number;
  endBeat: number;
}

export interface CompiledAir {
  format: "compiled-air@0-experimental";
  sourceFormat: AirSource["format"];
  title: string;
  tempo: number;
  meter: string;
  beatsPerBar: number;
  durationBeats: number;
  durationSeconds: number;
  events: CompiledEvent[];
  motifFamilies: CompiledMotifFamily[];
  motifOccurrences: MotifOccurrence[];
  segments: CompiledSegment[];
  sections: CompiledSection[];
}

export interface MotifMaterialTransform {
  transpose: number;
  stretch: number;
  invert: boolean;
  retrograde: boolean;
}

export function transformNormalizedMotifMaterial(
  material: readonly NormalizedMotifAtom[],
  transform: MotifMaterialTransform,
): NormalizedMotifAtom[] {
  const stretched = material.map((atom) => ({
    relativeStartBeat: atom.relativeStartBeat * transform.stretch,
    durationBeats: atom.durationBeats * transform.stretch,
    notes: atom.notes.map((midi) => midi + transform.transpose),
  }));
  const axis = stretched.flatMap((atom) => atom.notes)[0];
  const inverted =
    transform.invert && axis !== undefined
      ? stretched.map((atom) => ({
          ...atom,
          notes: atom.notes.map((midi) => axis * 2 - midi),
        }))
      : stretched;
  if (!transform.retrograde) return inverted;
  let cursor = 0;
  return [...inverted].reverse().map((atom) => {
    const placed = { ...atom, relativeStartBeat: cursor };
    cursor += atom.durationBeats;
    return placed;
  });
}

export interface CompileAirResult {
  source?: AirSource;
  compiled?: CompiledAir;
  diagnostics: Diagnostic[];
}

export interface CompileAirOptions {
  vocabulary?: AuthoringVocabularyClosure;
}

interface ParsedAtom {
  notes: Array<{ midi: number; note: string }>;
  durationBeats: number;
  velocity: number;
  rest: boolean;
}

interface ExpandedAtom extends ParsedAtom {
  motif?: string;
  motifInvocation?: string;
  transpose?: number;
  stretch?: number;
  inversion?: boolean;
  retrograde?: boolean;
}

interface ExpansionBudget {
  atoms: number;
  exhausted: boolean;
}

const DYNAMIC_VELOCITY: Record<string, number> = {
  pp: 0.28,
  p: 0.4,
  mp: 0.54,
  mf: 0.68,
  f: 0.82,
  ff: 0.94,
};

const PITCH_CLASS: Record<string, number> = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
};

const CHORD_INTERVALS: Record<string, number[]> = {
  "": [0, 4, 7],
  m: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  "6": [0, 4, 7, 9],
  "7": [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  m7b5: [0, 3, 6, 10],
  add9: [0, 4, 7, 14],
};

export interface ParsedChordSymbol {
  symbol: string;
  rootPitchClass: number;
  intervals: number[];
  inversion: number;
  slashBassPitchClass?: number;
}

export function parseChordSymbol(
  symbol: string,
  inversionOverride?: number,
): ParsedChordSymbol | undefined {
  const match =
    /^([A-Ga-g])([#b]?)(m7b5|maj7|m7|add9|sus2|sus4|dim|aug|m|6|7)?(?:\/([A-Ga-g][#b]?))?$/.exec(
      symbol,
    );
  if (!match) return undefined;
  const rootName = `${match[1]?.toUpperCase()}${match[2] ?? ""}`;
  const rootPitchClass = PITCH_CLASS[rootName];
  const intervals = CHORD_INTERVALS[match[3] ?? ""];
  if (rootPitchClass === undefined || !intervals) return undefined;
  const slashName = match[4]
    ? `${match[4][0]?.toUpperCase()}${match[4].slice(1)}`
    : undefined;
  const slashBassPitchClass = slashName ? PITCH_CLASS[slashName] : undefined;
  let slashInversion: number | undefined;
  if (slashName) {
    if (slashBassPitchClass === undefined) return undefined;
    slashInversion = intervals.findIndex(
      (interval) => (rootPitchClass + interval) % 12 === slashBassPitchClass,
    );
    if (slashInversion < 0) return undefined;
  }
  const inversion = inversionOverride ?? slashInversion ?? 0;
  if (
    !Number.isInteger(inversion) ||
    inversion < 0 ||
    inversion >= intervals.length
  )
    return undefined;
  if (
    slashInversion !== undefined &&
    inversionOverride !== undefined &&
    slashInversion !== inversionOverride
  )
    return undefined;
  return {
    symbol,
    rootPitchClass,
    intervals: [...intervals],
    inversion,
    ...(slashBassPitchClass === undefined ? {} : { slashBassPitchClass }),
  };
}

const diagnostic = (
  severity: Diagnostic["severity"],
  code: string,
  path: string,
  message: string,
  hint?: string,
): Diagnostic => ({
  severity,
  code,
  path,
  message,
  ...(hint === undefined ? {} : { hint }),
});

export function noteNameToMidi(note: string): number | undefined {
  const match = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(note);
  if (!match) return undefined;
  const name = `${match[1]?.toUpperCase()}${match[2] ?? ""}`;
  const pitchClass = PITCH_CLASS[name];
  const octave = Number(match[3]);
  if (pitchClass === undefined || !Number.isInteger(octave)) return undefined;
  const midi = (octave + 1) * 12 + pitchClass;
  return midi >= 0 && midi <= 127 ? midi : undefined;
}

export function midiToNoteName(midi: number): string {
  const names = [
    "C",
    "C#",
    "D",
    "D#",
    "E",
    "F",
    "F#",
    "G",
    "G#",
    "A",
    "A#",
    "B",
  ];
  return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

function parseDuration(denominatorText: string, dotted: boolean): number {
  const base = 4 / Number(denominatorText);
  return dotted ? base * 1.5 : base;
}

function parseAtom(
  token: string,
  path: string,
  diagnostics: Diagnostic[],
): ParsedAtom | undefined {
  const rest = /^r\/(1|2|4|8|16|32)(\.)?$/.exec(token);
  if (rest) {
    return {
      notes: [],
      durationBeats: parseDuration(rest[1] ?? "4", Boolean(rest[2])),
      velocity: DYNAMIC_VELOCITY.mf ?? 0.68,
      rest: true,
    };
  }

  const note =
    /^([A-Ga-g][#b]?-?\d)\/(1|2|4|8|16|32)(\.)?(?:@(pp|p|mp|mf|f|ff))?$/.exec(
      token,
    );
  if (note) {
    const midi = noteNameToMidi(note[1] ?? "");
    if (midi === undefined) {
      diagnostics.push(
        diagnostic(
          "error",
          "invalid_pitch",
          path,
          `Invalid pitch in ${token}.`,
        ),
      );
      return undefined;
    }
    return {
      notes: [{ midi, note: midiToNoteName(midi) }],
      durationBeats: parseDuration(note[2] ?? "4", Boolean(note[3])),
      velocity: DYNAMIC_VELOCITY[note[4] ?? "mf"] ?? 0.68,
      rest: false,
    };
  }

  const chord =
    /^\[([^\]]+)\]\/(1|2|4|8|16|32)(\.)?(?:@(pp|p|mp|mf|f|ff))?$/.exec(token);
  if (chord) {
    const pitches = (chord[1] ?? "").split(",");
    const notes: Array<{ midi: number; note: string }> = [];
    for (const pitch of pitches) {
      const midi = noteNameToMidi(pitch);
      if (midi === undefined) {
        diagnostics.push(
          diagnostic(
            "error",
            "invalid_pitch",
            path,
            `Invalid pitch ${pitch} in ${token}.`,
          ),
        );
        return undefined;
      }
      notes.push({ midi, note: midiToNoteName(midi) });
    }
    if (notes.length < 2 || notes.length > 6) {
      diagnostics.push(
        diagnostic(
          "error",
          "invalid_chord",
          path,
          "A chord must contain between 2 and 6 pitches.",
        ),
      );
      return undefined;
    }
    return {
      notes,
      durationBeats: parseDuration(chord[2] ?? "4", Boolean(chord[3])),
      velocity: DYNAMIC_VELOCITY[chord[4] ?? "mf"] ?? 0.68,
      rest: false,
    };
  }

  diagnostics.push(
    diagnostic(
      "error",
      "invalid_token",
      path,
      `Cannot parse ${token}.`,
      "Use NOTE/DURATION, [NOTE,NOTE]/DURATION, r/DURATION, @motif, or positional @motif(-3,0.5): first argument semitone transpose, optional second argument duration stretch. Named text such as @motif(transpose,1) is invalid.",
    ),
  );
  return undefined;
}

function expandMotif(
  source: AirSource,
  motifName: string,
  transpose: number,
  stretch: number,
  path: string,
  diagnostics: Diagnostic[],
  stack: string[],
  budget: ExpansionBudget,
): ExpandedAtom[] {
  const line = source.motifs[motifName];
  if (line === undefined) {
    diagnostics.push(
      diagnostic(
        "error",
        "unresolved_reference",
        path,
        `Unknown motif @${motifName}.`,
        "Define it in $.motifs.",
      ),
    );
    return [];
  }
  if (stack.includes(motifName)) {
    diagnostics.push(
      diagnostic(
        "error",
        "cyclic_reference",
        path,
        `Motif cycle: ${[...stack, motifName].join(" -> ")}.`,
      ),
    );
    return [];
  }
  if (stack.length >= MAX_MOTIF_DEPTH) {
    diagnostics.push(
      diagnostic(
        "error",
        "motif_depth_limit",
        path,
        `Motif expansion exceeds the experimental depth limit of ${MAX_MOTIF_DEPTH}.`,
      ),
    );
    return [];
  }
  if (line.includes("|")) {
    diagnostics.push(
      diagnostic(
        "error",
        "motif_contains_bar",
        `$.motifs.${motifName}`,
        "Motifs are reusable phrases and cannot contain a bar separator in this format.",
      ),
    );
    return [];
  }
  return expandTokens(
    source,
    line,
    `$.motifs.${motifName}`,
    diagnostics,
    [...stack, motifName],
    budget,
  ).map((atom) => ({
    ...atom,
    notes: atom.notes.map(({ midi }) => ({
      midi: midi + transpose,
      note: midiToNoteName(midi + transpose),
    })),
    durationBeats: atom.durationBeats * stretch,
    motif: motifName,
    motifInvocation: path,
    transpose: (atom.transpose ?? 0) + transpose,
    stretch: (atom.stretch ?? 1) * stretch,
  }));
}

function expandTokens(
  source: AirSource,
  line: string,
  path: string,
  diagnostics: Diagnostic[],
  stack: string[],
  budget: ExpansionBudget,
): ExpandedAtom[] {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  const atoms: ExpandedAtom[] = [];
  tokens.forEach((token, index) => {
    const tokenPath = `${path}#token${index + 1}`;
    const reference =
      /^@([a-z][a-z0-9_-]*)(?:\((-?\d+)(?:,(\d+(?:\.\d+)?))?\))?$/i.exec(token);
    if (reference) {
      const transpose = Number(reference[2] ?? 0);
      const stretch = Number(reference[3] ?? 1);
      if (!Number.isInteger(transpose) || transpose < -24 || transpose > 24) {
        diagnostics.push(
          diagnostic(
            "error",
            "invalid_transpose",
            tokenPath,
            "Motif transpose must be -24 through 24 semitones.",
          ),
        );
        return;
      }
      if (!Number.isFinite(stretch) || stretch < 0.25 || stretch > 4) {
        diagnostics.push(
          diagnostic(
            "error",
            "invalid_stretch",
            tokenPath,
            "Motif stretch must be between 0.25 and 4.",
          ),
        );
        return;
      }
      atoms.push(
        ...expandMotif(
          source,
          reference[1] ?? "",
          transpose,
          stretch,
          tokenPath,
          diagnostics,
          stack,
          budget,
        ),
      );
      return;
    }
    const atom = parseAtom(token, tokenPath, diagnostics);
    if (!atom) return;
    if (budget.atoms >= MAX_EXPANDED_ATOMS) {
      if (!budget.exhausted) {
        budget.exhausted = true;
        diagnostics.push(
          diagnostic(
            "error",
            "expanded_atom_limit",
            tokenPath,
            `Motif and part expansion exceeds the experimental limit of ${MAX_EXPANDED_ATOMS} atoms.`,
          ),
        );
      }
      return;
    }
    budget.atoms += 1;
    atoms.push(atom);
  });
  return atoms;
}

function meterBeats(meter: string): number | undefined {
  const match = /^(\d{1,2})\/(\d{1,2})$/.exec(meter);
  if (!match) return undefined;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (![1, 2, 4, 8, 16].includes(denominator)) return undefined;
  return (numerator * 4) / denominator;
}

interface ResolvedChordSpan {
  chord?: ParsedChordSymbol;
  beats: number;
}

function resolveHarmonyPlan(
  source: AirSource,
  planId: string,
  path: string,
  diagnostics: Diagnostic[],
): ResolvedChordSpan[] {
  const plan = source.harmony?.find((candidate) => candidate.id === planId);
  if (!plan) {
    diagnostics.push(
      diagnostic(
        "error",
        "unresolved_harmony",
        path,
        `Unknown harmony plan ${planId}.`,
      ),
    );
    return [];
  }
  return plan.chords.map((span, index) => {
    const chord = parseChordSymbol(span.symbol, span.inversion);
    if (!chord) {
      diagnostics.push(
        diagnostic(
          "error",
          "invalid_chord_symbol",
          `$.harmony.${plan.id}.chords[${index}].symbol`,
          `Unsupported or contradictory chord symbol ${span.symbol}.`,
        ),
      );
    }
    return { chord, beats: span.beats };
  });
}

function registerBounds(
  register: PitchRegister,
  path: string,
  diagnostics: Diagnostic[],
): [number, number] | undefined {
  const min = noteNameToMidi(register.min);
  const max = noteNameToMidi(register.max);
  if (min === undefined || max === undefined || min > max) {
    diagnostics.push(
      diagnostic(
        "error",
        "invalid_register_order",
        path,
        `Register ${register.min}–${register.max} is not ascending.`,
      ),
    );
    return undefined;
  }
  return [min, max];
}

function orderedChordOffsets(chord: ParsedChordSymbol): number[] {
  const rotated = [
    ...chord.intervals.slice(chord.inversion),
    ...chord.intervals.slice(0, chord.inversion).map((value) => value + 12),
  ];
  const base = rotated[0] ?? 0;
  return rotated.map((value) => value - base);
}

function voicingCandidates(
  chord: ParsedChordSymbol,
  voicing: "close" | "open" | "drop2",
  min: number,
  max: number,
): number[][] {
  const bassPitchClass =
    chord.slashBassPitchClass ??
    (chord.rootPitchClass + chord.intervals[chord.inversion]!) % 12;
  const offsets = orderedChordOffsets(chord);
  const candidates: number[][] = [];
  for (let bass = min; bass <= max; bass += 1) {
    if (bass % 12 !== bassPitchClass) continue;
    let notes = offsets.map((offset) => bass + offset);
    if (voicing === "open") {
      notes = notes.map((note, index) => note + (index % 2 === 1 ? 12 : 0));
    } else if (voicing === "drop2" && notes.length >= 3) {
      notes = [...notes];
      notes[notes.length - 2] = notes[notes.length - 2]! - 12;
    }
    notes.sort((left, right) => left - right);
    if (notes.every((note) => note >= min && note <= max))
      candidates.push(notes);
  }
  return candidates.sort((left, right) => {
    for (
      let index = 0;
      index < Math.max(left.length, right.length);
      index += 1
    ) {
      const difference = (left[index] ?? 0) - (right[index] ?? 0);
      if (difference !== 0) return difference;
    }
    return 0;
  });
}

function chooseVoicing(
  chord: ParsedChordSymbol,
  voicing: "close" | "open" | "drop2",
  bounds: [number, number],
  prior: number[] | undefined,
  nearest: boolean,
  path: string,
  diagnostics: Diagnostic[],
): number[] {
  const candidates = voicingCandidates(chord, voicing, bounds[0], bounds[1]);
  if (candidates.length === 0) {
    diagnostics.push(
      diagnostic(
        "error",
        "unrealizable_voicing",
        path,
        `No ${voicing} voicing for ${chord.symbol} fits the requested register.`,
      ),
    );
    return [];
  }
  if (!nearest || !prior) return candidates[0]!;
  return [...candidates].sort((left, right) => {
    const motion = (notes: number[]) =>
      notes.reduce(
        (sum, note, index) =>
          sum + Math.abs(note - (prior[index] ?? prior.at(-1) ?? note)),
        0,
      );
    return (
      motion(left) - motion(right) ||
      candidates.indexOf(left) - candidates.indexOf(right)
    );
  })[0]!;
}

function degreeIndex(degree: number): number | undefined {
  return ({ 1: 0, 3: 1, 5: 2, 7: 3, 9: 4 } as Record<number, number>)[degree];
}

function pitchForDegree(
  chord: ParsedChordSymbol,
  degree: number,
  bounds: [number, number],
  octaveOffset = 0,
): number | undefined {
  const index = degreeIndex(degree);
  const interval = index === undefined ? undefined : chord.intervals[index];
  if (interval === undefined) return undefined;
  const pitchClass = (chord.rootPitchClass + interval) % 12;
  for (let midi = bounds[0]; midi <= bounds[1]; midi += 1) {
    if (midi % 12 === pitchClass) {
      const candidate = midi + octaveOffset * 12;
      return candidate <= bounds[1] ? candidate : undefined;
    }
  }
  return undefined;
}

function generatedAtom(notes: number[], durationBeats: number): ExpandedAtom {
  return {
    notes: notes.map((midi) => ({ midi, note: midiToNoteName(midi) })),
    durationBeats,
    velocity: DYNAMIC_VELOCITY.mf!,
    rest: notes.length === 0,
  };
}

function addGeneratedAtom(
  atoms: ExpandedAtom[],
  atom: ExpandedAtom,
  path: string,
  diagnostics: Diagnostic[],
  budget: ExpansionBudget,
): void {
  if (budget.atoms >= MAX_EXPANDED_ATOMS) {
    if (!budget.exhausted) {
      budget.exhausted = true;
      diagnostics.push(
        diagnostic(
          "error",
          "expanded_atom_limit",
          path,
          `Realization exceeds the experimental limit of ${MAX_EXPANDED_ATOMS} atoms.`,
        ),
      );
    }
    return;
  }
  budget.atoms += 1;
  atoms.push(atom);
}

function harmonyAtoms(
  source: AirSource,
  segment: Extract<
    RealizationSegment,
    { kind: "chords" | "arpeggio" | "bass" }
  >,
  path: string,
  diagnostics: Diagnostic[],
  budget: ExpansionBudget,
): ExpandedAtom[] {
  const spans = resolveHarmonyPlan(
    source,
    segment.harmony,
    `${path}.harmony`,
    diagnostics,
  );
  const bounds = registerBounds(
    segment.register,
    `${path}.register`,
    diagnostics,
  );
  if (!bounds) return [];
  const atoms: ExpandedAtom[] = [];
  let priorVoicing: number[] | undefined;
  let patternCursor = 0;
  spans.forEach((span, spanIndex) => {
    if (segment.kind === "chords") {
      let cursor = 0;
      let rhythmIndex = 0;
      while (cursor < span.beats - 0.0001) {
        const duration = segment.rhythm[rhythmIndex % segment.rhythm.length]!;
        if (cursor + duration > span.beats + 0.0001) {
          diagnostics.push(
            diagnostic(
              "error",
              "invalid_rhythm_fill",
              `${path}.rhythm`,
              `rhythm does not exactly fill chord span ${spanIndex + 1} (${span.beats} beats).`,
            ),
          );
          break;
        }
        const notes = span.chord
          ? chooseVoicing(
              span.chord,
              segment.voicing,
              bounds,
              priorVoicing,
              segment.voiceLeading === "nearest",
              `${path}#chord${spanIndex + 1}`,
              diagnostics,
            )
          : [];
        if (notes.length > 0) priorVoicing = notes;
        addGeneratedAtom(
          atoms,
          generatedAtom(notes, duration),
          path,
          diagnostics,
          budget,
        );
        cursor += duration;
        rhythmIndex += 1;
      }
      return;
    }
    const steps = span.beats / segment.stepBeats;
    if (
      !Number.isInteger(Math.round(steps)) ||
      Math.abs(steps - Math.round(steps)) > 0.0001
    ) {
      diagnostics.push(
        diagnostic(
          "error",
          "invalid_rhythm_fill",
          `${path}.stepBeats`,
          `stepBeats does not exactly fill chord span ${spanIndex + 1} (${span.beats} beats).`,
        ),
      );
      return;
    }
    for (let step = 0; step < Math.round(steps); step += 1) {
      let midi: number | undefined;
      if (span.chord) {
        const requestedDegree =
          segment.degrees[patternCursor % segment.degrees.length]!;
        if (
          segment.kind === "bass" &&
          segment.slashBass === "honor" &&
          step === 0 &&
          span.chord.slashBassPitchClass !== undefined
        ) {
          for (
            let candidate = bounds[0];
            candidate <= bounds[1];
            candidate += 1
          ) {
            if (candidate % 12 === span.chord.slashBassPitchClass) {
              midi = candidate;
              break;
            }
          }
        } else {
          const octaveOffset =
            segment.kind === "arpeggio"
              ? Math.floor(patternCursor / segment.degrees.length) %
                segment.octaveSpan
              : 0;
          midi = pitchForDegree(
            span.chord,
            requestedDegree,
            bounds,
            octaveOffset,
          );
        }
        if (midi === undefined) {
          diagnostics.push(
            diagnostic(
              "error",
              "unavailable_chord_degree",
              `${path}.degrees`,
              `Degree ${requestedDegree} of ${span.chord.symbol} does not fit the requested register.`,
            ),
          );
        }
      }
      addGeneratedAtom(
        atoms,
        generatedAtom(midi === undefined ? [] : [midi], segment.stepBeats),
        path,
        diagnostics,
        budget,
      );
      patternCursor += 1;
    }
  });
  return atoms;
}

function segmentAtoms(
  source: AirSource,
  segment: RealizationSegment,
  path: string,
  diagnostics: Diagnostic[],
  budget: ExpansionBudget,
  beatsPerBar: number,
): ExpandedAtom[] {
  if (segment.kind === "literal") {
    const fragments = segment.part.split("|");
    return fragments.flatMap((line, index) => {
      const fragmentPath = `${path}.part#bar${index + 1}`;
      const atoms = expandTokens(
        source,
        line,
        fragmentPath,
        diagnostics,
        [],
        budget,
      );
      if (fragments.length > 1) {
        const duration = atoms.reduce(
          (total, atom) => total + atom.durationBeats,
          0,
        );
        if (Math.abs(duration - beatsPerBar) > 0.0001) {
          diagnostics.push(
            diagnostic(
              "error",
              duration > beatsPerBar ? "measure_overflow" : "measure_underflow",
              fragmentPath,
              `Bar ${index + 1} contains ${duration} beats; ${source.meter} requires ${beatsPerBar}.`,
            ),
          );
        }
      }
      return atoms;
    });
  }
  if (segment.kind === "motif") {
    const transform = segment.transform ?? {};
    let atoms = expandMotif(
      source,
      segment.motif,
      transform.transpose ?? 0,
      transform.stretch ?? 1,
      path,
      diagnostics,
      [],
      budget,
    );
    if (transform.inversion) {
      const axis = atoms.flatMap((atom) => atom.notes)[0]?.midi;
      if (axis !== undefined) {
        atoms = atoms.map((atom) => ({
          ...atom,
          notes: atom.notes.map(({ midi }) => {
            const inverted = axis * 2 - midi;
            return { midi: inverted, note: midiToNoteName(inverted) };
          }),
          inversion: true,
        }));
      }
    }
    if (transform.retrograde) {
      atoms = [...atoms]
        .reverse()
        .map((atom) => ({ ...atom, retrograde: true }));
    }
    return atoms;
  }
  if (
    segment.kind === "chords" ||
    segment.kind === "arpeggio" ||
    segment.kind === "bass"
  ) {
    return harmonyAtoms(source, segment, path, diagnostics, budget);
  }
  if (segment.kind === "drum_grid") {
    const atoms: ExpandedAtom[] = [];
    const stepBeats = 4 / segment.resolution;
    const steps = segment.lanes[0]?.pattern.length ?? 0;
    for (let step = 0; step < steps; step += 1) {
      const notes = segment.lanes
        .filter((lane) => lane.pattern[step] === "x")
        .map((lane) => noteNameToMidi(lane.note))
        .filter((midi): midi is number => midi !== undefined);
      addGeneratedAtom(
        atoms,
        generatedAtom(notes, stepBeats),
        path,
        diagnostics,
        budget,
      );
    }
    return atoms;
  }
  return [generatedAtom([], segment.beats)];
}

function expressionForSegment(
  segment: RealizationSegment,
  atoms: ExpandedAtom[],
): {
  atoms: ExpandedAtom[];
  articulation: "none" | Articulation;
  gate: number;
} {
  const articulation = segment.articulation ?? "none";
  const defaultGate: Record<"none" | Articulation, number> = {
    none: 1,
    staccato: 0.5,
    tenuto: 0.95,
    accent: 0.85,
    legato: 1.05,
  };
  const gate = segment.gate ?? defaultGate[articulation];
  const starts: number[] = [];
  let onset = 0;
  for (const atom of atoms) {
    starts.push(onset);
    onset += atom.durationBeats;
  }
  const finalOnset = starts.at(-1) ?? 0;
  const curvePoints = segment.dynamicCurve
    ? [
        { at: 0, level: segment.dynamicCurve.from },
        ...(segment.dynamicCurve.via ?? []),
        { at: 1, level: segment.dynamicCurve.to },
      ]
    : undefined;
  const expressed = atoms.map((atom, index) => {
    let velocity = atom.velocity;
    if (curvePoints) {
      const progress = finalOnset <= 0 ? 0 : (starts[index] ?? 0) / finalOnset;
      const rightIndex = curvePoints.findIndex((point) => progress <= point.at);
      const right =
        curvePoints[rightIndex < 0 ? curvePoints.length - 1 : rightIndex]!;
      const left =
        curvePoints[
          Math.max(0, (rightIndex < 0 ? curvePoints.length : rightIndex) - 1)
        ]!;
      const span = right.at - left.at;
      const localProgress = span <= 0 ? 0 : (progress - left.at) / span;
      velocity =
        DYNAMIC_VELOCITY[left.level]! +
        (DYNAMIC_VELOCITY[right.level]! - DYNAMIC_VELOCITY[left.level]!) *
          localProgress;
    } else if (segment.dynamic) {
      velocity = DYNAMIC_VELOCITY[segment.dynamic]!;
    }
    if (articulation === "accent") velocity = Math.min(0.99, velocity * 1.15);
    return { ...atom, velocity };
  });
  return { atoms: expressed, articulation, gate };
}

function structuralLint(compiled: CompiledAir): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const byStart = new Map<number, CompiledEvent[]>();
  for (const event of compiled.events) {
    const key = Math.round(event.startBeat * 1000) / 1000;
    const group = byStart.get(key) ?? [];
    group.push(event);
    byStart.set(key, group);
  }

  for (const [beat, group] of byStart) {
    const highAttacks = group.filter(
      (event) => event.midi >= 84 && event.velocity >= 0.8,
    );
    if (highAttacks.length >= 3) {
      diagnostics.push(
        diagnostic(
          "warning",
          "high_attack_cluster",
          `beat:${beat}`,
          `${highAttacks.length} strong high-register attacks begin together.`,
          "This can sound piercing on headphones; keep it only when intentional.",
        ),
      );
    }

    const sounding = [...group].sort((left, right) => left.midi - right.midi);
    if (
      sounding.length >= 5 &&
      sounding.at(-1)!.midi - sounding[0]!.midi <= 12
    ) {
      diagnostics.push(
        diagnostic(
          "warning",
          "register_crowding",
          `beat:${beat}`,
          `${sounding.length} attacks occupy one octave at the same moment.`,
        ),
      );
    }
  }

  const motifs = new Map<string, MotifOccurrence[]>();
  for (const occurrence of compiled.motifOccurrences) {
    const list = motifs.get(occurrence.motif) ?? [];
    list.push(occurrence);
    motifs.set(occurrence.motif, list);
  }
  for (const [name, occurrences] of motifs) {
    if (occurrences.length > 1) {
      diagnostics.push(
        diagnostic(
          "note",
          "motif_returns",
          `$.motifs.${name}`,
          `@${name} returns ${occurrences.length} times across the compiled air.`,
        ),
      );
    }
  }
  return diagnostics;
}

function compileAirImpl(
  input: string | unknown,
  options: CompileAirOptions = {},
  allowIncompleteFinalBar = false,
): CompileAirResult {
  const parsed = parseAir(input);
  if (!parsed.source) return { diagnostics: parsed.diagnostics };
  const source = parsed.source;
  const diagnostics = [...parsed.diagnostics];
  const vocabulary = options.vocabulary ?? CORE_AUTHORING_VOCABULARY;
  const instrumentsById = new Map(
    vocabulary.instruments.map((instrument) => [instrument.id, instrument]),
  );
  const beatsPerBar = meterBeats(source.meter);
  if (beatsPerBar === undefined || beatsPerBar <= 0) {
    diagnostics.push(
      diagnostic(
        "error",
        "unsupported_meter",
        "$.meter",
        `Cannot compile meter ${source.meter}.`,
      ),
    );
    return { source, diagnostics };
  }

  const events: CompiledEvent[] = [];
  const motifOccurrences: MotifOccurrence[] = [];
  const segments: CompiledSegment[] = [];
  let longestBars = 0;
  let eventLimitReported = false;
  const expansionBudget: ExpansionBudget = { atoms: 0, exhausted: false };

  source.voices.forEach((voice, voiceIndex) => {
    const instrument = instrumentsById.get(voice.instrument);
    if (!instrument) {
      diagnostics.push(
        diagnostic(
          "error",
          "unknown_instrument",
          `$.voices[${voiceIndex}].instrument`,
          `Unknown instrument ${voice.instrument}.`,
        ),
      );
      return;
    }
    let eventIndex = 0;
    const occurrenceCount = new Map<string, number>();
    const invocationOccurrence = new Map<string, number>();

    const emitAtoms = (
      atoms: ExpandedAtom[],
      startBeat: number,
      path: string,
      sourceAnchor: CompiledEvent["source"],
      articulation: "none" | Articulation,
      gate: number,
      invocationSuffix = "",
    ): { endBeat: number; emitted: CompiledEvent[] } => {
      let cursor = startBeat;
      const emitted: CompiledEvent[] = [];
      for (const atom of atoms) {
        let motifOccurrence: number | undefined;
        if (atom.motif) {
          const invocation = `${atom.motifInvocation ?? `${path}:${cursor}`}${invocationSuffix}`;
          motifOccurrence = invocationOccurrence.get(invocation);
          if (motifOccurrence === undefined) {
            motifOccurrence = (occurrenceCount.get(atom.motif) ?? 0) + 1;
            occurrenceCount.set(atom.motif, motifOccurrence);
            invocationOccurrence.set(invocation, motifOccurrence);
          }
          const prior = motifOccurrences.at(-1);
          if (
            !prior ||
            prior.motif !== atom.motif ||
            prior.voiceId !== voice.id ||
            Math.abs(prior.startBeat + prior.durationBeats - cursor) > 0.0001 ||
            prior.occurrence !== motifOccurrence
          ) {
            const anchor = `${voice.id}:${sourceAnchor.segmentId ?? "part"}:${motifOccurrence}:${atom.motif}`;
            motifOccurrences.push({
              anchor,
              motif: atom.motif,
              familyId: atom.motif,
              voiceId: voice.id,
              occurrence: motifOccurrence,
              startBeat: cursor,
              durationBeats: atom.durationBeats,
              transpose: atom.transpose ?? 0,
              stretch: atom.stretch ?? 1,
              inversion: atom.inversion ?? false,
              retrograde: atom.retrograde ?? false,
              material: [
                {
                  relativeStartBeat: 0,
                  durationBeats: atom.durationBeats,
                  notes: atom.notes.map((note) => note.midi),
                },
              ],
              ...(sourceAnchor.segmentId === undefined
                ? {}
                : { segmentId: sourceAnchor.segmentId }),
            });
          } else {
            prior.material.push({
              relativeStartBeat: cursor - prior.startBeat,
              durationBeats: atom.durationBeats,
              notes: atom.notes.map((note) => note.midi),
            });
            prior.durationBeats += atom.durationBeats;
          }
        }
        if (!atom.rest) {
          for (const note of atom.notes) {
            if (
              note.midi < instrument.midiMin ||
              note.midi > instrument.midiMax
            ) {
              diagnostics.push(
                diagnostic(
                  "error",
                  "out_of_range",
                  path,
                  `${note.note} is outside ${instrument.label}'s ${midiToNoteName(instrument.midiMin)}–${midiToNoteName(instrument.midiMax)} range.`,
                ),
              );
            }
            if (
              instrument.supportedNotes &&
              !instrument.supportedNotes.includes(note.midi)
            ) {
              diagnostics.push(
                diagnostic(
                  "error",
                  "unsupported_pitch",
                  path,
                  `${note.note} is not in ${instrument.label}'s supported kit (${instrument.supportedNotes.map(midiToNoteName).join(", ")}).`,
                ),
              );
            }
            if (events.length >= MAX_EVENTS) {
              if (!eventLimitReported) {
                eventLimitReported = true;
                diagnostics.push(
                  diagnostic(
                    "error",
                    "event_limit",
                    "$.voices",
                    `The experimental event limit is ${MAX_EVENTS} notes.`,
                  ),
                );
              }
              continue;
            }
            const id =
              sourceAnchor.authoring === "part"
                ? `${voice.id}:${Math.floor(cursor / beatsPerBar) + 1}:${++eventIndex}`
                : `${voice.id}:${sourceAnchor.segmentId}:r${(sourceAnchor.repeatIndex ?? 0) + 1}:${++eventIndex}`;
            const event: CompiledEvent = {
              id,
              voiceId: voice.id,
              role: voice.role,
              instrument: voice.instrument,
              midi: note.midi,
              note: note.note,
              startBeat: cursor,
              durationBeats: atom.durationBeats,
              soundingDurationBeats: atom.durationBeats * gate,
              velocity: atom.velocity,
              gainDb: voice.gainDb ?? 0,
              pan: voice.pan ?? 0,
              bar: Math.floor(cursor / beatsPerBar) + 1,
              articulation,
              gate,
              source: sourceAnchor,
              ...(atom.motif ? { motif: atom.motif, motifOccurrence } : {}),
            };
            events.push(event);
            emitted.push(event);
          }
        }
        cursor += atom.durationBeats;
      }
      return { endBeat: cursor, emitted };
    };

    if ("part" in voice && typeof voice.part === "string") {
      const bars = voice.part.split("|");
      if (bars.length > MAX_BARS) {
        diagnostics.push(
          diagnostic(
            "error",
            "bar_limit",
            `$.voices[${voiceIndex}].part`,
            `A voice may contain at most ${MAX_BARS} bars in this experimental format.`,
          ),
        );
        return;
      }
      longestBars = Math.max(longestBars, bars.length);
      bars.forEach((barText, barIndex) => {
        const path = `$.voices[${voiceIndex}].part#bar${barIndex + 1}`;
        const atoms = expandTokens(
          source,
          barText,
          path,
          diagnostics,
          [],
          expansionBudget,
        );
        const duration = atoms.reduce(
          (total, atom) => total + atom.durationBeats,
          0,
        );
        if (Math.abs(duration - beatsPerBar) > 0.0001) {
          diagnostics.push(
            diagnostic(
              "error",
              duration > beatsPerBar ? "measure_overflow" : "measure_underflow",
              path,
              `Bar ${barIndex + 1} contains ${duration} beats; ${source.meter} requires ${beatsPerBar}.`,
            ),
          );
        }
        emitAtoms(
          atoms,
          barIndex * beatsPerBar,
          path,
          { voiceId: voice.id, authoring: "part" },
          "none",
          1,
        );
      });
      return;
    }

    let cursor = 0;
    let priorTie:
      { path: string; boundary: number; events: CompiledEvent[] } | undefined;
    voice.realize.forEach((segment, segmentIndex) => {
      const path = `$.voices[${voiceIndex}].realize[${segmentIndex}]`;
      const baseAtoms = segmentAtoms(
        source,
        segment,
        path,
        diagnostics,
        expansionBudget,
        beatsPerBar,
      );
      const expression = expressionForSegment(segment, baseAtoms);
      for (
        let repeatIndex = 0;
        repeatIndex < (segment.repeat ?? 1);
        repeatIndex += 1
      ) {
        const sourceAnchor: CompiledEvent["source"] = {
          voiceId: voice.id,
          authoring: "realize",
          segmentId: segment.id,
          segmentIndex,
          repeatIndex,
          ...(segment.section === undefined
            ? {}
            : { section: segment.section }),
        };
        const executionStart = cursor;
        const result = emitAtoms(
          expression.atoms,
          cursor,
          path,
          sourceAnchor,
          expression.articulation,
          expression.gate,
          `:repeat${repeatIndex}`,
        );
        cursor = result.endBeat;
        segments.push({
          anchor: `${voice.id}:${segment.id}:r${repeatIndex + 1}`,
          voiceId: voice.id,
          segmentId: segment.id,
          segmentIndex,
          repeatIndex,
          kind: segment.kind,
          startBeat: executionStart,
          endBeat: cursor,
          ...(segment.section === undefined
            ? {}
            : { section: segment.section }),
          ...(segment.kind === "motif" ? { motif: segment.motif } : {}),
          ...(segment.kind === "chords" ||
          segment.kind === "arpeggio" ||
          segment.kind === "bass"
            ? { harmony: segment.harmony }
            : {}),
          expression: {
            ...(segment.dynamic === undefined
              ? {}
              : { dynamic: segment.dynamic }),
            ...(segment.dynamicCurve === undefined
              ? {}
              : { dynamicCurve: segment.dynamicCurve }),
            articulation: expression.articulation,
            gate: expression.gate,
            tieToNext: segment.tieToNext ?? false,
          },
        });
        if (priorTie) {
          let matches = 0;
          for (const priorEvent of priorTie.events) {
            const continuation = result.emitted.find(
              (event) =>
                event.midi === priorEvent.midi &&
                Math.abs(event.startBeat - priorTie!.boundary) < 0.0001,
            );
            if (!continuation) continue;
            priorEvent.durationBeats =
              continuation.startBeat +
              continuation.durationBeats -
              priorEvent.startBeat;
            priorEvent.soundingDurationBeats =
              continuation.startBeat +
              continuation.soundingDurationBeats -
              priorEvent.startBeat;
            priorEvent.gate =
              priorEvent.soundingDurationBeats / priorEvent.durationBeats;
            const index = events.indexOf(continuation);
            if (index >= 0) events.splice(index, 1);
            const emittedIndex = result.emitted.indexOf(continuation);
            if (emittedIndex >= 0) result.emitted[emittedIndex] = priorEvent;
            matches += 1;
          }
          if (matches === 0)
            diagnostics.push(
              diagnostic(
                "error",
                "dangling_tie",
                priorTie.path,
                "tieToNext found no matching pitch at the next segment boundary.",
              ),
            );
          priorTie = undefined;
        }
        if (segment.tieToNext) {
          priorTie = {
            path: `${path}.tieToNext`,
            boundary: cursor,
            events: result.emitted.filter(
              (event) =>
                Math.abs(event.startBeat + event.durationBeats - cursor) <
                0.0001,
            ),
          };
        }
        if (Math.abs(executionStart - cursor) < 0.0001) {
          diagnostics.push(
            diagnostic(
              "error",
              "empty_segment",
              path,
              "A segment must advance musical time.",
            ),
          );
        }
      }
    });
    if (priorTie)
      diagnostics.push(
        diagnostic(
          "error",
          "dangling_tie",
          priorTie.path,
          "tieToNext cannot end a voice.",
        ),
      );
    const bars = cursor / beatsPerBar;
    if (
      !allowIncompleteFinalBar &&
      Math.abs(bars - Math.round(bars)) > 0.0001
    ) {
      diagnostics.push(
        diagnostic(
          "error",
          "voice_bar_alignment",
          `$.voices[${voiceIndex}].realize`,
          `Structured voice contains ${cursor} beats; ${source.meter} requires complete bars of ${beatsPerBar} beats.`,
        ),
      );
    }
    if (Math.ceil(bars) > MAX_BARS)
      diagnostics.push(
        diagnostic(
          "error",
          "bar_limit",
          `$.voices[${voiceIndex}].realize`,
          `A voice may contain at most ${MAX_BARS} bars in this experimental format.`,
        ),
      );
    longestBars = Math.max(longestBars, Math.ceil(bars));
  });

  if (source.sections) {
    for (const section of source.sections) {
      if (section.startBar + section.bars - 1 > longestBars) {
        diagnostics.push(
          diagnostic(
            "error",
            "section_out_of_range",
            `$.sections.${section.id}`,
            `Section ${section.id} extends beyond the ${longestBars}-bar score.`,
          ),
        );
      }
    }
  }

  events.sort(
    (left, right) =>
      left.startBeat - right.startBeat ||
      (left.voiceId < right.voiceId
        ? -1
        : left.voiceId > right.voiceId
          ? 1
          : 0) ||
      left.midi - right.midi,
  );

  const durationBeats = longestBars * beatsPerBar;
  const durationSeconds = (durationBeats * 60) / source.tempo;
  if (durationSeconds > MAX_SCORE_SECONDS) {
    diagnostics.push(
      diagnostic(
        "error",
        "score_too_long",
        "$.voices",
        `The experimental duration limit is ${MAX_SCORE_SECONDS} seconds; this air is ${durationSeconds.toFixed(1)} seconds.`,
      ),
    );
  }

  if (diagnostics.some((item) => item.severity === "error")) {
    return { source, diagnostics };
  }

  const usedMotifs = new Set(
    motifOccurrences.map((occurrence) => occurrence.familyId),
  );
  const motifFamilies: CompiledMotifFamily[] = Object.keys(source.motifs)
    .filter((familyId) => usedMotifs.has(familyId))
    .map((familyId) => {
      const atoms = expandMotif(
        source,
        familyId,
        0,
        1,
        `$.motifs.${familyId}`,
        diagnostics,
        [],
        { atoms: 0, exhausted: false },
      );
      const originMidi = atoms.flatMap((atom) => atom.notes)[0]?.midi ?? 0;
      let cursor = 0;
      return {
        familyId,
        durationBeats: atoms.reduce(
          (total, atom) => total + atom.durationBeats,
          0,
        ),
        atoms: atoms.map((atom) => {
          const projected = {
            relativeStartBeat: cursor,
            durationBeats: atom.durationBeats,
            pitchDeltas: atom.notes.map((note) => note.midi - originMidi),
          };
          cursor += atom.durationBeats;
          return projected;
        }),
      };
    });

  const compiled: CompiledAir = {
    format: "compiled-air@0-experimental",
    sourceFormat: source.format,
    title: source.title,
    tempo: source.tempo,
    meter: source.meter,
    beatsPerBar,
    durationBeats,
    durationSeconds,
    events,
    motifFamilies,
    motifOccurrences,
    segments,
    sections: (source.sections ?? []).map((section) => ({
      id: section.id,
      startBeat: (section.startBar - 1) * beatsPerBar,
      endBeat: (section.startBar - 1 + section.bars) * beatsPerBar,
    })),
  };
  diagnostics.push(...structuralLint(compiled));
  return { source, compiled, diagnostics };
}

export function compileAir(
  input: string | unknown,
  options: CompileAirOptions = {},
): CompileAirResult {
  return compileAirImpl(input, options);
}

/** @internal Used only to reuse the AIR@0 realization engine inside AIR@1. */
export function compileAirSegmentProjection(
  input: string | unknown,
  options: CompileAirOptions = {},
): CompileAirResult {
  return compileAirImpl(input, options, true);
}
