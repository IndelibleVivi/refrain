import { describe, expect, it } from "vitest";
import type { StaticSynthPatch } from "@refrain/soundpack";
import { CompletePieceBrowserEngine } from "./complete-browser.js";
import {
  scheduleHeldEnvelope,
  type EnvelopeAutomationParam,
} from "./envelope.js";
import type { ExecutionBundle } from "./execution.js";
import type { PerformanceEvent, PerformanceVoice } from "./performance.js";

const airPad: StaticSynthPatch = {
  format: "refrain-synth-subtractive@0-experimental",
  oscillators: [{ type: "sine", ratio: 1, gain: 1 }],
  attack: 0.8,
  decay: 0.7,
  sustain: 0.62,
  release: 1.4,
  filterHz: 1800,
  filterQ: 0.7,
};

const modal: StaticSynthPatch = {
  format: "refrain-synth-modal@0-experimental",
  modes: [{ ratio: 1, gain: 1, decaySeconds: 2 }],
  attack: 0.2,
  release: 1,
};

type AutomationCall =
  | { kind: "set"; time: number; value: number }
  | { kind: "linear"; time: number; value: number };

class LinearAutomationParam implements EnvelopeAutomationParam {
  readonly calls: AutomationCall[] = [];

  setValueAtTime(value: number, time: number): void {
    this.calls.push({ kind: "set", time, value });
  }

  linearRampToValueAtTime(value: number, time: number): void {
    this.calls.push({ kind: "linear", time, value });
  }

  valueAt(time: number): number {
    let previous = this.calls[0];
    if (!previous || time <= previous.time) return previous?.value ?? 0.0001;
    for (const call of this.calls.slice(1)) {
      if (time < call.time) {
        if (call.kind !== "linear") return previous.value;
        const progress = (time - previous.time) / (call.time - previous.time);
        return previous.value + (call.value - previous.value) * progress;
      }
      previous = call;
    }
    return previous.value;
  }
}

class BrowserGainParam extends LinearAutomationParam {
  readonly curveCalls: Array<{
    curve: Float32Array;
    start: number;
    duration: number;
  }> = [];

  setValueCurveAtTime(
    curve: Float32Array,
    start: number,
    duration: number,
  ): void {
    this.curveCalls.push({ curve, start, duration });
  }
}

function browserHarness(patch: StaticSynthPatch, soundingDurationBeats = 1) {
  const gain = new BrowserGainParam();
  const nodes: Array<{ type: string; connects: unknown[] }> = [];
  const makeNode = (type: string) => {
    const node = {
      type,
      connects: [] as unknown[],
      connect(target: unknown) {
        node.connects.push(target);
        return target;
      },
    };
    nodes.push(node);
    return node;
  };
  const context = {
    createGain: () => ({ ...makeNode("gain"), gain }),
    createStereoPanner: () => ({ ...makeNode("panner"), pan: { value: 0 } }),
    createBiquadFilter: () => ({
      ...makeNode("filter"),
      type: "",
      frequency: { value: 0 },
      Q: { value: 0 },
    }),
    createOscillator: () => ({
      ...makeNode("oscillator"),
      type: "sine",
      frequency: { value: 0 },
      detune: { value: 0 },
      start() {},
      stop() {},
      setPeriodicWave() {},
      addEventListener() {},
    }),
    createPeriodicWave: () => ({}),
  };
  const engine = Object.create(
    CompletePieceBrowserEngine.prototype,
  ) as CompletePieceBrowserEngine;
  const internals = engine as unknown as Record<string, any>;
  internals.context = context;
  internals.bundle = {
    compiled: { tempo: 60 },
  } as unknown as ExecutionBundle;
  internals.voiceById = new Map();
  internals.activeSynth = new Set();
  internals.monitoredDestinationForVoice = () => ({});
  const event: PerformanceEvent = {
    id: "event",
    voiceId: "voice",
    midi: 60,
    startBeat: 0,
    durationBeats: soundingDurationBeats,
    soundingDurationBeats,
    noteOffBeat: soundingDurationBeats,
    effectiveGainDb: 0,
    performanceVelocity: 1,
  } as PerformanceEvent;
  const voice = {
    voiceId: "voice",
    engine: "synth",
    pan: 0,
    patch,
  } as PerformanceVoice;
  return { gain, internals, event, voice };
}

function schedule(
  patch: StaticSynthPatch,
  elapsedSeconds: number,
  noteOffSeconds: number,
  start = 10,
): LinearAutomationParam {
  const param = new LinearAutomationParam();
  scheduleHeldEnvelope(param, patch, {
    start,
    elapsedSeconds,
    noteOffSeconds,
    peak: 1,
  });
  return param;
}

