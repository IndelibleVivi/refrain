import type { DynamicLevel } from "@refrain/air-schema";
import {
  createAirVocabularyClosure,
  type AirSourceV1,
} from "@refrain/air-schema/v1";
import { compileAirV1 } from "@refrain/compiler/v1";
import { midiToNoteName, noteNameToMidi } from "@refrain/compiler";
import { createRefrainArtifactV3 } from "@refrain/renderer/portable";
import { createRootReceiptV1 } from "@refrain/renderer/v1";
import { F_ACOUSTIC_CHAMBER_PERFORMANCE_BINDING } from "@refrain/soundpack";
import { CORE_AUTHORING_VOCABULARY } from "@refrain/soundpack/vnext";
import type {
  Lead,
  RouteKey,
  ScoreChunk,
  ScoreStep,
  StudyScore,
  VisibleNote,
} from "./contracts.js";

/**
 * "A borrowed beat · 借来的半拍"
 *
 * One 16-bar air in A minor at 96 BPM, cut into eight identical-length
 * two-bar phrases so a listener can hand the foreground between a measured
 * piano and a short, syncopated marimba at two discrete boundaries.
 *
 * The sparse nylon-guitar bass and open harmony are the room; they are the
 * only voices present in every phrase. The two lead characters trade the
 * foreground, but an alternative route must change the foreground line, the
 * accompaniment space and the ending, not merely swap a timbre.
 *
 * This module is a pure, deterministic builder. It never touches audio, the
 * filesystem or the network, so it is safe to import from a test or the app.
 */

const TEMPO = 96;
const PHRASE_BEATS = 8;
const TOTAL_STEPS = 8;

export const HANDOFF_TITLE = "A borrowed beat · 借来的半拍";
export const HANDOFF_ID = "handoff-study@a-borrowed-beat";

/** Voice IDs are shared between phrases and full routes so events compare. */
type LeadVoiceId = "piano" | "marimba";
type VoiceId = LeadVoiceId | "guitar-bass" | "guitar-harm";

/** A concrete musical event in step-local beats (0 <= at < 8). */
interface StepEvent {
  at: number;
  beats: number;
  notes: string[];
  dynamic: DynamicLevel;
}

/** One step's realized material for one voice. */
type VoiceEvents = readonly StepEvent[];

interface StepContent {
  "guitar-bass": VoiceEvents;
  "guitar-harm": VoiceEvents;
  piano: VoiceEvents;
  marimba: VoiceEvents;
}

/** How the guitar room breathes behind a foreground choice. */
type Accompanying = "driving" | "open";

// ---------------------------------------------------------------------------
// Notation helpers. Everything is expressed as beat-positioned events and then
// rendered to canonical `part` tokens, so time arithmetic can never drift.
// ---------------------------------------------------------------------------

function event(
  at: number,
  beats: number,
  notes: string[],
  dynamic: DynamicLevel,
): StepEvent {
  return { at, beats, notes, dynamic };
}

function durationToken(beats: number): string {
  // quarter = 1 beat. Supported literal denominators cover every value used.
  const table: Record<number, string> = {
    0.25: "16",
    0.5: "8",
    0.75: "8.",
    1: "4",
    1.5: "4.",
    2: "2",
    3: "2.",
    4: "1",
    6: "1.",
  };
  const token = table[beats];
  if (!token) throw new Error(`Unsupported duration ${beats} beats.`);
  return token;
}

function noteToken(note: string, beats: number, dynamic: DynamicLevel): string {
  const midi = noteNameToMidi(note);
  if (midi === undefined) throw new Error(`Unknown pitch ${note}.`);
  return `${note}/${durationToken(beats)}@${dynamic}`;
}

function chordToken(
  notes: readonly string[],
  beats: number,
  dynamic: DynamicLevel,
): string {
  const pitches = notes.map((note) => {
    if (noteNameToMidi(note) === undefined)
      throw new Error(`Unknown pitch ${note}.`);
    return note;
  });
  if (pitches.length < 2 || pitches.length > 6)
    throw new Error(`A chord needs 2-6 pitches, received ${pitches.length}.`);
  return `[${pitches.join(",")}]/${durationToken(beats)}@${dynamic}`;
}

