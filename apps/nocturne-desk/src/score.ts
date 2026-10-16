import {
  createAirVocabularyClosure,
  type AirSourceV1,
} from "@refrain/air-schema/v1";
import { compileAirV1 } from "@refrain/compiler/v1";
import { sha256Id } from "@refrain/identity";
import { createRefrainArtifactV3 } from "@refrain/renderer/portable";
import { createRootReceiptV1 } from "@refrain/renderer/v1";
import { F_ACOUSTIC_CHAMBER_PERFORMANCE_BINDING as binding } from "@refrain/soundpack";
import { CORE_AUTHORING_VOCABULARY } from "@refrain/soundpack/vnext";
import {
  VOICE_IDS,
  type Score,
  type Session,
  type VoiceId,
  type Note,
} from "./contracts";

/** Authored musical material: CC BY-NC-SA 4.0. Builders: SUL-1.0. */
export const TITLE = "The Lantern Score · 灯下乐谱";
const TITLES = [
  "点灯",
  "纸上的河",
  "小小远行",
  "暗面的花",
  "再靠近",
  "留一盏灯",
];
const HARMONY = [
  "Dmaj7 · Bm7 · Gmaj7 · Asus4",
  "Gmaj7 · Em7 · A7 · Dadd9",
  "Bm · F♯m7 · Gmaj7 · A",
  "Em7 · Gm6 · D/F♯ · A7",
  "D · Gmaj7 · A · Bm7",
  "Gmaj7 · D/F♯ · A7 · D",
];
const PARTS: Record<VoiceId, string[]> = {
  piano: [
    "r/4 F#4/8@mp A4/8@mp E5/4@mp D5/4@p | F#4/4@mp A4/8@mp B4/8@mp F#4/2@p | G4/4@mp B4/4@mp A4/4@p F#4/4@p | E4/2@p D4/4@p r/4",
    "B4/4@mp D5/8@mp B4/8@mp A4/4@mp G4/4@p | B4/4@mp G4/4@p F#4/4@p E4/4@p | C#5/4@mp B4/8@mp A4/8@mp G4/4@mp E4/4@p | F#4/2@p E4/4@p D4/4@p",
    "F#4/8@mp A4/8@mp B4/4@mf D5/4@mf C#5/4@mp | A4/4@mp C#5/4@mf E5/8@mf C#5/8@mp A4/4@mp | B4/4@mf D5/4@mf F#5/4@mf E5/4@mp | C#5/4@mp B4/4@mp A4/2@p",
    "G4/2@p F#4/4@p E4/4@p | Bb4/4@mp A4/4@p G4/2@p | F#4/4@p A4/4@p E5/4@mp D5/4@p | C#5/2@p E4/4@pp r/4",
    "F#4/8@mp A4/8@mp E5/4@mf D5/4@mp A4/4@mp | G4/4@mp B4/4@mf D5/4@mp A4/4@p | E5/4@mf C#5/8@mp B4/8@mp A4/4@mp G4/4@p | F#4/2@mp D5/4@p B4/4@p",
    "B4/4@p A4/4@p G4/2@p | F#4/4@p A4/4@p E4/2@pp | E4/4@p G4/4@p C#4/4@pp E4/4@pp | D4/1@pp",
  ],
  harp: [
    "D3/4@p A3/8@p C#4/8@pp F#4/4@pp A3/4@pp | B2/4@p F#3/8@p A3/8@pp D4/4@p F#3/4@pp | G2/4@p D3/8@p F#3/8@pp B3/4@p D4/4@pp | A2/2@p E3/4@pp A3/4@pp",
    "G3/8@p B3/8@p D4/8@p F#4/8@p D4/8@p B3/8@pp A3/4@pp | E3/8@p G3/8@p B3/8@p D4/8@p B3/8@p G3/8@pp F#3/4@pp | A2/8@p E3/8@p G3/8@p C#4/8@p E4/8@p G3/8@pp E3/4@pp | D3/4@p A3/8@p E4/8@p F#4/4@pp A3/4@pp",
    "B2/8@mp F#3/8@p B3/8@p D4/8@p F#4/4@p D4/4@pp | F#3/8@mp A3/8@p C#4/8@p E4/8@p C#4/4@p A3/4@pp | G3/8@mp B3/8@p D4/8@p F#4/8@p A4/4@p F#4/4@pp | A2/8@p E3/8@p A3/8@p C#4/8@p E4/2@pp",
    "E3/4@pp B3/4@pp G4/2@pp | G3/4@p D4/4@pp E4/4@pp Bb3/4@pp | F#3/4@pp A3/4@pp D4/2@pp | A2/2@pp G3/4@pp C#4/4@pp",
    "D3/8@mp A3/8@p C#4/8@p F#4/8@p E4/8@p C#4/8@pp A3/4@p | G3/8@mp D4/8@p F#4/8@p B4/8@p A4/8@p F#4/8@pp D4/4@p | A2/8@mp E3/8@p A3/8@p C#4/8@p E4/4@p A3/4@pp | B2/4@p F#3/8@p A3/8@p D4/2@pp",
    "G3/4@p D4/4@pp B3/2@pp | F#3/4@p A3/4@pp D4/2@pp | A2/2@pp E3/4@pp G3/4@pp | D3/2@pp A3/4@pp D4/4@pp",
  ],
  cello: [
    "D3/2@p A2/2@pp | B2/2@p F#2/2@pp | G2/2@p B2/2@pp | A2/1@pp",
    "G2/2@p D3/2@p | E3/2@p B2/2@pp | A2/2@p C#3/4@p E3/4@pp | D3/1@p",
    "B2/2@mp D3/4@p F#3/4@p | F#2/2@p A2/2@p | G2/2@mp B2/4@p D3/4@p | A2/1@p",
    "E3/2@p D3/2@pp | G2/2@p Bb2/2@p | F#2/2@p A2/2@pp | A2/2@p E3/2@pp",
    "D3/2@mp F#3/4@p E3/4@p | G2/2@p D3/2@p | A2/2@p E3/4@p C#3/4@pp | B2/1@p",
    "G2/2@p D3/2@pp | F#2/2@p A2/2@pp | A2/2@p C#3/2@pp | D3/1@pp",
  ],
  marimba: [
    "r/2 A5/8@pp F#5/8@pp r/4 | r/2 F#5/4@pp D5/4@pp | r/4 D5/8@p F#5/8@pp B5/4@pp r/4 | r/2 E5/4@pp r/4",
    "r/4 B5/8@p A5/8@pp G5/4@pp r/4 | r/4 G5/8@p E5/8@pp B5/4@pp r/4 | r/2 G5/8@p E5/8@pp C#5/4@pp | r/4 A5/4@pp F#5/4@pp r/4",
    "r/4 F#5/8@p A5/8@p B5/4@mp r/4 | r/4 A5/8@p C#6/8@p A5/4@p r/4 | r/4 B5/8@mp D6/8@p B5/4@p r/4 | E5/4@p r/4 C#5/4@pp r/4",
    "r/2 B5/4@pp G5/4@pp | r/2 Bb5/4@pp A5/4@pp | r/2 A5/4@pp F#5/4@pp | r/2 G5/4@pp E5/4@pp",
    "r/4 A5/8@p F#5/8@p E5/4@pp r/4 | r/4 B5/8@p D6/8@p B5/4@pp r/4 | r/4 E5/8@p G5/8@p A5/4@p r/4 | r/2 F#5/4@pp D5/4@pp",
    "r/2 D6/4@pp B5/4@pp | r/2 A5/4@pp F#5/4@pp | r/2 E5/4@pp C#5/4@pp | D5/2@pp r/2",
  ],
};
const config: Record<
  VoiceId,
  {
    instrument: string;
    role: "lead" | "harmony" | "bass";
    gainDb: number;
    pan: number;
  }
