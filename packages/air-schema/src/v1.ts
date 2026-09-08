import {
  ARTICULATIONS,
  CHORD_DEGREES,
  DYNAMIC_LEVELS,
  MAX_BARS,
  MAX_SOURCE_BYTES,
  MAX_VOICES,
  VOICE_ROLES,
  type AirSource,
  type Articulation,
  type ChordDegree,
  type Diagnostic,
  type DynamicCurve,
  type DynamicLevel,
  type PitchRegister,
  type VoiceRole,
} from "./index.js";
import { sha256Hex } from "@refrain/identity";

export const AIR_V1_FORMAT = "air@1-experimental" as const;
export const AIR_VOCABULARY_FORMAT =
  "refrain-air-vocabulary-closure@0-experimental" as const;

export interface Rational {
  numerator: number;
  denominator: number;
}

export interface AirConductorMeter {
  bar: number;
  meter: string;
}

export interface AirConductor {
  tempo: number;
  meters: AirConductorMeter[];
  pickup?: Rational;
}

export type AirV1SegmentKind =
  | "literal"
  | "motif"
  | "chords"
  | "arpeggio"
  | "bass"
  | "drum_grid"
  | "rest"
  | "phrase";

export type TechniqueOperation =
  | { type: "transpose"; semitones: number }
  | { type: "time-scale"; factor: Rational }
  | { type: "velocity-scale"; factor: Rational }
  | { type: "gate-scale"; factor: Rational }
  | { type: "invert" }
  | { type: "retrograde" }
  | { type: "rotate"; steps: number }
  | { type: "thin"; every: number; offset: number };

export interface AuthoringTechniqueDefinition {
  id: string;
  label: string;
  appliesTo: AirV1SegmentKind[];
  operations: TechniqueOperation[];
}

export interface AirInstrumentDefinition {
  id: string;
  label: string;
  family: "pitched" | "percussion" | "texture";
  midiMin: number;
  midiMax: number;
  status: "active" | "deprecated";
  supportedNotes?: number[];
  authoringMeaning: string;
}

export interface AirVocabularyClosure {
  format: typeof AIR_VOCABULARY_FORMAT;
  id: string;
  contentSha256: string;
  instruments: AirInstrumentDefinition[];
  techniques: AuthoringTechniqueDefinition[];
}

export interface AirGrooveStep {
  at: Rational;
  offset: Rational;
  velocityScale?: Rational;
}

export interface AirGroove {
  id: string;
  cycle: Rational;
  steps: AirGrooveStep[];
}

export interface TupletRatio {
  notes: number;
  inTimeOf: number;
}

interface RealizationBaseV1 {
  id: string;
  repeat?: number;
  section?: string;
  dynamic?: DynamicLevel;
  dynamicCurve?: DynamicCurve;
  articulation?: Articulation;
  gate?: number;
  tieToNext?: boolean;
  techniques?: string[];
  groove?: string;
  tuplet?: TupletRatio;
}

export interface MotifTransformV1 {
  transpose?: number;
  timeScale?: Rational;
  inversion?: boolean;
  retrograde?: boolean;
}

export interface LiteralSegmentV1 extends RealizationBaseV1 {
  kind: "literal";
  part: string;
}

export interface MotifSegmentV1 extends RealizationBaseV1 {
  kind: "motif";
  motif: string;
  transform?: MotifTransformV1;
}

export interface ChordsSegmentV1 extends RealizationBaseV1 {
  kind: "chords";
  harmony: string;
  voicing: "close" | "open" | "drop2";
  register: PitchRegister;
  rhythm: Rational[];
  voiceLeading?: "nearest";
}

export interface ArpeggioSegmentV1 extends RealizationBaseV1 {
  kind: "arpeggio";
  harmony: string;
  degrees: ChordDegree[];
  step: Rational;
  octaveSpan: number;
  register: PitchRegister;
}

export interface BassSegmentV1 extends RealizationBaseV1 {
  kind: "bass";
  harmony: string;
  degrees: ChordDegree[];
  step: Rational;
  register: PitchRegister;
  slashBass: "honor" | "ignore";
}

export interface DrumGridSegmentV1 extends RealizationBaseV1 {
  kind: "drum_grid";
  resolution: 8 | 16;
  lanes: Array<{ note: string; pattern: string }>;
}

export interface RestSegmentV1 extends RealizationBaseV1 {
  kind: "rest";
  duration: Rational;
}

export interface PhraseTransformV1 {
  transpose?: number;
  timeScale?: Rational;
  inversion?: boolean;
  retrograde?: boolean;
}

export interface PhraseSegmentV1 extends RealizationBaseV1 {
  kind: "phrase";
  phrase: string;
  transform?: PhraseTransformV1;
}

export type PhraseBodySegmentV1 =
  | LiteralSegmentV1
  | MotifSegmentV1
  | ChordsSegmentV1
  | ArpeggioSegmentV1
  | BassSegmentV1
  | DrumGridSegmentV1
  | RestSegmentV1;

export type RealizationSegmentV1 = PhraseBodySegmentV1 | PhraseSegmentV1;

export interface PhraseDefinitionV1 {
  id: string;
  segments: PhraseBodySegmentV1[];
}

export interface HarmonyChordV1 {
  symbol: string;
  duration: Rational;
  inversion?: number;
}

export interface HarmonyPlanV1 {
  id: string;
  chords: HarmonyChordV1[];
}

interface AirVoiceBaseV1 {
  id: string;
  instrument: string;
  role: VoiceRole;
  gainDb?: number;
  pan?: number;
}

export type AirVoiceV1 = AirVoiceBaseV1 &
  (
    | { part: string; realize?: never }
    | { realize: RealizationSegmentV1[]; part?: never }
  );

export interface AirSectionV1 {
  id: string;
  startBar: number;
  bars: number;
}

export interface AirSourceV1 {
  format: typeof AIR_V1_FORMAT;
  title: string;
  conductor: AirConductor;
  key?: string;
  vocabulary: AirVocabularyClosure;
  motifs: Record<string, string>;
  grooves?: AirGroove[];
  harmony?: HarmonyPlanV1[];
  phrases?: PhraseDefinitionV1[];
  voices: AirVoiceV1[];
  sections?: AirSectionV1[];
}

export interface ParseAirV1Result {
  source?: AirSourceV1;
  diagnostics: Diagnostic[];
}

const ID = /^[a-z][a-z0-9_-]*$/i;
const MODULE_ID = /^[a-z0-9][a-z0-9_.@-]*$/;
const NOTE = /^[A-Ga-g][#b]?-?\d$/;
const METER = /^(?:[1-9]|[1-9]\d)\/(?:1|2|4|8|16)$/;
const dynamicLevels = new Set<string>(DYNAMIC_LEVELS);
const articulations = new Set<string>(ARTICULATIONS);
const voiceRoles = new Set<string>(VOICE_ROLES);
const chordDegrees = new Set<number>(CHORD_DEGREES);
const segmentKinds = new Set<AirV1SegmentKind>([
  "literal",
  "motif",
  "chords",
  "arpeggio",
  "bass",
  "drum_grid",
  "rest",
  "phrase",
]);

const AIR_KEYS = new Set([
  "format",
  "title",
  "conductor",
  "key",
  "vocabulary",
  "motifs",
  "grooves",
  "harmony",
  "phrases",
  "voices",
  "sections",
]);
const BASE_SEGMENT_KEYS = [
  "id",
  "kind",
  "repeat",
  "section",
  "dynamic",
  "dynamicCurve",
  "articulation",
  "gate",
  "tieToNext",
  "techniques",
  "groove",
  "tuplet",
] as const;
const SEGMENT_KEYS: Record<AirV1SegmentKind, readonly string[]> = {
  literal: ["part"],
  motif: ["motif", "transform"],
  chords: ["harmony", "voicing", "register", "rhythm", "voiceLeading"],
  arpeggio: ["harmony", "degrees", "step", "octaveSpan", "register"],
  bass: ["harmony", "degrees", "step", "register", "slashBass"],
  drum_grid: ["resolution", "lanes"],
  rest: ["duration"],
  phrase: ["phrase", "transform"],
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const problem = (
  code: string,
  path: string,
  message: string,
  hint?: string,
): Diagnostic => ({
  severity: "error",
  code,
  path,
  message,
  ...(hint === undefined ? {} : { hint }),
});

function exactKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  diagnostics: Diagnostic[],
): void {
  for (const key of Object.keys(value))
    if (!allowed.has(key))
      diagnostics.push(
        problem(
          "unknown_field",
          `${path}.${key}`,
          `Unknown field ${key}.`,
          "AIR@1 is closed; runtime, private, and performance data stay outside canonical music.",
        ),
      );
}

function gcd(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) [a, b] = [b, a % b];
  return a || 1;
}

