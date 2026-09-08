import { mkdir, writeFile } from "node:fs/promises";
import {
  stringifyAir,
  type AirSource,
  type RealizationSegment,
} from "@refrain/air-schema";

const sectionIds = [
  "arrival",
  "nearness",
  "distance",
  "answer",
  "return",
  "afterglow",
] as const;

const changes = [
  ["Cm7", "Abmaj7", "Ebmaj7", "Bb7", "Fm7", "Cm7", "G7", "Cm7"],
  ["Abmaj7", "Ebmaj7", "Bb7", "Cm7", "Fm7", "Abmaj7", "G7", "Cm7"],
  ["Fm7", "Cm7", "Abmaj7", "Ebmaj7", "Dm7b5", "G7", "Cm7", "Cm7"],
  ["Ebmaj7", "Bb7", "Cm7", "Abmaj7", "Fm7", "G7", "Cm7", "G7"],
  ["Cm7", "G7", "Abmaj7", "Ebmaj7", "Fm7", "Cm7", "G7", "Cm7"],
  ["Abmaj7", "Fm7", "Cm7", "Ebmaj7", "Dm7b5", "G7", "Cm7", "Cm7"],
] as const;

function transformedMotif(
  id: string,
  motif: string,
  section: string,
  repeat: number,
  transform: {
    transpose?: number;
    inversion?: boolean;
    retrograde?: boolean;
    stretch?: number;
  },
  dynamic: "pp" | "p" | "mp" | "mf" | "f",
): RealizationSegment {
  return {
    id,
    kind: "motif",
    motif,
    section,
    repeat,
    ...(Object.keys(transform).length === 0 ? {} : { transform }),
    dynamic,
    articulation: "legato",
  };
}

function rest(id: string, section: string, beats: number): RealizationSegment {
  return { id, kind: "rest", section, beats };
}

