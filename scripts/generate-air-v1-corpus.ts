import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { format as formatWithPrettier } from "prettier";
import {
  AIR_V1_FORMAT,
  createAirVocabularyClosure,
  stringifyAirV1,
  type AirSourceV1,
} from "@refrain/air-schema/v1";
import { compileAirV1 } from "@refrain/compiler/v1";
import {
  CORE_AUTHORING_VOCABULARY,
  createExtensionPackV1,
} from "@refrain/soundpack/vnext";

const outputRoot = resolve("fixtures/air-v1");

async function formatFixtureJson(value: string): Promise<string> {
  return formatWithPrettier(value, { parser: "json" });
}

const instruments = CORE_AUTHORING_VOCABULARY.instruments.map((instrument) => ({
  id: instrument.id,
  label: instrument.label,
  family: instrument.family,
  midiMin: instrument.midiMin,
  midiMax: instrument.midiMax,
  status: instrument.status,
  authoringMeaning: instrument.authoringMeaning,
  ...(instrument.supportedNotes === undefined
    ? {}
    : { supportedNotes: Array.from(instrument.supportedNotes) }),
}));

const coreVocabulary = createAirVocabularyClosure({
  id: "refrain-core-language@1",
  instruments,
  techniques: [
    {
      id: "ghost_return",
      label: "Ghost return",
      appliesTo: ["motif", "phrase"],
      operations: [
        {
          type: "velocity-scale",
          factor: { numerator: 2, denominator: 3 },
        },
        {
          type: "gate-scale",
          factor: { numerator: 3, denominator: 4 },
        },
      ],
    },
    {
      id: "hocket_even",
      label: "Hocket even atoms",
      appliesTo: ["literal", "motif", "phrase"],
      operations: [{ type: "thin", every: 2, offset: 0 }],
    },
    {
      id: "turn_once",
      label: "Turn once",
      appliesTo: ["literal", "motif", "phrase"],
      operations: [{ type: "rotate", steps: 1 }],
    },
  ],
});

const packVocabulary = createAirVocabularyClosure({
  id: "prismatic-voice-language@1",
  instruments: [
    ...instruments,
    {
      id: "prismatic_voice",
      label: "Prismatic voice",
      family: "pitched",
      midiMin: 48,
      midiMax: 96,
      status: "active",
      authoringMeaning:
        "A carried extension identity for clear, refracted phrase handoffs.",
    },
  ],
  techniques: coreVocabulary.techniques,
});

const prismaticVoicePack = createExtensionPackV1({
  id: "prismatic-voice-kit@1",
  version: "1.0.0",
  label: "Prismatic voice authoring kit",
  modules: [
    {
      kind: "authoring-vocabulary",
      id: packVocabulary.id,
      sha256: packVocabulary.contentSha256,
    },
  ],
  assets: [],
});

