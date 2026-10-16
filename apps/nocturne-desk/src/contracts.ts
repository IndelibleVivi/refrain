export const VOICE_IDS = ["piano", "harp", "cello", "marimba"] as const;
export type VoiceId = (typeof VOICE_IDS)[number];
export interface Note {
  at: number;
  duration: number;
  midi: number;
  velocity: number;
}
export interface Score {
  id: string;
  title: string;
  tempo: 88;
  beatsPerSection: 16;
  sections: {
    id: string;
    title: string;
    harmony: string;
    notes: Record<VoiceId, Note[]>;
  }[];
}
export interface Session {
  format: "nocturne-desk-session@0";
  workId: string;
  title: string;
  arrangement: boolean[][];
}
export interface AudioRef {
  file: string;
  bytes: number;
  sha256: string;
  frames: number;
}
export interface Manifest {
  format: "nocturne-desk-manifest@0";
  score: Score;
  audio: Record<string, AudioRef>;
  mixGain: number;
}
export type Preset = "manuscript" | "solitude" | "constellation";
