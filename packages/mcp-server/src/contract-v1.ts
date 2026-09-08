import {
  AIR_V1_FORMAT,
  AIR_VOCABULARY_FORMAT,
  airVocabularyContentSha256,
  parseAirV1,
} from "@refrain/air-schema/v1";
import {
  ARTICULATIONS,
  DYNAMIC_LEVELS,
  MAX_BARS,
  MAX_SOURCE_BYTES,
  MAX_VOICES,
  VOICE_ROLES,
} from "@refrain/air-schema";
import { z } from "zod";
import { parseRefrainArtifact } from "@refrain/renderer/portable";
import { compactPartDescription } from "./authoring-syntax.js";
import { performanceBindingSchema } from "./performance-binding-schema.js";

const motifId = z.string().regex(/^[a-z][a-z0-9_-]*$/i);
const moduleId = z.string().regex(/^[a-z0-9][a-z0-9_.@-]*$/);
const sha256Id = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const dynamic = z.enum(DYNAMIC_LEVELS);
const note = z.string().regex(/^[A-Ga-g][#b]?-?\d$/);
const gcd = (left: number, right: number): number => {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) [a, b] = [b, a % b];
  return a || 1;
};

export const rationalSchemaV1 = z
  .object({
    numerator: z.number().int().min(-65_536).max(65_536),
    denominator: z.number().int().min(1).max(96),
  })
  .strict()
  .superRefine((value, context) => {
    if (gcd(value.numerator, value.denominator) !== 1)
      context.addIssue({
        code: "custom",
        message: "Rationals must be reduced to one canonical representation.",
      });
    if (value.numerator === 0 && value.denominator !== 1)
      context.addIssue({ code: "custom", message: "Zero must be 0/1." });
  })
  .meta({ id: "RefrainRationalV1" });

const positiveRational = rationalSchemaV1.refine(
  (value) => value.numerator > 0,
  {
    message: "This rational must be positive.",
  },
);
const boundedTechniqueFactor = positiveRational
  .refine((value) => value.numerator / value.denominator <= 4, {
    message: "Technique scale factors cannot exceed 4.",
  })
  .describe("A reduced positive rational no greater than 4.");
const nonnegativeRational = rationalSchemaV1.refine(
  (value) => value.numerator >= 0,
  { message: "This rational cannot be negative." },
);
const register = z.object({ min: note, max: note }).strict();
const dynamicCurve = z
  .object({
    from: dynamic,
    via: z
      .array(z.object({ at: z.number().gt(0).lt(1), level: dynamic }).strict())
      .min(1)
      .max(6)
      .optional(),
    to: dynamic,
  })
  .strict()
  .superRefine((value, context) => {
    let previous = 0;
    value.via?.forEach((point, index) => {
      if (point.at <= previous)
        context.addIssue({
          code: "custom",
          path: ["via", index, "at"],
          message: "Dynamic-curve through points must strictly increase.",
        });
      previous = point.at;
    });
  });
const tuplet = z
  .object({
    notes: z.number().int().min(2).max(16),
    inTimeOf: z.number().int().min(1).max(16),
  })
  .strict()
  .refine((value) => value.notes !== value.inTimeOf, {
    message: "Tuplet notes and inTimeOf must differ.",
  });

const segmentKinds = [
  "literal",
  "motif",
  "chords",
  "arpeggio",
  "bass",
  "drum_grid",
  "rest",
  "phrase",
] as const;
const techniqueOperation = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("transpose"),
      semitones: z.number().int().min(-24).max(24),
    })
    .strict(),
  z
    .object({ type: z.literal("time-scale"), factor: boundedTechniqueFactor })
    .strict(),
  z
    .object({
      type: z.literal("velocity-scale"),
      factor: boundedTechniqueFactor,
    })
    .strict(),
  z
    .object({ type: z.literal("gate-scale"), factor: boundedTechniqueFactor })
    .strict(),
  z.object({ type: z.literal("invert") }).strict(),
  z.object({ type: z.literal("retrograde") }).strict(),
  z
    .object({
      type: z.literal("rotate"),
      steps: z
        .number()
        .int()
        .min(-64)
        .max(64)
        .refine((value) => value !== 0),
    })
    .strict(),
  z
    .object({
      type: z.literal("thin"),
      every: z.number().int().min(2).max(16),
      offset: z.number().int().min(0).max(15),
    })
    .strict()
    .refine((value) => value.offset < value.every, {
      path: ["offset"],
      message: "thin.offset must select one position in the cycle.",
    }),
]);