const corpus: Array<{
  filename: string;
  perspective: string;
  density: "sparse" | "medium" | "dense";
  features: string[];
  source: AirSourceV1;
}> = [
  {
    filename: "crooked-return.air.json",
    perspective: "crooked chamber return",
    density: "sparse",
    features: [
      "pickup",
      "5/8-to-7/8",
      "tuplet",
      "groove",
      "phrase-reuse",
      "portable-technique",
    ],
    source: {
      format: AIR_V1_FORMAT,
      title: "Five, five, seven",
      conductor: {
        tempo: 90,
        pickup: { numerator: 1, denominator: 2 },
        meters: [
          { bar: 1, meter: "5/8" },
          { bar: 3, meter: "7/8" },
        ],
      },
      key: "D minor",
      vocabulary: coreVocabulary,
      motifs: { seed: "D4/8 F4/8 A4/8" },
      grooves: [
        {
          id: "held_second",
          cycle: { numerator: 1, denominator: 1 },
          steps: [
            {
              at: { numerator: 0, denominator: 1 },
              offset: { numerator: 0, denominator: 1 },
            },
            {
              at: { numerator: 1, denominator: 3 },
              offset: { numerator: 1, denominator: 12 },
              velocityScale: { numerator: 9, denominator: 10 },
            },
          ],
        },
      ],
      phrases: [
        {
          id: "answer",
          segments: [
            {
              id: "triplet",
              kind: "motif",
              motif: "seed",
              tuplet: { notes: 3, inTimeOf: 2 },
            },
            {
              id: "breath",
              kind: "rest",
              duration: { numerator: 1, denominator: 2 },
            },
          ],
        },
      ],
      voices: [
        {
          id: "piano",
          instrument: "warm_piano",
          role: "lead",
          realize: [
            { id: "pickup", kind: "literal", part: "D4/8" },
            {
              id: "answers",
              kind: "phrase",
              phrase: "answer",
              repeat: 4,
              techniques: ["ghost_return"],
              groove: "held_second",
              transform: { transpose: 2 },
            },
            {
              id: "tail",
              kind: "rest",
              duration: { numerator: 5, denominator: 2 },
            },
          ],
        },
      ],
      sections: [
        { id: "five", startBar: 1, bars: 2 },
        { id: "seven", startBar: 3, bars: 1 },
      ],
    },
  },
  {
    filename: "paper-waltz.air.json",
    perspective: "sparse relational waltz",
    density: "sparse",
    features: ["3/4", "phrase-reuse", "meaningful-rests", "technique"],
    source: {
      format: AIR_V1_FORMAT,
      title: "A place kept at the table",
      conductor: { tempo: 66, meters: [{ bar: 1, meter: "3/4" }] },
      vocabulary: coreVocabulary,
      motifs: { turn: "A4/4 C5/4 E5/4" },
      phrases: [
        {
          id: "kept_place",
          segments: [{ id: "turn", kind: "motif", motif: "turn" }],
        },
      ],
      voices: [
        {
          id: "piano",
          instrument: "warm_piano",
          role: "lead",
          realize: [
            {
              id: "four_turns",
              kind: "phrase",
              phrase: "kept_place",
              repeat: 4,
              dynamicCurve: {
                from: "p",
                via: [{ at: 0.65, level: "mp" }],
                to: "pp",
              },
            },
          ],
        },
        {
          id: "clarinet",
          instrument: "clarinet",
          role: "counter",
          realize: [
            {
              id: "wait",
              kind: "rest",
              duration: { numerator: 3, denominator: 1 },
            },
            {
              id: "answer",
              kind: "phrase",
              phrase: "kept_place",
              repeat: 2,
              techniques: ["ghost_return"],
              transform: { transpose: -12 },
            },
            {
              id: "leave",
              kind: "rest",
              duration: { numerator: 3, denominator: 1 },
            },
          ],
        },
      ],
      sections: [
        { id: "kept", startBar: 1, bars: 2 },
        { id: "answered", startBar: 3, bars: 2 },
      ],
    },
  },
  {
    filename: "synthetic-counterpulse.air.json",
    perspective: "dense synthetic counterpulse",
    density: "dense",
    features: ["4/4", "groove", "hocket", "multiple-registers", "phrase-reuse"],
    source: {
      format: AIR_V1_FORMAT,
      title: "Pulse leaves a door open",
      conductor: { tempo: 116, meters: [{ bar: 1, meter: "4/4" }] },
      vocabulary: coreVocabulary,
      motifs: {
        shard: "C5/8 r/8 G4/8 Bb4/8",
        floor: "C2/2 G1/2",
      },
      grooves: [
        {
          id: "backstep",
          cycle: { numerator: 1, denominator: 1 },
          steps: [
            {
              at: { numerator: 0, denominator: 1 },
              offset: { numerator: 0, denominator: 1 },
            },
            {
              at: { numerator: 1, denominator: 2 },
              offset: { numerator: 1, denominator: 24 },
              velocityScale: { numerator: 4, denominator: 5 },
            },
          ],
        },
      ],
      phrases: [
        {
          id: "open_door",
          segments: [
            {
              id: "shards",
              kind: "motif",
              motif: "shard",
              repeat: 2,
            },
          ],
        },
      ],
      voices: [
        {
          id: "lead",
          instrument: "prism_lead",
          role: "lead",
          realize: [
            {
              id: "shard_form",
              kind: "phrase",
              phrase: "open_door",
              repeat: 4,
              groove: "backstep",
              techniques: ["turn_once"],
            },
          ],
        },
        {
          id: "bass",
          instrument: "sub_bass",
          role: "bass",
          realize: [
            {
              id: "floor",
              kind: "motif",
              motif: "floor",
              repeat: 4,
              articulation: "tenuto",
            },
          ],
        },
        {
          id: "pulse",
          instrument: "rhythm_pulse",
          role: "percussion",
          realize: [
            {
              id: "counterpulse",
              kind: "literal",
              part: "C2/8 r/8 C2/8 r/8 D2/8 r/8 C2/8 D2/8",
              repeat: 4,
              groove: "backstep",
              techniques: ["hocket_even"],
            },
          ],
        },
      ],
      sections: [
        { id: "lattice", startBar: 1, bars: 2 },
        { id: "door", startBar: 3, bars: 2 },
      ],
    },
  },
  {
    filename: "six-eight-handoff.air.json",
    perspective: "6/8 acoustic ensemble handoff",
    density: "medium",
    features: ["6/8", "harmony", "voice-leading", "arpeggio", "bass"],
    source: {
      format: AIR_V1_FORMAT,
      title: "Hands crossing in six",
      conductor: { tempo: 78, meters: [{ bar: 1, meter: "6/8" }] },
      key: "G minor",
      vocabulary: coreVocabulary,
      motifs: {},
      harmony: [
        {
          id: "crossing",
          chords: [
            { symbol: "Gm7", duration: { numerator: 3, denominator: 1 } },
            { symbol: "Ebmaj7", duration: { numerator: 3, denominator: 1 } },
            { symbol: "Bbmaj7", duration: { numerator: 3, denominator: 1 } },
            { symbol: "D7/F#", duration: { numerator: 3, denominator: 1 } },
          ],
        },
      ],
      voices: [
        {
          id: "piano",
          instrument: "warm_piano",
          role: "harmony",
          realize: [
            {
              id: "room",
              kind: "chords",
              harmony: "crossing",
              voicing: "close",
              register: { min: "C3", max: "C5" },
              rhythm: [{ numerator: 3, denominator: 1 }],
              voiceLeading: "nearest",
              articulation: "tenuto",
            },
          ],
        },
        {
          id: "guitar",
          instrument: "nylon_guitar",
          role: "counter",
          realize: [
            {
              id: "crossing",
              kind: "arpeggio",
              harmony: "crossing",
              degrees: [1, 5, 3, 7],
              step: { numerator: 1, denominator: 2 },
              octaveSpan: 2,
              register: { min: "E2", max: "E5" },
            },
          ],
        },
        {
          id: "cello",
          instrument: "solo_cello",
          role: "bass",
          realize: [
            {
              id: "ground",
              kind: "bass",
              harmony: "crossing",
              degrees: [1, 5],
              step: { numerator: 1, denominator: 1 },
              register: { min: "C2", max: "C4" },
              slashBass: "honor",
              dynamicCurve: { from: "p", to: "mf" },
            },
          ],
        },
      ],
      sections: [
        { id: "near", startBar: 1, bars: 2 },
        { id: "cross", startBar: 3, bars: 2 },
      ],
    },
  },
  {
    filename: "prismatic-pack-voice.air.json",
    perspective: "portable extension-voice etude",
    density: "medium",
    features: ["7/8", "pack-vocabulary", "exact-unavailable-embodiment"],
    source: {
      format: AIR_V1_FORMAT,
      title: "A voice the room has not installed",
      conductor: { tempo: 84, meters: [{ bar: 1, meter: "7/8" }] },
      vocabulary: packVocabulary,
      motifs: { refraction: "C4/8 D4/8 E4/8 G4/8 A4/8 G4/8 E4/8" },
      voices: [
        {
          id: "refraction",
          instrument: "prismatic_voice",
          role: "lead",
          realize: [
            {
              id: "uninstalled_body",
              kind: "motif",
              motif: "refraction",
            },
          ],
        },
      ],
      sections: [{ id: "single_arc", startBar: 1, bars: 1 }],
    },
  },
];

