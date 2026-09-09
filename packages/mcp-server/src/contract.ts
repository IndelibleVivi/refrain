import {
  AIR_FORMAT,
  ARTICULATIONS,
  DYNAMIC_LEVELS,
  MAX_SOURCE_BYTES,
  MAX_VOICES,
  VOICE_ROLES,
} from "@refrain/air-schema";
import {
  MAX_EVENTS,
  MAX_EXPANDED_ATOMS,
  MAX_MOTIF_DEPTH,
  MAX_SCORE_SECONDS,
  midiToNoteName,
} from "@refrain/compiler";
import {
  AIR_V1_FORMAT,
  createAirVocabularyClosure,
} from "@refrain/air-schema/v1";
import {
  BUILT_IN_PERFORMANCE_BINDINGS,
  INSTRUMENTS,
  type InstrumentId,
} from "@refrain/soundpack";
import {
  CORE_AUTHORING_VOCABULARY,
  validateHistoricalPerformanceBindingV1,
  type PerformanceBindingV1,
} from "@refrain/soundpack/vnext";
import { z } from "zod";
import { compactPartDescription } from "./authoring-syntax.js";
import {
  airInputSchemaV1,
  airObjectSchemaV1,
  compiledSummarySchemaV1,
  fromInputSchemaV1,
  parentArtifactInputSchemaV1,
  performanceStatusSchemaV1,
  receiptSchemaV1,
} from "./contract-v1.js";
import { performanceBindingSchema } from "./performance-binding-schema.js";

export { performanceBindingSchema } from "./performance-binding-schema.js";

const instrumentIds = INSTRUMENTS.map((instrument) => instrument.id) as [
  InstrumentId,
  ...InstrumentId[],
];
const instrumentGuide = INSTRUMENTS.map((instrument) => {
  const supported = instrument.supportedNotes
    ? `; supported notes ${instrument.supportedNotes.map((note) => `${midiToNoteName(note)}(${note})`).join(",")}`
    : "";
  return `${instrument.id} ${instrument.midiMin}-${instrument.midiMax}${supported}`;
}).join("; ");
const bindingIds = BUILT_IN_PERFORMANCE_BINDINGS.map(
  (binding) => binding.id,
) as [string, ...string[]];

const motifId = z
  .string()
  .regex(/^[a-z][a-z0-9_-]*$/i)
  .describe("Motif identifier using letters, digits, _ or -.");