function validateRational(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
  options: { signed?: boolean; allowZero?: boolean; max?: number } = {},
): value is Rational {
  if (!isRecord(value)) {
    diagnostics.push(
      problem(
        "invalid_rational",
        path,
        "A rational value must contain integer numerator and denominator fields.",
      ),
    );
    return false;
  }
  exactKeys(value, new Set(["numerator", "denominator"]), path, diagnostics);
  if (
    !Number.isInteger(value.numerator) ||
    !Number.isInteger(value.denominator) ||
    Number(value.denominator) < 1 ||
    Number(value.denominator) > 96 ||
    Math.abs(Number(value.numerator)) > 65_536
  ) {
    diagnostics.push(
      problem(
        "invalid_rational",
        path,
        "Rationals need an integer numerator and a positive denominator no greater than 96.",
      ),
    );
    return false;
  }
  const numerator = Number(value.numerator);
  const denominator = Number(value.denominator);
  if (!options.signed && numerator < 0) {
    diagnostics.push(
      problem(
        "invalid_rational",
        `${path}.numerator`,
        "This rational cannot be negative.",
      ),
    );
    return false;
  }
  if (!options.allowZero && numerator === 0) {
    diagnostics.push(
      problem(
        "invalid_rational",
        `${path}.numerator`,
        "This rational must be positive.",
      ),
    );
    return false;
  }
  if (gcd(numerator, denominator) !== 1) {
    diagnostics.push(
      problem(
        "non_canonical_rational",
        path,
        "Rationals must be reduced to one canonical representation.",
      ),
    );
    return false;
  }
  if (numerator === 0 && denominator !== 1) {
    diagnostics.push(
      problem("non_canonical_rational", path, "Zero must be written as 0/1."),
    );
    return false;
  }
  if (
    options.max !== undefined &&
    Math.abs(numerator / denominator) > options.max
  ) {
    diagnostics.push(
      problem(
        "rational_out_of_range",
        path,
        `The absolute rational value must be no greater than ${options.max}.`,
      ),
    );
    return false;
  }
  return true;
}

export function rationalToNumber(value: Rational): number {
  return value.numerator / value.denominator;
}

function validateDynamicCurve(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): void {
  if (!isRecord(value)) {
    diagnostics.push(
      problem("invalid_dynamic_curve", path, "dynamicCurve must be an object."),
    );
    return;
  }
  exactKeys(value, new Set(["from", "via", "to"]), path, diagnostics);
  if (
    !dynamicLevels.has(String(value.from)) ||
    !dynamicLevels.has(String(value.to))
  )
    diagnostics.push(
      problem(
        "invalid_dynamic_curve",
        path,
        "dynamicCurve.from and .to must be named dynamic levels.",
      ),
    );
  if (value.via !== undefined) {
    if (
      !Array.isArray(value.via) ||
      value.via.length < 1 ||
      value.via.length > 6
    ) {
      diagnostics.push(
        problem(
          "invalid_dynamic_curve",
          `${path}.via`,
          "dynamicCurve.via needs one through six points.",
        ),
      );
      return;
    }
    let previous = 0;
    value.via.forEach((point, index) => {
      const pointPath = `${path}.via[${index}]`;
      if (!isRecord(point)) {
        diagnostics.push(
          problem(
            "invalid_dynamic_curve",
            pointPath,
            "A curve point must be an object.",
          ),
        );
        return;
      }
      exactKeys(point, new Set(["at", "level"]), pointPath, diagnostics);
      if (
        typeof point.at !== "number" ||
        !Number.isFinite(point.at) ||
        point.at <= previous ||
        point.at >= 1
      )
        diagnostics.push(
          problem(
            "invalid_dynamic_curve",
            `${pointPath}.at`,
            "Curve points must be strictly increasing between zero and one.",
          ),
        );
      else previous = point.at;
      if (!dynamicLevels.has(String(point.level)))
        diagnostics.push(
          problem(
            "invalid_dynamic_curve",
            `${pointPath}.level`,
            "Curve-point level must be a named dynamic.",
          ),
        );
    });
  }
}

function validateRegister(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): void {
  if (!isRecord(value)) {
    diagnostics.push(
      problem("invalid_register", path, "register must be an object."),
    );
    return;
  }
  exactKeys(value, new Set(["min", "max"]), path, diagnostics);
  if (typeof value.min !== "string" || !NOTE.test(value.min))
    diagnostics.push(
      problem(
        "invalid_register",
        `${path}.min`,
        "register.min must be a note such as C3.",
      ),
    );
  if (typeof value.max !== "string" || !NOTE.test(value.max))
    diagnostics.push(
      problem(
        "invalid_register",
        `${path}.max`,
        "register.max must be a note such as C5.",
      ),
    );
}

function validateTransform(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): void {
  if (!isRecord(value)) {
    diagnostics.push(
      problem("invalid_transform", path, "transform must be an object."),
    );
    return;
  }
  exactKeys(
    value,
    new Set(["transpose", "timeScale", "inversion", "retrograde"]),
    path,
    diagnostics,
  );
  if (
    value.transpose !== undefined &&
    (!Number.isInteger(value.transpose) ||
      Number(value.transpose) < -24 ||
      Number(value.transpose) > 24)
  )
    diagnostics.push(
      problem(
        "invalid_transpose",
        `${path}.transpose`,
        "transpose must be -24 through 24 semitones.",
      ),
    );
  if (value.timeScale !== undefined)
    validateRational(value.timeScale, `${path}.timeScale`, diagnostics, {
      max: 4,
    });
  for (const key of ["inversion", "retrograde"] as const)
    if (value[key] !== undefined && typeof value[key] !== "boolean")
      diagnostics.push(
        problem(
          "invalid_transform",
          `${path}.${key}`,
          `${key} must be boolean.`,
        ),
      );
}

