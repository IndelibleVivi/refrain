export const AIR_FORMAT = "air@0-experimental" as const;
export const MAX_SOURCE_BYTES = 65_536;
export const MAX_VOICES = 12;
export const MAX_BARS = 256;
export const MAX_EVENTS = 24_576;
export const MAX_EXPANDED_ATOMS = 65_536;
export const MAX_SCORE_SECONDS = 480;

export type DiagnosticSeverity = "error" | "warning" | "note";

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  path: string;
  message: string;
  hint?: string;
}

export interface AirSection {
  id: string;
  startBar: number;
  bars: number;
}

export const DYNAMIC_LEVELS = ["pp", "p", "mp", "mf", "f", "ff"] as const;
export type DynamicLevel = (typeof DYNAMIC_LEVELS)[number];

export const ARTICULATIONS = [
  "staccato",
  "tenuto",
  "accent",
  "legato",
] as const;
export type Articulation = (typeof ARTICULATIONS)[number];

export interface DynamicCurvePoint {
  at: number;
  level: DynamicLevel;
}

export interface DynamicCurve {
  from: DynamicLevel;
  via?: DynamicCurvePoint[];
  to: DynamicLevel;
}

export interface PitchRegister {
  min: string;
  max: string;
}

export const CHORD_DEGREES = [1, 3, 5, 7, 9] as const;
export type ChordDegree = (typeof CHORD_DEGREES)[number];

export interface MotifTransform {
  transpose?: number;
  stretch?: number;
  inversion?: boolean;
  retrograde?: boolean;
}

interface RealizationBase {
  id: string;
  repeat?: number;
  section?: string;
  dynamic?: DynamicLevel;
  dynamicCurve?: DynamicCurve;
  articulation?: Articulation;
  gate?: number;
  tieToNext?: boolean;
}

export interface LiteralSegment extends RealizationBase {
  kind: "literal";
  part: string;
}

export interface MotifSegment extends RealizationBase {
  kind: "motif";
  motif: string;
  transform?: MotifTransform;
}

export interface ChordsSegment extends RealizationBase {
  kind: "chords";
  harmony: string;
  voicing: "close" | "open" | "drop2";
  register: PitchRegister;
  rhythm: number[];
  voiceLeading?: "nearest";
}

export interface ArpeggioSegment extends RealizationBase {
  kind: "arpeggio";
  harmony: string;
  degrees: ChordDegree[];
  stepBeats: number;
  octaveSpan: number;
  register: PitchRegister;
}

export interface BassSegment extends RealizationBase {
  kind: "bass";
  harmony: string;
  degrees: ChordDegree[];
  stepBeats: number;
  register: PitchRegister;
  slashBass: "honor" | "ignore";
}

export interface DrumLane {
  note: string;
  pattern: string;
}

export interface DrumGridSegment extends RealizationBase {
  kind: "drum_grid";
  resolution: 8 | 16;
  lanes: DrumLane[];
}

export interface RestSegment extends RealizationBase {
  kind: "rest";
  beats: number;
}

export type RealizationSegment =
  | LiteralSegment
  | MotifSegment
  | ChordsSegment
  | ArpeggioSegment
  | BassSegment
  | DrumGridSegment
  | RestSegment;

export interface HarmonyChord {
  symbol: string;
  beats: number;
  inversion?: number;
}

export interface HarmonyPlan {
  id: string;
  chords: HarmonyChord[];
}

export const VOICE_ROLES = [
  "lead",
  "harmony",
  "counter",
  "bass",
  "pulse",
  "percussion",
  "texture",
] as const;

export type VoiceRole = (typeof VOICE_ROLES)[number];

interface AirVoiceBase {
  id: string;
  instrument: string;
  role: VoiceRole;
  gainDb?: number;
  pan?: number;
}

export type AirVoice = AirVoiceBase &
  (
    | {
        /** Compact note line; `|` separates measures and `@name` recalls a motif. */
        part: string;
        realize?: never;
      }
    | { realize: RealizationSegment[]; part?: never }
  );

export interface AirSource {
  format: typeof AIR_FORMAT;
  title: string;
  tempo: number;
  meter: string;
  key?: string;
  motifs: Record<string, string>;
  harmony?: HarmonyPlan[];
  voices: AirVoice[];
  sections?: AirSection[];
}

export interface ParseAirResult {
  source?: AirSource;
  diagnostics: Diagnostic[];
}