/** Render one 4/4 bar of events into canonical `part` tokens with rests. */
function barTokens(events: VoiceEvents): string[] {
  const sorted = [...events].sort((left, right) => left.at - right.at);
  const tokens: string[] = [];
  let cursor = 0;
  for (const item of sorted) {
    if (item.at < cursor - 1e-9)
      throw new Error(`Overlapping events at beat ${item.at}.`);
    if (item.at > cursor + 1e-9) {
      tokens.push(`r/${durationToken(item.at - cursor)}`);
      cursor = item.at;
    }
    tokens.push(
      item.notes.length > 1
        ? chordToken(item.notes, item.beats, item.dynamic)
        : noteToken(item.notes[0]!, item.beats, item.dynamic),
    );
    cursor = item.at + item.beats;
  }
  if (cursor < 4 - 1e-9) {
    tokens.push(`r/${durationToken(4 - cursor)}`);
    cursor = 4;
  }
  if (Math.abs(cursor - 4) > 1e-9)
    throw new Error(`Bar events fill ${cursor} beats, not 4.`);
  return tokens;
}

/** Render a full step (two bars) as `barA | barB`. */
function stepPart(events: VoiceEvents): string {
  const inside = events.filter((item) => item.at < 4);
  const after = events
    .filter((item) => item.at >= 4)
    .map((item) => ({ ...item, at: item.at - 4 }));
  return `${barTokens(inside).join(" ")} | ${barTokens(after).join(" ")}`;
}

/** A silent voice still needs a complete-bar span to stay aligned. */
function silentPart(steps: number): string {
  return Array.from({ length: steps }, () => "r/1 | r/1").join(" | ");
}

function joinSteps(parts: readonly string[]): string {
  return parts.join(" | ");
}

function shift(events: VoiceEvents, by: number): StepEvent[] {
  return events.map((item) => ({ ...item, at: item.at + by }));
}

// ---------------------------------------------------------------------------
// The guitar room. Bass is always a sparse root/fifth line; harmony is an
// open dyad on the strong beats. The room changes shape by route: behind a
// piano foreground the bass walks more, behind a marimba foreground it opens.
// ---------------------------------------------------------------------------

function bassFor(
  chords: readonly [string, string],
  mode: Accompanying,
): VoiceEvents {
  const [first, second] = chords;
  const roots: Record<string, string> = {
    Am: "A2",
    F: "F2",
    G: "G2",
    C: "C3",
    Dm: "D3",
    E: "E2",
    Em: "E2",
  };
  const fifths: Record<string, string> = {
    Am: "E3",
    F: "C3",
    G: "D3",
    C: "G3",
    Dm: "A3",
    E: "B2",
    Em: "B2",
  };
  const rootA = roots[first]!;
  const rootB = roots[second]!;
  if (mode === "open") {
    // One long bass tone per bar; let the room ring.
    return [event(0, 4, [rootA], "mp"), event(4, 4, [rootB], "mp")];
  }
  // Driving: root then fifth, a light pulse under a piano foreground.
  return [
    event(0, 2, [rootA], "mp"),
    event(2, 2, [fifths[first]!], "p"),
    event(4, 2, [rootB], "mp"),
    event(6, 2, [fifths[second]!], "p"),
  ];
}

function harmonyFor(
  chords: readonly [string, string],
  mode: Accompanying,
): VoiceEvents {
  const dyads: Record<string, [string, string]> = {
    Am: ["C4", "E4"],
    F: ["A3", "C4"],
    G: ["B3", "D4"],
    C: ["E4", "G4"],
    Dm: ["F4", "A4"],
    E: ["G#3", "B3"],
    Em: ["G3", "B3"],
  };
  const [first, second] = chords;
  if (mode === "open") {
    // Higher, ringing open fifths placed slightly off the bass.
    const open: Record<string, [string, string]> = {
      Am: ["E4", "A4"],
      F: ["C4", "F4"],
      G: ["D4", "G4"],
      C: ["G4", "C5"],
      Dm: ["A4", "D5"],
      E: ["B4", "E5"],
      Em: ["B4", "E5"],
    };
    const pairA = open[first]!;
    const pairB = open[second]!;
    return [
      event(0.5, 1.5, [pairA[0], pairA[1]], "pp"),
      event(2, 1.5, [pairA[0], pairA[1]], "pp"),
      event(4.5, 1.5, [pairB[0], pairB[1]], "pp"),
      event(6, 1.5, [pairB[0], pairB[1]], "pp"),
    ];
  }
  const pairA = dyads[first]!;
  const pairB = dyads[second]!;
  return [
    event(0, 3, [pairA[0], pairA[1]], "pp"),
    event(4, 3, [pairB[0], pairB[1]], "pp"),
  ];
}