export const airVocabularySchemaV1 = z
  .object({
    format: z.literal(AIR_VOCABULARY_FORMAT),
    id: moduleId,
    contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
    instruments: z
      .array(
        z
          .object({
            id: moduleId,
            label: z.string().min(1).max(120),
            family: z.enum(["pitched", "percussion", "texture"]),
            midiMin: z.number().int().min(0).max(127),
            midiMax: z.number().int().min(0).max(127),
            status: z.enum(["active", "deprecated"]),
            supportedNotes: z
              .array(z.number().int().min(0).max(127))
              .optional(),
            authoringMeaning: z.string().min(1).max(500),
          })
          .strict(),
      )
      .min(1)
      .max(128),
    techniques: z
      .array(
        z
          .object({
            id: motifId,
            label: z.string().min(1).max(120),
            appliesTo: z
              .array(z.enum(segmentKinds))
              .min(1)
              .max(segmentKinds.length),
            operations: z.array(techniqueOperation).min(1).max(8),
          })
          .strict(),
      )
      .max(128),
  })
  .strict()
  .superRefine((value, context) => {
    const instrumentIds = value.instruments.map((instrument) => instrument.id);
    const techniqueIds = value.techniques.map((technique) => technique.id);
    if (new Set(instrumentIds).size !== instrumentIds.length)
      context.addIssue({
        code: "custom",
        path: ["instruments"],
        message: "Instrument IDs must be unique.",
      });
    if (new Set(techniqueIds).size !== techniqueIds.length)
      context.addIssue({
        code: "custom",
        path: ["techniques"],
        message: "Technique IDs must be unique.",
      });
    value.instruments.forEach((instrument, index) => {
      if (instrument.midiMin > instrument.midiMax)
        context.addIssue({
          code: "custom",
          path: ["instruments", index],
          message: "Instrument MIDI range is invalid.",
        });
      if (
        instrument.supportedNotes &&
        new Set(instrument.supportedNotes).size !==
          instrument.supportedNotes.length
      )
        context.addIssue({
          code: "custom",
          path: ["instruments", index, "supportedNotes"],
          message: "supportedNotes must contain unique MIDI integers.",
        });
    });
    if (value.contentSha256 !== airVocabularyContentSha256(value))
      context.addIssue({
        code: "custom",
        path: ["contentSha256"],
        message: "Vocabulary content SHA-256 does not match its definitions.",
      });
  })
  .describe(
    "The exact carried authoring vocabulary closure. Pack instruments and portable techniques must be present here; the runtime never resolves missing definitions by name.",
  )
  .meta({ id: "RefrainAuthoringVocabularyV1" });

const expression = {
  id: motifId,
  repeat: z.number().int().min(1).max(16).optional(),
  section: z.string().min(1).max(80).optional(),
  dynamic: dynamic.optional(),
  dynamicCurve: dynamicCurve.optional(),
  articulation: z.enum(ARTICULATIONS).optional(),
  gate: z.number().min(0.05).max(1.5).optional(),
  tieToNext: z.boolean().optional(),
  techniques: z.array(motifId).min(1).max(8).optional(),
  groove: motifId.optional(),
  tuplet: tuplet.optional(),
};
const transform = z
  .object({
    transpose: z.number().int().min(-24).max(24).optional(),
    timeScale: positiveRational.optional(),
    inversion: z.boolean().optional(),
    retrograde: z.boolean().optional(),
  })
  .strict();
