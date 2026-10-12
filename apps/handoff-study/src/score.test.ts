import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { compileAirV1 } from "@refrain/compiler/v1";
import { parseRefrainArtifact } from "@refrain/renderer/portable";
import {
  createScore,
  compileChunk,
  compileRoute,
  leadAt,
  routeSources,
} from "./score.js";
import type { RouteKey } from "./contracts.js";

const ROUTES: RouteKey[] = ["pp", "pm", "mp", "mm"];

describe("handoff study score", () => {
  const score = createScore();

  it("is an eight-step, eight-beat, 96 BPM A-minor form", () => {
    expect(score.format).toBe("handoff-study-work@0");
    expect(score.tempo).toBe(96);
    expect(score.phraseBeats).toBe(8);
    expect(score.steps).toHaveLength(8);
    expect(score.defaultRoute).toEqual(["marimba", "piano"]);
  });

  it("introduces piano then marimba before the first gate", () => {
    expect(score.steps[0]!.lead.mp).toBe("piano");
    expect(score.steps[1]!.lead.mp).toBe("marimba");
    // Shared pre-gate chunks are identical for every route.
    for (const route of ROUTES) {
      expect(score.steps[0]!.chunks[route]).toBe(score.steps[0]!.chunks.mp);
      expect(score.steps[1]!.chunks[route]).toBe(score.steps[1]!.chunks.mp);
    }
  });

  it("gates at step 2 (beat 16) and step 5 (beat 40)", () => {
    for (const route of ROUTES) {
      expect(leadAt(route, 2)).toBe(route[0] === "p" ? "piano" : "marimba");
      expect(leadAt(route, 4)).toBe(route[0] === "p" ? "piano" : "marimba");
      expect(leadAt(route, 5)).toBe(route[1] === "p" ? "piano" : "marimba");
      expect(leadAt(route, 7)).toBe(route[1] === "p" ? "piano" : "marimba");
    }
  });

  it("compiles every chunk and route to an exact 16-bar artifact graph", () => {
    for (const route of ROUTES) {
      const compiled = compileRoute(route);
      expect(compiled.diagnostics).toEqual([]);
      expect(compiled.compiled).toBeDefined();
      expect(compiled.compiled!.durationBeats).toBe(64);
      expect(compiled.compiled!.bars).toBe(16);
    }
    for (const chunk of score.chunks) {
      const parsed = parseRefrainArtifact(chunk.artifact);
      expect(parsed.ok).toBe(true);
    }
    for (const route of ROUTES) {
      const parsed = parseRefrainArtifact(score.routes[route]);
      expect(parsed.ok).toBe(true);
    }
  });

  it("keeps chunk note facts equal to the compiled phrase", () => {
    for (const route of ROUTES) {
      for (let step = 0; step < 8; step += 1) {
        const chunkId = score.steps[step]!.chunks[route];
        const chunk = score.chunks.find((c) => c.id === chunkId)!;
        const compiled = compileChunk(step, route).compiled!;
        const fromEvents = compiled.events
          .map((e) => ({ at: e.notatedStartBeat, midi: e.midi }))
          .sort((a, b) => a.at - b.at || a.midi - b.midi);
        const fromNotes = chunk.notes
          .map((n) => ({ at: n.at, midi: n.midi }))
          .sort((a, b) => a.at - b.at || a.midi - b.midi);
        expect(fromEvents).toEqual(fromNotes);
      }
    }
  });

  it("preserves the pre-gate prefix at source level across routes", () => {
    for (const route of ROUTES) {
      // Steps 0-1 voices compile identically across routes in beats [0,16).
      const reference = compileRoute("pp").compiled!;
      const current = compileRoute(route).compiled!;
      const prefix = (events: typeof current.events) =>
        events
          .filter((e) => e.notatedStartBeat < 16)
          .map((e) => [e.voiceId, e.notatedStartBeat, e.midi, e.durationBeats]);
      expect(prefix(current.events)).toEqual(prefix(reference.events));
      // And the prefix matches the shared chunk sources (shifted by step).
      for (const step of [0, 1] as const) {
        const chunkEvents = compileChunk(step, route).compiled!.events.map(
          (e) => [
            e.voiceId,
            e.notatedStartBeat + step * 8,
            e.midi,
            e.durationBeats,
          ],
        );
        const routeEvents = current.events
          .filter(
            (e) =>
              e.notatedStartBeat >= step * 8 &&
              e.notatedStartBeat < step * 8 + 8,
          )
          .map((e) => [e.voiceId, e.notatedStartBeat, e.midi, e.durationBeats]);
        expect(routeEvents).toEqual(chunkEvents);
      }
    }
  });

  it("makes alternative routes genuinely different music", () => {
    const fingerprint = (route: RouteKey) =>
      compileRoute(route)
        .compiled!.events.map(
          (e) => `${e.voiceId}:${e.notatedStartBeat}:${e.midi}`,
        )
        .join("|");
    const prints = ROUTES.map(fingerprint);
    expect(new Set(prints).size).toBe(4);
  });
  it("keeps the first choice in the returning music and the second gate causal", () => {
    const facts = (route: RouteKey, from: number, to = 64) =>
      compileRoute(route)
        .compiled!.events.filter(
          (e) => e.notatedStartBeat >= from && e.notatedStartBeat < to,
        )
        .map((e) => [e.voiceId, e.notatedStartBeat, e.midi, e.durationBeats]);
    expect(facts("pp", 16, 40)).toEqual(facts("pm", 16, 40));
    expect(facts("mp", 16, 40)).toEqual(facts("mm", 16, 40));
    expect(facts("pp", 40)).not.toEqual(facts("mp", 40));
    expect(facts("pm", 40)).not.toEqual(facts("mm", 40));
  });
  it("keeps checked-in sources and exact artifacts synchronized", async () => {
    const sources = routeSources();
    for (const route of ROUTES) {
      expect(
        JSON.parse(
          await readFile(
            new URL(
              `../../../examples/handoff-study/${route}.air.json`,
              import.meta.url,
            ),
            "utf8",
          ),
        ),
      ).toEqual(sources[route]);
      expect(
        JSON.parse(
          await readFile(
            new URL(
              `../../../examples/handoff-study/${route}.refrain.json`,
              import.meta.url,
            ),
            "utf8",
          ),
        ),
      ).toEqual(score.routes[route]);
    }
  });
});