// ---------------------------------------------------------------------------
// Lead material. Two cells: a measured piano arch (M) and a short offbeat
// marimba cell (S). Every later phrase derives from them, but each route
// writes its own notes, registers and endings.
// ---------------------------------------------------------------------------

function pianoCell(
  root: string,
  third: string,
  fifth: string,
  shape: "arch" | "answer" | "syncopated",
): VoiceEvents {
  if (shape === "arch") {
    // M: beat-led, clear, measured.
    return [
      event(0, 1.5, [root], "mp"),
      event(1.5, 0.5, [third], "p"),
      event(2, 2, [fifth], "mf"),
    ];
  }
  if (shape === "answer") {
    // M': the arch falls back to rest on the tonic.
    return [
      event(0, 1, [fifth], "mp"),
      event(1, 1, [third], "mp"),
      event(2, 2, [root], "p"),
    ];
  }
  // The piano borrowing the marimba's offbeat habit — the point of route mp.
  return [
    event(0.5, 0.5, [root], "mp"),
    event(1.5, 0.5, [third], "mf"),
    event(2, 2, [fifth], "mf"),
  ];
}

function marimbaCell(
  root: string,
  third: string,
  fifth: string,
  shape: "syncopated" | "answer",
): VoiceEvents {
  if (shape === "syncopated") {
    // S: offbeat, short, syncopated.
    return [
      event(0.5, 0.5, [root], "mf"),
      event(1.5, 0.5, [third], "mf"),
      event(2, 1.5, [fifth], "mf"),
      event(3.5, 0.5, [third], "mp"),
    ];
  }
  // S': a short falling answer.
  return [
    event(0, 0.5, [fifth], "mf"),
    event(0.5, 0.5, [third], "mf"),
    event(1, 1, [root], "mp"),
  ];
}

/** Layer a second bar of the same lead over its own first bar. */
function twice(events: VoiceEvents): VoiceEvents {
  return [...events, ...shift(events, 4)];
}

// ---------------------------------------------------------------------------
// Per-step content. Steps 0-1 are shared by every route (pre-gate material is
// preserved exactly). Steps 2-7 depend on the carried route.
// ---------------------------------------------------------------------------

const STEP_CHORDS: readonly (readonly [string, string])[] = [
  ["Am", "Am"],
  ["F", "G"],
  ["C", "Am"],
  ["Dm", "E"],
  ["F", "G"],
  ["C", "Em"],
  ["Dm", "F"],
  ["E", "Am"],
];

interface LeadWrite {
  piano: VoiceEvents;
  marimba: VoiceEvents;
}

/** The two shared opening phrases. Both instruments are introduced. */
function openingContent(step: 0 | 1, mode: Accompanying): StepContent {
  const [first, second] = STEP_CHORDS[step]!;
  if (step === 0) {
    return {
      "guitar-bass": bassFor([first, second], mode),
      "guitar-harm": harmonyFor([first, second], mode),
      // piano intro: measured arch, twice with an answer on the repeat.
      piano: [
        ...pianoCell("A3", "C4", "E4", "arch"),
        ...shift(pianoCell("C4", "E4", "D4", "answer"), 4),
      ],
      marimba: [],
    };
  }
  // step 1: the marimba answers with its syncopated cell.
  return {
    "guitar-bass": bassFor([first, second], mode),
    "guitar-harm": harmonyFor([first, second], mode),
    piano: [],
    marimba: [
      ...marimbaCell("F4", "A4", "C5", "syncopated"),
      ...shift(marimbaCell("G4", "B4", "D5", "syncopated"), 4),
    ],
  };
}

