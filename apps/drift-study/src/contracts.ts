/** Local experimental work; deliberately not AIR, a binding, or a receipt. */
export type Layers = "both" | "a" | "b";
export interface Rules {
  drift: number;
  erosion: number;
  bloom: number;
}
export interface MaterialNote {
  midi: number;
  at: number;
  duration: number;
}
export interface Work {
  format: "drift-study-work@0";
  title: string;
  duration: number;
  loopSeconds: number;
  notes: MaterialNote[];
  rules: Rules;
}
export type Gesture =
  | { at: number; kind: "rules"; rules: Rules }
  | { at: number; kind: "freeze"; frozen: boolean }
  | { at: number; kind: "layers"; layers: Layers }
  | { at: number; kind: "pluck"; note: number; layers: Layers };
export interface Bookmark {
  name: string;
  at: number;
  gestures: Gesture[];
}
export type SessionFormat = "drift-study-session@0" | "drift-study-session@1";
export interface Session {
  format: SessionFormat;
  work: Work;
  gestures: Gesture[];
  cursor: number;
  bookmarks: Bookmark[];
}
export interface Moment {
  phaseA: number;
  phaseB: number;
  evolution: number;
  erosion: number;
  bloom: number;
  frozen: boolean;
  layers: Layers;
  rules: Rules;
}
export type PlaybackStatus = "idle" | "playing" | "paused" | "ended";