const degree = z.union([
  z.literal(1),
  z.literal(3),
  z.literal(5),
  z.literal(7),
  z.literal(9),
]);
const literalSegment = z
  .object({
    ...expression,
    kind: z.literal("literal"),
    part: z.string().min(1).max(16_384).describe(compactPartDescription),
  })
  .strict();
const motifSegment = z
  .object({
    ...expression,
    kind: z.literal("motif"),
    motif: motifId,
    transform: transform.optional(),
  })
  .strict();
const chordsSegment = z
  .object({
    ...expression,
    kind: z.literal("chords"),
    harmony: motifId,
    voicing: z.enum(["close", "open", "drop2"]),
    register,
    rhythm: z.array(positiveRational).min(1).max(32),
    voiceLeading: z.literal("nearest").optional(),
  })
  .strict();
const arpeggioSegment = z
  .object({
    ...expression,
    kind: z.literal("arpeggio"),
    harmony: motifId,
    degrees: z.array(degree).min(1).max(32),
    step: positiveRational,
    octaveSpan: z.number().int().min(1).max(4),
    register,
  })
  .strict();
const bassSegment = z
  .object({
    ...expression,
    kind: z.literal("bass"),
    harmony: motifId,
    degrees: z.array(degree).min(1).max(32),
    step: positiveRational,
    register,
    slashBass: z.enum(["honor", "ignore"]),
  })
  .strict();
const drumSegment = z
  .object({
    ...expression,
    kind: z.literal("drum_grid"),
    resolution: z.union([z.literal(8), z.literal(16)]),
    lanes: z
      .array(
        z.object({ note, pattern: z.string().regex(/^[x.]{1,256}$/) }).strict(),
      )
      .min(1)
      .max(16),
  })
  .strict()
  .superRefine((value, context) => {
    const length = value.lanes[0]?.pattern.length;
    value.lanes.forEach((lane, index) => {
      if (lane.pattern.length !== length)
        context.addIssue({
          code: "custom",
          path: ["lanes", index, "pattern"],
          message: "All drum-grid lane patterns must have equal length.",
        });
    });
  });
const restSegment = z
  .object({
    ...expression,
    kind: z.literal("rest"),
    duration: positiveRational,
  })
  .strict();
const phraseSegment = z
  .object({
    ...expression,
    kind: z.literal("phrase"),
    phrase: motifId,
    transform: transform.optional(),
  })
  .strict();
const phraseBodySegment = z.discriminatedUnion("kind", [
  literalSegment,
  motifSegment,
  chordsSegment,
  arpeggioSegment,
  bassSegment,
  drumSegment,
  restSegment,
]);
const realizationSegment = z.discriminatedUnion("kind", [
  literalSegment,
  motifSegment,
  chordsSegment,
  arpeggioSegment,
  bassSegment,
  drumSegment,
  restSegment,
  phraseSegment,
]);

const voiceBase = {
  id: motifId,
  instrument: moduleId,
  role: z.enum(VOICE_ROLES),
  gainDb: z.number().min(-36).max(6).optional(),
  pan: z.number().min(-1).max(1).optional(),
};

