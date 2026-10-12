import type { Lead, RouteKey, StudyManifest } from "./contracts";
export function fixture(): StudyManifest {
  const keys = ["pp", "pm", "mp", "mm"] as const;
  return {
    format: "handoff-study-audio@0",
    mixGain: 0.8,
    score: {
      format: "handoff-study-work@0",
      id: "test",
      title: "test",
      tempo: 96,
      phraseBeats: 8,
      defaultRoute: ["marimba", "piano"],
      chunks: ["p", "m"].map((id) => ({
        id,
        title: id,
        artifact: { format: "test-only" },
        notes: [],
      })),
      routes: Object.fromEntries(keys.map((k) => [k, {}])) as Record<
        RouteKey,
        unknown
      >,
      steps: Array.from({ length: 8 }, (_, i) => ({
        id: `s${i}`,
        title: `phrase ${i}`,
        description: "",
        chunks: Object.fromEntries(
          keys.map((k) => [k, i < 2 ? "p" : i < 5 ? k[0] : k[1]]),
        ) as Record<RouteKey, string>,
        lead: Object.fromEntries(
          keys.map((k) => [
            k,
            (i < 2 ? "p" : i < 5 ? k[0] : k[1]) === "p" ? "piano" : "marimba",
          ]),
        ) as Record<RouteKey, Lead>,
      })),
    },
    audio: Object.fromEntries(
      ["p", "m"].map((id) => [
        id,
        {
          file: `${id}.wav`,
          bytes: 44 + 300000 * 4,
          sha256: "a".repeat(64),
          sampleRate: 44100,
          frames: 300000,
        },
      ]),
    ),
  };
}
