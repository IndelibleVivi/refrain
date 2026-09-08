import {
  AIR_FORMAT,
  type AirSource,
  type Articulation,
  type Diagnostic,
  type DynamicCurve,
  type RealizationSegment,
} from "@refrain/air-schema";
import {
  AIR_V1_FORMAT,
  parseAirV1,
  rationalToNumber,
  type AirGroove,
  type AirSourceV1,
  type PhraseBodySegmentV1,
  type PhraseSegmentV1,
  type RealizationSegmentV1,
  type TechniqueOperation,
} from "@refrain/air-schema/v1";
import {
  AUTHORING_VOCABULARY_CLOSURE_FORMAT,
  type AuthoringVocabularyClosure,
} from "@refrain/soundpack/vnext";
import {
  MAX_BARS,
  MAX_EVENTS,
  MAX_EXPANDED_ATOMS,
  MAX_SCORE_SECONDS,
  compileAirSegmentProjection,
  midiToNoteName,
  type CompiledAir,
  type CompiledEvent,
  type CompiledMotifFamily,
  type CompiledSection,
  type MotifOccurrence,
  type NormalizedMotifAtom,
} from "./index.js";

export const COMPILED_AIR_V1_FORMAT = "compiled-air@1-experimental" as const;

export interface CompiledMeterChange {
  bar: number;
  meter: string;
  startBeat: number;
  beatsPerBar: number;
}

export interface CompiledEventV1 extends CompiledEvent {
  notatedStartBeat: number;
  timingOffsetBeats?: number;
  techniques?: string[];
  grooves?: string[];
  phrase?: string;
  phraseOccurrence?: number;
}

export interface CompiledSegmentV1 {
  anchor: string;
  voiceId: string;
  segmentId: string;
  sourceSegmentId: string;
  segmentIndex: number;
  repeatIndex: number;
  kind: RealizationSegmentV1["kind"];
  startBeat: number;
  endBeat: number;
  section?: string;
  motif?: string;
  harmony?: string;
  phrase?: string;
  parentPhraseSegmentId?: string;
  techniques: string[];
  grooves: string[];
  expression: {
    dynamic?: string;
    dynamicCurve?: DynamicCurve;
    articulation: "none" | Articulation;
    gate: number;
    tieToNext: boolean;
  };
}

export interface PhraseOccurrence {
  anchor: string;
  phrase: string;
  voiceId: string;
  occurrence: number;
  segmentId: string;
  repeatIndex: number;
  startBeat: number;
  durationBeats: number;
  transpose: number;
  timeScale: number;
  inversion: boolean;
  retrograde: boolean;
  techniques: string[];
  grooves: string[];
}

export interface CompiledAirV1 {
  format: typeof COMPILED_AIR_V1_FORMAT;
  sourceFormat: typeof AIR_V1_FORMAT;
  title: string;
  tempo: number;
  meter: string;
  beatsPerBar: number;
  pickupBeats: number;
  meterChanges: CompiledMeterChange[];
  durationBeats: number;
  durationSeconds: number;
  bars: number;
  events: CompiledEventV1[];
  motifFamilies: CompiledMotifFamily[];
  motifOccurrences: MotifOccurrence[];
  phraseOccurrences: PhraseOccurrence[];
  segments: CompiledSegmentV1[];
  sections: CompiledSection[];
  techniquesUsed: string[];
  groovesUsed: string[];
}

export interface CompileAirV1Result {
  source?: AirSourceV1;
  compiled?: CompiledAirV1;
  diagnostics: Diagnostic[];
}

interface BlockAtom {
  startBeat: number;
  durationBeats: number;
  notes: number[];
  velocity: number;
  articulation: "none" | Articulation;
  gate: number;
  timingOffsetBeats: number;
  motif?: string;
  motifLocalOccurrence?: number;
  motifOccurrenceToken?: string;
  motifTranspose: number;
  motifStretch: number;
  motifInversion: boolean;
  motifRetrograde: boolean;
  techniques: string[];
  grooves: string[];
}

interface BlockSpan {
  sourceSegmentId: string;
  childRepeatIndex?: number;
  kind: PhraseBodySegmentV1["kind"];
  startBeat: number;
  endBeat: number;
  section?: string;
  motif?: string;
  harmony?: string;
  techniques: string[];
  grooves: string[];
  expression: CompiledSegmentV1["expression"];
}

interface MusicalBlock {
  durationBeats: number;
  atoms: BlockAtom[];
  spans: BlockSpan[];
  motifFamilies: CompiledMotifFamily[];
}

interface OperationSummary {
  transpose: number;
  timeScale: number;
  inversion: boolean;
  retrograde: boolean;
}

const EPSILON = 1e-8;
const DYNAMIC_VELOCITY: Record<string, number> = {
  pp: 0.28,
  p: 0.4,
  mp: 0.54,
  mf: 0.68,
  f: 0.82,
  ff: 0.94,
};
const DEFAULT_GATE: Record<"none" | Articulation, number> = {
  none: 1,
  staccato: 0.5,
  tenuto: 0.95,
  accent: 0.85,
  legato: 1.05,
};

type BudgetCounter =
  | "expandedAtoms"
  | "allocatedAtoms"
  | "compiledEvents"
  | "segments"
  | "motifOccurrences"
  | "phraseOccurrences"
  | "cloneCost";

const V1_BUDGET_LIMITS: Record<BudgetCounter, number> = {
  expandedAtoms: MAX_EXPANDED_ATOMS,
  allocatedAtoms: MAX_EXPANDED_ATOMS * 8,
  compiledEvents: MAX_EVENTS,
  segments: MAX_EXPANDED_ATOMS,
  motifOccurrences: MAX_EXPANDED_ATOMS,
  phraseOccurrences: MAX_EXPANDED_ATOMS,
  cloneCost: MAX_EXPANDED_ATOMS * 16,
};

class V1BudgetExceeded extends Error {}

class V1CompileBudget {
  private readonly values: Record<BudgetCounter, number> = {
    expandedAtoms: 0,
    allocatedAtoms: 0,
    compiledEvents: 0,
    segments: 0,
    motifOccurrences: 0,
    phraseOccurrences: 0,
    cloneCost: 0,
  };

  charge(
    counter: BudgetCounter,
    amount: number,
    path: string,
    diagnostics: Diagnostic[],
  ): void {
    const next = this.values[counter] + amount;
    if (
      !Number.isSafeInteger(amount) ||
      amount < 0 ||
      !Number.isSafeInteger(next) ||
      next > V1_BUDGET_LIMITS[counter]
    ) {
      const code =
        counter === "expandedAtoms"
          ? "expanded_atom_limit"
          : counter === "compiledEvents"
            ? "event_limit"
            : `${counter.replace(/[A-Z]/g, (value) => `_${value.toLowerCase()}`)}_limit`;
      diagnostics.push(
        diagnostic(
          "error",
          code,
          path,
          `AIR@1 ${counter} exceeds the bounded limit of ${V1_BUDGET_LIMITS[counter]}.`,
        ),
      );
      throw new V1BudgetExceeded(code);
    }
    this.values[counter] = next;
  }