export const airObjectSchemaV1 = z
  .object({
    format: z.literal(AIR_V1_FORMAT),
    title: z.string().min(1).max(200),
    conductor: z
      .object({
        tempo: z.number().min(30).max(220),
        meters: z
          .array(
            z
              .object({
                bar: z
                  .number()
                  .int()
                  .min(1)
                  .max(MAX_BARS + 1),
                meter: z.string().regex(/^(?:[1-9]|[1-9]\d)\/(?:1|2|4|8|16)$/),
              })
              .strict(),
          )
          .min(1)
          .max(64)
          .superRefine((meters, context) => {
            let previous = 0;
            meters.forEach((entry, index) => {
              if ((index === 0 && entry.bar !== 1) || entry.bar <= previous)
                context.addIssue({
                  code: "custom",
                  path: [index, "bar"],
                  message: "Meter bars must begin at 1 and strictly increase.",
                });
              previous = entry.bar;
            });
          }),
        pickup: positiveRational.optional(),
      })
      .strict(),
    key: z.string().max(80).optional(),
    vocabulary: airVocabularySchemaV1,
    motifs: z
      .record(motifId, z.string().min(1).max(4096))
      .describe(
        "Reusable compact parts keyed by motif ID. " + compactPartDescription,
      ),
    grooves: z
      .array(
        z
          .object({
            id: motifId,
            cycle: positiveRational,
            steps: z
              .array(
                z
                  .object({
                    at: nonnegativeRational,
                    offset: rationalSchemaV1,
                    velocityScale: positiveRational.optional(),
                  })
                  .strict(),
              )
              .min(1)
              .max(32),
          })
          .strict(),
      )
      .min(1)
      .max(32)
      .optional(),
    harmony: z
      .array(
        z
          .object({
            id: motifId,
            chords: z
              .array(
                z
                  .object({
                    symbol: z.string().min(1).max(32),
                    duration: positiveRational,
                    inversion: z.number().int().min(0).max(5).optional(),
                  })
                  .strict(),
              )
              .min(1)
              .max(256),
          })
          .strict(),
      )
      .min(1)
      .max(64)
      .optional(),
    phrases: z
      .array(
        z
          .object({
            id: motifId,
            segments: z.array(phraseBodySegment).min(1).max(64),
          })
          .strict(),
      )
      .min(1)
      .max(64)
      .optional(),
    voices: z
      .array(
        z.union([
          z
            .object({
              ...voiceBase,
              part: z
                .string()
                .min(1)
                .max(16_384)
                .describe(compactPartDescription),
            })
            .strict(),
          z
            .object({
              ...voiceBase,
              realize: z.array(realizationSegment).min(1).max(256),
            })
            .strict(),
        ]),
      )
      .min(1)
      .max(MAX_VOICES),
    sections: z
      .array(
        z
          .object({
            id: motifId,
            startBar: z.number().int().min(1).max(MAX_BARS),
            bars: z.number().int().min(1).max(MAX_BARS),
          })
          .strict(),
      )
      .max(64)
      .superRefine((sections, context) => {
        sections.forEach((section, index) => {
          if (section.startBar + section.bars - 1 > MAX_BARS)
            context.addIssue({
              code: "custom",
              path: [index, "bars"],
              message: `Sections must end by bar ${MAX_BARS}.`,
            });
        });
      })
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    for (const diagnostic of parseAirV1(value).diagnostics)
      if (diagnostic.severity === "error")
        context.addIssue({
          code: "custom",
          message: `${diagnostic.path}: ${diagnostic.message}`,
        });
  })
  .describe(
    "One complete strict air@1-experimental source. The host authors the music; Refrain expands only explicit phrases, tuplets, transforms, grooves, and carried portable techniques.",
  )
  .meta({ id: "RefrainAirV1" });

export const airInputSchemaV1 = z.union([
  airObjectSchemaV1,
  z
    .string()
    .max(MAX_SOURCE_BYTES)
    .describe("JSON text containing the complete AIR@1 object."),
]);

const relation = z.enum(["revise", "extend", "reply", "variation", "quote"]);
const lineage = z
  .object({
    relation,
    parentSourceRevision: sha256Id,
    parentReceiptId: sha256Id,
    parentAirId: sha256Id,
  })
  .strict();
const motifTransformEvidence = z
  .object({
    transpose: z.number().int().min(-24).max(24),
    stretch: z.number().min(0.01).max(16),
    invert: z.boolean(),
    retrograde: z.boolean(),
  })
  .strict();
const motifLink = z
  .object({
    parent: motifId,
    child: motifId,
    parentAnchor: z.string().min(1).max(256),
    childAnchor: z.string().min(1).max(256),
    transform: motifTransformEvidence,
  })
  .strict();
