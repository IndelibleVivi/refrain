/** This experiment is independent of AIR, native bindings and receipts. */
export interface ScoreNote {
  id: string;
  at: number;
  beats: number;
  midi: number;
  velocity: number;
  pan: number;
  part: "melody" | "harmony" | "bass";
}
export interface Settings {
  breath: number;
  color: number;
  space: number;
}
export interface Work {
  format: "breath-study-work@0";
  title: string;
  tempo: number;
  lengthBeats: number;
  notes: ScoreNote[];
  /** Insert a pause before each named beat; notes crossing it keep their decay. */
  breaths: number[];
  settings: Settings;
}
export interface SoundNote extends ScoreNote {
  start: number;
  duration: number;
}
export interface Program {
  notes: SoundNote[];
  duration: number;
  musicEnd: number;
  settings: Settings;
  gaps: { start: number; end: number }[];
}
export interface PCM {
  left: Float32Array;
  right: Float32Array;
}
export type Status = "idle" | "preparing" | "playing" | "paused" | "ended";