function validateSegment(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
  allowPhrase: boolean,
): void {
  if (!isRecord(value)) {
    diagnostics.push(
      problem(
        "invalid_segment",
        path,
        "Each realization segment must be an object.",
      ),
    );
    return;
  }
  const kind = String(value.kind) as AirV1SegmentKind;
  if (!segmentKinds.has(kind) || (!allowPhrase && kind === "phrase")) {
    diagnostics.push(
      problem(
        "invalid_segment_kind",
        `${path}.kind`,
        allowPhrase
          ? "Unknown AIR@1 realization-segment kind."
          : "Phrase bodies cannot recursively invoke another phrase.",
      ),
    );
    return;
  }
  exactKeys(
    value,
    new Set([...BASE_SEGMENT_KEYS, ...SEGMENT_KEYS[kind]]),
    path,
    diagnostics,
  );
  if (typeof value.id !== "string" || !ID.test(value.id))
    diagnostics.push(
      problem("invalid_segment_id", `${path}.id`, "Segment ID is invalid."),
    );
  if (
    value.repeat !== undefined &&
    (!Number.isInteger(value.repeat) ||
      Number(value.repeat) < 1 ||
      Number(value.repeat) > 16)
  )
    diagnostics.push(
      problem(
        "invalid_repeat",
        `${path}.repeat`,
        "repeat must be 1 through 16.",
      ),
    );
  if (
    value.section !== undefined &&
    (typeof value.section !== "string" ||
      value.section.length < 1 ||
      value.section.length > 80)
  )
    diagnostics.push(
      problem(
        "invalid_segment_section",
        `${path}.section`,
        "section must contain 1-80 characters.",
      ),
    );
  if (value.dynamic !== undefined && !dynamicLevels.has(String(value.dynamic)))
    diagnostics.push(
      problem(
        "invalid_dynamic",
        `${path}.dynamic`,
        "dynamic must be pp, p, mp, mf, f, or ff.",
      ),
    );
  if (value.dynamicCurve !== undefined)
    validateDynamicCurve(
      value.dynamicCurve,
      `${path}.dynamicCurve`,
      diagnostics,
    );
  if (value.dynamic !== undefined && value.dynamicCurve !== undefined)
    diagnostics.push(
      problem(
        "expression_conflict",
        path,
        "Use dynamic or dynamicCurve, not both.",
      ),
    );
  if (
    value.articulation !== undefined &&
    !articulations.has(String(value.articulation))
  )
    diagnostics.push(
      problem(
        "invalid_articulation",
        `${path}.articulation`,
        "Unknown articulation.",
      ),
    );
  if (
    value.gate !== undefined &&
    (typeof value.gate !== "number" ||
      !Number.isFinite(value.gate) ||
      value.gate < 0.05 ||
      value.gate > 1.5)
  )
    diagnostics.push(
      problem("invalid_gate", `${path}.gate`, "gate must be 0.05 through 1.5."),
    );
  if (value.tieToNext !== undefined && typeof value.tieToNext !== "boolean")
    diagnostics.push(
      problem("invalid_tie", `${path}.tieToNext`, "tieToNext must be boolean."),
    );
  if (
    value.techniques !== undefined &&
    (!Array.isArray(value.techniques) ||
      value.techniques.length < 1 ||
      value.techniques.length > 8 ||
      value.techniques.some(
        (item) => typeof item !== "string" || !ID.test(item),
      ) ||
      new Set(value.techniques).size !== value.techniques.length)
  )
    diagnostics.push(
      problem(
        "invalid_techniques",
        `${path}.techniques`,
        "techniques needs 1-8 unique definition IDs.",
      ),
    );
  if (
    value.groove !== undefined &&
    (typeof value.groove !== "string" || !ID.test(value.groove))
  )
    diagnostics.push(
      problem(
        "invalid_groove",
        `${path}.groove`,
        "groove must be a valid definition ID.",
      ),
    );
  if (value.tuplet !== undefined) {
    if (!isRecord(value.tuplet))
      diagnostics.push(
        problem(
          "invalid_tuplet",
          `${path}.tuplet`,
          "tuplet must be an object.",
        ),
      );
    else {
      exactKeys(
        value.tuplet,
        new Set(["notes", "inTimeOf"]),
        `${path}.tuplet`,
        diagnostics,
      );
      if (
        !Number.isInteger(value.tuplet.notes) ||
        !Number.isInteger(value.tuplet.inTimeOf) ||
        Number(value.tuplet.notes) < 2 ||
        Number(value.tuplet.notes) > 16 ||
        Number(value.tuplet.inTimeOf) < 1 ||
        Number(value.tuplet.inTimeOf) > 16 ||
        value.tuplet.notes === value.tuplet.inTimeOf
      )
        diagnostics.push(
          problem(
            "invalid_tuplet",
            `${path}.tuplet`,
            "tuplet needs distinct notes/inTimeOf integers within 1-16.",
          ),
        );
    }
  }

  if (kind === "literal") {
    if (
      typeof value.part !== "string" ||
      value.part.trim().length === 0 ||
      value.part.length > 16_384
    )
      diagnostics.push(
        problem(
          "invalid_part",
          `${path}.part`,
          "Literal part must contain 1-16384 characters.",
        ),
      );
  } else if (kind === "motif") {
    if (typeof value.motif !== "string" || !ID.test(value.motif))
      diagnostics.push(
        problem(
          "invalid_motif_id",
          `${path}.motif`,
          "motif must be a valid ID.",
        ),
      );
    if (value.transform !== undefined)
      validateTransform(value.transform, `${path}.transform`, diagnostics);
  } else if (kind === "phrase") {
    if (typeof value.phrase !== "string" || !ID.test(value.phrase))
      diagnostics.push(
        problem(
          "invalid_phrase_id",
          `${path}.phrase`,
          "phrase must be a valid ID.",
        ),
      );
    if (value.transform !== undefined)
      validateTransform(value.transform, `${path}.transform`, diagnostics);
  } else if (kind === "chords") {
    if (typeof value.harmony !== "string" || !ID.test(value.harmony))
      diagnostics.push(
        problem(
          "invalid_harmony_reference",
          `${path}.harmony`,
          "harmony must be a valid ID.",
        ),
      );
    if (!["close", "open", "drop2"].includes(String(value.voicing)))
      diagnostics.push(
        problem(
          "invalid_voicing",
          `${path}.voicing`,
          "voicing must be close, open, or drop2.",
        ),
      );
    validateRegister(value.register, `${path}.register`, diagnostics);
    if (
      !Array.isArray(value.rhythm) ||
      value.rhythm.length < 1 ||
      value.rhythm.length > 32
    )
      diagnostics.push(
        problem(
          "invalid_pattern",
          `${path}.rhythm`,
          "rhythm needs 1-32 rational values.",
        ),
      );
    else
      value.rhythm.forEach((item, index) =>
        validateRational(item, `${path}.rhythm[${index}]`, diagnostics, {
          max: 16,
        }),
      );
    if (value.voiceLeading !== undefined && value.voiceLeading !== "nearest")
      diagnostics.push(
        problem(
          "invalid_voice_leading",
          `${path}.voiceLeading`,
          "voiceLeading currently supports nearest.",
        ),
      );
  } else if (kind === "arpeggio" || kind === "bass") {
    if (typeof value.harmony !== "string" || !ID.test(value.harmony))
      diagnostics.push(
        problem(
          "invalid_harmony_reference",
          `${path}.harmony`,
          "harmony must be a valid ID.",
        ),
      );
    if (
      !Array.isArray(value.degrees) ||
      value.degrees.length < 1 ||
      value.degrees.length > 32 ||
      value.degrees.some(
        (item) => typeof item !== "number" || !chordDegrees.has(item),
      )
    )
      diagnostics.push(
        problem(
          "invalid_pattern",
          `${path}.degrees`,
          "degrees must use 1, 3, 5, 7, or 9.",
        ),
      );
    validateRational(value.step, `${path}.step`, diagnostics, { max: 16 });
    validateRegister(value.register, `${path}.register`, diagnostics);
    if (
      kind === "arpeggio" &&
      (!Number.isInteger(value.octaveSpan) ||
        Number(value.octaveSpan) < 1 ||
        Number(value.octaveSpan) > 4)
    )
      diagnostics.push(
        problem(
          "invalid_octave_span",
          `${path}.octaveSpan`,
          "octaveSpan must be 1 through 4.",
        ),
      );
    if (
      kind === "bass" &&
      !["honor", "ignore"].includes(String(value.slashBass))
    )
      diagnostics.push(
        problem(
          "invalid_slash_bass",
          `${path}.slashBass`,
          "slashBass must be honor or ignore.",
        ),
      );
  } else if (kind === "drum_grid") {
    if (value.resolution !== 8 && value.resolution !== 16)
      diagnostics.push(
        problem(
          "invalid_grid_resolution",
          `${path}.resolution`,
          "resolution must be 8 or 16.",
        ),
      );
    if (
      !Array.isArray(value.lanes) ||
      value.lanes.length < 1 ||
      value.lanes.length > 16
    )
      diagnostics.push(
        problem(
          "invalid_drum_lanes",
          `${path}.lanes`,
          "drum_grid needs 1-16 lanes.",
        ),
      );
    else {
      let length: number | undefined;
      value.lanes.forEach((lane, index) => {
        const lanePath = `${path}.lanes[${index}]`;
        if (!isRecord(lane)) {
          diagnostics.push(
            problem("invalid_drum_lane", lanePath, "A lane must be an object."),
          );
          return;
        }
        exactKeys(lane, new Set(["note", "pattern"]), lanePath, diagnostics);
        if (typeof lane.note !== "string" || !NOTE.test(lane.note))
          diagnostics.push(
            problem(
              "invalid_drum_note",
              `${lanePath}.note`,
              "note must look like C2.",
            ),
          );
        if (
          typeof lane.pattern !== "string" ||
          !/^[x.]{1,256}$/.test(lane.pattern)
        )
          diagnostics.push(
            problem(
              "invalid_drum_pattern",
              `${lanePath}.pattern`,
              "pattern needs 1-256 x or . steps.",
            ),
          );
        else if (length === undefined) length = lane.pattern.length;
        else if (lane.pattern.length !== length)
          diagnostics.push(
            problem(
              "drum_pattern_mismatch",
              `${lanePath}.pattern`,
              "All lane patterns need the same length.",
            ),
          );
      });
    }
  } else if (kind === "rest") {
    validateRational(value.duration, `${path}.duration`, diagnostics, {
      max: 1024,
    });
  }
}

