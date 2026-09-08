import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseAir } from "@refrain/air-schema";
import { compileAir } from "@refrain/compiler";
import { COMPLETE_PIECE_VCSL_PERFORMANCE_BINDING } from "@refrain/soundpack";
import { createExecutionBundle } from "./execution.js";
import {
  ExecutionTransportController,
  activeEventIndexesAt,
  createExecutionCursor,
  pullExecutionWindow,
  reconstructExecutionEventAt,
  sectionFrame,
} from "./execution-transport.js";

function fixture() {
  const parsed = parseAir(
    readFileSync(
      "fixtures/complete-piece/relational-complete.air.json",
      "utf8",
    ),
  );
  const compiled = parsed.source
    ? compileAir(parsed.source).compiled
    : undefined;
  if (!compiled) throw new Error("Fixture did not compile.");
  return createExecutionBundle(compiled);
}

describe("indexed execution transport", () => {
  it("pulls only horizon attacks and releases", () => {
    const bundle = fixture();
    const cursor = createExecutionCursor(bundle, 0, 1);
    const window = pullExecutionWindow(bundle, cursor, 0, 11_025);
    expect(window.attacks.length).toBeLessThan(100);
    expect(cursor.nextStartIndex).toBe(window.attacks.length);
    expect(window.attacks.length).toBeLessThan(bundle.compiled.events.length);
  });

  it("reconstructs through two-second checkpoints", () => {
    const bundle = fixture();
    const frame = REFERENCE_FRAME * 37;
    const active = activeEventIndexesAt(bundle, frame);
    expect(active.length).toBeGreaterThan(0);
    const controller = new ExecutionTransportController(bundle);
    controller.command({ type: "prepare", targetFrame: frame });
    const playing = controller.command({ type: "play" });
    expect(playing.positionFrame).toBe(frame);
    expect(playing.activeVoices.length).toBe(active.length);
    expect(playing.sceneState.checkpointFrame).toBeGreaterThanOrEqual(
      frame - REFERENCE_FRAME * 2,
    );
  });

  it("keeps section jump, stop, and restart on one plan", () => {
    const bundle = fixture();
    const controller = new ExecutionTransportController(bundle);
    const jumped = controller.command({ type: "jump", sectionId: "answer" });
    expect(jumped.positionFrame).toBe(sectionFrame(bundle, "answer"));
    expect(controller.command({ type: "stop" }).positionFrame).toBe(0);
    const restarted = controller.command({ type: "restart" });
    expect(restarted.performancePlanSha256).toBe(bundle.planSha256);
    expect(restarted.status).toBe("playing");
  });

  it("reconstructs an already-looping late sampler without replaying from zero", () => {
    const parsed = parseAir(
      readFileSync(
        "fixtures/complete-piece/relational-complete.air.json",
        "utf8",
      ),
    );
    const compiled = parsed.source
      ? compileAir(parsed.source).compiled
      : undefined;
    if (!compiled) throw new Error("Fixture did not compile.");
    const bundle = createExecutionBundle(compiled, {
      performanceBinding: COMPLETE_PIECE_VCSL_PERFORMANCE_BINDING,
    });
    const eventIndex = compiled.events.findIndex(
      (event) => event.voiceId === "late_sustain",
    );
    const startFrame = bundle.index.eventStartFrames[eventIndex]!;
    const targetFrame = startFrame + Math.round(8.5 * REFERENCE_FRAME);
    const reconstructed = reconstructExecutionEventAt(
      bundle,
      eventIndex,
      targetFrame,
    );
    expect(reconstructed?.event.sample?.loop.mode).toBe("sustain");
    expect(reconstructed?.state.phase).toBe("sustain");
    expect(reconstructed?.state.attackSourceOffsetFrames).toBeGreaterThan(
      reconstructed?.event.sample?.loop.mode === "sustain"
        ? reconstructed.event.sample.loop.endFrame
        : 0,
    );
  });

  it("keeps synth release tails reconstructable after note-off", () => {
    const bundle = fixture();
    const voiceById = new Map(
      bundle.plan.voices.map((voice) => [voice.voiceId, voice]),
    );
    const eventIndex = bundle.compiled.events.findIndex(
      (event) => voiceById.get(event.voiceId)?.engine === "synth",
    );
    const noteOffFrame = bundle.index.noteOffFrames[eventIndex]!;
    const targetFrame = noteOffFrame + Math.round(REFERENCE_FRAME * 0.25);
    const reconstructed = reconstructExecutionEventAt(
      bundle,
      eventIndex,
      targetFrame,
    );
    expect(bundle.index.renderEndFrames[eventIndex]).toBeGreaterThan(
      noteOffFrame,
    );
    expect(reconstructed?.state.phase).toBe("release");
    expect(reconstructed?.state.oscillatorPhaseCycles).toBeTypeOf("number");
  });
});

const REFERENCE_FRAME = 44_100;