function referenceAir(): AirSource {
  const leadTransforms = [
    {},
    { transpose: 2 },
    { inversion: true },
    { transpose: 5, retrograde: true },
    { transpose: -5, inversion: true },
    {},
  ];
  const lead = sectionIds.flatMap((section, index) => [
    transformedMotif(
      `${section}_near`,
      "near",
      section,
      4,
      leadTransforms[index]!,
      index === 0 ? "p" : index === 3 ? "f" : "mp",
    ),
    rest(`${section}_breath_a`, section, 8),
    transformedMotif(
      `${section}_tide`,
      "tide",
      section,
      4,
      index % 2 === 0 ? { inversion: true } : { retrograde: true },
      index === 2 ? "p" : "mp",
    ),
    rest(`${section}_breath_b`, section, 8),
    transformedMotif(
      `${section}_home`,
      "home",
      section,
      4,
      index === sectionIds.length - 1 ? {} : { transpose: index - 2 },
      index === sectionIds.length - 1 ? "p" : "mf",
    ),
  ]);
  const flute = sectionIds.flatMap((section, index) => [
    rest(`${section}_flute_wait_a`, section, 16),
    transformedMotif(
      `${section}_flute_tide`,
      "tide",
      section,
      4,
      { transpose: 12, ...(index % 2 ? { inversion: true } : {}) },
      index < 2 ? "pp" : "p",
    ),
    rest(`${section}_flute_wait_b`, section, 16),
    transformedMotif(
      `${section}_flute_near`,
      "near",
      section,
      4,
      { transpose: 12, ...(index === 3 ? { retrograde: true } : {}) },
      index === 3 ? "mf" : "p",
    ),
  ]);
  const clarinet = sectionIds.flatMap((section, index) => [
    transformedMotif(
      `${section}_clarinet_near`,
      "near",
      section,
      8,
      { transpose: -5, ...(index === 2 ? { inversion: true } : {}) },
      index === 2 ? "p" : "mp",
    ),
    rest(`${section}_clarinet_wait`, section, 16),
    transformedMotif(
      `${section}_clarinet_tide`,
      "tide",
      section,
      4,
      { transpose: -7, ...(index === 4 ? { retrograde: true } : {}) },
      "p",
    ),
  ]);
  const cello = sectionIds.flatMap((section, index) => [
    transformedMotif(
      `${section}_cello_near`,
      "near",
      section,
      4,
      {
        transpose: -12,
        stretch: 2,
        ...(index === 2 ? { inversion: true } : {}),
      },
      index === 3 ? "mf" : "p",
    ),
    rest(`${section}_cello_wait`, section, 16),
    transformedMotif(
      `${section}_cello_home`,
      "home",
      section,
      2,
      { transpose: -12, stretch: 2 },
      index === 5 ? "pp" : "mp",
    ),
  ]);
  const harmonySegments = sectionIds.map((section, index) => ({
    id: `${section}_strings`,
    kind: "chords" as const,
    harmony: `${section}_changes`,
    voicing: "close" as const,
    register: { min: "C3", max: "C6" },
    rhythm: [4],
    voiceLeading: "nearest" as const,
    section,
    dynamicCurve: {
      from: index === 0 ? ("pp" as const) : ("p" as const),
      to: index === 3 ? ("f" as const) : ("mp" as const),
    },
    articulation: "legato" as const,
  }));
  const harpSegments = sectionIds.map((section, index) => ({
    id: `${section}_harp`,
    kind: "arpeggio" as const,
    harmony: `${section}_changes`,
    degrees: [1, 5, 3, 7] as const,
    stepBeats: 1,
    octaveSpan: 2,
    register: { min: "C3", max: "C6" },
    section,
    dynamicCurve: {
      from: index === 2 ? ("pp" as const) : ("p" as const),
      to: index === 3 ? ("mf" as const) : ("mp" as const),
    },
    articulation: "tenuto" as const,
  }));
  const bassSegments = sectionIds.map((section, index) => ({
    id: `${section}_bass`,
    kind: "bass" as const,
    harmony: `${section}_changes`,
    degrees: [1, 5] as const,
    stepBeats: 2,
    register: { min: "C2", max: "C4" },
    slashBass: "honor" as const,
    section,
    dynamic: index === 3 ? ("mf" as const) : ("mp" as const),
    articulation: "tenuto" as const,
  }));
  const percussionSegments = sectionIds.map((section, index) => ({
    id: `${section}_percussion`,
    kind: "drum_grid" as const,
    resolution: 16 as const,
    lanes: [
      {
        note: "C2",
        pattern: Array.from({ length: 256 }, (_, step) =>
          step % 16 === 0 ? "x" : ".",
        ).join(""),
      },
      {
        note: "D2",
        pattern: Array.from({ length: 256 }, (_, step) =>
          step % 32 === 16 ? "x" : ".",
        ).join(""),
      },
      {
        note: "F#2",
        pattern: Array.from({ length: 256 }, (_, step) =>
          step % 8 === 0 ? "x" : ".",
        ).join(""),
      },
      {
        note: "D#3",
        pattern: Array.from({ length: 256 }, (_, step) =>
          step % 16 === (index % 2 === 0 ? 12 : 4) ? "x" : ".",
        ).join(""),
      },
    ],
    section,
    dynamic: index === 3 ? ("mf" as const) : ("p" as const),
  }));
  const lateMarimba: RealizationSegment[] = [
    rest("arrival_echo_wait", "arrival", 64),
    rest("nearness_echo_wait", "nearness", 64),
    {
      id: "distance_echo",
      kind: "motif",
      motif: "bell",
      section: "distance",
      repeat: 8,
      dynamic: "pp",
    },
    rest("distance_echo_tail", "distance", 56),
    rest("answer_echo_wait", "answer", 64),
    {
      id: "return_echo",
      kind: "motif",
      motif: "bell",
      section: "return",
      repeat: 16,
      dynamic: "p",
    },
    rest("return_echo_tail", "return", 48),
    rest("afterglow_echo_wait", "afterglow", 64),
  ];
  const lateStrings: RealizationSegment[] = [
    rest("arrival_sustain_wait", "arrival", 64),
    rest("nearness_sustain_wait", "nearness", 64),
    transformedMotif(
      "distance_sustain",
      "sustain",
      "distance",
      1,
      { stretch: 3 },
      "pp",
    ),
    rest("distance_sustain_tail", "distance", 52),
    rest("answer_sustain_wait", "answer", 64),
    transformedMotif(
      "return_sustain",
      "sustain",
      "return",
      1,
      { stretch: 3 },
      "p",
    ),
    rest("return_sustain_tail", "return", 52),
    rest("afterglow_sustain_wait", "afterglow", 64),
  ];

  return {
    format: "air@0-experimental",
    title: "醒来以后，房间还记得",
    tempo: 80,
    meter: "4/4",
    key: "C minor, with an authored return to C",
    motifs: {
      near: "G4/8 Bb4/8 C5/4 r/4 D5/4",
      tide: "r/4 Eb4/8 G4/8 Bb4/4 G4/4",
      home: "[C4,G4]/2 r/4 Eb4/4",
      bell: "C4/4",
      sustain: "C5/1",
    },
    harmony: sectionIds.map((section, index) => ({
      id: `${section}_changes`,
      chords: changes[index]!.map((symbol) => ({ symbol, beats: 8 })),
    })),
    sections: sectionIds.map((id, index) => ({
      id,
      startBar: index * 16 + 1,
      bars: 16,
    })),
    voices: [
      {
        id: "lead",
        instrument: "warm_piano",
        role: "lead",
        gainDb: -2,
        pan: -0.08,
        realize: lead,
      },
      {
        id: "harp",
        instrument: "harp",
        role: "counter",
        gainDb: -5,
        pan: 0.28,
        realize: harpSegments,
      },
      {
        id: "strings",
        instrument: "air_pad",
        role: "harmony",
        gainDb: -7,
        pan: 0,
        realize: harmonySegments,
      },
      {
        id: "cello",
        instrument: "solo_cello",
        role: "counter",
        gainDb: -4,
        pan: -0.3,
        realize: cello,
      },
      {
        id: "flute",
        instrument: "flute",
        role: "counter",
        gainDb: -7,
        pan: 0.4,
        realize: flute,
      },
      {
        id: "clarinet",
        instrument: "clarinet",
        role: "counter",
        gainDb: -6,
        pan: 0.18,
        realize: clarinet,
      },
      {
        id: "bass",
        instrument: "clean_bass",
        role: "bass",
        gainDb: -4,
        pan: -0.18,
        realize: bassSegments,
      },
      {
        id: "percussion",
        instrument: "soft_percussion",
        role: "percussion",
        gainDb: -9,
        pan: 0.12,
        realize: percussionSegments,
      },
      {
        id: "late_echo",
        instrument: "marimba",
        role: "texture",
        gainDb: -10,
        pan: 0.5,
        realize: lateMarimba,
      },
      {
        id: "late_sustain",
        instrument: "chamber_strings",
        role: "texture",
        gainDb: -12,
        pan: -0.52,
        realize: lateStrings,
      },
    ],
  };
}