const VOICE_ROLE_SET = new Set<VoiceRole>(VOICE_ROLES);
const DYNAMIC_LEVEL_SET = new Set<DynamicLevel>(DYNAMIC_LEVELS);
const ARTICULATION_SET = new Set<Articulation>(ARTICULATIONS);

const AIR_KEYS = new Set([
  "format",
  "title",
  "tempo",
  "meter",
  "key",
  "motifs",
  "harmony",
  "voices",
  "sections",
]);
const VOICE_KEYS = new Set([
  "id",
  "instrument",
  "role",
  "part",
  "realize",
  "gainDb",
  "pan",
]);
const SECTION_KEYS = new Set(["id", "startBar", "bars"]);
const HARMONY_KEYS = new Set(["id", "chords"]);
const HARMONY_CHORD_KEYS = new Set(["symbol", "beats", "inversion"]);
const SEGMENT_COMMON_KEYS = [
  "id",
  "kind",
  "repeat",
  "section",
  "dynamic",
  "dynamicCurve",
  "articulation",
  "gate",
  "tieToNext",
] as const;
const SEGMENT_KIND_KEYS: Record<string, readonly string[]> = {
  literal: ["part"],
  motif: ["motif", "transform"],
  chords: ["harmony", "voicing", "register", "rhythm", "voiceLeading"],
  arpeggio: ["harmony", "degrees", "stepBeats", "octaveSpan", "register"],
  bass: ["harmony", "degrees", "stepBeats", "register", "slashBass"],
  drum_grid: ["resolution", "lanes"],
  rest: ["beats"],
};
const DYNAMIC_CURVE_KEYS = new Set(["from", "via", "to"]);
const DYNAMIC_CURVE_POINT_KEYS = new Set(["at", "level"]);
const TRANSFORM_KEYS = new Set([
  "transpose",
  "stretch",
  "inversion",
  "retrograde",
]);
const REGISTER_KEYS = new Set(["min", "max"]);
const DRUM_LANE_KEYS = new Set(["note", "pattern"]);
const ID_PATTERN = /^[a-z][a-z0-9_-]*$/i;
const NOTE_PATTERN = /^[A-Ga-g][#b]?-?\d$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const error = (
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

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
  path: string,
  diagnostics: Diagnostic[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      diagnostics.push(
        error(
          "unknown_field",
          `${path}.${key}`,
          `Unknown field ${key}.`,
          "Canonical airs are closed; move runtime or private metadata into the tool context.",
        ),
      );
    }
  }
}

function validId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function validateRegister(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): void {
  if (!isRecord(value)) {
    diagnostics.push(
      error(
        "invalid_register",
        path,
        "register must be an object with min and max notes.",
      ),
    );
    return;
  }
  rejectUnknownKeys(value, REGISTER_KEYS, path, diagnostics);
  if (typeof value.min !== "string" || !NOTE_PATTERN.test(value.min)) {
    diagnostics.push(
      error(
        "invalid_register",
        `${path}.min`,
        "register.min must be a note such as C3.",
      ),
    );
  }
  if (typeof value.max !== "string" || !NOTE_PATTERN.test(value.max)) {
    diagnostics.push(
      error(
        "invalid_register",
        `${path}.max`,
        "register.max must be a note such as C5.",
      ),
    );
  }
}

function validateNumberList(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
  predicate: (item: number) => boolean,
  message: string,
): void {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 32 ||
    value.some(
      (item) =>
        typeof item !== "number" || !Number.isFinite(item) || !predicate(item),
    )
  ) {
    diagnostics.push(error("invalid_pattern", path, message));
  }
}