function routeLeads(route: RouteKey): [Lead, Lead] {
  return [
    route[0] === "p" ? "piano" : "marimba",
    route[1] === "p" ? "piano" : "marimba",
  ];
}

/** Which lead carries the foreground at a step. Steps 0-1 are fixed. */
export function leadAt(route: RouteKey, step: number): Lead {
  const [first, second] = routeLeads(route);
  if (step <= 0) return "piano";
  if (step === 1) return "marimba";
  return step <= 4 ? first : second;
}

function transpose(note: string, semitones: number): string {
  const midi = noteNameToMidi(note);
  if (midi === undefined) throw new Error(`Unknown pitch ${note}.`);
  return midiToNoteName(midi + semitones);
}

/** Real melodic material for the lead that carries a given step. */
function leadWrite(
  step: number,
  route: RouteKey,
  first: string,
  second: string,
): LeadWrite {
  const empty: LeadWrite = { piano: [], marimba: [] };
  const chordVoices: Record<
    string,
    { root: string; third: string; fifth: string }
  > = {
    Am: { root: "A4", third: "C5", fifth: "E5" },
    F: { root: "F4", third: "A4", fifth: "C5" },
    G: { root: "G4", third: "B4", fifth: "D5" },
    C: { root: "C4", third: "E4", fifth: "G4" },
    Dm: { root: "D4", third: "F4", fifth: "A4" },
    E: { root: "E4", third: "G#4", fifth: "B4" },
    Em: { root: "E4", third: "G4", fifth: "B4" },
  };
  const r1 = chordVoices[first]!;
  const r2 = chordVoices[second]!;

  const [gateOneLead, gateTwoLead] = routeLeads(route);
  const lead = step <= 4 ? gateOneLead : gateTwoLead;

  // The second gate always states the borrowed rhythm, whatever carries it.
  if (step === 5) {
    if (lead === "piano") {
      // The piano returns carrying the marimba's offbeat habit.
      return {
        piano: [
          ...pianoCell(
            r1.root,
            r1.third,
            r1.fifth,
            gateOneLead === "marimba" ? "syncopated" : "arch",
          ),
          ...shift(
            pianoCell(
              r2.root,
              r2.third,
              r2.fifth,
              gateOneLead === "marimba" ? "syncopated" : "answer",
            ),
            4,
          ),
        ],
        marimba: [],
      };
    }
    return {
      piano: [],
      marimba: [
        ...marimbaCell(r1.root, r1.third, r1.fifth, "syncopated"),
        ...shift(
          marimbaCell(
            r2.root,
            r2.third,
            r2.fifth,
            step === 5 && gateOneLead === "piano" ? "answer" : "syncopated",
          ),
          4,
        ),
      ],
    };
  }

  if (step === 2) {
    // The chosen lead picks up the opening cells and turns them outward.
    if (lead === "piano") {
      return {
        piano: [
          ...pianoCell(r1.root, r1.third, r1.fifth, "arch"),
          ...shift(pianoCell(r2.root, r2.third, r2.fifth, "answer"), 4),
        ],
        marimba: [],
      };
    }
    return {
      piano: [],
      marimba: [
        ...marimbaCell(r1.root, r1.third, r1.fifth, "syncopated"),
        ...shift(marimbaCell(r2.root, r2.third, r2.fifth, "syncopated"), 4),
      ],
    };
  }

  if (step === 3) {
    if (lead === "piano") {
      // Development: sequence the arch a third up, then answer low.
      return {
        piano: [
          ...pianoCell(r1.third, r1.fifth, transpose(r1.root, 12), "arch"),
          ...shift(pianoCell(r2.root, r2.third, r2.fifth, "answer"), 4),
        ],
        marimba: [],
      };
    }
    // Marimba: short exchange against the guitar, higher and tighter.
    return {
      piano: [],
      marimba: [
        ...marimbaCell(r1.root, r1.third, r1.fifth, "syncopated"),
        ...shift(marimbaCell(r2.fifth, r2.third, r2.root, "answer"), 4),
      ],
    };
  }

  if (step === 4) {
    // Both routes prepare the second gate; room opening for the handoff.
    if (lead === "piano") {
      return {
        piano: twice(pianoCell(r1.fifth, r1.third, r1.root, "answer")),
        marimba: [],
      };
    }
    return {
      piano: [],
      marimba: [
        event(0.5, 1.5, [r1.fifth], "mp"),
        event(2.5, 1.5, [r1.third], "mp"),
        event(4.5, 1.5, [r2.fifth], "mp"),
        event(6.5, 1.5, [r2.third], "mp"),
      ],
    };
  }

  if (step === 6) {
    // Consequence: the borrowed rhythm starts to resolve.
    if (lead === "piano") {
      return {
        piano: [
          ...pianoCell(
            r1.root,
            r1.third,
            r1.fifth,
            gateOneLead === "marimba" ? "syncopated" : "arch",
          ),
          ...shift(pianoCell(r2.third, r2.fifth, r2.root, "answer"), 4),
        ],
        marimba: [],
      };
    }
    return {
      piano: [],
      marimba: [
        ...marimbaCell(r1.third, r1.fifth, r1.root, "syncopated"),
        ...shift(marimbaCell(r2.fifth, r2.root, r2.third, "answer"), 4),
      ],
    };
  }

  if (step === 7) {
    // Ending: E major leans home to A minor. The lead lands, the other fades.
    if (lead === "piano") {
      return {
        piano: [
          event(0, 1, [r1.third], "mf"),
          event(1, 1, [r1.fifth], "mf"),
          event(2, 2, [r1.root], "mp"),
          event(
            gateOneLead === "marimba" ? 4.5 : 4,
            gateOneLead === "marimba" ? 1 : 1.5,
            ["G#4"],
            "mp",
          ),
          event(5.5, 2, ["A4"], "p"),
        ],
        marimba: [],
      };
    }
    return {
      piano: [],
      marimba: [
        event(0, 1, [r1.fifth], "mf"),
        event(1, 1, [r1.third], "mf"),
        event(2, 1, ["E5"], "mp"),
        event(
          gateOneLead === "piano" ? 4 : 4.5,
          gateOneLead === "piano" ? 1.5 : 1,
          ["G#4"],
          "mp",
        ),
        event(5.5, 2, ["A4"], "p"),
      ],
    };
  }

  return empty;
}