function validateTechniqueOperation(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): void {
  if (!isRecord(value) || typeof value.type !== "string") {
    diagnostics.push(
      problem(
        "invalid_technique_operation",
        path,
        "Technique operations must be typed objects.",
      ),
    );
    return;
  }
  if (value.type === "transpose") {
    exactKeys(value, new Set(["type", "semitones"]), path, diagnostics);
    if (
      !Number.isInteger(value.semitones) ||
      Number(value.semitones) < -24 ||
      Number(value.semitones) > 24
    )
      diagnostics.push(
        problem(
          "invalid_technique_operation",
          `${path}.semitones`,
          "Technique transpose must be -24 through 24.",
        ),
      );
  } else if (
    ["time-scale", "velocity-scale", "gate-scale"].includes(value.type)
  ) {
    exactKeys(value, new Set(["type", "factor"]), path, diagnostics);
    validateRational(value.factor, `${path}.factor`, diagnostics, { max: 4 });
  } else if (value.type === "invert" || value.type === "retrograde") {
    exactKeys(value, new Set(["type"]), path, diagnostics);
  } else if (value.type === "rotate") {
    exactKeys(value, new Set(["type", "steps"]), path, diagnostics);
    if (
      !Number.isInteger(value.steps) ||
      Number(value.steps) === 0 ||
      Math.abs(Number(value.steps)) > 64
    )
      diagnostics.push(
        problem(
          "invalid_technique_operation",
          `${path}.steps`,
          "rotate.steps must be a non-zero integer within 64.",
        ),
      );
  } else if (value.type === "thin") {
    exactKeys(value, new Set(["type", "every", "offset"]), path, diagnostics);
    if (
      !Number.isInteger(value.every) ||
      Number(value.every) < 2 ||
      Number(value.every) > 16
    )
      diagnostics.push(
        problem(
          "invalid_technique_operation",
          `${path}.every`,
          "thin.every must be 2 through 16.",
        ),
      );
    if (
      !Number.isInteger(value.offset) ||
      Number(value.offset) < 0 ||
      Number(value.offset) >= Number(value.every)
    )
      diagnostics.push(
        problem(
          "invalid_technique_operation",
          `${path}.offset`,
          "thin.offset must select one position in the cycle.",
        ),
      );
  } else {
    diagnostics.push(
      problem(
        "invalid_technique_operation",
        `${path}.type`,
        `Unknown technique operation ${value.type}.`,
      ),
    );
  }
}

function validateVocabulary(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): void {
  if (!isRecord(value)) {
    diagnostics.push(
      problem("invalid_vocabulary", path, "vocabulary must be an object."),
    );
    return;
  }
  exactKeys(
    value,
    new Set(["format", "id", "contentSha256", "instruments", "techniques"]),
    path,
    diagnostics,
  );
  if (value.format !== AIR_VOCABULARY_FORMAT)
    diagnostics.push(
      problem(
        "invalid_vocabulary_format",
        `${path}.format`,
        `Expected ${AIR_VOCABULARY_FORMAT}.`,
      ),
    );
  if (typeof value.id !== "string" || !MODULE_ID.test(value.id))
    diagnostics.push(
      problem(
        "invalid_vocabulary_id",
        `${path}.id`,
        "Vocabulary ID is invalid.",
      ),
    );
  if (
    typeof value.contentSha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.contentSha256)
  )
    diagnostics.push(
      problem(
        "invalid_vocabulary_digest",
        `${path}.contentSha256`,
        "Vocabulary needs a lowercase content SHA-256.",
      ),
    );
  if (
    !Array.isArray(value.instruments) ||
    value.instruments.length < 1 ||
    value.instruments.length > 128
  )
    diagnostics.push(
      problem(
        "invalid_vocabulary_instruments",
        `${path}.instruments`,
        "Vocabulary needs 1-128 instruments.",
      ),
    );
  else {
    const ids = new Set<string>();
    value.instruments.forEach((instrument, index) => {
      const instrumentPath = `${path}.instruments[${index}]`;
      if (!isRecord(instrument)) {
        diagnostics.push(
          problem(
            "invalid_vocabulary_instrument",
            instrumentPath,
            "Instrument definition must be an object.",
          ),
        );
        return;
      }
      exactKeys(
        instrument,
        new Set([
          "id",
          "label",
          "family",
          "midiMin",
          "midiMax",
          "status",
          "supportedNotes",
          "authoringMeaning",
        ]),
        instrumentPath,
        diagnostics,
      );
      if (typeof instrument.id !== "string" || !MODULE_ID.test(instrument.id))
        diagnostics.push(
          problem(
            "invalid_instrument",
            `${instrumentPath}.id`,
            "Instrument ID is invalid.",
          ),
        );
      else if (ids.has(instrument.id))
        diagnostics.push(
          problem(
            "duplicate_instrument",
            `${instrumentPath}.id`,
            `Duplicate instrument ${instrument.id}.`,
          ),
        );
      else ids.add(instrument.id);
      if (
        typeof instrument.label !== "string" ||
        instrument.label.length < 1 ||
        instrument.label.length > 120
      )
        diagnostics.push(
          problem(
            "invalid_instrument",
            `${instrumentPath}.label`,
            "Instrument label needs 1-120 characters.",
          ),
        );
      if (
        !["pitched", "percussion", "texture"].includes(
          String(instrument.family),
        )
      )
        diagnostics.push(
          problem(
            "invalid_instrument",
            `${instrumentPath}.family`,
            "Unknown instrument family.",
          ),
        );
      if (
        !Number.isInteger(instrument.midiMin) ||
        !Number.isInteger(instrument.midiMax) ||
        Number(instrument.midiMin) < 0 ||
        Number(instrument.midiMax) > 127 ||
        Number(instrument.midiMin) > Number(instrument.midiMax)
      )
        diagnostics.push(
          problem(
            "invalid_instrument",
            instrumentPath,
            "Instrument MIDI range is invalid.",
          ),
        );
      if (!["active", "deprecated"].includes(String(instrument.status)))
        diagnostics.push(
          problem(
            "invalid_instrument",
            `${instrumentPath}.status`,
            "Instrument status is invalid.",
          ),
        );
      if (
        typeof instrument.authoringMeaning !== "string" ||
        instrument.authoringMeaning.length < 1 ||
        instrument.authoringMeaning.length > 500
      )
        diagnostics.push(
          problem(
            "invalid_instrument",
            `${instrumentPath}.authoringMeaning`,
            "Instrument authoringMeaning needs 1-500 characters.",
          ),
        );
      if (
        instrument.supportedNotes !== undefined &&
        (!Array.isArray(instrument.supportedNotes) ||
          instrument.supportedNotes.some(
            (note) => !Number.isInteger(note) || note < 0 || note > 127,
          ) ||
          new Set(instrument.supportedNotes).size !==
            instrument.supportedNotes.length)
      )
        diagnostics.push(
          problem(
            "invalid_instrument",
            `${instrumentPath}.supportedNotes`,
            "supportedNotes must be unique MIDI integers.",
          ),
        );
    });
  }
  if (!Array.isArray(value.techniques) || value.techniques.length > 128)
    diagnostics.push(
      problem(
        "invalid_vocabulary_techniques",
        `${path}.techniques`,
        "techniques must be an array of at most 128 definitions.",
      ),
    );
  else {
    const ids = new Set<string>();
    value.techniques.forEach((technique, index) => {
      const techniquePath = `${path}.techniques[${index}]`;
      if (!isRecord(technique)) {
        diagnostics.push(
          problem(
            "invalid_technique",
            techniquePath,
            "Technique definition must be an object.",
          ),
        );
        return;
      }
      exactKeys(
        technique,
        new Set(["id", "label", "appliesTo", "operations"]),
        techniquePath,
        diagnostics,
      );
      if (typeof technique.id !== "string" || !ID.test(technique.id))
        diagnostics.push(
          problem(
            "invalid_technique",
            `${techniquePath}.id`,
            "Technique ID is invalid.",
          ),
        );
      else if (ids.has(technique.id))
        diagnostics.push(
          problem(
            "duplicate_technique",
            `${techniquePath}.id`,
            `Duplicate technique ${technique.id}.`,
          ),
        );
      else ids.add(technique.id);
      if (
        typeof technique.label !== "string" ||
        technique.label.length < 1 ||
        technique.label.length > 120
      )
        diagnostics.push(
          problem(
            "invalid_technique",
            `${techniquePath}.label`,
            "Technique label needs 1-120 characters.",
          ),
        );
      if (
        !Array.isArray(technique.appliesTo) ||
        technique.appliesTo.length < 1 ||
        technique.appliesTo.length > segmentKinds.size ||
        technique.appliesTo.some(
          (kind) => !segmentKinds.has(kind as AirV1SegmentKind),
        ) ||
        new Set(technique.appliesTo).size !== technique.appliesTo.length
      )
        diagnostics.push(
          problem(
            "invalid_technique",
            `${techniquePath}.appliesTo`,
            "appliesTo needs unique AIR@1 segment kinds.",
          ),
        );
      if (
        !Array.isArray(technique.operations) ||
        technique.operations.length < 1 ||
        technique.operations.length > 8
      )
        diagnostics.push(
          problem(
            "invalid_technique",
            `${techniquePath}.operations`,
            "Technique needs 1-8 bounded operations.",
          ),
        );
      else
        technique.operations.forEach((operation, operationIndex) =>
          validateTechniqueOperation(
            operation,
            `${techniquePath}.operations[${operationIndex}]`,
            diagnostics,
          ),
        );
    });
  }
  if (
    typeof value.contentSha256 === "string" &&
    /^[0-9a-f]{64}$/.test(value.contentSha256) &&
    value.contentSha256 !==
      airVocabularyContentSha256(value as unknown as AirVocabularyClosure)
  )
    diagnostics.push(
      problem(
        "vocabulary_digest_mismatch",
        `${path}.contentSha256`,
        "Vocabulary content SHA-256 does not match its carried definitions.",
      ),
    );
}