const orchestrationLink = z
  .object({
    parentAnchor: z.string().min(1).max(256),
    childAnchor: z.string().min(1).max(256),
    parentVoiceId: motifId,
    childVoiceId: motifId,
    parentInstrument: moduleId,
    childInstrument: moduleId,
  })
  .strict();
const recurrence = z
  .object({
    motif: motifId,
    parentCount: z.number().int().nonnegative(),
    childCount: z.number().int().positive(),
  })
  .strict();
const contrast = z
  .object({
    parentSection: motifId,
    childSection: motifId,
    dimensions: z
      .array(z.enum(["register", "density", "instrumentation"]))
      .min(1)
      .max(3),
  })
  .strict()
  .refine(
    (value) => new Set(value.dimensions).size === value.dimensions.length,
    {
      path: ["dimensions"],
      message: "Contrast dimensions must be unique.",
    },
  );
const absence = z
  .object({
    motif: motifId,
    parentAnchor: z.string().min(1).max(256),
    childSection: motifId,
  })
  .strict();
const verificationV1 = z
  .object({
    contract: z.literal("musical-relation@1-experimental"),
    status: z.enum(["not_applicable", "declared", "verified"]),
    motifLinks: z.array(motifLink).max(64),
    orchestrationLinks: z.array(orchestrationLink).max(64),
    recurrences: z.array(recurrence).max(64),
    contrasts: z.array(contrast).max(64),
    absences: z.array(absence).max(64),
    prefix: z
      .object({
        parentEventCount: z.number().int().nonnegative(),
        childEventCount: z.number().int().nonnegative(),
        parentDurationBeats: z.number().nonnegative(),
        childDurationBeats: z.number().nonnegative(),
      })
      .strict()
      .optional(),
    evidenceId: sha256Id.optional(),
  })
  .strict();
const embodiment = z
  .object({
    contract: z.literal("refrain-embodiment-lineage@0-experimental"),
    parentPerformanceBindingDigest: sha256Id,
    childPerformanceBindingDigest: sha256Id,
    instrumentMap: z
      .array(
        z
          .object({ parentInstrument: moduleId, childInstrument: moduleId })
          .strict(),
      )
      .min(1)
      .max(128),
    evidenceId: sha256Id,
  })
  .strict();

export const receiptSchemaV1 = z
  .object({
    format: z.literal("refrain-receipt@1-experimental"),
    sourceRevision: sha256Id,
    airId: sha256Id,
    receiptId: sha256Id,
    sourceFormat: z.literal(AIR_V1_FORMAT),
    verification: verificationV1,
    lineage: lineage.optional(),
    embodiment: embodiment.optional(),
  })
  .strict()
  .meta({ id: "RefrainReceiptV1" });

export const relationEvidenceInputSchemaV1 = z
  .object({
    motifLinks: z.array(motifLink).min(1).max(64).optional(),
    orchestrationLinks: z.array(orchestrationLink).min(1).max(64).optional(),
    recurrences: z
      .array(
        z
          .object({
            motif: motifId,
            minimumChildCount: z.number().int().min(1),
          })
          .strict(),
      )
      .min(1)
      .max(64)
      .optional(),
    contrasts: z.array(contrast).min(1).max(64).optional(),
    absences: z.array(absence).min(1).max(64).optional(),
  })
  .strict()
  .describe(
    "Explicit relation assertions. Refrain verifies them against compiled motif transformation, orchestration, recurrence, section contrast, and meaningful absence evidence.",
  );