  product(
    left: number,
    right: number,
    path: string,
    diagnostics: Diagnostic[],
  ): number {
    const product = left * right;
    if (!Number.isSafeInteger(product) || product < 0) {
      diagnostics.push(
        diagnostic(
          "error",
          "expansion_overflow",
          path,
          "AIR@1 expansion multiplication exceeded the safe-integer range.",
        ),
      );
      throw new V1BudgetExceeded("expansion_overflow");
    }
    return product;
  }

  reserveClone(
    block: MusicalBlock,
    copies: number,
    path: string,
    diagnostics: Diagnostic[],
  ): void {
    const atoms = this.product(block.atoms.length, copies, path, diagnostics);
    const spans = this.product(block.spans.length, copies, path, diagnostics);
    this.charge("allocatedAtoms", atoms, path, diagnostics);
    this.charge("cloneCost", atoms + spans, path, diagnostics);
  }
}

function diagnostic(
  severity: Diagnostic["severity"],
  code: string,
  path: string,
  message: string,
  hint?: string,
): Diagnostic {
  return {
    severity,
    code,
    path,
    message,
    ...(hint === undefined ? {} : { hint }),
  };
}

function meterBeats(meter: string): number {
  const [numerator, denominator] = meter.split("/").map(Number);
  return (numerator! * 4) / denominator!;
}

function operationFactor(operation: TechniqueOperation): number | undefined {
  return "factor" in operation ? rationalToNumber(operation.factor) : undefined;
}

function transformOperations(
  transform:
    | PhraseSegmentV1["transform"]
    | Extract<PhraseBodySegmentV1, { kind: "motif" }>["transform"],
): TechniqueOperation[] {
  if (!transform) return [];
  return [
    ...(transform.transpose === undefined
      ? []
      : [{ type: "transpose", semitones: transform.transpose } as const]),
    ...(transform.timeScale === undefined
      ? []
      : [{ type: "time-scale", factor: transform.timeScale } as const]),
    ...(transform.inversion ? [{ type: "invert" } as const] : []),
    ...(transform.retrograde ? [{ type: "retrograde" } as const] : []),
  ];
}

function operationSummary(
  operations: readonly TechniqueOperation[],
): OperationSummary {
  const summary: OperationSummary = {
    transpose: 0,
    timeScale: 1,
    inversion: false,
    retrograde: false,
  };
  for (const operation of operations) {
    if (operation.type === "transpose")
      summary.transpose += operation.semitones;
    else if (operation.type === "time-scale")
      summary.timeScale *= rationalToNumber(operation.factor);
    else if (operation.type === "invert")
      summary.inversion = !summary.inversion;
    else if (operation.type === "retrograde")
      summary.retrograde = !summary.retrograde;
  }
  return summary;
}

function cloneBlock(
  block: MusicalBlock,
  budget: V1CompileBudget,
  path: string,
  diagnostics: Diagnostic[],
): MusicalBlock {
  budget.reserveClone(block, 1, path, diagnostics);
  return structuredClone(block);
}

function rotateContents(atoms: BlockAtom[], steps: number): void {
  if (atoms.length < 2) return;
  const ordered = [...atoms].sort(
    (left, right) => left.startBeat - right.startBeat,
  );
  const shift = ((steps % ordered.length) + ordered.length) % ordered.length;
  const contents = ordered.map((atom) => ({
    notes: atom.notes,
    velocity: atom.velocity,
    articulation: atom.articulation,
    gate: atom.gate,
    motif: atom.motif,
    motifLocalOccurrence: atom.motifLocalOccurrence,
    motifOccurrenceToken: atom.motifOccurrenceToken,
    motifTranspose: atom.motifTranspose,
    motifStretch: atom.motifStretch,
    motifInversion: atom.motifInversion,
    motifRetrograde: atom.motifRetrograde,
  }));
  ordered.forEach((atom, index) => {
    Object.assign(
      atom,
      contents[(index - shift + ordered.length) % ordered.length],
    );
  });
}

function applyOperations(
  input: MusicalBlock,
  operations: readonly TechniqueOperation[],
  budget: V1CompileBudget,
  path: string,
  diagnostics: Diagnostic[],
): MusicalBlock {
  const block = cloneBlock(input, budget, path, diagnostics);
  for (const operation of operations) {
    if (operation.type === "transpose") {
      for (const atom of block.atoms) {
        atom.notes = atom.notes.map((note) => note + operation.semitones);
        if (atom.motif) atom.motifTranspose += operation.semitones;
      }
      continue;
    }
    if (operation.type === "time-scale") {
      const factor = operationFactor(operation)!;
      block.durationBeats *= factor;
      for (const atom of block.atoms) {
        atom.startBeat *= factor;
        atom.durationBeats *= factor;
        atom.timingOffsetBeats *= factor;
        if (atom.motif) atom.motifStretch *= factor;
      }
      for (const span of block.spans) {
        span.startBeat *= factor;
        span.endBeat *= factor;
      }
      continue;
    }
    if (operation.type === "velocity-scale") {
      const factor = operationFactor(operation)!;
      for (const atom of block.atoms)
        atom.velocity = Math.min(0.99, Math.max(0.01, atom.velocity * factor));
      continue;
    }
    if (operation.type === "gate-scale") {
      const factor = operationFactor(operation)!;
      for (const atom of block.atoms)
        atom.gate = Math.min(1.5, Math.max(0.05, atom.gate * factor));
      for (const span of block.spans)
        span.expression.gate = Math.min(
          1.5,
          Math.max(0.05, span.expression.gate * factor),
        );
      continue;
    }
    if (operation.type === "invert") {
      const axis = [...block.atoms]
        .sort((left, right) => left.startBeat - right.startBeat)
        .flatMap((atom) => atom.notes)[0];
      if (axis !== undefined)
        for (const atom of block.atoms) {
          atom.notes = atom.notes.map((note) => axis * 2 - note);
          if (atom.motif) atom.motifInversion = !atom.motifInversion;
        }
      continue;
    }
    if (operation.type === "retrograde") {
      for (const atom of block.atoms) {
        atom.startBeat =
          block.durationBeats - atom.startBeat - atom.durationBeats;
        if (atom.motif) atom.motifRetrograde = !atom.motifRetrograde;
      }
      for (const span of block.spans) {
        const oldStart = span.startBeat;
        span.startBeat = block.durationBeats - span.endBeat;
        span.endBeat = block.durationBeats - oldStart;
      }
      continue;
    }
    if (operation.type === "rotate") {
      rotateContents(block.atoms, operation.steps);
      continue;
    }
    block.atoms = block.atoms.filter(
      (_atom, index) => index % operation.every === operation.offset,
    );
  }
  block.atoms.sort((left, right) => left.startBeat - right.startBeat);
  block.spans.sort((left, right) => left.startBeat - right.startBeat);
  return block;
}