function validateGrooves(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): void {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) {
    diagnostics.push(
      problem(
        "invalid_grooves",
        path,
        "grooves needs 1-32 definitions when supplied.",
      ),
    );
    return;
  }
  const ids = new Set<string>();
  value.forEach((groove, index) => {
    const groovePath = `${path}[${index}]`;
    if (!isRecord(groove)) {
      diagnostics.push(
        problem(
          "invalid_groove",
          groovePath,
          "Groove definition must be an object.",
        ),
      );
      return;
    }
    exactKeys(
      groove,
      new Set(["id", "cycle", "steps"]),
      groovePath,
      diagnostics,
    );
    if (typeof groove.id !== "string" || !ID.test(groove.id))
      diagnostics.push(
        problem("invalid_groove", `${groovePath}.id`, "Groove ID is invalid."),
      );
    else if (ids.has(groove.id))
      diagnostics.push(
        problem(
          "duplicate_groove",
          `${groovePath}.id`,
          `Duplicate groove ${groove.id}.`,
        ),
      );
    else ids.add(groove.id);
    const validCycle = validateRational(
      groove.cycle,
      `${groovePath}.cycle`,
      diagnostics,
      { max: 16 },
    );
    if (
      !Array.isArray(groove.steps) ||
      groove.steps.length < 1 ||
      groove.steps.length > 32
    ) {
      diagnostics.push(
        problem(
          "invalid_groove",
          `${groovePath}.steps`,
          "Groove needs 1-32 explicit steps.",
        ),
      );
      return;
    }
    let previousAt = -1;
    groove.steps.forEach((step, stepIndex) => {
      const stepPath = `${groovePath}.steps[${stepIndex}]`;
      if (!isRecord(step)) {
        diagnostics.push(
          problem(
            "invalid_groove_step",
            stepPath,
            "Groove step must be an object.",
          ),
        );
        return;
      }
      exactKeys(
        step,
        new Set(["at", "offset", "velocityScale"]),
        stepPath,
        diagnostics,
      );
      const validAt = validateRational(step.at, `${stepPath}.at`, diagnostics, {
        allowZero: true,
        max: 16,
      });
      validateRational(step.offset, `${stepPath}.offset`, diagnostics, {
        signed: true,
        allowZero: true,
        max: 0.25,
      });
      if (step.velocityScale !== undefined)
        validateRational(
          step.velocityScale,
          `${stepPath}.velocityScale`,
          diagnostics,
          { max: 2 },
        );
      if (validAt) {
        const at = rationalToNumber(step.at as Rational);
        if (at <= previousAt)
          diagnostics.push(
            problem(
              "invalid_groove_step",
              `${stepPath}.at`,
              "Groove steps must be strictly ordered.",
            ),
          );
        previousAt = at;
        if (validCycle && at >= rationalToNumber(groove.cycle as Rational))
          diagnostics.push(
            problem(
              "invalid_groove_step",
              `${stepPath}.at`,
              "Groove-step position must be inside its cycle.",
            ),
          );
      }
    });
  });
}

function encodedSize(value: unknown): number | undefined {
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return text === undefined
      ? undefined
      : new TextEncoder().encode(text).length;
  } catch {
    return undefined;
  }
}

function validateReferences(
  value: Record<string, unknown>,
  diagnostics: Diagnostic[],
): void {
  if (!isRecord(value.vocabulary)) return;
  const instruments = new Set(
    Array.isArray(value.vocabulary.instruments)
      ? value.vocabulary.instruments.flatMap((instrument) =>
          isRecord(instrument) && typeof instrument.id === "string"
            ? [instrument.id]
            : [],
        )
      : [],
  );
  const techniqueDefinitions = new Map<string, Set<string>>(
    Array.isArray(value.vocabulary.techniques)
      ? value.vocabulary.techniques.flatMap((technique) =>
          isRecord(technique) &&
          typeof technique.id === "string" &&
          Array.isArray(technique.appliesTo)
            ? [
                [
                  technique.id,
                  new Set(technique.appliesTo.map(String)),
                ] as const,
              ]
            : [],
        )
      : [],
  );
  const grooves = new Set(
    Array.isArray(value.grooves)
      ? value.grooves.flatMap((groove) =>
          isRecord(groove) && typeof groove.id === "string" ? [groove.id] : [],
        )
      : [],
  );
  const motifs = isRecord(value.motifs)
    ? new Set(Object.keys(value.motifs))
    : new Set<string>();
  const harmonies = new Set(
    Array.isArray(value.harmony)
      ? value.harmony.flatMap((plan) =>
          isRecord(plan) && typeof plan.id === "string" ? [plan.id] : [],
        )
      : [],
  );
  const phrases = new Set(
    Array.isArray(value.phrases)
      ? value.phrases.flatMap((phrase) =>
          isRecord(phrase) && typeof phrase.id === "string" ? [phrase.id] : [],
        )
      : [],
  );
  const inspect = (segment: unknown, path: string): void => {
    if (!isRecord(segment) || typeof segment.kind !== "string") return;
    if (Array.isArray(segment.techniques))
      segment.techniques.forEach((technique, index) => {
        const applies = techniqueDefinitions.get(String(technique));
        if (!applies)
          diagnostics.push(
            problem(
              "unresolved_technique",
              `${path}.techniques[${index}]`,
              `Technique ${String(technique)} is absent from the carried vocabulary closure.`,
            ),
          );
        else if (!applies.has(segment.kind as string))
          diagnostics.push(
            problem(
              "technique_kind_mismatch",
              `${path}.techniques[${index}]`,
              `Technique ${String(technique)} does not apply to ${segment.kind}.`,
            ),
          );
      });
    if (typeof segment.groove === "string" && !grooves.has(segment.groove))
      diagnostics.push(
        problem(
          "unresolved_groove",
          `${path}.groove`,
          `Groove ${segment.groove} is absent from this AIR.`,
        ),
      );
    if (
      segment.kind === "motif" &&
      typeof segment.motif === "string" &&
      !motifs.has(segment.motif)
    )
      diagnostics.push(
        problem(
          "unresolved_motif",
          `${path}.motif`,
          `Motif ${segment.motif} is absent from this AIR.`,
        ),
      );
    if (
      ["chords", "arpeggio", "bass"].includes(segment.kind) &&
      typeof segment.harmony === "string" &&
      !harmonies.has(segment.harmony)
    )
      diagnostics.push(
        problem(
          "unresolved_harmony",
          `${path}.harmony`,
          `Harmony plan ${segment.harmony} is absent from this AIR.`,
        ),
      );
    if (
      segment.kind === "phrase" &&
      typeof segment.phrase === "string" &&
      !phrases.has(segment.phrase)
    )
      diagnostics.push(
        problem(
          "unresolved_phrase",
          `${path}.phrase`,
          `Phrase ${segment.phrase} is absent from this AIR.`,
        ),
      );
  };
  if (Array.isArray(value.phrases))
    value.phrases.forEach((phrase, phraseIndex) => {
      if (isRecord(phrase) && Array.isArray(phrase.segments))
        phrase.segments.forEach((segment, segmentIndex) =>
          inspect(
            segment,
            `$.phrases[${phraseIndex}].segments[${segmentIndex}]`,
          ),
        );
    });
  if (Array.isArray(value.voices))
    value.voices.forEach((voice, voiceIndex) => {
      if (!isRecord(voice)) return;
      if (
        typeof voice.instrument === "string" &&
        !instruments.has(voice.instrument)
      )
        diagnostics.push(
          problem(
            "unresolved_instrument",
            `$.voices[${voiceIndex}].instrument`,
            `Instrument ${voice.instrument} is absent from the carried vocabulary closure.`,
          ),
        );
      if (Array.isArray(voice.realize))
        voice.realize.forEach((segment, segmentIndex) =>
          inspect(segment, `$.voices[${voiceIndex}].realize[${segmentIndex}]`),
        );
    });
}