function routeContent(
  step: number,
  route: RouteKey,
  mode: Accompanying,
): StepContent {
  const [first, second] = STEP_CHORDS[step]!;
  const leading: Lead = leadAt(route, step);
  const write = leadWrite(step, route, first, second);
  return {
    "guitar-bass": bassFor([first, second], mode),
    "guitar-harm": harmonyFor([first, second], mode),
    piano: leading === "piano" ? write.piano : [],
    marimba: leading === "marimba" ? write.marimba : [],
  };
}

// ---------------------------------------------------------------------------
// Source assembly.
// ---------------------------------------------------------------------------

const VOCABULARY_INSTRUMENTS = [
  "warm_piano",
  "marimba",
  "nylon_guitar",
] as const;

const HANDOFF_VOCABULARY = createAirVocabularyClosure({
  id: "handoff-study-language@1",
  instruments: CORE_AUTHORING_VOCABULARY.instruments
    .filter((instrument) =>
      (VOCABULARY_INSTRUMENTS as readonly string[]).includes(instrument.id),
    )
    .map((instrument) => ({
      id: instrument.id,
      label: instrument.label,
      family: instrument.family,
      midiMin: instrument.midiMin,
      midiMax: instrument.midiMax,
      status: instrument.status,
      authoringMeaning: instrument.authoringMeaning,
    })),
  techniques: [],
});

const VOICE_CONFIG: Record<
  VoiceId,
  {
    instrument: string;
    role: "bass" | "harmony" | "lead";
    gainDb: number;
    pan: number;
  }
> = {
  "guitar-bass": {
    instrument: "nylon_guitar",
    role: "bass",
    gainDb: 0,
    pan: 0.05,
  },
  "guitar-harm": {
    instrument: "nylon_guitar",
    role: "harmony",
    gainDb: -5,
    pan: 0.28,
  },
  piano: { instrument: "warm_piano", role: "lead", gainDb: 5, pan: -0.08 },
  marimba: { instrument: "marimba", role: "lead", gainDb: 4, pan: 0.14 },
};