function applyTechniqueDefinitions(
  block: MusicalBlock,
  techniqueIds: readonly string[],
  source: AirSourceV1,
  budget: V1CompileBudget,
  path: string,
  diagnostics: Diagnostic[],
): MusicalBlock {
  let current = cloneBlock(block, budget, path, diagnostics);
  for (const [index, techniqueId] of techniqueIds.entries()) {
    const definition = source.vocabulary.techniques.find(
      (candidate) => candidate.id === techniqueId,
    )!;
    current = applyOperations(
      current,
      definition.operations,
      budget,
      `${path}.techniques[${index}]`,
      diagnostics,
    );
    for (const atom of current.atoms)
      if (!atom.techniques.includes(techniqueId))
        atom.techniques.push(techniqueId);
    for (const span of current.spans)
      if (!span.techniques.includes(techniqueId))
        span.techniques.push(techniqueId);
  }
  return current;
}

function applyGroove(
  input: MusicalBlock,
  groove: AirGroove | undefined,
  budget: V1CompileBudget,
  path: string,
  diagnostics: Diagnostic[],
): MusicalBlock {
  if (!groove) return input;
  const block = cloneBlock(input, budget, path, diagnostics);
  const cycle = rationalToNumber(groove.cycle);
  for (const atom of block.atoms) {
    const position = ((atom.startBeat % cycle) + cycle) % cycle;
    const step = groove.steps.find(
      (candidate) =>
        Math.abs(rationalToNumber(candidate.at) - position) < EPSILON,
    );
    if (!step) continue;
    atom.timingOffsetBeats += rationalToNumber(step.offset);
    if (step.velocityScale)
      atom.velocity = Math.min(
        0.99,
        Math.max(0.01, atom.velocity * rationalToNumber(step.velocityScale)),
      );
    if (!atom.grooves.includes(groove.id)) atom.grooves.push(groove.id);
  }
  for (const span of block.spans)
    if (!span.grooves.includes(groove.id)) span.grooves.push(groove.id);
  return block;
}

function applyExpression(
  input: MusicalBlock,
  segment: RealizationSegmentV1,
  budget: V1CompileBudget,
  path: string,
  diagnostics: Diagnostic[],
): MusicalBlock {
  const block = cloneBlock(input, budget, path, diagnostics);
  const articulation = segment.articulation;
  const gate = articulation
    ? (segment.gate ?? DEFAULT_GATE[articulation])
    : segment.gate;
  const ordered = [...block.atoms].sort(
    (left, right) => left.startBeat - right.startBeat,
  );
  const finalOnset = ordered.at(-1)?.startBeat ?? 0;
  const curve = segment.dynamicCurve
    ? [
        { at: 0, level: segment.dynamicCurve.from },
        ...(segment.dynamicCurve.via ?? []),
        { at: 1, level: segment.dynamicCurve.to },
      ]
    : undefined;
  for (const atom of ordered) {
    if (segment.dynamic) atom.velocity = DYNAMIC_VELOCITY[segment.dynamic]!;
    else if (curve) {
      const progress = finalOnset <= 0 ? 0 : atom.startBeat / finalOnset;
      const rightIndex = Math.max(
        1,
        curve.findIndex((point) => progress <= point.at),
      );
      const right = curve[rightIndex < 0 ? curve.length - 1 : rightIndex]!;
      const left = curve[Math.max(0, rightIndex - 1)]!;
      const span = right.at - left.at;
      const local = span <= 0 ? 0 : (progress - left.at) / span;
      atom.velocity =
        DYNAMIC_VELOCITY[left.level]! +
        (DYNAMIC_VELOCITY[right.level]! - DYNAMIC_VELOCITY[left.level]!) *
          local;
    }
    if (articulation) atom.articulation = articulation;
    if (gate !== undefined) atom.gate = gate;
    if (articulation === "accent")
      atom.velocity = Math.min(0.99, atom.velocity * 1.15);
  }
  return block;
}

function concatenate(
  blocks: readonly MusicalBlock[],
  budget: V1CompileBudget,
  path: string,
  diagnostics: Diagnostic[],
): MusicalBlock {
  for (const block of blocks) budget.reserveClone(block, 1, path, diagnostics);
  let cursor = 0;
  const atoms: BlockAtom[] = [];
  const spans: BlockSpan[] = [];
  const families = new Map<string, CompiledMotifFamily>();
  for (const block of blocks) {
    atoms.push(
      ...block.atoms.map((atom) => ({
        ...structuredClone(atom),
        startBeat: atom.startBeat + cursor,
      })),
    );
    spans.push(
      ...block.spans.map((span) => ({
        ...structuredClone(span),
        startBeat: span.startBeat + cursor,
        endBeat: span.endBeat + cursor,
      })),
    );
    for (const family of block.motifFamilies)
      if (!families.has(family.familyId)) families.set(family.familyId, family);
    cursor += block.durationBeats;
  }
  return {
    durationBeats: cursor,
    atoms,
    spans,
    motifFamilies: [...families.values()],
  };
}

function legacySegment(segment: PhraseBodySegmentV1): RealizationSegment {
  const common = {
    id: segment.id,
    ...(segment.section === undefined ? {} : { section: segment.section }),
    ...(segment.dynamic === undefined ? {} : { dynamic: segment.dynamic }),
    ...(segment.dynamicCurve === undefined
      ? {}
      : { dynamicCurve: structuredClone(segment.dynamicCurve) }),
    ...(segment.articulation === undefined
      ? {}
      : { articulation: segment.articulation }),
    ...(segment.gate === undefined ? {} : { gate: segment.gate }),
  };
  if (segment.kind === "literal")
    return {
      ...common,
      kind: "literal",
      part: segment.part.replaceAll("|", " "),
    };
  if (segment.kind === "motif")
    return { ...common, kind: "motif", motif: segment.motif };
  if (segment.kind === "chords")
    return {
      ...common,
      kind: "chords",
      harmony: segment.harmony,
      voicing: segment.voicing,
      register: structuredClone(segment.register),
      rhythm: segment.rhythm.map(rationalToNumber),
      ...(segment.voiceLeading === undefined
        ? {}
        : { voiceLeading: segment.voiceLeading }),
    };
  if (segment.kind === "arpeggio")
    return {
      ...common,
      kind: "arpeggio",
      harmony: segment.harmony,
      degrees: [...segment.degrees],
      stepBeats: rationalToNumber(segment.step),
      octaveSpan: segment.octaveSpan,
      register: structuredClone(segment.register),
    };
  if (segment.kind === "bass")
    return {
      ...common,
      kind: "bass",
      harmony: segment.harmony,
      degrees: [...segment.degrees],
      stepBeats: rationalToNumber(segment.step),
      register: structuredClone(segment.register),
      slashBass: segment.slashBass,
    };
  if (segment.kind === "drum_grid")
    return {
      ...common,
      kind: "drum_grid",
      resolution: segment.resolution,
      lanes: structuredClone(segment.lanes),
    };
  return {
    ...common,
    kind: "rest",
    beats: rationalToNumber(segment.duration),
  };
}