export function parseAirV1(input: string | unknown): ParseAirV1Result {
  let value: unknown = input;
  const diagnostics: Diagnostic[] = [];
  const bytes = encodedSize(input);
  if (bytes === undefined)
    return {
      diagnostics: [
        problem(
          "invalid_source_encoding",
          "$",
          "The air must be JSON-serializable.",
        ),
      ],
    };
  if (bytes > MAX_SOURCE_BYTES)
    return {
      diagnostics: [
        problem(
          "source_too_large",
          "$",
          `AIR@1 is limited to ${MAX_SOURCE_BYTES} UTF-8 bytes; received ${bytes}.`,
        ),
      ],
    };
  if (typeof input === "string") {
    try {
      value = JSON.parse(input) as unknown;
    } catch (cause) {
      return {
        diagnostics: [
          problem(
            "invalid_json",
            "$",
            cause instanceof Error
              ? cause.message
              : "Unknown JSON parse error.",
            "Return one complete AIR@1 JSON object.",
          ),
        ],
      };
    }
  }
  if (!isRecord(value))
    return {
      diagnostics: [
        problem("invalid_envelope", "$", "An AIR@1 source must be an object."),
      ],
    };
  exactKeys(value, AIR_KEYS, "$", diagnostics);
  if (value.format !== AIR_V1_FORMAT)
    diagnostics.push(
      problem("unsupported_format", "$.format", `Expected ${AIR_V1_FORMAT}.`),
    );
  if (
    typeof value.title !== "string" ||
    value.title.trim().length < 1 ||
    value.title.length > 200
  )
    diagnostics.push(
      problem("invalid_title", "$.title", "Title needs 1-200 characters."),
    );
  if (
    value.key !== undefined &&
    (typeof value.key !== "string" || value.key.length > 80)
  )
    diagnostics.push(
      problem(
        "invalid_key",
        "$.key",
        "Key must be text of at most 80 characters.",
      ),
    );

  if (!isRecord(value.conductor))
    diagnostics.push(
      problem(
        "invalid_conductor",
        "$.conductor",
        "AIR@1 needs a conductor object.",
      ),
    );
  else {
    exactKeys(
      value.conductor,
      new Set(["tempo", "meters", "pickup"]),
      "$.conductor",
      diagnostics,
    );
    if (
      typeof value.conductor.tempo !== "number" ||
      !Number.isFinite(value.conductor.tempo) ||
      value.conductor.tempo < 30 ||
      value.conductor.tempo > 220
    )
      diagnostics.push(
        problem(
          "invalid_tempo",
          "$.conductor.tempo",
          "Tempo must be 30 through 220 BPM.",
        ),
      );
    if (
      !Array.isArray(value.conductor.meters) ||
      value.conductor.meters.length < 1 ||
      value.conductor.meters.length > 64
    )
      diagnostics.push(
        problem(
          "invalid_meter_map",
          "$.conductor.meters",
          "Conductor needs 1-64 meter entries.",
        ),
      );
    else {
      let previous = 0;
      value.conductor.meters.forEach((entry, index) => {
        const path = `$.conductor.meters[${index}]`;
        if (!isRecord(entry)) {
          diagnostics.push(
            problem(
              "invalid_meter_map",
              path,
              "Meter entry must be an object.",
            ),
          );
          return;
        }
        exactKeys(entry, new Set(["bar", "meter"]), path, diagnostics);
        if (
          !Number.isSafeInteger(entry.bar) ||
          Number(entry.bar) < 1 ||
          Number(entry.bar) > MAX_BARS + 1 ||
          Number(entry.bar) <= previous
        )
          diagnostics.push(
            problem(
              "invalid_meter_map",
              `${path}.bar`,
              `Meter bars must be safe integers from 1 through ${MAX_BARS + 1} and strictly increasing.`,
            ),
          );
        else previous = Number(entry.bar);
        if (typeof entry.meter !== "string" || !METER.test(entry.meter))
          diagnostics.push(
            problem(
              "invalid_meter",
              `${path}.meter`,
              "Meter must look like 4/4, 5/8, or 7/8.",
            ),
          );
      });
      if (
        isRecord(value.conductor.meters[0]) &&
        value.conductor.meters[0]!.bar !== 1
      )
        diagnostics.push(
          problem(
            "invalid_meter_map",
            "$.conductor.meters[0].bar",
            "The first meter entry must start at bar 1.",
          ),
        );
    }
    if (value.conductor.pickup !== undefined) {
      const valid = validateRational(
        value.conductor.pickup,
        "$.conductor.pickup",
        diagnostics,
        { max: 16 },
      );
      const first =
        Array.isArray(value.conductor.meters) &&
        isRecord(value.conductor.meters[0])
          ? String(value.conductor.meters[0]!.meter)
          : "";
      const match = METER.exec(first);
      if (valid && match) {
        const meterBeats = (Number(match[1]) * 4) / Number(match[2]);
        if (rationalToNumber(value.conductor.pickup as Rational) >= meterBeats)
          diagnostics.push(
            problem(
              "invalid_pickup",
              "$.conductor.pickup",
              "Pickup must be shorter than the first complete bar.",
            ),
          );
      }
    }
  }

  validateVocabulary(value.vocabulary, "$.vocabulary", diagnostics);
  if (!isRecord(value.motifs))
    diagnostics.push(
      problem("invalid_motifs", "$.motifs", "motifs must be an object."),
    );
  else {
    if (Object.keys(value.motifs).length > 64)
      diagnostics.push(
        problem(
          "too_many_motifs",
          "$.motifs",
          "AIR@1 supports at most 64 motifs.",
        ),
      );
    for (const [id, line] of Object.entries(value.motifs)) {
      if (!ID.test(id))
        diagnostics.push(
          problem("invalid_motif_id", `$.motifs.${id}`, "Motif ID is invalid."),
        );
      if (
        typeof line !== "string" ||
        line.trim().length < 1 ||
        line.length > 4096
      )
        diagnostics.push(
          problem(
            "invalid_motif_line",
            `$.motifs.${id}`,
            "Motif line needs 1-4096 characters.",
          ),
        );
    }
  }
  if (value.grooves !== undefined)
    validateGrooves(value.grooves, "$.grooves", diagnostics);

  if (value.harmony !== undefined) {
    if (
      !Array.isArray(value.harmony) ||
      value.harmony.length < 1 ||
      value.harmony.length > 64
    )
      diagnostics.push(
        problem(
          "invalid_harmony",
          "$.harmony",
          "harmony needs 1-64 plans when supplied.",
        ),
      );
    else {
      const ids = new Set<string>();
      value.harmony.forEach((plan, planIndex) => {
        const path = `$.harmony[${planIndex}]`;
        if (!isRecord(plan)) {
          diagnostics.push(
            problem(
              "invalid_harmony_plan",
              path,
              "Harmony plan must be an object.",
            ),
          );
          return;
        }
        exactKeys(plan, new Set(["id", "chords"]), path, diagnostics);
        if (typeof plan.id !== "string" || !ID.test(plan.id))
          diagnostics.push(
            problem(
              "invalid_harmony_id",
              `${path}.id`,
              "Harmony ID is invalid.",
            ),
          );
        else if (ids.has(plan.id))
          diagnostics.push(
            problem(
              "duplicate_harmony_id",
              `${path}.id`,
              `Duplicate harmony ${plan.id}.`,
            ),
          );
        else ids.add(plan.id);
        if (
          !Array.isArray(plan.chords) ||
          plan.chords.length < 1 ||
          plan.chords.length > 256
        )
          diagnostics.push(
            problem(
              "invalid_harmony_chords",
              `${path}.chords`,
              "Harmony plan needs 1-256 chord spans.",
            ),
          );
        else
          plan.chords.forEach((chord, chordIndex) => {
            const chordPath = `${path}.chords[${chordIndex}]`;
            if (!isRecord(chord)) {
              diagnostics.push(
                problem(
                  "invalid_harmony_chord",
                  chordPath,
                  "Chord span must be an object.",
                ),
              );
              return;
            }
            exactKeys(
              chord,
              new Set(["symbol", "duration", "inversion"]),
              chordPath,
              diagnostics,
            );
            if (
              typeof chord.symbol !== "string" ||
              chord.symbol.length < 1 ||
              chord.symbol.length > 32
            )
              diagnostics.push(
                problem(
                  "invalid_chord_symbol",
                  `${chordPath}.symbol`,
                  "Chord symbol needs 1-32 characters.",
                ),
              );
            validateRational(
              chord.duration,
              `${chordPath}.duration`,
              diagnostics,
              { max: 64 },
            );
            if (
              chord.inversion !== undefined &&
              (!Number.isInteger(chord.inversion) ||
                Number(chord.inversion) < 0 ||
                Number(chord.inversion) > 5)
            )
              diagnostics.push(
                problem(
                  "invalid_chord_inversion",
                  `${chordPath}.inversion`,
                  "inversion must be 0 through 5.",
                ),
              );
          });
      });
    }
  }

  if (value.phrases !== undefined) {
    if (
      !Array.isArray(value.phrases) ||
      value.phrases.length < 1 ||
      value.phrases.length > 64
    )
      diagnostics.push(
        problem(
          "invalid_phrases",
          "$.phrases",
          "phrases needs 1-64 definitions when supplied.",
        ),
      );
    else {
      const ids = new Set<string>();
      value.phrases.forEach((phrase, phraseIndex) => {
        const path = `$.phrases[${phraseIndex}]`;
        if (!isRecord(phrase)) {
          diagnostics.push(
            problem(
              "invalid_phrase",
              path,
              "Phrase definition must be an object.",
            ),
          );
          return;
        }
        exactKeys(phrase, new Set(["id", "segments"]), path, diagnostics);
        if (typeof phrase.id !== "string" || !ID.test(phrase.id))
          diagnostics.push(
            problem("invalid_phrase_id", `${path}.id`, "Phrase ID is invalid."),
          );
        else if (ids.has(phrase.id))
          diagnostics.push(
            problem(
              "duplicate_phrase_id",
              `${path}.id`,
              `Duplicate phrase ${phrase.id}.`,
            ),
          );
        else ids.add(phrase.id);
        if (
          !Array.isArray(phrase.segments) ||
          phrase.segments.length < 1 ||
          phrase.segments.length > 64
        )
          diagnostics.push(
            problem(
              "invalid_phrase",
              `${path}.segments`,
              "Phrase needs 1-64 non-recursive segments.",
            ),
          );
        else {
          const segmentIds = new Set<string>();
          phrase.segments.forEach((segment, segmentIndex) => {
            const segmentPath = `${path}.segments[${segmentIndex}]`;
            validateSegment(segment, segmentPath, diagnostics, false);
            if (isRecord(segment) && typeof segment.id === "string") {
              if (segmentIds.has(segment.id))
                diagnostics.push(
                  problem(
                    "duplicate_segment_id",
                    `${segmentPath}.id`,
                    `Duplicate phrase segment ${segment.id}.`,
                  ),
                );
              else segmentIds.add(segment.id);
            }
          });
        }
      });
    }
  }

  if (!Array.isArray(value.voices) || value.voices.length < 1)
    diagnostics.push(
      problem("invalid_voices", "$.voices", "AIR@1 needs at least one voice."),
    );
  else if (value.voices.length > MAX_VOICES)
    diagnostics.push(
      problem(
        "too_many_voices",
        "$.voices",
        `AIR@1 supports at most ${MAX_VOICES} voices.`,
      ),
    );
  else {
    const ids = new Set<string>();
    value.voices.forEach((voice, voiceIndex) => {
      const path = `$.voices[${voiceIndex}]`;
      if (!isRecord(voice)) {
        diagnostics.push(
          problem("invalid_voice", path, "Voice must be an object."),
        );
        return;
      }
      exactKeys(
        voice,
        new Set([
          "id",
          "instrument",
          "role",
          "part",
          "realize",
          "gainDb",
          "pan",
        ]),
        path,
        diagnostics,
      );
      if (typeof voice.id !== "string" || !ID.test(voice.id))
        diagnostics.push(
          problem("invalid_voice_id", `${path}.id`, "Voice ID is invalid."),
        );
      else if (ids.has(voice.id))
        diagnostics.push(
          problem(
            "duplicate_voice_id",
            `${path}.id`,
            `Duplicate voice ${voice.id}.`,
          ),
        );
      else ids.add(voice.id);
      if (
        typeof voice.instrument !== "string" ||
        !MODULE_ID.test(voice.instrument)
      )
        diagnostics.push(
          problem(
            "invalid_instrument",
            `${path}.instrument`,
            "Voice instrument ID is invalid.",
          ),
        );
      if (!voiceRoles.has(String(voice.role)))
        diagnostics.push(
          problem(
            "invalid_role",
            `${path}.role`,
            "Voice role is not recognized.",
          ),
        );
      const hasPart = voice.part !== undefined;
      const hasRealize = voice.realize !== undefined;
      if (hasPart === hasRealize)
        diagnostics.push(
          problem(
            "voice_authoring_mode",
            path,
            "Voice must provide exactly one of part or realize.",
          ),
        );
      if (
        hasPart &&
        (typeof voice.part !== "string" ||
          voice.part.trim().length < 1 ||
          voice.part.length > 16_384)
      )
        diagnostics.push(
          problem(
            "invalid_part",
            `${path}.part`,
            "Voice part needs 1-16384 characters.",
          ),
        );
      if (hasRealize) {
        if (
          !Array.isArray(voice.realize) ||
          voice.realize.length < 1 ||
          voice.realize.length > 256
        )
          diagnostics.push(
            problem(
              "invalid_realize",
              `${path}.realize`,
              "realize needs 1-256 segments.",
            ),
          );
        else {
          const segmentIds = new Set<string>();
          voice.realize.forEach((segment, segmentIndex) => {
            const segmentPath = `${path}.realize[${segmentIndex}]`;
            validateSegment(segment, segmentPath, diagnostics, true);
            if (isRecord(segment) && typeof segment.id === "string") {
              if (segmentIds.has(segment.id))
                diagnostics.push(
                  problem(
                    "duplicate_segment_id",
                    `${segmentPath}.id`,
                    `Duplicate segment ${segment.id}.`,
                  ),
                );
              else segmentIds.add(segment.id);
            }
          });
        }
      }
      if (
        voice.gainDb !== undefined &&
        (typeof voice.gainDb !== "number" ||
          !Number.isFinite(voice.gainDb) ||
          voice.gainDb < -36 ||
          voice.gainDb > 6)
      )
        diagnostics.push(
          problem(
            "invalid_gain",
            `${path}.gainDb`,
            "gainDb must be -36 through 6.",
          ),
        );
      if (
        voice.pan !== undefined &&
        (typeof voice.pan !== "number" ||
          !Number.isFinite(voice.pan) ||
          voice.pan < -1 ||
          voice.pan > 1)
      )
        diagnostics.push(
          problem("invalid_pan", `${path}.pan`, "pan must be -1 through 1."),
        );
    });
  }

  if (value.sections !== undefined) {
    if (!Array.isArray(value.sections) || value.sections.length > 64)
      diagnostics.push(
        problem(
          "invalid_sections",
          "$.sections",
          "sections must be an array of at most 64 entries.",
        ),
      );
    else {
      const ids = new Set<string>();
      value.sections.forEach((section, index) => {
        const path = `$.sections[${index}]`;
        if (!isRecord(section)) {
          diagnostics.push(
            problem("invalid_section", path, "Section must be an object."),
          );
          return;
        }
        exactKeys(
          section,
          new Set(["id", "startBar", "bars"]),
          path,
          diagnostics,
        );
        if (typeof section.id !== "string" || !ID.test(section.id))
          diagnostics.push(
            problem(
              "invalid_section_id",
              `${path}.id`,
              "Section ID is invalid.",
            ),
          );
        else if (ids.has(section.id))
          diagnostics.push(
            problem(
              "duplicate_section_id",
              `${path}.id`,
              `Duplicate section ${section.id}.`,
            ),
          );
        else ids.add(section.id);
        if (
          !Number.isSafeInteger(section.startBar) ||
          Number(section.startBar) < 1 ||
          Number(section.startBar) > MAX_BARS
        )
          diagnostics.push(
            problem(
              "invalid_section_start",
              `${path}.startBar`,
              `startBar must be a safe integer from 1 through ${MAX_BARS}.`,
            ),
          );
        if (
          !Number.isSafeInteger(section.bars) ||
          Number(section.bars) < 1 ||
          Number(section.bars) > MAX_BARS ||
          (Number.isSafeInteger(section.startBar) &&
            Number(section.startBar) + Number(section.bars) - 1 > MAX_BARS)
        )
          diagnostics.push(
            problem(
              "invalid_section_length",
              `${path}.bars`,
              `bars must be a safe positive integer and the section must end by bar ${MAX_BARS}.`,
            ),
          );
      });
    }
  }
  validateReferences(value, diagnostics);
  if (diagnostics.some((item) => item.severity === "error"))
    return { diagnostics };
  return {
    source: structuredClone(value) as unknown as AirSourceV1,
    diagnostics,
  };
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortValue(item)]),
  );
}