const VOICE_ORDER: readonly VoiceId[] = [
  "guitar-bass",
  "guitar-harm",
  "piano",
  "marimba",
];

function accompanimentFor(route: RouteKey, step: number): Accompanying {
  if (step <= 1) return "driving";
  return leadAt(route, step) === "piano" ? "driving" : "open";
}

function contentForStep(step: number, route: RouteKey): StepContent {
  const mode = accompanimentFor(route, step);
  if (step === 0) return openingContent(0, mode);
  if (step === 1) return openingContent(1, mode);
  return routeContent(step, route, mode);
}

function leadForStep(step: number, route: RouteKey): Lead | undefined {
  if (step === 0) return "piano";
  if (step === 1) return "marimba";
  return leadAt(route, step);
}

/** A chunk is the exact two-bar phrase for one step and route. */
function chunkSourceForStep(step: number, route: RouteKey): AirSourceV1 {
  const content = contentForStep(step, route);
  const [first, second] = STEP_CHORDS[step]!;
  const voices: AirSourceV1["voices"] = [];
  for (const voiceId of VOICE_ORDER) {
    const events = content[voiceId];
    if (events.length === 0) continue;
    const config = VOICE_CONFIG[voiceId];
    voices.push({
      id: voiceId,
      instrument: config.instrument,
      role: config.role,
      gainDb: config.gainDb,
      pan: config.pan,
      realize: [{ id: "phrase", kind: "literal", part: stepPart(events) }],
    });
  }
  const label =
    step === 0
      ? "Piano introduction"
      : step === 1
        ? "Marimba answer"
        : `${capitalize(leadForStep(step, route) ?? "lead")} — ${first}→${second}`;
  return {
    format: "air@1-experimental",
    title: `${HANDOFF_TITLE} · step ${step + 1} · ${label}`,
    conductor: { tempo: TEMPO, meters: [{ bar: 1, meter: "4/4" }] },
    key: "A minor",
    vocabulary: structuredClone(HANDOFF_VOCABULARY),
    motifs: {},
    voices,
  };
}