function legacySource(
  source: AirSourceV1,
  segment: PhraseBodySegmentV1,
  instrumentId: string,
): AirSource {
  return {
    format: AIR_FORMAT,
    title: source.title,
    tempo: source.conductor.tempo,
    meter: source.conductor.meters[0]!.meter,
    ...(source.key === undefined ? {} : { key: source.key }),
    motifs: structuredClone(source.motifs),
    ...(source.harmony === undefined
      ? {}
      : {
          harmony: source.harmony.map((plan) => ({
            id: plan.id,
            chords: plan.chords.map((chord) => ({
              symbol: chord.symbol,
              beats: rationalToNumber(chord.duration),
              ...(chord.inversion === undefined
                ? {}
                : { inversion: chord.inversion }),
            })),
          })),
        }),
    voices: [
      {
        id: "projection_voice",
        instrument: instrumentId,
        role: "lead",
        realize: [legacySegment(segment)],
      },
    ],
  };
}

function projectionVocabulary(source: AirSourceV1): AuthoringVocabularyClosure {
  return {
    format: AUTHORING_VOCABULARY_CLOSURE_FORMAT,
    id: source.vocabulary.id,
    contentSha256: "0".repeat(64),
    instruments: structuredClone(source.vocabulary.instruments),
  };
}

function neutralBlock(
  source: AirSourceV1,
  segment: PhraseBodySegmentV1,
  instrumentId: string,
  path: string,
  diagnostics: Diagnostic[],
  budget: V1CompileBudget,
): MusicalBlock | undefined {
  const projection = legacySource(source, segment, instrumentId);
  const result = compileAirSegmentProjection(projection, {
    vocabulary: projectionVocabulary(source),
  });
  diagnostics.push(
    ...result.diagnostics.filter((item) => item.code !== "motif_returns"),
  );
  if (!result.compiled) return undefined;
  const compiled = result.compiled;
  const span = compiled.segments[0];
  if (!span) {
    diagnostics.push(
      diagnostic(
        "error",
        "empty_segment",
        path,
        "AIR@1 segment emitted no time span.",
      ),
    );
    return undefined;
  }
  const groups = new Map<number, CompiledEvent[]>();
  for (const event of compiled.events) {
    const key = Math.round(event.startBeat * 1e9) / 1e9;
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }
  budget.charge("allocatedAtoms", groups.size, path, diagnostics);
  const atoms: BlockAtom[] = [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([startBeat, events]) => {
      const first = events[0]!;
      const occurrence = compiled.motifOccurrences.find(
        (candidate) =>
          candidate.motif === first.motif &&
          candidate.occurrence === first.motifOccurrence,
      );
      return {
        startBeat,
        durationBeats: first.durationBeats,
        notes: events.map((event) => event.midi),
        velocity: first.velocity,
        articulation: first.articulation,
        gate: first.gate,
        timingOffsetBeats: 0,
        ...(first.motif === undefined ? {} : { motif: first.motif }),
        ...(first.motifOccurrence === undefined
          ? {}
          : { motifLocalOccurrence: first.motifOccurrence }),
        ...(first.motifOccurrence === undefined
          ? {}
          : { motifOccurrenceToken: `${path}:m${first.motifOccurrence}` }),
        motifTranspose: occurrence?.transpose ?? 0,
        motifStretch: occurrence?.stretch ?? 1,
        motifInversion: occurrence?.inversion ?? false,
        motifRetrograde: occurrence?.retrograde ?? false,
        techniques: [],
        grooves: [],
      };
    });
  return {
    durationBeats: span.endBeat - span.startBeat,
    atoms,
    spans: [
      {
        sourceSegmentId: segment.id,
        kind: segment.kind,
        startBeat: 0,
        endBeat: span.endBeat - span.startBeat,
        ...(segment.section === undefined ? {} : { section: segment.section }),
        ...(segment.kind === "motif" ? { motif: segment.motif } : {}),
        ...(segment.kind === "chords" ||
        segment.kind === "arpeggio" ||
        segment.kind === "bass"
          ? { harmony: segment.harmony }
          : {}),
        techniques: [],
        grooves: [],
        expression: {
          ...structuredClone(span.expression),
          tieToNext: segment.tieToNext ?? false,
        },
      },
    ],
    motifFamilies: structuredClone(compiled.motifFamilies),
  };
}

function compileBodySegment(
  source: AirSourceV1,
  segment: PhraseBodySegmentV1,
  instrumentId: string,
  path: string,
  diagnostics: Diagnostic[],
  budget: V1CompileBudget,
): MusicalBlock | undefined {
  const neutral = neutralBlock(
    source,
    segment,
    instrumentId,
    path,
    diagnostics,
    budget,
  );
  if (!neutral) return undefined;
  let block = neutral;
  if (segment.kind === "motif")
    block = applyOperations(
      block,
      transformOperations(segment.transform),
      budget,
      `${path}.transform`,
      diagnostics,
    );
  if (segment.tuplet)
    block = applyOperations(
      block,
      [
        {
          type: "time-scale",
          factor: {
            numerator: segment.tuplet.inTimeOf,
            denominator: segment.tuplet.notes,
          },
        },
      ],
      budget,
      `${path}.tuplet`,
      diagnostics,
    );
  block = applyTechniqueDefinitions(
    block,
    segment.techniques ?? [],
    source,
    budget,
    path,
    diagnostics,
  );
  block = applyGroove(
    block,
    source.grooves?.find((candidate) => candidate.id === segment.groove),
    budget,
    `${path}.groove`,
    diagnostics,
  );
  return block;
}

function repeatBlock(
  block: MusicalBlock,
  repeat: number,
  budget: V1CompileBudget,
  path: string,
  diagnostics: Diagnostic[],
): MusicalBlock {
  budget.reserveClone(block, repeat, path, diagnostics);
  const atoms: BlockAtom[] = [];
  const spans: BlockSpan[] = [];
  for (let index = 0; index < repeat; index += 1) {
    const offset = block.durationBeats * index;
    atoms.push(
      ...block.atoms.map((atom) => ({
        ...structuredClone(atom),
        startBeat: atom.startBeat + offset,
        ...(repeat > 1 && atom.motifOccurrenceToken
          ? {
              motifOccurrenceToken: `${atom.motifOccurrenceToken}:child-repeat${index + 1}`,
            }
          : {}),
      })),
    );
    spans.push(
      ...block.spans.map((span) => ({
        ...structuredClone(span),
        startBeat: span.startBeat + offset,
        endBeat: span.endBeat + offset,
        ...(repeat > 1 ? { childRepeatIndex: index } : {}),
      })),
    );
  }
  return {
    durationBeats: block.durationBeats * repeat,
    atoms,
    spans,
    motifFamilies: structuredClone(block.motifFamilies),
  };
}