export function airVocabularyIdentityJson(
  vocabulary: Omit<AirVocabularyClosure, "contentSha256">,
): string {
  return JSON.stringify(sortValue(vocabulary));
}

export function airVocabularyContentSha256(
  vocabulary: AirVocabularyClosure,
): string {
  const { contentSha256: _contentSha256, ...core } = vocabulary;
  return sha256Hex(airVocabularyIdentityJson(core));
}

export function createAirVocabularyClosure(
  input: Omit<AirVocabularyClosure, "format" | "contentSha256">,
): AirVocabularyClosure {
  const core: Omit<AirVocabularyClosure, "contentSha256"> = {
    format: AIR_VOCABULARY_FORMAT,
    id: input.id,
    instruments: structuredClone(input.instruments),
    techniques: structuredClone(input.techniques),
  };
  const value: AirVocabularyClosure = {
    ...core,
    contentSha256: sha256Hex(airVocabularyIdentityJson(core)),
  };
  return value;
}

export function canonicalAirV1Json(source: AirSourceV1): string {
  return JSON.stringify(sortValue(source));
}

export function stringifyAirV1(source: AirSourceV1): string {
  return `${JSON.stringify(source, null, 2)}\n`;
}

export function rationalFromNumber(value: number): Rational {
  for (let denominator = 1; denominator <= 96; denominator += 1) {
    const numerator = Math.round(value * denominator);
    if (Math.abs(numerator / denominator - value) < 1e-9) {
      const divisor = gcd(numerator, denominator);
      return {
        numerator: numerator / divisor,
        denominator: denominator / divisor,
      };
    }
  }
  throw new Error(
    `AIR@0 beat value ${value} has no exact AIR@1 rational within denominator 96.`,
  );
}