describe("complete-browser held envelope scheduling", () => {
  it("routes a short note through the actual browser voice scheduler", () => {
    const { gain, internals, event, voice } = browserHarness(airPad, 0.25);

    internals.createSynthVoice(event, voice, airPad, 10, 0, "attack");

    expect(gain.calls.slice(0, 2)).toEqual([
      { kind: "set", time: 10, value: 0.0001 },
      { kind: "linear", time: 10.25, value: 0.3125 },
    ]);
    expect(gain.valueAt(10.125)).toBeCloseTo(0.1563, 4);
    expect(gain.curveCalls).toHaveLength(1);
    expect(gain.curveCalls[0]!.start).toBe(10.25);
  });

  it("reconstructs a clipped browser endpoint after elapsed seek", () => {
    const { gain, internals, event, voice } = browserHarness(airPad, 0.25);

    internals.createSynthVoice(event, voice, airPad, 20, 0.2, "sustain");

    expect(gain.calls.slice(0, 2)).toEqual([
      { kind: "set", time: 20, value: 0.25 },
      { kind: "linear", time: 20.05, value: 0.3125 },
    ]);
    expect(gain.valueAt(20.025)).toBeCloseTo(0.28125);
    expect(gain.curveCalls[0]!.start).toBe(20.05);
  });

  it("starts an already-released browser voice from its elapsed release level", () => {
    const { gain, internals, event, voice } = browserHarness(airPad, 0.25);

    internals.createSynthVoice(event, voice, airPad, 30, 0.5, "release");

    expect(gain.calls[0]).toEqual({
      kind: "set",
      time: 30,
      value: 0.3125 * (1 - 0.25 / 1.4) ** 2,
    });
    expect(gain.calls.some((call) => call.kind === "linear")).toBe(false);
    expect(gain.curveCalls[0]!.start).toBe(30);
    expect(gain.curveCalls[0]!.duration).toBeCloseTo(1.15);
  });

  it("ramps a short air-pad attack through note-off instead of jumping", () => {
    const gain = schedule(airPad, 0, 0.25);

    expect(gain.calls).toEqual([
      { kind: "set", time: 10, value: 0.0001 },
      { kind: "linear", time: 10.25, value: 0.3125 },
    ]);
    expect(gain.valueAt(10.125)).toBeCloseTo(0.1563, 4);
  });

  it("clips a decay ramp at note-off and reaches peak at an exact attack boundary", () => {
    const decay = schedule(airPad, 0, 0.9);
    expect(decay.valueAt(10.8)).toBe(1);
    expect(decay.calls.at(-1)).toEqual({
      kind: "linear",
      time: 10.9,
      value: 1 - 0.38 * (0.1 / 0.7),
    });
    expect(decay.valueAt(10.85)).toBeCloseTo(1 - 0.38 * (0.05 / 0.7), 6);

    const boundary = schedule(airPad, 0, 0.8);
    expect(boundary.calls.at(-1)).toEqual({
      kind: "linear",
      time: 10.8,
      value: 1,
    });
  });

  it("reconstructs remaining attack and decay stages from an elapsed start", () => {
    const attack = schedule(airPad, 0.2, 0.25);
    expect(attack.calls).toEqual([
      { kind: "set", time: 10, value: 0.25 },
      { kind: "linear", time: 10.05, value: 0.3125 },
    ]);
    expect(attack.valueAt(10.025)).toBeCloseTo(0.28125);

    const decay = schedule(airPad, 0.9, 1.1);
    expect(decay.calls).toHaveLength(2);
    expect(decay.calls[0]).toEqual({
      kind: "set",
      time: 10,
      value: 1 - 0.38 * (0.1 / 0.7),
    });
    expect(decay.calls[1]).toMatchObject({ kind: "linear", time: 10.2 });
    expect(decay.calls[1]!.value).toBeCloseTo(1 - 0.38 * (0.3 / 0.7), 12);
  });

  it("holds sustain after an exact decay boundary without scheduling a jump", () => {
    const gain = schedule(airPad, 0, 2);

    expect(gain.calls).toEqual([
      { kind: "set", time: 10, value: 0.0001 },
      { kind: "linear", time: 10.8, value: 1 },
      { kind: "linear", time: 11.5, value: 0.62 },
    ]);
    expect(gain.valueAt(11.25)).toBeCloseTo(1 - 0.38 * ((11.25 - 10.8) / 0.7));
    expect(gain.valueAt(11.5)).toBe(0.62);
    expect(gain.valueAt(11.9)).toBe(0.62);
  });

  it("clips a short modal attack and schedules no subtractive decay", () => {
    const gain = schedule(modal, 0, 0.05);

    expect(gain.calls).toEqual([
      { kind: "set", time: 10, value: 0.0001 },
      { kind: "linear", time: 10.05, value: 0.25 },
    ]);
    expect(gain.valueAt(10.025)).toBeCloseTo(0.12505, 5);
  });

  it("reaches the attack peak before a zero-decay step, including elapsed starts and note-off at the boundary", () => {
    const patch = { ...airPad, attack: 1, decay: 0, sustain: 0.2 };
    for (const noteOff of [1, 2]) {
      const gain = schedule(patch, 0, noteOff);
      expect(gain.valueAt(10.5)).toBeCloseTo(0.5, 3);
      expect(gain.valueAt(10.99)).toBeCloseTo(0.99, 3);
      expect(gain.valueAt(11)).toBe(0.2);
      const elapsed = schedule(patch, 0.4, noteOff);
      expect(elapsed.valueAt(10.1)).toBeCloseTo(0.5, 3);
      expect(elapsed.valueAt(10.6)).toBe(0.2);
    }
  });

  it("keeps zero duration stable and lets a near-zero duration take its clip", () => {
    const zero = schedule(airPad, 0, 0);
    expect(zero.calls).toEqual([{ kind: "set", time: 10, value: 0.0001 }]);

    const nearZero = schedule(airPad, 0, 1e-6);
    expect(nearZero.calls).toEqual([
      { kind: "set", time: 10, value: 0.0001 },
      { kind: "linear", time: 10 + 1e-6, value: 0.0001 },
    ]);
    const belowClockResolution = schedule(airPad, 0, Number.MIN_VALUE);
    expect(belowClockResolution.calls).toEqual([
      { kind: "set", time: 10, value: 0.0001 },
    ]);
  });
});