export const parentArtifactInputSchemaV1 = z
  .object({
    format: z.literal("refrain-artifact@3-experimental"),
    source: airObjectSchemaV1,
    receipt: receiptSchemaV1,
    performanceBindings: z.array(z.unknown()).max(16),
    defaultBindingId: z.string().min(1).max(200).optional(),
    renderReceipts: z.array(z.object({}).passthrough()).max(256).optional(),
    projections: z.array(z.object({}).passthrough()).max(256).optional(),
    caption: z.string().max(1000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const parsed = parseRefrainArtifact(value);
    if (!parsed.ok)
      for (const error of parsed.errors)
        context.addIssue({ code: "custom", message: error });
  })
  .describe(
    "The exact parent Artifact@3 returned by a prior hum result. Pass it unchanged; Refrain derives and cross-verifies parent source, receipt, and binding authority.",
  )
  .meta({ id: "RefrainArtifactV3Input" });

const fromAuthorityFieldsV1 = {
  relation,
  expectedSourceRevision: sha256Id.optional(),
  evidence: relationEvidenceInputSchemaV1.optional(),
};

const legacyFromInputSchemaV1 = z
  .object({
    air: airInputSchemaV1,
    receipt: receiptSchemaV1,
    ...fromAuthorityFieldsV1,
    embodiment: z
      .object({
        parentPerformanceBinding: performanceBindingSchema,
        childPerformanceBinding: performanceBindingSchema,
        instrumentMap: z
          .array(
            z
              .object({ parentInstrument: moduleId, childInstrument: moduleId })
              .strict(),
          )
          .min(1)
          .max(128),
      })
      .strict()
      .optional(),
  })
  .strict();

const artifactFromInputSchemaV1 = z
  .object({
    parentArtifact: parentArtifactInputSchemaV1,
    ...fromAuthorityFieldsV1,
    embodiment: z
      .object({
        instrumentMap: z
          .array(
            z
              .object({ parentInstrument: moduleId, childInstrument: moduleId })
              .strict(),
          )
          .min(1)
          .max(128),
      })
      .strict()
      .optional(),
  })
  .strict();

export const fromInputSchemaV1 = z
  .union([artifactFromInputSchemaV1, legacyFromInputSchemaV1])
  .describe(
    "Prefer parentArtifact as one exact continuation authority. The explicit source/receipt form remains accepted for existing clients.",
  );

export const compiledSummarySchemaV1 = z
  .object({
    format: z.literal("compiled-air-summary@1-experimental"),
    durationBeats: z.number().nonnegative(),
    durationSeconds: z.number().nonnegative(),
    tempo: z.number(),
    pickupBeats: z.number().nonnegative(),
    meters: z.array(
      z
        .object({
          bar: z.number().int().min(1),
          meter: z.string(),
          startBeat: z.number().nonnegative(),
        })
        .strict(),
    ),
    eventCount: z.number().int().nonnegative(),
    voices: z.array(
      z
        .object({
          voiceId: z.string(),
          role: z.enum(VOICE_ROLES),
          instrument: z.string(),
          eventCount: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    motifOccurrences: z.array(
      z
        .object({
          motif: z.string(),
          count: z.number().int().positive(),
          voiceIds: z.array(z.string()),
          anchors: z.array(z.string()),
        })
        .strict(),
    ),
    phraseOccurrences: z.array(
      z
        .object({
          phrase: z.string(),
          count: z.number().int().positive(),
          voiceIds: z.array(z.string()),
          anchors: z.array(z.string()),
        })
        .strict(),
    ),
    authoring: z
      .object({
        literalVoiceCount: z.number().int().nonnegative(),
        realizedVoiceCount: z.number().int().nonnegative(),
        harmonyPlanCount: z.number().int().nonnegative(),
        phraseDefinitionCount: z.number().int().nonnegative(),
        grooveDefinitionCount: z.number().int().nonnegative(),
        segmentCount: z.number().int().nonnegative(),
        techniqueIds: z.array(z.string()),
        grooveIds: z.array(z.string()),
        sectionLabels: z.array(z.string()),
        vocabularyId: z.string(),
      })
      .strict(),
  })
  .strict()
  .meta({ id: "RefrainSummaryV1" });

export const performanceStatusSchemaV1 = z
  .union([
    z.object({ status: z.literal("available") }).strict(),
    z
      .object({
        status: z.literal("unavailable"),
        reason: z.string(),
        message: z.string(),
        errors: z.array(z.string()),
      })
      .strict(),
  ])
  .meta({ id: "RefrainPerformanceStatusV1" });