function phraseBlock(
  source: AirSourceV1,
  segment: PhraseSegmentV1,
  instrumentId: string,
  path: string,
  diagnostics: Diagnostic[],
  budget: V1CompileBudget,
): MusicalBlock | undefined {
  const phrase = source.phrases?.find(
    (candidate) => candidate.id === segment.phrase,
  );
  if (!phrase) return undefined;
  const children: MusicalBlock[] = [];
  phrase.segments.forEach((child, index) => {
    const compiled = compileBodySegment(
      source,
      child,
      instrumentId,
      `${path}.phrase(${phrase.id})[${index}]`,
      diagnostics,
      budget,
    );
    if (compiled)
      children.push(
        repeatBlock(
          compiled,
          child.repeat ?? 1,
          budget,
          `${path}.phrase(${phrase.id})[${index}].repeat`,
          diagnostics,
        ),
      );
  });
  let block = concatenate(children, budget, `${path}.phrase`, diagnostics);
  block = applyOperations(
    block,
    transformOperations(segment.transform),
    budget,
    `${path}.transform`,
    diagnostics,
  );
  if (segment.tuplet)
    block = applyOperations(
      block,
      [
        {
          type: "time-scale",
          factor: {
            numerator: segment.tuplet.inTimeOf,
            denominator: segment.tuplet.notes,
          },
        },
      ],
      budget,
      `${path}.tuplet`,
      diagnostics,
    );
  block = applyTechniqueDefinitions(
    block,
    segment.techniques ?? [],
    source,
    budget,
    path,
    diagnostics,
  );
  block = applyExpression(block, segment, budget, path, diagnostics);
  block = applyGroove(
    block,
    source.grooves?.find((candidate) => candidate.id === segment.groove),
    budget,
    `${path}.groove`,
    diagnostics,
  );
  return block;
}

interface ConductorRegion {
  bar: number;
  meter: string;
  beatsPerBar: number;
  startBeat: number;
}

interface ConductorSchedule {
  regions: ConductorRegion[];
  barStarts: number[];
}

function conductorRegions(source: AirSourceV1): ConductorRegion[] {
  const regions: ConductorRegion[] = [];
  let startBeat = rationalToNumber(
    source.conductor.pickup ?? { numerator: 0, denominator: 1 },
  );
  source.conductor.meters.forEach((entry, index) => {
    if (index > 0) {
      const previous = source.conductor.meters[index - 1]!;
      startBeat += (entry.bar - previous.bar) * meterBeats(previous.meter);
    }
    regions.push({
      bar: entry.bar,
      meter: entry.meter,
      beatsPerBar: meterBeats(entry.meter),
      startBeat,
    });
  });
  return regions;
}

function conductorSchedule(source: AirSourceV1): ConductorSchedule {
  const regions = conductorRegions(source);
  const barStarts = new Array<number>(MAX_BARS + 2);
  barStarts[0] = 0;
  let cursor = regions[0]!.startBeat;
  let regionIndex = 0;
  for (let bar = 1; bar <= MAX_BARS + 1; bar += 1) {
    while (
      regionIndex + 1 < regions.length &&
      regions[regionIndex + 1]!.bar <= bar
    )
      regionIndex += 1;
    barStarts[bar] = cursor;
    cursor += regions[regionIndex]!.beatsPerBar;
  }
  return { regions, barStarts };
}

function meterAtBar(schedule: ConductorSchedule, bar: number): string {
  let low = 0;
  let high = schedule.regions.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (schedule.regions[middle]!.bar <= bar) low = middle;
    else high = middle - 1;
  }
  return schedule.regions[low]!.meter;
}

function barAtBeat(
  schedule: ConductorSchedule,
  beat: number,
  maxBars: number,
): number {
  const pickup = schedule.barStarts[1]!;
  if (pickup > 0 && beat < pickup - EPSILON) return 0;
  let low = 1;
  let high = maxBars;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (beat >= schedule.barStarts[middle]! - EPSILON) low = middle;
    else high = middle - 1;
  }
  return low;
}

function alignedBarCount(
  schedule: ConductorSchedule,
  duration: number,
): number | undefined {
  const pickup = schedule.barStarts[1]!;
  if (Math.abs(duration - pickup) < EPSILON) return 0;
  for (let bar = 1; bar <= MAX_BARS; bar += 1) {
    const end = schedule.barStarts[bar + 1]!;
    if (Math.abs(duration - end) < EPSILON) return bar;
    if (duration < end - EPSILON) return undefined;
  }
  return undefined;
}

function meterChanges(schedule: ConductorSchedule): CompiledMeterChange[] {
  return schedule.regions.map((region, index) => ({
    bar: region.bar,
    meter: region.meter,
    startBeat: index === 0 ? 0 : region.startBeat,
    beatsPerBar: region.beatsPerBar,
  }));
}

function motifOccurrenceKey(atom: BlockAtom): string | undefined {
  if (!atom.motif) return undefined;
  return (
    atom.motifOccurrenceToken ??
    `${atom.motif}:${atom.motifLocalOccurrence ?? 1}`
  );
}

function motifOccurrencesForBlock(
  block: MusicalBlock,
  source: AirSourceV1,
  voiceId: string,
  segmentId: string,
  placement: number,
  counts: Map<string, number>,
  budget: V1CompileBudget,
  path: string,
  diagnostics: Diagnostic[],
): {
  occurrences: MotifOccurrence[];
  occurrenceByToken: Map<string, number>;
} {
  const groups = new Map<string, BlockAtom[]>();
  for (const atom of block.atoms) {
    const key = motifOccurrenceKey(atom);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(atom);
    groups.set(key, group);
  }
  budget.charge("motifOccurrences", groups.size, path, diagnostics);
  const occurrences: MotifOccurrence[] = [];
  const occurrenceByToken = new Map<string, number>();
  for (const [token, atoms] of groups) {
    atoms.sort((left, right) => left.startBeat - right.startBeat);
    const first = atoms[0]!;
    const motif = first.motif!;
    const occurrence = (counts.get(motif) ?? 0) + 1;
    counts.set(motif, occurrence);
    occurrenceByToken.set(token, occurrence);
    const startBeat = placement + first.startBeat;
    const endBeat = Math.max(
      ...atoms.map((atom) => placement + atom.startBeat + atom.durationBeats),
    );
    const material: NormalizedMotifAtom[] = atoms.map((atom) => ({
      relativeStartBeat: atom.startBeat - first.startBeat,
      durationBeats: atom.durationBeats,
      notes: [...atom.notes],
    }));
    occurrences.push({
      anchor: `${voiceId}:${segmentId}:${occurrence}:${motif}`,
      motif,
      familyId: motif,
      voiceId,
      occurrence,
      startBeat,
      durationBeats: endBeat - startBeat,
      transpose: first.motifTranspose,
      stretch: first.motifStretch,
      inversion: first.motifInversion,
      retrograde: first.motifRetrograde,
      material,
      segmentId,
    });
  }
  return { occurrences, occurrenceByToken };
}