await mkdir(outputRoot, { recursive: true });
for (const item of corpus) {
  const result = compileAirV1(item.source);
  const errors = result.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  );
  if (!result.compiled || errors.length > 0)
    throw new Error(
      `${item.filename} is invalid:\n${errors
        .map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`)
        .join("\n")}`,
    );
  await writeFile(
    resolve(outputRoot, item.filename),
    await formatFixtureJson(stringifyAirV1(item.source)),
    "utf8",
  );
}

await writeFile(
  resolve(outputRoot, "prismatic-voice.pack.json"),
  await formatFixtureJson(JSON.stringify(prismaticVoicePack)),
  "utf8",
);

await writeFile(
  resolve(outputRoot, "corpus.json"),
  await formatFixtureJson(
    JSON.stringify({
      format: "refrain-air-v1-corpus@0-experimental",
      status: "schema-and-compiler-evidence",
      acceptanceBoundary:
        "Materially different local authored fixtures prove portable language behavior only. They are not multi-host/model acceptance, listening acceptance, or genre classification.",
      extensionPacks: [
        {
          filename: "prismatic-voice.pack.json",
          vocabularyId: packVocabulary.id,
          vocabularySha256: packVocabulary.contentSha256,
        },
      ],
      items: corpus.map(({ filename, perspective, density, features }) => ({
        filename,
        perspective,
        density,
        features,
      })),
    }),
  ),
  "utf8",
);