/** A route is the complete 16-bar canonical performance. */
function routeSource(route: RouteKey): AirSourceV1 {
  const contents: StepContent[] = Array.from(
    { length: TOTAL_STEPS },
    (_, step) => contentForStep(step, route),
  );
  const voices: AirSourceV1["voices"] = [];
  for (const voiceId of VOICE_ORDER) {
    const config = VOICE_CONFIG[voiceId];
    const silent = contents.every((content) => content[voiceId].length === 0);
    if (silent) continue;
    const parts = contents.map((content) => {
      const events = content[voiceId];
      return events.length === 0 ? silentPart(1) : stepPart(events);
    });
    voices.push({
      id: voiceId,
      instrument: config.instrument,
      role: config.role,
      gainDb: config.gainDb,
      pan: config.pan,
      realize: [{ id: "route", kind: "literal", part: joinSteps(parts) }],
    });
  }
  return {
    format: "air@1-experimental",
    title: `${HANDOFF_TITLE} · ${route} route`,
    conductor: { tempo: TEMPO, meters: [{ bar: 1, meter: "4/4" }] },
    key: "A minor",
    vocabulary: structuredClone(HANDOFF_VOCABULARY),
    motifs: {},
    voices,
  };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ---------------------------------------------------------------------------
// Sealing. Each chunk and route becomes an exact Artifact@3 with the shared
// conservative acoustic binding. Nothing here renders audio.
// ---------------------------------------------------------------------------

function seal(source: AirSourceV1): unknown {
  const receipt = createRootReceiptV1(source);
  return createRefrainArtifactV3({
    source,
    receipt,
    performanceBinding: F_ACOUSTIC_CHAMBER_PERFORMANCE_BINDING,
    defaultBindingId: F_ACOUSTIC_CHAMBER_PERFORMANCE_BINDING.id,
    caption:
      "An independent phrase-handoff study. No listening acceptance is claimed.",
  });
}

function visibleNotes(source: AirSourceV1): VisibleNote[] {
  const compiled = compileAirV1(source).compiled;
  if (!compiled) throw new Error(`Chunk AIR did not compile: ${source.title}`);
  const voiceOf: Record<string, VisibleNote["voice"]> = {
    "guitar-bass": "guitar",
    "guitar-harm": "guitar",
    piano: "piano",
    marimba: "marimba",
  };
  return compiled.events
    .map((item) => ({
      at: round(item.notatedStartBeat),
      beats: round(item.durationBeats),
      midi: item.midi,
      voice: voiceOf[item.voiceId as VoiceId] ?? "guitar",
    }))
    .sort((left, right) => left.at - right.at || left.midi - right.midi);
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export function createScore(): StudyScore {
  const routeKeys: RouteKey[] = ["pp", "pm", "mp", "mm"];

  // Build every (step, route) chunk once, deduplicating genuinely identical
  // phrases: pre-gate steps 0-1 are byte-identical across all four routes.
  const chunksById = new Map<string, ScoreChunk>();
  const byMaterial = new Map<string, string>();
  const stepChunkIds: Record<RouteKey, string[]> = {
    pp: [],
    pm: [],
    mp: [],
    mm: [],
  };
  for (const route of routeKeys) {
    for (let step = 0; step < TOTAL_STEPS; step += 1) {
      const source = chunkSourceForStep(step, route);
      const material = JSON.stringify([step, source.voices]);
      const id = byMaterial.get(material) ?? `step${step + 1}-${route}`;
      byMaterial.set(material, id);
      if (!chunksById.has(id)) {
        chunksById.set(id, {
          id,
          title: source.title,
          artifact: seal(source),
          notes: visibleNotes(source),
        });
      }
      stepChunkIds[route].push(id);
    }
  }

  const steps: ScoreStep[] = Array.from({ length: TOTAL_STEPS }, (_, step) => {
    const [first, second] = STEP_CHORDS[step]!;
    return {
      id: `step-${step + 1}`,
      title: [
        "钢琴起句",
        "半拍回答",
        "把句子借走",
        "往上走一点",
        "留下空隙",
        "带回来",
        "慢慢落下",
        "句号",
      ][step]!,
      description: `${["先稳稳地说一句。", "木琴把重音放在半拍之后。", "接过主题，改变它的步态。", "同一个弧线，走到新的和声里。", "让下一句进来之前，留一点空。", "熟悉的声音，带着前面借来的习惯。", "不急着结束，先把句子放低。", "向家里落下，余音留给房间。"][step]}  ${first} → ${second}`,
      lead: {
        pp: leadForStep(step, "pp")!,
        pm: leadForStep(step, "pm")!,
        mp: leadForStep(step, "mp")!,
        mm: leadForStep(step, "mm")!,
      },
      chunks: {
        pp: stepChunkIds.pp[step]!,
        pm: stepChunkIds.pm[step]!,
        mp: stepChunkIds.mp[step]!,
        mm: stepChunkIds.mm[step]!,
      },
    };
  });

  const routes: Record<RouteKey, unknown> = {
    pp: seal(routeSource("pp")),
    pm: seal(routeSource("pm")),
    mp: seal(routeSource("mp")),
    mm: seal(routeSource("mm")),
  };

  return {
    format: "handoff-study-work@0",
    id: HANDOFF_ID,
    title: HANDOFF_TITLE,
    tempo: TEMPO,
    phraseBeats: PHRASE_BEATS,
    defaultRoute: ["marimba", "piano"],
    steps,
    chunks: [...chunksById.values()],
    routes,
  };
}

/** Exposed for tests and the example generator: the canonical route sources. */
export function routeSources(): Record<RouteKey, AirSourceV1> {
  return {
    pp: routeSource("pp"),
    pm: routeSource("pm"),
    mp: routeSource("mp"),
    mm: routeSource("mm"),
  };
}

/** Exposed for tests: compiled route source. */
export function compileRoute(route: RouteKey): ReturnType<typeof compileAirV1> {
  return compileAirV1(routeSource(route));
}

/** Exposed for tests: compiled chunk source by step and route. */
export function compileChunk(
  step: number,
  route: RouteKey,
): ReturnType<typeof compileAirV1> {
  return compileAirV1(chunkSourceForStep(step, route));
}

export { VOICE_ORDER, STEP_CHORDS };