function resolveBoundaryTies(
  events: CompiledEventV1[],
  segments: readonly CompiledSegmentV1[],
  diagnostics: Diagnostic[],
): void {
  const boundaryKey = (voiceId: string, beat: number): string =>
    `${voiceId}:${beat.toFixed(9)}`;
  const pitchBoundaryKey = (
    voiceId: string,
    beat: number,
    midi: number,
  ): string => `${boundaryKey(voiceId, beat)}:${midi}`;
  const seenBoundaries = new Set<string>();
  const endingsByBoundary = new Map<string, CompiledEventV1[]>();
  const startsByPitchBoundary = new Map<string, CompiledEventV1[]>();
  const carriedByBoundary = new Map<string, CompiledEventV1[]>();
  const startCursors = new Map<string, number>();
  const removed = new Set<CompiledEventV1>();
  for (const event of events) {
    const endingKey = boundaryKey(
      event.voiceId,
      event.notatedStartBeat + event.durationBeats,
    );
    const endings = endingsByBoundary.get(endingKey) ?? [];
    endings.push(event);
    endingsByBoundary.set(endingKey, endings);
    const startingKey = pitchBoundaryKey(
      event.voiceId,
      event.notatedStartBeat,
      event.midi,
    );
    const starts = startsByPitchBoundary.get(startingKey) ?? [];
    starts.push(event);
    startsByPitchBoundary.set(startingKey, starts);
  }
  const ties = segments
    .filter((segment) => segment.expression.tieToNext)
    .sort(
      (left, right) =>
        left.endBeat - right.endBeat || left.anchor.localeCompare(right.anchor),
    );
  for (const segment of ties) {
    const tieBoundaryKey = boundaryKey(segment.voiceId, segment.endBeat);
    if (seenBoundaries.has(tieBoundaryKey)) continue;
    seenBoundaries.add(tieBoundaryKey);
    const endings = new Set<CompiledEventV1>([
      ...(endingsByBoundary.get(tieBoundaryKey) ?? []).filter(
        (event) =>
          !removed.has(event) &&
          event.notatedStartBeat >= segment.startBeat - EPSILON,
      ),
      ...(carriedByBoundary.get(tieBoundaryKey) ?? []).filter(
        (event) => !removed.has(event),
      ),
    ]);
    let matches = 0;
    for (const prior of endings) {
      const startingKey = pitchBoundaryKey(
        prior.voiceId,
        segment.endBeat,
        prior.midi,
      );
      const candidates = startsByPitchBoundary.get(startingKey) ?? [];
      let cursor = startCursors.get(startingKey) ?? 0;
      while (
        cursor < candidates.length &&
        (removed.has(candidates[cursor]!) || candidates[cursor] === prior)
      )
        cursor += 1;
      const continuation = candidates[cursor];
      if (!continuation) continue;
      startCursors.set(startingKey, cursor + 1);
      prior.durationBeats =
        continuation.notatedStartBeat +
        continuation.durationBeats -
        prior.notatedStartBeat;
      prior.soundingDurationBeats =
        continuation.startBeat +
        continuation.soundingDurationBeats -
        prior.startBeat;
      prior.gate = prior.soundingDurationBeats / prior.durationBeats;
      removed.add(continuation);
      const carriedKey = boundaryKey(
        prior.voiceId,
        prior.notatedStartBeat + prior.durationBeats,
      );
      const carried = carriedByBoundary.get(carriedKey) ?? [];
      carried.push(prior);
      carriedByBoundary.set(carriedKey, carried);
      matches += 1;
    }
    if (matches === 0)
      diagnostics.push(
        diagnostic(
          "error",
          "dangling_tie",
          segment.anchor,
          "tieToNext found no matching pitch at the next AIR@1 segment boundary.",
        ),
      );
  }
  if (removed.size > 0) {
    let writeIndex = 0;
    for (const event of events)
      if (!removed.has(event)) {
        events[writeIndex] = event;
        writeIndex += 1;
      }
    events.length = writeIndex;
  }
}

function phraseSummary(
  segment: PhraseSegmentV1,
  source: AirSourceV1,
): OperationSummary {
  const operations = [...transformOperations(segment.transform)];
  if (segment.tuplet)
    operations.push({
      type: "time-scale",
      factor: {
        numerator: segment.tuplet.inTimeOf,
        denominator: segment.tuplet.notes,
      },
    });
  for (const techniqueId of segment.techniques ?? [])
    operations.push(
      ...source.vocabulary.techniques.find(
        (candidate) => candidate.id === techniqueId,
      )!.operations,
    );
  return operationSummary(operations);
}