function validateSegment(
  segment: unknown,
  path: string,
  diagnostics: Diagnostic[],
): void {
  if (!isRecord(segment)) {
    diagnostics.push(
      error(
        "invalid_segment",
        path,
        "Each realization segment must be an object.",
      ),
    );
    return;
  }
  const kind = typeof segment.kind === "string" ? segment.kind : "";
  const kindKeys = SEGMENT_KIND_KEYS[kind];
  if (!kindKeys) {
    diagnostics.push(
      error(
        "invalid_segment_kind",
        `${path}.kind`,
        "Segment kind must be literal, motif, chords, arpeggio, bass, drum_grid, or rest.",
      ),
    );
  }
  rejectUnknownKeys(
    segment,
    new Set([...SEGMENT_COMMON_KEYS, ...(kindKeys ?? [])]),
    path,
    diagnostics,
  );
  if (!validId(segment.id)) {
    diagnostics.push(
      error("invalid_segment_id", `${path}.id`, "Segment ID is invalid."),
    );
  }
  if (
    segment.repeat !== undefined &&
    (!Number.isInteger(segment.repeat) ||
      (segment.repeat as number) < 1 ||
      (segment.repeat as number) > 16)
  ) {
    diagnostics.push(
      error(
        "invalid_repeat",
        `${path}.repeat`,
        "repeat must be an integer from 1 through 16.",
      ),
    );
  }
  if (
    segment.section !== undefined &&
    (typeof segment.section !== "string" ||
      segment.section.length === 0 ||
      segment.section.length > 80)
  ) {
    diagnostics.push(
      error(
        "invalid_segment_section",
        `${path}.section`,
        "section must be non-empty text of at most 80 characters.",
      ),
    );
  }
  if (
    segment.dynamic !== undefined &&
    (typeof segment.dynamic !== "string" ||
      !DYNAMIC_LEVEL_SET.has(segment.dynamic as DynamicLevel))
  ) {
    diagnostics.push(
      error(
        "invalid_dynamic",
        `${path}.dynamic`,
        "dynamic must be pp, p, mp, mf, f, or ff.",
      ),
    );
  }
  if (segment.dynamicCurve !== undefined) {
    if (!isRecord(segment.dynamicCurve)) {
      diagnostics.push(
        error(
          "invalid_dynamic_curve",
          `${path}.dynamicCurve`,
          "dynamicCurve must contain from and to.",
        ),
      );
    } else {
      rejectUnknownKeys(
        segment.dynamicCurve,
        DYNAMIC_CURVE_KEYS,
        `${path}.dynamicCurve`,
        diagnostics,
      );
      for (const key of ["from", "to"] as const) {
        if (
          typeof segment.dynamicCurve[key] !== "string" ||
          !DYNAMIC_LEVEL_SET.has(segment.dynamicCurve[key] as DynamicLevel)
        ) {
          diagnostics.push(
            error(
              "invalid_dynamic_curve",
              `${path}.dynamicCurve.${key}`,
              `${key} must be pp, p, mp, mf, f, or ff.`,
            ),
          );
        }
      }
      if (segment.dynamicCurve.via !== undefined) {
        if (
          !Array.isArray(segment.dynamicCurve.via) ||
          segment.dynamicCurve.via.length < 1 ||
          segment.dynamicCurve.via.length > 6
        ) {
          diagnostics.push(
            error(
              "invalid_dynamic_curve",
              `${path}.dynamicCurve.via`,
              "via must contain between one and six dynamic points.",
            ),
          );
        } else {
          let previousAt = 0;
          for (const [
            pointIndex,
            point,
          ] of segment.dynamicCurve.via.entries()) {
            const pointPath = `${path}.dynamicCurve.via[${pointIndex}]`;
            if (!isRecord(point)) {
              diagnostics.push(
                error(
                  "invalid_dynamic_curve",
                  pointPath,
                  "A dynamic point must contain at and level.",
                ),
              );
              continue;
            }
            rejectUnknownKeys(
              point,
              DYNAMIC_CURVE_POINT_KEYS,
              pointPath,
              diagnostics,
            );
            if (
              typeof point.at !== "number" ||
              !Number.isFinite(point.at) ||
              point.at <= 0 ||
              point.at >= 1
            ) {
              diagnostics.push(
                error(
                  "invalid_dynamic_curve",
                  `${pointPath}.at`,
                  "at must be a finite number strictly between 0 and 1.",
                ),
              );
            } else {
              if (point.at <= previousAt) {
                diagnostics.push(
                  error(
                    "invalid_dynamic_curve",
                    `${pointPath}.at`,
                    "via points must be in strictly increasing order.",
                  ),
                );
              }
              previousAt = point.at;
            }
            if (
              typeof point.level !== "string" ||
              !DYNAMIC_LEVEL_SET.has(point.level as DynamicLevel)
            ) {
              diagnostics.push(
                error(
                  "invalid_dynamic_curve",
                  `${pointPath}.level`,
                  "level must be pp, p, mp, mf, f, or ff.",
                ),
              );
            }
          }
        }
      }
    }
  }
  if (segment.dynamic !== undefined && segment.dynamicCurve !== undefined) {
    diagnostics.push(
      error(
        "expression_conflict",
        path,
        "Use either dynamic or dynamicCurve, not both.",
      ),
    );
  }
  if (
    segment.articulation !== undefined &&
    (typeof segment.articulation !== "string" ||
      !ARTICULATION_SET.has(segment.articulation as Articulation))
  ) {
    diagnostics.push(
      error(
        "invalid_articulation",
        `${path}.articulation`,
        "articulation must be staccato, tenuto, accent, or legato.",
      ),
    );
  }
  if (
    segment.gate !== undefined &&
    (typeof segment.gate !== "number" ||
      !Number.isFinite(segment.gate) ||
      segment.gate < 0.05 ||
      segment.gate > 1.5)
  ) {
    diagnostics.push(
      error(
        "invalid_gate",
        `${path}.gate`,
        "gate must be between 0.05 and 1.5.",
      ),
    );
  }
  if (
    segment.tieToNext !== undefined &&
    typeof segment.tieToNext !== "boolean"
  ) {
    diagnostics.push(
      error("invalid_tie", `${path}.tieToNext`, "tieToNext must be boolean."),
    );
  }

  if (kind === "literal") {
    if (
      typeof segment.part !== "string" ||
      segment.part.trim().length === 0 ||
      segment.part.length > 16_384
    ) {
      diagnostics.push(
        error(
          "invalid_part",
          `${path}.part`,
          "Literal part must be non-empty text of at most 16384 characters.",
        ),
      );
    }
  } else if (kind === "motif") {
    if (!validId(segment.motif)) {
      diagnostics.push(
        error(
          "invalid_motif_id",
          `${path}.motif`,
          "motif must be a valid motif ID.",
        ),
      );
    }
    if (segment.transform !== undefined) {
      if (!isRecord(segment.transform)) {
        diagnostics.push(
          error(
            "invalid_transform",
            `${path}.transform`,
            "transform must be an object.",
          ),
        );
      } else {
        rejectUnknownKeys(
          segment.transform,
          TRANSFORM_KEYS,
          `${path}.transform`,
          diagnostics,
        );
        const transpose = segment.transform.transpose;
        if (
          transpose !== undefined &&
          (!Number.isInteger(transpose) ||
            (transpose as number) < -24 ||
            (transpose as number) > 24)
        ) {
          diagnostics.push(
            error(
              "invalid_transpose",
              `${path}.transform.transpose`,
              "transpose must be an integer from -24 through 24.",
            ),
          );
        }
        const stretch = segment.transform.stretch;
        if (
          stretch !== undefined &&
          (typeof stretch !== "number" ||
            !Number.isFinite(stretch) ||
            stretch < 0.25 ||
            stretch > 4)
        ) {
          diagnostics.push(
            error(
              "invalid_stretch",
              `${path}.transform.stretch`,
              "stretch must be between 0.25 and 4.",
            ),
          );
        }
        for (const key of ["inversion", "retrograde"] as const) {
          if (
            segment.transform[key] !== undefined &&
            typeof segment.transform[key] !== "boolean"
          ) {
            diagnostics.push(
              error(
                "invalid_transform",
                `${path}.transform.${key}`,
                `${key} must be boolean.`,
              ),
            );
          }
        }
      }
    }
  } else if (kind === "chords") {
    if (!validId(segment.harmony))
      diagnostics.push(
        error(
          "invalid_harmony_reference",
          `${path}.harmony`,
          "harmony must be a valid plan ID.",
        ),
      );
    if (!["close", "open", "drop2"].includes(String(segment.voicing)))
      diagnostics.push(
        error(
          "invalid_voicing",
          `${path}.voicing`,
          "voicing must be close, open, or drop2.",
        ),
      );
    validateRegister(segment.register, `${path}.register`, diagnostics);
    validateNumberList(
      segment.rhythm,
      `${path}.rhythm`,
      diagnostics,
      (item) => item > 0 && item <= 16,
      "rhythm needs 1–32 positive beat durations no greater than 16.",
    );
    if (
      segment.voiceLeading !== undefined &&
      segment.voiceLeading !== "nearest"
    )
      diagnostics.push(
        error(
          "invalid_voice_leading",
          `${path}.voiceLeading`,
          "voiceLeading currently supports only nearest.",
        ),
      );
  } else if (kind === "arpeggio" || kind === "bass") {
    if (!validId(segment.harmony))
      diagnostics.push(
        error(
          "invalid_harmony_reference",
          `${path}.harmony`,
          "harmony must be a valid plan ID.",
        ),
      );
    validateNumberList(
      segment.degrees,
      `${path}.degrees`,
      diagnostics,
      (item) =>
        Number.isInteger(item) && CHORD_DEGREES.includes(item as ChordDegree),
      "degrees needs 1–32 values from the supported set 1, 3, 5, 7, 9.",
    );
    if (
      typeof segment.stepBeats !== "number" ||
      !Number.isFinite(segment.stepBeats) ||
      segment.stepBeats <= 0 ||
      segment.stepBeats > 16
    )
      diagnostics.push(
        error(
          "invalid_step",
          `${path}.stepBeats`,
          "stepBeats must be positive and no greater than 16.",
        ),
      );
    validateRegister(segment.register, `${path}.register`, diagnostics);
    if (kind === "arpeggio") {
      if (
        !Number.isInteger(segment.octaveSpan) ||
        (segment.octaveSpan as number) < 1 ||
        (segment.octaveSpan as number) > 4
      )
        diagnostics.push(
          error(
            "invalid_octave_span",
            `${path}.octaveSpan`,
            "octaveSpan must be an integer from 1 through 4.",
          ),
        );
    } else if (!["honor", "ignore"].includes(String(segment.slashBass))) {
      diagnostics.push(
        error(
          "invalid_slash_bass",
          `${path}.slashBass`,
          "slashBass must be honor or ignore.",
        ),
      );
    }
  } else if (kind === "drum_grid") {
    if (segment.resolution !== 8 && segment.resolution !== 16)
      diagnostics.push(
        error(
          "invalid_grid_resolution",
          `${path}.resolution`,
          "resolution must be 8 or 16.",
        ),
      );
    if (
      !Array.isArray(segment.lanes) ||
      segment.lanes.length === 0 ||
      segment.lanes.length > 16
    ) {
      diagnostics.push(
        error(
          "invalid_drum_lanes",
          `${path}.lanes`,
          "drum_grid needs 1–16 lanes.",
        ),
      );
    } else {
      let patternLength: number | undefined;
      segment.lanes.forEach((lane, index) => {
        const lanePath = `${path}.lanes[${index}]`;
        if (!isRecord(lane)) {
          diagnostics.push(
            error(
              "invalid_drum_lane",
              lanePath,
              "Each lane must be an object.",
            ),
          );
          return;
        }
        rejectUnknownKeys(lane, DRUM_LANE_KEYS, lanePath, diagnostics);
        if (typeof lane.note !== "string" || !NOTE_PATTERN.test(lane.note))
          diagnostics.push(
            error(
              "invalid_drum_note",
              `${lanePath}.note`,
              "note must look like C2.",
            ),
          );
        if (
          typeof lane.pattern !== "string" ||
          lane.pattern.length === 0 ||
          lane.pattern.length > 256 ||
          !/^[x.]+$/.test(lane.pattern)
        ) {
          diagnostics.push(
            error(
              "invalid_drum_pattern",
              `${lanePath}.pattern`,
              "pattern must contain 1–256 x or . steps.",
            ),
          );
        } else if (patternLength === undefined)
          patternLength = lane.pattern.length;
        else if (lane.pattern.length !== patternLength)
          diagnostics.push(
            error(
              "drum_pattern_mismatch",
              `${lanePath}.pattern`,
              "All drum-grid lane patterns must have the same length.",
            ),
          );
      });
    }
  } else if (kind === "rest") {
    if (
      typeof segment.beats !== "number" ||
      !Number.isFinite(segment.beats) ||
      segment.beats <= 0 ||
      segment.beats > 1024
    )
      diagnostics.push(
        error(
          "invalid_rest",
          `${path}.beats`,
          "Rest beats must be positive and no greater than 1024.",
        ),
      );
  }
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

export function parseAir(input: string | unknown): ParseAirResult {
  let value: unknown = input;
  const diagnostics: Diagnostic[] = [];

  const inputBytes = encodedSize(input);
  if (inputBytes === undefined) {
    return {
      diagnostics: [
        error(
          "invalid_source_encoding",
          "$",
          "The air must be JSON-serializable.",
        ),
      ],
    };
  }
  if (inputBytes > MAX_SOURCE_BYTES) {
    return {
      diagnostics: [
        error(
          "source_too_large",
          "$",
          `The experimental source limit is ${MAX_SOURCE_BYTES} UTF-8 bytes; received ${inputBytes}.`,
        ),
      ],
    };
  }

  if (typeof input === "string") {
    try {
      value = JSON.parse(input) as unknown;
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Unknown JSON parse error";
      return {
        diagnostics: [
          error(
            "invalid_json",
            "$",
            message,
            "Return one complete JSON object.",
          ),
        ],
      };
    }
  }

  if (!isRecord(value)) {
    return {
      diagnostics: [
        error("invalid_envelope", "$", "An air must be a JSON object."),
      ],
    };
  }

  rejectUnknownKeys(value, AIR_KEYS, "$", diagnostics);

  if (value.format !== AIR_FORMAT) {
    diagnostics.push(
      error(
        "unsupported_format",
        "$.format",
        `Expected ${AIR_FORMAT}.`,
        "Use the experimental format identifier exactly; it is not a stable v1.",
      ),
    );
  }

  if (
    typeof value.title !== "string" ||
    value.title.trim().length === 0 ||
    value.title.length > 200
  ) {
    diagnostics.push(
      error(
        "invalid_title",
        "$.title",
        "Title must be a non-empty string of at most 200 characters.",
      ),
    );
  }

  if (typeof value.tempo !== "number" || !Number.isFinite(value.tempo)) {
    diagnostics.push(
      error("invalid_tempo", "$.tempo", "Tempo must be a finite number."),
    );
  } else if (value.tempo < 30 || value.tempo > 220) {
    diagnostics.push(
      error(
        "tempo_out_of_range",
        "$.tempo",
        "Tempo must be between 30 and 220 BPM.",
      ),
    );
  }

  if (
    typeof value.meter !== "string" ||
    !/^\d{1,2}\/\d{1,2}$/.test(value.meter)
  ) {
    diagnostics.push(
      error("invalid_meter", "$.meter", "Meter must look like 4/4 or 6/8."),
    );
  }

  if (
    value.key !== undefined &&
    (typeof value.key !== "string" || value.key.length > 80)
  ) {
    diagnostics.push(
      error(
        "invalid_key",
        "$.key",
        "Key must be a string of at most 80 characters when supplied.",
      ),
    );
  }

  if (!isRecord(value.motifs)) {
    diagnostics.push(
      error(
        "invalid_motifs",
        "$.motifs",
        "Motifs must be an object of named lines.",
      ),
    );
  } else {
    if (Object.keys(value.motifs).length > 64) {
      diagnostics.push(
        error(
          "too_many_motifs",
          "$.motifs",
          "The experimental limit is 64 motifs.",
        ),
      );
    }
    for (const [name, line] of Object.entries(value.motifs)) {
      if (!/^[a-z][a-z0-9_-]*$/i.test(name)) {
        diagnostics.push(
          error(
            "invalid_motif_id",
            `$.motifs.${name}`,
            "Motif IDs use letters, digits, _ or -.",
          ),
        );
      }
      if (
        typeof line !== "string" ||
        line.trim().length === 0 ||
        line.length > 4096
      ) {
        diagnostics.push(
          error(
            "invalid_motif_line",
            `$.motifs.${name}`,
            "A motif line must be non-empty text of at most 4096 characters.",
          ),
        );
      }
    }
  }

  if (value.harmony !== undefined) {
    if (!Array.isArray(value.harmony) || value.harmony.length === 0) {
      diagnostics.push(
        error(
          "invalid_harmony",
          "$.harmony",
          "harmony must be a non-empty array when supplied.",
        ),
      );
    } else if (value.harmony.length > 64) {
      diagnostics.push(
        error(
          "too_many_harmony_plans",
          "$.harmony",
          "The experimental limit is 64 harmony plans.",
        ),
      );
    } else {
      const ids = new Set<string>();
      value.harmony.forEach((plan, planIndex) => {
        const path = `$.harmony[${planIndex}]`;
        if (!isRecord(plan)) {
          diagnostics.push(
            error(
              "invalid_harmony_plan",
              path,
              "Each harmony plan must be an object.",
            ),
          );
          return;
        }
        rejectUnknownKeys(plan, HARMONY_KEYS, path, diagnostics);
        if (!validId(plan.id)) {
          diagnostics.push(
            error(
              "invalid_harmony_id",
              `${path}.id`,
              "Harmony plan ID is invalid.",
            ),
          );
        } else if (ids.has(plan.id)) {
          diagnostics.push(
            error(
              "duplicate_harmony_id",
              `${path}.id`,
              `Duplicate harmony plan ${plan.id}.`,
            ),
          );
        } else ids.add(plan.id);
        if (
          !Array.isArray(plan.chords) ||
          plan.chords.length === 0 ||
          plan.chords.length > 256
        ) {
          diagnostics.push(
            error(
              "invalid_harmony_chords",
              `${path}.chords`,
              "A harmony plan needs 1–256 chord spans.",
            ),
          );
          return;
        }
        plan.chords.forEach((chord, chordIndex) => {
          const chordPath = `${path}.chords[${chordIndex}]`;
          if (!isRecord(chord)) {
            diagnostics.push(
              error(
                "invalid_harmony_chord",
                chordPath,
                "Each chord span must be an object.",
              ),
            );
            return;
          }
          rejectUnknownKeys(chord, HARMONY_CHORD_KEYS, chordPath, diagnostics);
          if (
            typeof chord.symbol !== "string" ||
            chord.symbol.length === 0 ||
            chord.symbol.length > 32
          )
            diagnostics.push(
              error(
                "invalid_chord_symbol",
                `${chordPath}.symbol`,
                "Chord symbol must be non-empty text of at most 32 characters.",
              ),
            );
          if (
            typeof chord.beats !== "number" ||
            !Number.isFinite(chord.beats) ||
            chord.beats <= 0 ||
            chord.beats > 64
          )
            diagnostics.push(
              error(
                "invalid_chord_duration",
                `${chordPath}.beats`,
                "Chord beats must be positive and no greater than 64.",
              ),
            );
          if (
            chord.inversion !== undefined &&
            (!Number.isInteger(chord.inversion) ||
              (chord.inversion as number) < 0 ||
              (chord.inversion as number) > 5)
          )
            diagnostics.push(
              error(
                "invalid_chord_inversion",
                `${chordPath}.inversion`,
                "inversion must be an integer from 0 through 5.",
              ),
            );
        });
      });
    }
  }

  if (!Array.isArray(value.voices) || value.voices.length === 0) {
    diagnostics.push(
      error("invalid_voices", "$.voices", "An air needs at least one voice."),
    );
  } else if (value.voices.length > MAX_VOICES) {
    diagnostics.push(
      error(
        "too_many_voices",
        "$.voices",
        `The complete-piece limit is ${MAX_VOICES} voices.`,
      ),
    );
  } else {
    const ids = new Set<string>();
    value.voices.forEach((voice, index) => {
      const path = `$.voices[${index}]`;
      if (!isRecord(voice)) {
        diagnostics.push(
          error("invalid_voice", path, "Each voice must be an object."),
        );
        return;
      }
      rejectUnknownKeys(voice, VOICE_KEYS, path, diagnostics);
      if (
        typeof voice.id !== "string" ||
        !/^[a-z][a-z0-9_-]*$/i.test(voice.id)
      ) {
        diagnostics.push(
          error("invalid_voice_id", `${path}.id`, "Voice ID is invalid."),
        );
      } else if (ids.has(voice.id)) {
        diagnostics.push(
          error(
            "duplicate_voice_id",
            `${path}.id`,
            `Duplicate voice ${voice.id}.`,
          ),
        );
      } else {
        ids.add(voice.id);
      }
      if (
        typeof voice.instrument !== "string" ||
        voice.instrument.length === 0
      ) {
        diagnostics.push(
          error(
            "invalid_instrument",
            `${path}.instrument`,
            "Instrument is required.",
          ),
        );
      }
      if (
        typeof voice.role !== "string" ||
        !VOICE_ROLE_SET.has(voice.role as VoiceRole)
      ) {
        diagnostics.push(
          error(
            "invalid_role",
            `${path}.role`,
            "Voice role is not recognized.",
          ),
        );
      }
      const hasPart = voice.part !== undefined;
      const hasRealize = voice.realize !== undefined;
      if (hasPart === hasRealize) {
        diagnostics.push(
          error(
            "voice_authoring_mode",
            path,
            "A voice must provide exactly one of part or realize.",
          ),
        );
      }
      if (
        hasPart &&
        (typeof voice.part !== "string" ||
          voice.part.trim().length === 0 ||
          voice.part.length > 16_384)
      ) {
        diagnostics.push(
          error(
            "invalid_part",
            `${path}.part`,
            "Voice part must be non-empty text of at most 16384 characters.",
          ),
        );
      }
      if (hasRealize) {
        if (
          !Array.isArray(voice.realize) ||
          voice.realize.length === 0 ||
          voice.realize.length > 256
        ) {
          diagnostics.push(
            error(
              "invalid_realize",
              `${path}.realize`,
              "realize must contain 1–256 segments.",
            ),
          );
        } else {
          const segmentIds = new Set<string>();
          voice.realize.forEach((segment, segmentIndex) => {
            const segmentPath = `${path}.realize[${segmentIndex}]`;
            validateSegment(segment, segmentPath, diagnostics);
            if (isRecord(segment) && validId(segment.id)) {
              if (segmentIds.has(segment.id))
                diagnostics.push(
                  error(
                    "duplicate_segment_id",
                    `${segmentPath}.id`,
                    `Duplicate segment ${segment.id} in voice ${String(voice.id)}.`,
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
      ) {
        diagnostics.push(
          error(
            "invalid_gain",
            `${path}.gainDb`,
            "gainDb must be between -36 and 6.",
          ),
        );
      }
      if (
        voice.pan !== undefined &&
        (typeof voice.pan !== "number" ||
          !Number.isFinite(voice.pan) ||
          voice.pan < -1 ||
          voice.pan > 1)
      ) {
        diagnostics.push(
          error("invalid_pan", `${path}.pan`, "pan must be between -1 and 1."),
        );
      }
    });
  }

  if (value.sections !== undefined) {
    if (!Array.isArray(value.sections)) {
      diagnostics.push(
        error("invalid_sections", "$.sections", "Sections must be an array."),
      );
    } else {
      if (value.sections.length > 64) {
        diagnostics.push(
          error(
            "too_many_sections",
            "$.sections",
            "The experimental limit is 64 sections.",
          ),
        );
      }
      const ids = new Set<string>();
      value.sections.forEach((section, index) => {
        const path = `$.sections[${index}]`;
        if (!isRecord(section)) {
          diagnostics.push(
            error("invalid_section", path, "Each section must be an object."),
          );
          return;
        }
        rejectUnknownKeys(section, SECTION_KEYS, path, diagnostics);
        if (typeof section.id !== "string" || section.id.length === 0) {
          diagnostics.push(
            error(
              "invalid_section_id",
              `${path}.id`,
              "Section ID is required.",
            ),
          );
        } else if (ids.has(section.id)) {
          diagnostics.push(
            error(
              "duplicate_section_id",
              `${path}.id`,
              `Duplicate section ${section.id}.`,
            ),
          );
        } else {
          ids.add(section.id);
        }
        if (
          !Number.isInteger(section.startBar) ||
          (section.startBar as number) < 1
        ) {
          diagnostics.push(
            error(
              "invalid_section_start",
              `${path}.startBar`,
              "startBar starts at 1.",
            ),
          );
        }
        if (!Number.isInteger(section.bars) || (section.bars as number) < 1) {
          diagnostics.push(
            error(
              "invalid_section_length",
              `${path}.bars`,
              "bars must be positive.",
            ),
          );
        }
      });
    }
  }

  if (diagnostics.some((item) => item.severity === "error")) {
    return { diagnostics };
  }

  const source: AirSource = {
    format: AIR_FORMAT,
    title: value.title as string,
    tempo: value.tempo as number,
    meter: value.meter as string,
    ...(typeof value.key === "string" ? { key: value.key } : {}),
    motifs: Object.fromEntries(
      Object.entries(value.motifs as Record<string, unknown>).map(
        ([name, line]) => [name, line as string],
      ),
    ),
    ...(Array.isArray(value.harmony)
      ? {
          harmony: (value.harmony as Array<Record<string, unknown>>).map(
            (plan) => ({
              id: plan.id as string,
              chords: (plan.chords as Array<Record<string, unknown>>).map(
                (chord) => ({
                  symbol: chord.symbol as string,
                  beats: chord.beats as number,
                  ...(typeof chord.inversion === "number"
                    ? { inversion: chord.inversion }
                    : {}),
                }),
              ),
            }),
          ),
        }
      : {}),
    voices: (value.voices as Array<Record<string, unknown>>).map((voice) => ({
      id: voice.id as string,
      instrument: voice.instrument as string,
      role: voice.role as VoiceRole,
      ...(typeof voice.part === "string"
        ? { part: voice.part }
        : { realize: voice.realize as RealizationSegment[] }),
      ...(typeof voice.gainDb === "number" ? { gainDb: voice.gainDb } : {}),
      ...(typeof voice.pan === "number" ? { pan: voice.pan } : {}),
    })) as AirVoice[],
    ...(Array.isArray(value.sections)
      ? {
          sections: (value.sections as Array<Record<string, unknown>>).map(
            (section) => ({
              id: section.id as string,
              startBar: section.startBar as number,
              bars: section.bars as number,
            }),
          ),
        }
      : {}),
  };
  return { source, diagnostics };
}

export function stringifyAir(source: AirSource): string {
  return `${JSON.stringify(source, null, 2)}\n`;
}

/** Stable JSON text for content identity and receipts. */
export function canonicalAirJson(source: AirSource): string {
  const sortValue = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sortValue);
    if (!isRecord(value)) return value;
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  };
  return JSON.stringify(sortValue(source));
}