function stressAir(): AirSource {
  const pitchedVoices = [
    ["warm_piano", "C3", "C6", "lead"],
    ["nylon_guitar", "E2", "E6", "pulse"],
    ["harp", "C2", "C7", "counter"],
    ["clean_bass", "E1", "G3", "bass"],
    ["chamber_strings", "C3", "C6", "harmony"],
    ["solo_cello", "C2", "E5", "counter"],
    ["flute", "C4", "C7", "lead"],
    ["clarinet", "D3", "Bb6", "counter"],
    ["marimba", "A2", "C7", "pulse"],
    ["air_pad", "C3", "C6", "texture"],
    ["glass_bell", "C4", "C7", "texture"],
  ] as const;
  const pattern = (predicate: (step: number) => boolean) =>
    Array.from({ length: 256 }, (_, step) =>
      predicate(step) ? "x" : ".",
    ).join("");
  return {
    format: "air@0-experimental",
    title: "Upper Envelope — Eight Minutes",
    tempo: 120,
    meter: "4/4",
    key: "C minor stress form",
    motifs: {},
    harmony: [
      {
        id: "stress_changes",
        chords: Array.from({ length: 15 }, (_, index) => ({
          symbol: ["Cm7", "Abmaj7", "Ebmaj7", "Bb7"][index % 4]!,
          beats: 64,
        })),
      },
    ],
    sections: Array.from({ length: 8 }, (_, index) => ({
      id: `pressure_${index + 1}`,
      startBar: index * 30 + 1,
      bars: 30,
    })),
    voices: [
      ...pitchedVoices.map(([instrument, min, max, role], index) => ({
        id: `stress_${instrument}`,
        instrument,
        role,
        gainDb: -12,
        pan: -0.8 + index * 0.16,
        realize: [
          {
            id: "whole_form",
            kind: "arpeggio" as const,
            harmony: "stress_changes",
            degrees: [1, 3, 5, 7] as const,
            stepBeats: 0.5,
            octaveSpan: 2,
            register: { min, max },
            dynamic: "mp" as const,
            articulation: "staccato" as const,
          },
        ],
      })),
      {
        id: "stress_soft_percussion",
        instrument: "soft_percussion",
        role: "percussion",
        gainDb: -12,
        pan: 0,
        realize: [
          {
            id: "whole_form",
            kind: "drum_grid",
            resolution: 16,
            repeat: 15,
            lanes: [
              { note: "C2", pattern: pattern((step) => step % 16 === 0) },
              { note: "D2", pattern: pattern((step) => step % 32 === 16) },
              { note: "F#2", pattern: pattern((step) => step % 16 === 8) },
              { note: "D#3", pattern: pattern((step) => step % 32 === 28) },
            ],
            dynamic: "mp",
            articulation: "staccato",
          },
        ],
      },
    ],
  };
}

const fixtureDirectory = new URL(
  "../fixtures/complete-piece/",
  import.meta.url,
);
await mkdir(fixtureDirectory, { recursive: true });
await Promise.all([
  writeFile(
    new URL("relational-complete.air.json", fixtureDirectory),
    stringifyAir(referenceAir()),
  ),
  writeFile(
    new URL("upper-envelope.air.json", fixtureDirectory),
    stringifyAir(stressAir()),
  ),
]);
