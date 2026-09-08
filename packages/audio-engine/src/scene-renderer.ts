import type { RenderSceneV1, SceneProcessor } from "@refrain/soundpack/vnext";
import { BiquadLowPass } from "./filter.js";
import { sceneRouteForVoice } from "./scene-routing.js";

export interface SceneStereoBlock {
  left: Float32Array;
  right: Float32Array;
}

interface DelayState {
  left: Float32Array;
  right: Float32Array;
  cursor: number;
  feedback: number;
}

const dbToGain = (db: number): number => 10 ** (db / 20);

export class SceneBlockProcessor {
  private readonly busOrder: string[];
  private readonly lowPass = new Map<
    string,
    { left: BiquadLowPass; right: BiquadLowPass }
  >();
  private readonly delays = new Map<string, DelayState>();
  private readonly rooms = new Map<string, DelayState[]>();
  private readonly musicalDurationFrames: number;
  private readonly totalDurationFrames: number;

  constructor(
    readonly scene: RenderSceneV1,
    readonly sampleRate: number,
    musicalDurationSeconds: number,
    totalDurationSeconds: number,
  ) {
    if (!Number.isInteger(sampleRate) || sampleRate <= 0)
      throw new Error("Scene processor sampleRate must be a positive integer.");
    this.musicalDurationFrames = Math.round(
      musicalDurationSeconds * sampleRate,
    );
    this.totalDurationFrames = Math.round(totalDurationSeconds * sampleRate);
    const outputByBus = new Map(scene.buses.map((bus) => [bus.id, bus.output]));
    const distance = (id: string): number => {
      let result = 0;
      let cursor: string | undefined = id;
      while (cursor && cursor !== "master") {
        result += 1;
        cursor = outputByBus.get(cursor);
      }
      return result;
    };
    this.busOrder = scene.buses
      .map((bus) => bus.id)
      .sort(
        (left, right) =>
          distance(right) - distance(left) || left.localeCompare(right),
      );
    for (const bus of scene.buses) {
      for (const processor of bus.processors) {
        const key = `${bus.id}:${processor.id}`;
        if (processor.type === "lowpass") {
          this.lowPass.set(key, {
            left: new BiquadLowPass(
              processor.frequencyHz,
              processor.q,
              sampleRate,
            ),
            right: new BiquadLowPass(
              processor.frequencyHz,
              processor.q,
              sampleRate,
            ),
          });
        }
        if (processor.type === "delay") {
          const frames = Math.max(
            1,
            Math.round((processor.delayMs / 1_000) * sampleRate),
          );
          this.delays.set(key, {
            left: new Float32Array(frames),
            right: new Float32Array(frames),
            cursor: 0,
            feedback: processor.feedback,
          });
        }
        if (processor.type === "room") {
          this.rooms.set(
            key,
            [0.0297, 0.0371, 0.0411].map((delaySeconds) => {
              const frames = Math.max(1, Math.round(delaySeconds * sampleRate));
              return {
                left: new Float32Array(frames),
                right: new Float32Array(frames),
                cursor: 0,
                feedback: Math.exp(
                  (-3 * delaySeconds) / processor.decaySeconds,
                ),
              };
            }),
          );
        }
      }
    }
  }

  routeForVoice(voice: { instrument: string; role: string }): string {
    return sceneRouteForVoice(this.scene, voice)?.bus ?? "master";
  }

  createBlock(frameCount: number): Map<string, SceneStereoBlock> {
    if (!Number.isInteger(frameCount) || frameCount <= 0)
      throw new Error("Scene block frame count must be a positive integer.");
    return new Map(
      ["master", ...this.scene.buses.map((bus) => bus.id)].map((id) => [
        id,
        {
          left: new Float32Array(frameCount),
          right: new Float32Array(frameCount),
        },
      ]),
    );
  }

  private processDelay(
    block: SceneStereoBlock,
    state: DelayState,
    mix: number,
  ): void {
    for (let index = 0; index < block.left.length; index += 1) {
      const delayedLeft = state.left[state.cursor]!;
      const delayedRight = state.right[state.cursor]!;
      const dryLeft = block.left[index]!;
      const dryRight = block.right[index]!;
      state.left[state.cursor] = dryLeft + delayedLeft * state.feedback;
      state.right[state.cursor] = dryRight + delayedRight * state.feedback;
      state.cursor = (state.cursor + 1) % state.left.length;
      block.left[index] = dryLeft * (1 - mix) + delayedLeft * mix;
      block.right[index] = dryRight * (1 - mix) + delayedRight * mix;
    }
  }