function migrateSegment(
  segment: NonNullable<
    Extract<AirSource["voices"][number], { realize: unknown }>["realize"]
  >[number],
): PhraseBodySegmentV1 {
  const common = {
    id: segment.id,
    ...(segment.repeat === undefined ? {} : { repeat: segment.repeat }),
    ...(segment.section === undefined ? {} : { section: segment.section }),
    ...(segment.dynamic === undefined ? {} : { dynamic: segment.dynamic }),
    ...(segment.dynamicCurve === undefined
      ? {}
      : { dynamicCurve: structuredClone(segment.dynamicCurve) }),
    ...(segment.articulation === undefined
      ? {}
      : { articulation: segment.articulation }),
    ...(segment.gate === undefined ? {} : { gate: segment.gate }),
    ...(segment.tieToNext === undefined
      ? {}
      : { tieToNext: segment.tieToNext }),
  };
  if (segment.kind === "literal")
    return { ...common, kind: "literal", part: segment.part };
  if (segment.kind === "motif")
    return {
      ...common,
      kind: "motif",
      motif: segment.motif,
      ...(segment.transform === undefined
        ? {}
        : {
            transform: {
              ...(segment.transform.transpose === undefined
                ? {}
                : { transpose: segment.transform.transpose }),
              ...(segment.transform.stretch === undefined
                ? {}
                : { timeScale: rationalFromNumber(segment.transform.stretch) }),
              ...(segment.transform.inversion === undefined
                ? {}
                : { inversion: segment.transform.inversion }),
              ...(segment.transform.retrograde === undefined
                ? {}
                : { retrograde: segment.transform.retrograde }),
            },
          }),
    };
  if (segment.kind === "chords")
    return {
      ...common,
      kind: "chords",
      harmony: segment.harmony,
      voicing: segment.voicing,
      register: structuredClone(segment.register),
      rhythm: segment.rhythm.map(rationalFromNumber),
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
      step: rationalFromNumber(segment.stepBeats),
      octaveSpan: segment.octaveSpan,
      register: structuredClone(segment.register),
    };
  if (segment.kind === "bass")
    return {
      ...common,
      kind: "bass",
      harmony: segment.harmony,
      degrees: [...segment.degrees],
      step: rationalFromNumber(segment.stepBeats),
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
    duration: rationalFromNumber(segment.beats),
  };
}

export function migrateAirV0ToV1(
  source: AirSource,
  vocabulary: AirVocabularyClosure,
): AirSourceV1 {
  const migrated: AirSourceV1 = {
    format: AIR_V1_FORMAT,
    title: source.title,
    conductor: {
      tempo: source.tempo,
      meters: [{ bar: 1, meter: source.meter }],
    },
    ...(source.key === undefined ? {} : { key: source.key }),
    vocabulary: structuredClone(vocabulary),
    motifs: structuredClone(source.motifs),
    ...(source.harmony === undefined
      ? {}
      : {
          harmony: source.harmony.map((plan) => ({
            id: plan.id,
            chords: plan.chords.map((chord) => ({
              symbol: chord.symbol,
              duration: rationalFromNumber(chord.beats),
              ...(chord.inversion === undefined
                ? {}
                : { inversion: chord.inversion }),
            })),
          })),
        }),
    voices: source.voices.map((voice) => ({
      id: voice.id,
      instrument: voice.instrument,
      role: voice.role,
      ...(voice.gainDb === undefined ? {} : { gainDb: voice.gainDb }),
      ...(voice.pan === undefined ? {} : { pan: voice.pan }),
      ...(typeof voice.part === "string"
        ? { part: voice.part }
        : { realize: voice.realize.map(migrateSegment) }),
    })) as AirVoiceV1[],
    ...(source.sections === undefined
      ? {}
      : { sections: structuredClone(source.sections) }),
  };
  const parsed = parseAirV1(migrated);
  if (!parsed.source)
    throw new Error(
      parsed.diagnostics
        .map((item) => `${item.path}: ${item.message}`)
        .join("\n"),
    );
  return parsed.source;
}