export function compileAirV1(input: string | unknown): CompileAirV1Result {
  const parsed = parseAirV1(input);
  if (!parsed.source) return { diagnostics: parsed.diagnostics };
  const source = parsed.source;
  const diagnostics = [...parsed.diagnostics];
  const events: CompiledEventV1[] = [];
  const segments: CompiledSegmentV1[] = [];
  const motifOccurrences: MotifOccurrence[] = [];
  const phraseOccurrences: PhraseOccurrence[] = [];
  const motifFamilies = new Map<string, CompiledMotifFamily>();
  const techniquesUsed = new Set<string>();
  const groovesUsed = new Set<string>();
  const budget = new V1CompileBudget();
  const schedule = conductorSchedule(source);
  let longestBars = 0;
  let durationBeats = 0;

  try {
    source.voices.forEach((voice, voiceIndex) => {
      const scheduled: Array<{
        sourceSegment: RealizationSegmentV1;
        block: MusicalBlock;
        segmentIndex: number;
        repeatIndex: number;
        phraseOccurrence?: number;
      }> = [];
      let voiceCursor = 0;
      const phraseCounts = new Map<string, number>();
      const motifCounts = new Map<string, number>();

      const append = (
        segment: RealizationSegmentV1,
        block: MusicalBlock,
        segmentIndex: number,
        repeatIndex: number,
      ): void => {
        let phraseOccurrence: number | undefined;
        if (segment.kind === "phrase") {
          phraseOccurrence = (phraseCounts.get(segment.phrase) ?? 0) + 1;
          phraseCounts.set(segment.phrase, phraseOccurrence);
          const summary = phraseSummary(segment, source);
          phraseOccurrences.push({
            anchor: `${voice.id}:${segment.id}:r${repeatIndex + 1}:${segment.phrase}`,
            phrase: segment.phrase,
            voiceId: voice.id,
            occurrence: phraseOccurrence,
            segmentId: segment.id,
            repeatIndex,
            startBeat: voiceCursor,
            durationBeats: block.durationBeats,
            transpose: summary.transpose,
            timeScale: summary.timeScale,
            inversion: summary.inversion,
            retrograde: summary.retrograde,
            techniques: [...(segment.techniques ?? [])],
            grooves: segment.groove ? [segment.groove] : [],
          });
        }
        scheduled.push({
          sourceSegment: segment,
          block,
          segmentIndex,
          repeatIndex,
          ...(phraseOccurrence === undefined ? {} : { phraseOccurrence }),
        });
        voiceCursor += block.durationBeats;
      };

      if (typeof voice.part === "string") {
        const fragments = voice.part.split("|");
        fragments.forEach((part, index) => {
          const synthetic: PhraseBodySegmentV1 = {
            id: `part_${index + 1}`,
            kind: "literal",
            part,
          };
          const block = compileBodySegment(
            source,
            synthetic,
            voice.instrument,
            `$.voices[${voiceIndex}].part#fragment${index + 1}`,
            diagnostics,
            budget,
          );
          if (!block) return;
          const expected =
            index === 0 && source.conductor.pickup
              ? rationalToNumber(source.conductor.pickup)
              : meterBeats(
                  meterAtBar(
                    schedule,
                    index + (source.conductor.pickup ? 0 : 1),
                  ),
                );
          if (Math.abs(block.durationBeats - expected) > EPSILON)
            diagnostics.push(
              diagnostic(
                "error",
                block.durationBeats > expected
                  ? "measure_overflow"
                  : "measure_underflow",
                `$.voices[${voiceIndex}].part#fragment${index + 1}`,
                `Fragment ${index + 1} contains ${block.durationBeats} beats; the conductor requires ${expected}.`,
              ),
            );
          budget.charge(
            "expandedAtoms",
            block.atoms.length,
            `$.voices[${voiceIndex}].part#fragment${index + 1}`,
            diagnostics,
          );
          budget.charge(
            "compiledEvents",
            block.atoms.reduce((sum, atom) => sum + atom.notes.length, 0),
            `$.voices[${voiceIndex}].part#fragment${index + 1}`,
            diagnostics,
          );
          budget.charge(
            "segments",
            block.spans.length,
            `$.voices[${voiceIndex}].part#fragment${index + 1}`,
            diagnostics,
          );
          append(synthetic, block, index, 0);
        });
      } else if (voice.realize) {
        voice.realize.forEach((segment, segmentIndex) => {
          const path = `$.voices[${voiceIndex}].realize[${segmentIndex}]`;
          const block =
            segment.kind === "phrase"
              ? phraseBlock(
                  source,
                  segment,
                  voice.instrument,
                  path,
                  diagnostics,
                  budget,
                )
              : compileBodySegment(
                  source,
                  segment,
                  voice.instrument,
                  path,
                  diagnostics,
                  budget,
                );
          if (!block) return;
          const repeat = segment.repeat ?? 1;
          budget.reserveClone(block, repeat, `${path}.repeat`, diagnostics);
          budget.charge(
            "expandedAtoms",
            budget.product(block.atoms.length, repeat, path, diagnostics),
            path,
            diagnostics,
          );
          budget.charge(
            "compiledEvents",
            budget.product(
              block.atoms.reduce((sum, atom) => sum + atom.notes.length, 0),
              repeat,
              path,
              diagnostics,
            ),
            path,
            diagnostics,
          );
          budget.charge(
            "segments",
            budget.product(
              block.spans.length + (segment.kind === "phrase" ? 1 : 0),
              repeat,
              path,
              diagnostics,
            ),
            path,
            diagnostics,
          );
          if (segment.kind === "phrase")
            budget.charge("phraseOccurrences", repeat, path, diagnostics);
          for (let repeatIndex = 0; repeatIndex < repeat; repeatIndex += 1)
            append(segment, structuredClone(block), segmentIndex, repeatIndex);
        });
      }

      const voiceDurationSeconds = (voiceCursor * 60) / source.conductor.tempo;
      if (voiceDurationSeconds > MAX_SCORE_SECONDS + EPSILON) {
        diagnostics.push(
          diagnostic(
            "error",
            "duration_limit",
            `$.voices[${voiceIndex}]`,
            `AIR@1 is limited to ${MAX_SCORE_SECONDS} seconds; this voice is ${voiceDurationSeconds.toFixed(3)} seconds.`,
          ),
        );
        throw new V1BudgetExceeded("duration_limit");
      }

      const bars = alignedBarCount(schedule, voiceCursor);
      if (bars === undefined)
        diagnostics.push(
          diagnostic(
            "error",
            "voice_bar_alignment",
            `$.voices[${voiceIndex}]`,
            `Voice contains ${voiceCursor} beats; it must close over the pickup and complete bars in the conductor meter map.`,
          ),
        );
      else longestBars = Math.max(longestBars, bars);
      durationBeats = Math.max(durationBeats, voiceCursor);

      let eventIndex = 0;
      let placement = 0;
      for (const item of scheduled) {
        const {
          sourceSegment: segment,
          block,
          segmentIndex,
          repeatIndex,
        } = item;
        for (const family of block.motifFamilies)
          if (!motifFamilies.has(family.familyId))
            motifFamilies.set(family.familyId, family);
        const blockMotifOccurrences = motifOccurrencesForBlock(
          block,
          source,
          voice.id,
          segment.id,
          placement,
          motifCounts,
          budget,
          `$.voices[${voiceIndex}].realize[${segmentIndex}]`,
          diagnostics,
        );
        motifOccurrences.push(...blockMotifOccurrences.occurrences);
        const allTechniques = new Set(
          block.atoms.flatMap((atom) => atom.techniques),
        );
        const allGrooves = new Set(block.atoms.flatMap((atom) => atom.grooves));
        allTechniques.forEach((id) => techniquesUsed.add(id));
        allGrooves.forEach((id) => groovesUsed.add(id));
        for (const span of block.spans) {
          segments.push({
            anchor: `${voice.id}:${segment.id}:${span.sourceSegmentId}:r${repeatIndex + 1}${span.childRepeatIndex === undefined ? "" : `:c${span.childRepeatIndex + 1}`}`,
            voiceId: voice.id,
            segmentId:
              segment.kind === "phrase"
                ? `${segment.id}/${span.sourceSegmentId}`
                : segment.id,
            sourceSegmentId: span.sourceSegmentId,
            segmentIndex,
            repeatIndex,
            kind: span.kind,
            startBeat: placement + span.startBeat,
            endBeat: placement + span.endBeat,
            ...((span.section ?? segment.section)
              ? { section: span.section ?? segment.section }
              : {}),
            ...(span.motif === undefined ? {} : { motif: span.motif }),
            ...(span.harmony === undefined ? {} : { harmony: span.harmony }),
            ...(segment.kind === "phrase"
              ? {
                  phrase: segment.phrase,
                  parentPhraseSegmentId: segment.id,
                }
              : {}),
            techniques: [
              ...new Set([...span.techniques, ...(segment.techniques ?? [])]),
            ],
            grooves: [
              ...new Set([
                ...span.grooves,
                ...(segment.groove ? [segment.groove] : []),
              ]),
            ],
            expression: structuredClone(span.expression),
          });
        }
        if (segment.kind === "phrase")
          segments.push({
            anchor: `${voice.id}:${segment.id}:r${repeatIndex + 1}`,
            voiceId: voice.id,
            segmentId: segment.id,
            sourceSegmentId: segment.id,
            segmentIndex,
            repeatIndex,
            kind: "phrase",
            startBeat: placement,
            endBeat: placement + block.durationBeats,
            ...(segment.section === undefined
              ? {}
              : { section: segment.section }),
            phrase: segment.phrase,
            techniques: [...(segment.techniques ?? [])],
            grooves: segment.groove ? [segment.groove] : [],
            expression: {
              ...(segment.dynamic === undefined
                ? {}
                : { dynamic: segment.dynamic }),
              ...(segment.dynamicCurve === undefined
                ? {}
                : { dynamicCurve: structuredClone(segment.dynamicCurve) }),
              articulation: segment.articulation ?? "none",
              gate:
                segment.gate ?? DEFAULT_GATE[segment.articulation ?? "none"],
              tieToNext: segment.tieToNext ?? false,
            },
          });

        for (const atom of block.atoms) {
          const notatedStartBeat = placement + atom.startBeat;
          const performedStartBeat = notatedStartBeat + atom.timingOffsetBeats;
          if (performedStartBeat < -EPSILON)
            diagnostics.push(
              diagnostic(
                "error",
                "groove_before_score",
                `$.voices[${voiceIndex}]`,
                "A groove moved an onset before the score begins.",
              ),
            );
          for (const midi of atom.notes) {
            const instrument = source.vocabulary.instruments.find(
              (candidate) => candidate.id === voice.instrument,
            )!;
            if (
              midi < instrument.midiMin ||
              midi > instrument.midiMax ||
              (instrument.supportedNotes &&
                !instrument.supportedNotes.includes(midi))
            )
              diagnostics.push(
                diagnostic(
                  "error",
                  "out_of_range",
                  `$.voices[${voiceIndex}]`,
                  `${midiToNoteName(midi)} is unavailable on ${instrument.label}.`,
                ),
              );
            eventIndex += 1;
            events.push({
              id: `${voice.id}:${segment.id}:r${repeatIndex + 1}:${eventIndex}`,
              voiceId: voice.id,
              role: voice.role,
              instrument: voice.instrument,
              midi,
              note: midiToNoteName(midi),
              startBeat: performedStartBeat,
              notatedStartBeat,
              ...(Math.abs(atom.timingOffsetBeats) < EPSILON
                ? {}
                : { timingOffsetBeats: atom.timingOffsetBeats }),
              durationBeats: atom.durationBeats,
              soundingDurationBeats: atom.durationBeats * atom.gate,
              velocity: atom.velocity,
              gainDb: voice.gainDb ?? 0,
              pan: voice.pan ?? 0,
              bar: barAtBeat(
                schedule,
                notatedStartBeat,
                Math.max(1, longestBars),
              ),
              articulation: atom.articulation,
              gate: atom.gate,
              source: {
                voiceId: voice.id,
                authoring: "realize",
                segmentId: segment.id,
                segmentIndex,
                repeatIndex,
                ...(segment.section === undefined
                  ? {}
                  : { section: segment.section }),
              },
              ...(atom.motif === undefined ? {} : { motif: atom.motif }),
              ...(atom.motifLocalOccurrence === undefined
                ? {}
                : {
                    motifOccurrence:
                      blockMotifOccurrences.occurrenceByToken.get(
                        motifOccurrenceKey(atom)!,
                      ),
                  }),
              ...(atom.techniques.length === 0
                ? {}
                : { techniques: [...atom.techniques] }),
              ...(atom.grooves.length === 0
                ? {}
                : { grooves: [...atom.grooves] }),
              ...(segment.kind === "phrase"
                ? {
                    phrase: segment.phrase,
                    phraseOccurrence: item.phraseOccurrence,
                  }
                : {}),
            });
          }
        }
        placement += block.durationBeats;
      }
    });

    resolveBoundaryTies(events, segments, diagnostics);

    for (const entry of source.conductor.meters.slice(1))
      if (entry.bar > longestBars)
        diagnostics.push(
          diagnostic(
            "error",
            "meter_change_out_of_range",
            `$.conductor.meters[${source.conductor.meters.indexOf(entry)}].bar`,
            `Meter change at bar ${entry.bar} is beyond the ${longestBars}-bar score.`,
          ),
        );

    if (source.sections)
      for (const section of source.sections)
        if (section.startBar + section.bars - 1 > longestBars)
          diagnostics.push(
            diagnostic(
              "error",
              "section_out_of_range",
              `$.sections.${section.id}`,
              `Section ${section.id} extends beyond the ${longestBars}-bar score.`,
            ),
          );

    events.sort(
      (left, right) =>
        left.startBeat - right.startBeat ||
        left.voiceId.localeCompare(right.voiceId) ||
        left.midi - right.midi,
    );
    motifOccurrences.sort(
      (left, right) =>
        left.startBeat - right.startBeat ||
        left.anchor.localeCompare(right.anchor),
    );
    phraseOccurrences.sort(
      (left, right) =>
        left.startBeat - right.startBeat ||
        left.anchor.localeCompare(right.anchor),
    );

    if (diagnostics.some((item) => item.severity === "error"))
      return { source, diagnostics };
    const initialMeter = source.conductor.meters[0]!.meter;
    return {
      source,
      compiled: {
        format: COMPILED_AIR_V1_FORMAT,
        sourceFormat: AIR_V1_FORMAT,
        title: source.title,
        tempo: source.conductor.tempo,
        meter: initialMeter,
        beatsPerBar: meterBeats(initialMeter),
        pickupBeats: rationalToNumber(
          source.conductor.pickup ?? { numerator: 0, denominator: 1 },
        ),
        meterChanges: meterChanges(schedule),
        durationBeats,
        durationSeconds: (durationBeats * 60) / source.conductor.tempo,
        bars: longestBars,
        events,
        motifFamilies: [...motifFamilies.values()].sort((left, right) =>
          left.familyId.localeCompare(right.familyId),
        ),
        motifOccurrences,
        phraseOccurrences,
        segments,
        sections: (source.sections ?? []).map((section) => ({
          id: section.id,
          startBeat: schedule.barStarts[section.startBar]!,
          endBeat: schedule.barStarts[section.startBar + section.bars]!,
        })),
        techniquesUsed: [...techniquesUsed].sort(),
        groovesUsed: [...groovesUsed].sort(),
      },
      diagnostics,
    };
  } catch (cause) {
    if (cause instanceof V1BudgetExceeded) return { source, diagnostics };
    throw cause;
  }
}

export type AnyCompiledAir = CompiledAir | CompiledAirV1;