const dynamicLevelSchema = z.enum(DYNAMIC_LEVELS);
const chordDegreeSchema = z.union([
  z.literal(1),
  z.literal(3),
  z.literal(5),
  z.literal(7),
  z.literal(9),
]);
const registerSchema = z
  .object({
    min: z.string().regex(/^[A-Ga-g][#b]?-?\d$/),
    max: z.string().regex(/^[A-Ga-g][#b]?-?\d$/),
  })
  .strict()
  .describe("Inclusive authored pitch register such as C3–C5.");
const expressionShape = {
  id: motifId.describe("Stable segment ID, unique within its voice."),
  repeat: z.number().int().min(1).max(16).optional(),
  section: z.string().min(1).max(80).optional(),
  dynamic: dynamicLevelSchema.optional(),
  dynamicCurve: z
    .object({
      from: dynamicLevelSchema,
      via: z
        .array(
          z
            .object({
              at: z.number().gt(0).lt(1),
              level: dynamicLevelSchema,
            })
            .strict(),
        )
        .min(1)
        .max(6)
        .refine(
          (points) =>
            points.every(
              (point, index) => index === 0 || point.at > points[index - 1]!.at,
            ),
          { message: "via points must be in strictly increasing order" },
        )
        .optional(),
      to: dynamicLevelSchema,
    })
    .strict()
    .optional(),
  articulation: z.enum(ARTICULATIONS).optional(),
  gate: z.number().min(0.05).max(1.5).optional(),
  tieToNext: z.boolean().optional(),
};
const motifTransformSchema = z
  .object({
    transpose: z.number().int().min(-24).max(24).optional(),
    stretch: z.number().min(0.25).max(4).optional(),
    inversion: z.boolean().optional(),
    retrograde: z.boolean().optional(),
  })
  .strict();
const realizationSegmentSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...expressionShape,
      kind: z.literal("literal"),
      part: z.string().min(1).max(16_384).describe(compactPartDescription),
    })
    .strict(),
  z
    .object({
      ...expressionShape,
      kind: z.literal("motif"),
      motif: motifId,
      transform: motifTransformSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...expressionShape,
      kind: z.literal("chords"),
      harmony: motifId,
      voicing: z.enum(["close", "open", "drop2"]),
      register: registerSchema,
      rhythm: z.array(z.number().positive().max(16)).min(1).max(32),
      voiceLeading: z.literal("nearest").optional(),
    })
    .strict(),
  z
    .object({
      ...expressionShape,
      kind: z.literal("arpeggio"),
      harmony: motifId,
      degrees: z.array(chordDegreeSchema).min(1).max(32),
      stepBeats: z.number().positive().max(16),
      octaveSpan: z.number().int().min(1).max(4),
      register: registerSchema,
    })
    .strict(),
  z
    .object({
      ...expressionShape,
      kind: z.literal("bass"),
      harmony: motifId,
      degrees: z.array(chordDegreeSchema).min(1).max(32),
      stepBeats: z.number().positive().max(16),
      register: registerSchema,
      slashBass: z.enum(["honor", "ignore"]),
    })
    .strict(),
  z
    .object({
      ...expressionShape,
      kind: z.literal("drum_grid"),
      resolution: z.union([z.literal(8), z.literal(16)]),
      lanes: z
        .array(
          z
            .object({
              note: z.string().regex(/^[A-Ga-g][#b]?-?\d$/),
              pattern: z.string().regex(/^[x.]{1,256}$/),
            })
            .strict(),
        )
        .min(1)
        .max(16),
    })
    .strict(),
  z
    .object({
      ...expressionShape,
      kind: z.literal("rest"),
      beats: z.number().positive().max(1024),
    })
    .strict(),
]);

const voiceBase = {
  id: motifId,
  instrument: z
    .enum(instrumentIds)
    .describe(`Stable instrument IDs and MIDI ranges: ${instrumentGuide}.`),
  role: z.enum(VOICE_ROLES),
  gainDb: z.number().min(-36).max(6).optional(),
  pan: z.number().min(-1).max(1).optional(),
};

export const airObjectSchema = z
  .object({
    format: z.literal(AIR_FORMAT),
    title: z.string().min(1).max(200),
    tempo: z.number().min(30).max(220).describe("Tempo in BPM."),
    meter: z
      .string()
      .regex(/^(?:[1-9]|[1-9]\d)\/(?:1|2|4|8|16)$/)
      .describe(
        "Meter with numerator 1-99 and denominator 1, 2, 4, 8, or 16, such as 4/4, 3/4, or 6/8.",
      ),
    key: z.string().max(80).optional(),
    motifs: z
      .record(motifId, z.string().min(1).max(4096))
      .refine((motifs) => Object.keys(motifs).length <= 64, {
        message: "At most 64 motifs are allowed.",
      })
      .describe(
        "Named reusable part lines. A voice recalls one with @name and may explicitly transpose/stretch it.",
      ),
    harmony: z
      .array(
        z
          .object({
            id: motifId,
            chords: z
              .array(
                z
                  .object({
                    symbol: z
                      .string()
                      .min(1)
                      .max(32)
                      .describe(
                        "Chord symbol: major, m, dim, aug, sus2, sus4, 6, 7, maj7, m7, m7b5, or add9; optional chord-tone slash bass.",
                      ),
                    beats: z.number().positive().max(64),
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
              realize: z.array(realizationSegmentSchema).min(1).max(256),
            })
            .strict(),
        ]),
      )
      .min(1)
      .max(MAX_VOICES)
      .describe(`One to ${MAX_VOICES} voices; every voice id must be unique.`),
    sections: z
      .array(
        z
          .object({
            id: z.string().min(1),
            startBar: z.number().int().min(1),
            bars: z.number().int().min(1),
          })
          .strict(),
      )
      .max(64)
      .describe("Optional named sections; every section id must be unique.")
      .optional(),
  })
  .strict()
  .describe(
    'Complete closed AIR object. Each voice uses exactly one of part or realize. Minimal example: {"format":"air@0-experimental","title":"A small hello","tempo":72,"meter":"4/4","motifs":{"hello":"C4/4 D4/4 E4/4 G4/4"},"voices":[{"id":"lead","instrument":"warm_piano","role":"lead","part":"@hello"}]}.',
  )
  .meta({ id: "RefrainAirV0" });

export const airInputSchema = z
  .union([
    airObjectSchema,
    z
      .string()
      .max(MAX_SOURCE_BYTES)
      .describe(
        "A JSON string containing the same complete strict AIR object.",
      ),
  ])
  .describe(
    "One complete air@0-experimental object, or its JSON string. Do not omit musical decisions for Refrain to invent.",
  );

const sha256Id = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const relationSchema = z.enum([
  "revise",
  "extend",
  "reply",
  "variation",
  "quote",
]);
const lineageSchema = z
  .object({
    relation: relationSchema,
    parentSourceRevision: sha256Id,
    parentReceiptId: sha256Id,
    parentAirId: sha256Id,
  })
  .strict();
const evidenceTransformSchema = z
  .object({
    transpose: z.number().int().min(-24).max(24),
    stretch: z.number().min(0.25).max(4),
    invert: z.boolean(),
    retrograde: z.boolean(),
  })
  .strict();
const motifLinkEvidenceSchema = z
  .object({
    parent: motifId,
    child: motifId,
    parentAnchor: z
      .string()
      .min(1)
      .max(256)
      .describe(
        "Exact parent occurrence anchor from the parent summary: <voiceId>:<segmentId|part>:<occurrence>:<motifId>.",
      ),
    childAnchor: z
      .string()
      .min(1)
      .max(256)
      .describe(
        "Exact deterministic child occurrence anchor derived from its source: <voiceId>:<segmentId|part>:<occurrence>:<motifId>.",
      ),
    transform: evidenceTransformSchema,
  })
  .strict();
const verifiedMotifLinkSchema = motifLinkEvidenceSchema;
const verificationSchema = z
  .object({
    contract: z.literal("musical-relation@0-experimental"),
    status: z.enum(["not_applicable", "declared", "verified"]),
    motifLinks: z.array(verifiedMotifLinkSchema).max(64),
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
export const receiptSchema = z
  .object({
    format: z.literal("refrain-receipt@0-experimental"),
    sourceRevision: sha256Id,
    airId: sha256Id,
    receiptId: sha256Id,
    sourceFormat: z.literal(AIR_FORMAT),
    verification: verificationSchema,
    lineage: lineageSchema.optional(),
  })
  .strict()
  .describe(
    "Complete integrity-verified receipt. verification distinguishes not-applicable, declared lineage, and verified musical evidence.",
  )
  .meta({ id: "RefrainReceiptV0" });

const diagnosticSchema = z
  .object({
    severity: z.enum(["error", "warning", "note"]),
    code: z.string(),
    path: z.string(),
    message: z.string(),
    hint: z.string().optional(),
  })
  .strict();

export const compiledSummarySchema = z
  .object({
    format: z.literal("compiled-air-summary@0-experimental"),
    durationBeats: z.number().nonnegative(),
    durationSeconds: z.number().nonnegative(),
    meter: z.string(),
    tempo: z.number(),
    eventCount: z.number().int().nonnegative(),
    voices: z.array(
      z
        .object({
          voiceId: z.string(),
          role: z.enum(VOICE_ROLES),
          instrument: z.enum(instrumentIds),
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
          anchors: z.array(z.string().min(1)),
        })
        .strict(),
    ),
    authoring: z
      .object({
        literalVoiceCount: z.number().int().nonnegative(),
        realizedVoiceCount: z.number().int().nonnegative(),
        harmonyPlanCount: z.number().int().nonnegative(),
        segmentCount: z.number().int().nonnegative(),
        sectionLabels: z.array(z.string()),
      })
      .strict(),
  })
  .strict()
  .meta({ id: "RefrainSummaryV0" });

const presentationSchema = z.object({ url: z.string().url() }).strict();
export const humSuccessOutputSchema = z
  .object({
    ok: z.literal(true),
    source: airObjectSchema,
    summary: compiledSummarySchema,
    diagnostics: z.array(diagnosticSchema),
    receipt: receiptSchema,
    performanceBinding: performanceBindingSchema,
    caption: z.string().max(1000).optional(),
    presentation: presentationSchema.optional(),
  })
  .strict();
export const humErrorOutputSchema = z
  .object({
    ok: z.literal(false),
    diagnostics: z.array(diagnosticSchema),
  })
  .strict();

export const humInputSchema = {
  air: airInputSchema,
  caption: z
    .string()
    .max(1000)
    .optional()
    .describe("Your own brief caption to the person."),
  performance: z
    .object({
      bindingId: z
        .enum(bindingIds)
        .describe(
          "Exact built-in PerformanceBinding. Omit to use the exact host default advertised in this tool description; an explicit selection always wins.",
        ),
    })
    .strict()
    .optional(),
  from: z
    .object({
      air: airInputSchema.describe("The complete canonical prior AIR source."),
      receipt: receiptSchema,
      relation: relationSchema.describe(
        "Continuation relation. quote and variation require verified motifLinks; extend requires an exact compiled prefix.",
      ),
      expectedSourceRevision: sha256Id.optional(),
      motifLinks: z
        .array(motifLinkEvidenceSchema)
        .min(1)
        .max(64)
        .optional()
        .describe(
          "Strict parent occurrence → child occurrence assertions using exact anchors from compact summaries and an explicit deterministic transform.",
        ),
    })
    .strict()
    .optional(),
};

export const humInputObjectSchema = z.object(humInputSchema).strict();

// Internal result validation; the model-facing schema below still carries Artifact@3.
const currentPerformanceBindingSchema = z.union([
  performanceBindingSchema,
  z.custom<PerformanceBindingV1>(
    (value) => validateHistoricalPerformanceBindingV1(value).length === 0,
    "Invalid exact Binding@1",
  ),
]);

export const humSuccessOutputSchemaV1 = z
  .object({
    ok: z.literal(true),
    source: airObjectSchemaV1,
    summary: compiledSummarySchemaV1,
    diagnostics: z.array(diagnosticSchema),
    receipt: receiptSchemaV1,
    performanceBinding: currentPerformanceBindingSchema.optional(),
    performanceStatus: performanceStatusSchemaV1,
    caption: z.string().max(1000).optional(),
    presentation: presentationSchema.optional(),
  })
  .strict();

export const humAnySuccessOutputSchema = z
  .object({
    ok: z.literal(true),
    source: z.union([airObjectSchemaV1, airObjectSchema]),
    summary: z.union([compiledSummarySchemaV1, compiledSummarySchema]),
    diagnostics: z.array(diagnosticSchema),
    receipt: z.union([receiptSchemaV1, receiptSchema]),
    performanceBinding: currentPerformanceBindingSchema.optional(),
    performanceStatus: performanceStatusSchemaV1.optional(),
    caption: z.string().max(1000).optional(),
    presentation: presentationSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const v1 = value.source.format === "air@1-experimental";
    if (
      v1 !== (value.summary.format === "compiled-air-summary@1-experimental") ||
      v1 !== (value.receipt.format === "refrain-receipt@1-experimental") ||
      v1 !== (value.performanceStatus !== undefined)
    )
      context.addIssue({
        code: "custom",
        message:
          "Source, summary, receipt, and performance status versions must agree.",
      });
    if (
      !v1 &&
      !performanceBindingSchema.safeParse(value.performanceBinding).success
    )
      context.addIssue({
        code: "custom",
        message:
          "Historical AIR@0 success requires its exact PerformanceBinding.",
      });
  });

export const performanceBindingIdentitySchema = performanceBindingSchema.pick({
  format: true,
  id: true,
  contentSha256: true,
  renderer: true,
});

const artifactModelOutputSchemaV1 = z
  .object({
    format: z.literal("refrain-artifact@3-experimental"),
    source: z
      .object({ format: z.literal(AIR_V1_FORMAT) })
      .passthrough()
      .describe("The complete canonical AIR@1 source."),
    receipt: z
      .object({
        format: z.literal("refrain-receipt@1-experimental"),
        sourceRevision: sha256Id,
        airId: sha256Id,
        receiptId: sha256Id,
        sourceFormat: z.literal(AIR_V1_FORMAT),
      })
      .passthrough()
      .describe("The complete verified AIR@1 receipt."),
    performanceBindings: z.array(z.unknown()).max(16),
    defaultBindingId: z.string().min(1).max(200).optional(),
    renderReceipts: z.array(z.unknown()).max(256).optional(),
    projections: z.array(z.unknown()).max(256).optional(),
    caption: z.string().max(1000).optional(),
  })
  .passthrough()
  .describe(
    "One exact Artifact@3 continuation authority. The tool returns the complete artifact; this compact output envelope names its stable routing and identity fields while from.parentArtifact validates the full object unchanged.",
  )
  .meta({ id: "RefrainArtifactV3OutputEnvelope" });

export const humAnyModelSuccessOutputSchema = z
  .object({
    ok: z.literal(true),
    artifact: artifactModelOutputSchemaV1.optional(),
    source: airObjectSchema.optional(),
    summary: z.union([compiledSummarySchemaV1, compiledSummarySchema]),
    diagnostics: z.array(diagnosticSchema),
    receipt: receiptSchema.optional(),
    performanceBinding: performanceBindingIdentitySchema.optional(),
    performanceStatus: performanceStatusSchemaV1.optional(),
    caption: z.string().max(1000).optional(),
    presentation: presentationSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const current = value.artifact !== undefined;
    if (
      current !==
        (value.summary.format === "compiled-air-summary@1-experimental") ||
      current !== (value.performanceStatus !== undefined)
    )
      context.addIssue({
        code: "custom",
        message:
          "Artifact@3, AIR@1 summary, and performance status must travel together.",
      });
    if (
      current &&
      (value.source !== undefined ||
        value.receipt !== undefined ||
        value.performanceBinding !== undefined)
    )
      context.addIssue({
        code: "custom",
        message:
          "AIR@1 model output carries source, receipt, and binding only through its exact Artifact@3 authority.",
      });
    if (
      !current &&
      (value.source === undefined ||
        value.receipt === undefined ||
        value.performanceBinding === undefined)
    )
      context.addIssue({
        code: "custom",
        message:
          "Historical AIR@0 output requires source, receipt, and binding identity.",
      });
  });

export const humAnyInputSchema = {
  air: z
    .union([airInputSchemaV1, airInputSchema])
    .describe(
      "One complete AIR@1 source (current authoring contract) or an exact historical AIR@0 source.",
    ),
  caption: humInputSchema.caption,
  performance: z
    .object({
      bindingId: z
        .string()
        .min(1)
        .max(200)
        .regex(/^[a-z0-9][a-z0-9_.@-]*$/)
        .describe(
          "Exact built-in or parent-carried binding ID. Carried identities win within their parent artifact. Omit to inherit the parent's exact selected sound, including an unbound parent; only new roots use the advertised host default.",
        ),
    })
    .strict()
    .optional(),
  from: z.union([humInputSchema.from.unwrap(), fromInputSchemaV1]).optional(),
};

export const humAnyInputObjectSchema = z.object(humAnyInputSchema).strict();

export const arrangedAirExample = {
  format: AIR_FORMAT,
  title: "An arranged hello",
  tempo: 76,
  meter: "4/4",
  motifs: { hello: "D5/4 F5/4 A5/4 G5/4" },
  harmony: [
    {
      id: "hello_changes",
      chords: [
        { symbol: "Dm7", beats: 2 },
        { symbol: "Bbmaj7", beats: 2 },
      ],
    },
  ],
  voices: [
    {
      id: "lead",
      instrument: "flute",
      role: "lead",
      realize: [
        {
          id: "hello_phrase",
          kind: "motif",
          motif: "hello",
          dynamicCurve: { from: "p", to: "mf" },
          articulation: "legato",
          section: "A",
        },
      ],
    },
    {
      id: "piano",
      instrument: "warm_piano",
      role: "harmony",
      realize: [
        {
          id: "hello_chords",
          kind: "chords",
          harmony: "hello_changes",
          voicing: "close",
          register: { min: "C3", max: "C5" },
          rhythm: [2],
          voiceLeading: "nearest",
          dynamic: "mp",
        },
      ],
    },
  ],
} as const;

const minimalAirV1Instrument = CORE_AUTHORING_VOCABULARY.instruments.find(
  (instrument) => instrument.id === "lattice_pluck",
)!;

export const minimalAirV1Example = {
  format: AIR_V1_FORMAT,
  title: "A small hello",
  conductor: {
    tempo: 72,
    meters: [{ bar: 1, meter: "4/4" }],
  },
  vocabulary: createAirVocabularyClosure({
    id: "refrain-minimal-lattice-pluck@1",
    instruments: [
      {
        id: minimalAirV1Instrument.id,
        label: minimalAirV1Instrument.label,
        family: minimalAirV1Instrument.family,
        midiMin: minimalAirV1Instrument.midiMin,
        midiMax: minimalAirV1Instrument.midiMax,
        status: minimalAirV1Instrument.status,
        authoringMeaning: minimalAirV1Instrument.authoringMeaning,
        ...(minimalAirV1Instrument.supportedNotes === undefined
          ? {}
          : {
              supportedNotes: Array.from(minimalAirV1Instrument.supportedNotes),
            }),
      },
    ],
    techniques: [],
  }),
  motifs: { hello: "C4/4 D4/4 E4/4 G4/4" },
  voices: [
    {
      id: "lead",
      instrument: "lattice_pluck",
      role: "lead",
      part: "@hello | @hello(-2,1)",
    },
  ],
  sections: [{ id: "whole", startBar: 1, bars: 2 }],
} as const;

export const authoringCard = [
  "Write every new musical root as one complete strict air@1-experimental object; Refrain validates and renders but does not compose missing material. Use air@0-experimental only when preserving or continuing an exact historical AIR@0 source, never as a shortcut for new work.",
  "AIR@1 conductor carries tempo, pickup, and an ordered per-bar meter map. Exact reduced rationals carry duration, tuplet, groove, and time-scale values.",
  "AIR@1 phrases are non-recursive reusable segment sequences. Portable techniques and instruments must arrive in the carried vocabulary closure; missing definitions never resolve by name or hidden arranging behavior.",
  "AIR@1 relation evidence may verify motif transformation, orchestration, recurrence, section contrast, and meaningful absence. Optional embodiment lineage is separate and never substitutes for musical relation evidence.",
  compactPartDescription,
  `Voice roles: ${VOICE_ROLES.join(", ")}.`,
  `Instrument MIDI ranges: ${instrumentGuide}.`,
  `Exact performance bindings: ${bindingIds.join(", ")}. An AIR@1 result returns one exact Artifact@3 as its source, receipt, and binding authority; historical AIR@0 keeps its compact binding identity. Changing the binding does not change musical identity.`,
  `Whole-air limits: ${MAX_SCORE_SECONDS} seconds, ${MAX_VOICES} voices, ${MAX_EVENTS} notes, ${MAX_EXPANDED_ATOMS} expanded atoms, motif nesting depth ${MAX_MOTIF_DEPTH}.`,
  "A voice uses exactly one of literal part or realize. realize supports literal, motif, chords, arpeggio, bass, drum_grid, and rest with stable IDs, repeat/section, dynamics, articulation, gate, and tieToNext.",
  "Harmony symbols: major, m, dim, aug, sus2, sus4, 6, 7, maj7, m7, m7b5, add9, inversion, and chord-tone slash bass.",
  "quote/variation need motifLinks evidence; extend must preserve the complete compiled parent schedule as an exact prefix.",
  "For AIR@1 continuation, pass the prior result artifact unchanged as from.parentArtifact; do not manually reconstruct source, receipt, or binding authority.",
  `Minimal current AIR@1: ${JSON.stringify(minimalAirV1Example)}.`,
].join(" ");