> = {
  piano: { instrument: "warm_piano", role: "lead", gainDb: 5, pan: -0.12 },
  harp: { instrument: "harp", role: "harmony", gainDb: -1, pan: 0.3 },
  cello: { instrument: "solo_cello", role: "bass", gainDb: -2, pan: -0.25 },
  marimba: { instrument: "marimba", role: "harmony", gainDb: 0, pan: 0.2 },
};
const vocabulary = createAirVocabularyClosure({
  id: "lantern-chamber-vocabulary@0",
  instruments: CORE_AUTHORING_VOCABULARY.instruments
    .filter((i) => Object.values(config).some((c) => c.instrument === i.id))
    .map((i) => ({
      id: i.id,
      label: i.label,
      family: i.family,
      midiMin: i.midiMin,
      midiMax: i.midiMax,
      status: i.status,
      authoringMeaning: i.authoringMeaning,
    })),
  techniques: [],
});
const SILENCE = "r/1 | r/1 | r/1 | r/1";
export function stemSource(section: number, voice: VoiceId): AirSourceV1 {
  if (
    !Number.isInteger(section) ||
    section < 0 ||
    section > 5 ||
    !VOICE_IDS.includes(voice)
  )
    throw new Error("Unknown score stem.");
  return {
    format: "air@1-experimental",
    title: `${TITLE} · ${TITLES[section]} · ${voice}`,
    conductor: { tempo: 88, meters: [{ bar: 1, meter: "4/4" }] },
    key: "D major",
    vocabulary: structuredClone(vocabulary),
    motifs: {},
    voices: [
      {
        id: voice,
        ...config[voice],
        realize: [
          {
            id: `page${section + 1}`,
            kind: "literal",
            part: PARTS[voice][section]!,
          },
        ],
      },
    ],
  };
}
let cached: Score | undefined;
export function createScore(): Score {
  if (!cached) {
    const id = sha256Id(
      JSON.stringify({
        domain: "nocturne-desk-work@0",
        parts: PARTS,
        config,
        tempo: 88,
        binding,
        vocabulary,
        titles: TITLES,
      }),
    );
    cached = {
      id,
      title: TITLE,
      tempo: 88,
      beatsPerSection: 16,
      sections: TITLES.map((title, i) => {
        const notes = {} as Record<VoiceId, Note[]>;
        for (const voice of VOICE_IDS) {
          const c = compileAirV1(stemSource(i, voice));
          if (!c.compiled) throw new Error(JSON.stringify(c.diagnostics));
          notes[voice] = c.compiled.events.map((n) => ({
            at: n.notatedStartBeat,
            duration: n.durationBeats,
            midi: n.midi,
            velocity: n.velocity,
          }));
        }
        return { id: `page-${i + 1}`, title, harmony: HARMONY[i]!, notes };
      }),
    };
  }
  return structuredClone(cached);
}
export function buildSource(session: Session): AirSourceV1 {
  if (
    session.workId !== createScore().id ||
    session.arrangement.length !== 6 ||
    session.arrangement.some(
      (r) =>
        r.length !== 4 ||
        !r.some(Boolean) ||
        r.some((v) => typeof v !== "boolean"),
    )
  )
    throw new Error("Invalid orchestration.");
  return {
    format: "air@1-experimental",
    title: session.title,
    conductor: { tempo: 88, meters: [{ bar: 1, meter: "4/4" }] },
    key: "D major",
    vocabulary: structuredClone(vocabulary),
    motifs: {},
    voices: VOICE_IDS.filter((_, v) =>
      session.arrangement.some((r) => r[v]),
    ).map((voice) => ({
      id: voice,
      ...config[voice],
      realize: TITLES.map((_, i) => ({
        id: `page${i + 1}`,
        kind: "literal" as const,
        section: TITLES[i],
        part: session.arrangement[i]![VOICE_IDS.indexOf(voice)]
          ? PARTS[voice][i]!
          : SILENCE,
      })),
    })),
  };
}
export function buildArtifact(session: Session) {
  const source = buildSource(session);
  return createRefrainArtifactV3({
    source,
    receipt: createRootReceiptV1(source),
    performanceBinding: binding,
    defaultBindingId: binding.id,
    caption:
      "Six pages, four voices, a little light left on. An authored orchestration study.",
  });
}
