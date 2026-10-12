export type Lead = "piano" | "marimba";
export type RouteKey = "pp" | "pm" | "mp" | "mm";
export interface VisibleNote {
  at: number;
  beats: number;
  midi: number;
  voice: "piano" | "marimba" | "guitar";
}
export interface ScoreChunk {
  id: string;
  title: string;
  /** Exact Artifact@3 for this authored phrase. */
  artifact: unknown;
  notes: VisibleNote[];
}
export interface ScoreStep {
  id: string;
  title: string;
  description: string;
  lead: Record<RouteKey, Lead>;
  chunks: Record<RouteKey, string>;
}
export interface StudyScore {
  format: "handoff-study-work@0";
  id: string;
  title: string;
  tempo: number;
  phraseBeats: number;
  /** Two choices, entering step 2 and step 5. Default mp. */
  defaultRoute: [Lead, Lead];
  steps: ScoreStep[];
  chunks: ScoreChunk[];
  /** Full canonical AIR performances remain separately inspectable. */
  routes: Record<RouteKey, unknown>;
}
export interface AudioReference {
  file: string;
  bytes: number;
  sha256: string;
  sampleRate: number;
  frames: number;
}
export interface StudyManifest {
  format: "handoff-study-audio@0";
  score: StudyScore;
  audio: Record<string, AudioReference>;
  /** One explicit session mixer level, shared by realtime and WAV. */
  mixGain: number;
}
export interface Choice {
  gate: 0 | 1;
  lead: Lead;
  requestedBeat: number;
  effectiveBeat: number;
}
export interface StudySession {
  format: "handoff-study-session@0";
  work: StudyScore;
  /** Exact prepared-audio references prevent a saved route silently changing sound. */
  audio: Record<string, AudioReference>;
  mixGain: number;
  choices: Choice[];
}