  private processRoom(
    block: SceneStereoBlock,
    states: DelayState[],
    mix: number,
  ): void {
    for (let index = 0; index < block.left.length; index += 1) {
      const dryLeft = block.left[index]!;
      const dryRight = block.right[index]!;
      let wetLeft = 0;
      let wetRight = 0;
      for (const state of states) {
        const delayedLeft = state.left[state.cursor]!;
        const delayedRight = state.right[state.cursor]!;
        state.left[state.cursor] = dryLeft + delayedRight * state.feedback;
        state.right[state.cursor] = dryRight + delayedLeft * state.feedback;
        state.cursor = (state.cursor + 1) % state.left.length;
        wetLeft += delayedLeft;
        wetRight += delayedRight;
      }
      wetLeft /= states.length;
      wetRight /= states.length;
      block.left[index] = dryLeft * (1 - mix) + wetLeft * mix;
      block.right[index] = dryRight * (1 - mix) + wetRight * mix;
    }
  }

  private applyProcessor(
    busId: string,
    processor: SceneProcessor,
    block: SceneStereoBlock,
    frameOffset: number,
  ): void {
    const key = `${busId}:${processor.id}`;
    if (processor.type === "gain-pan") {
      const gain = dbToGain(processor.gainDb);
      const leftPan = Math.cos(((processor.pan + 1) * Math.PI) / 4);
      const rightPan = Math.sin(((processor.pan + 1) * Math.PI) / 4);
      for (let index = 0; index < block.left.length; index += 1) {
        const mid = (block.left[index]! + block.right[index]!) * 0.5;
        const side =
          (block.left[index]! - block.right[index]!) * 0.5 * processor.width;
        block.left[index] = (mid + side) * gain * leftPan;
        block.right[index] = (mid - side) * gain * rightPan;
      }
      return;
    }
    if (processor.type === "lowpass") {
      const filters = this.lowPass.get(key)!;
      for (let index = 0; index < block.left.length; index += 1) {
        block.left[index] = filters.left.process(block.left[index]!);
        block.right[index] = filters.right.process(block.right[index]!);
      }
      return;
    }
    if (processor.type === "saturation") {
      const normalizer = Math.tanh(processor.drive);
      for (let index = 0; index < block.left.length; index += 1) {
        const left = block.left[index]!;
        const right = block.right[index]!;
        const wetLeft = Math.tanh(left * processor.drive) / normalizer;
        const wetRight = Math.tanh(right * processor.drive) / normalizer;
        block.left[index] =
          left * (1 - processor.mix) + wetLeft * processor.mix;
        block.right[index] =
          right * (1 - processor.mix) + wetRight * processor.mix;
      }
      return;
    }
    if (processor.type === "delay") {
      this.processDelay(block, this.delays.get(key)!, processor.mix);
      return;
    }
    if (processor.type === "room") {
      this.processRoom(block, this.rooms.get(key)!, processor.mix);
      return;
    }
    const inFrames = Math.round(processor.inSeconds * this.sampleRate);
    const outFrames = Math.round(processor.outSeconds * this.sampleRate);
    const outStart = Math.max(0, this.musicalDurationFrames - outFrames);
    const tailEnd = Math.min(
      this.totalDurationFrames,
      this.musicalDurationFrames +
        Math.round(processor.tailSeconds * this.sampleRate),
    );
    for (let index = 0; index < block.left.length; index += 1) {
      const frame = frameOffset + index;
      const fadeIn = inFrames === 0 ? 1 : Math.min(1, frame / inFrames);
      const fadeOut =
        frame < outStart
          ? 1
          : frame >= tailEnd
            ? 0
            : Math.max(0, (tailEnd - frame) / Math.max(1, tailEnd - outStart));
      const gain = Math.min(fadeIn, fadeOut);
      block.left[index] = block.left[index]! * gain;
      block.right[index] = block.right[index]! * gain;
    }
  }

  processBlock(
    frameOffset: number,
    blocks: Map<string, SceneStereoBlock>,
  ): SceneStereoBlock {
    for (const busId of this.busOrder) {
      const bus = this.scene.buses.find((candidate) => candidate.id === busId)!;
      const block = blocks.get(busId)!;
      for (const processor of bus.processors)
        this.applyProcessor(busId, processor, block, frameOffset);
      const output = blocks.get(bus.output)!;
      for (let index = 0; index < block.left.length; index += 1) {
        output.left[index] = output.left[index]! + block.left[index]!;
        output.right[index] = output.right[index]! + block.right[index]!;
      }
    }
    const master = blocks.get("master")!;
    const gain = dbToGain(this.scene.master.gainDb);
    const ceiling = this.scene.master.peakCeiling;
    for (let index = 0; index < master.left.length; index += 1) {
      master.left[index] = Math.max(
        -ceiling,
        Math.min(ceiling, master.left[index]! * gain),
      );
      master.right[index] = Math.max(
        -ceiling,
        Math.min(ceiling, master.right[index]! * gain),
      );
    }
    return master;
  }
}
