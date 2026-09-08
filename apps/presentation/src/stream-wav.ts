import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  REFERENCE_BLOCK_FRAMES,
  renderExecutionBlocks,
  type ExecutionAssetBundle,
  type ExecutionBundle,
  type WavAmplitudePolicy,
} from "@refrain/audio-engine";

export interface StreamWavOptions {
  sampleRate?: number;
  isCancelled?: () => boolean;
  amplitude?: WavAmplitudePolicy;
}

export interface StreamWavEvidence {
  format: "refrain-stream-wav-evidence@0-experimental";
  outputBytes: number;
  outputSha256: string;
  sourcePeak: number;
  amplitudeScale: number;
  blockFrames: number;
  peakWorkingBytes: number;
}

function wavHeader(sampleRate: number, frameCount: number): Uint8Array {
  const channelCount = 2;
  const bytesPerSample = 2;
  const dataSize = frameCount * channelCount * bytesPerSample;
  const bytes = new Uint8Array(44);
  const view = new DataView(bytes.buffer);
  bytes.set([82, 73, 70, 70], 0);
  view.setUint32(4, 36 + dataSize, true);
  bytes.set([87, 65, 86, 69], 8);
  bytes.set([102, 109, 116, 32], 12);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, 16, true);
  bytes.set([100, 97, 116, 97], 36);
  view.setUint32(40, dataSize, true);
  return bytes;
}

function interleavedFloatBlock(
  left: Float32Array,
  right: Float32Array,
): Uint8Array {
  const bytes = new Uint8Array(
    left.length * 2 * Float32Array.BYTES_PER_ELEMENT,
  );
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < left.length; index += 1) {
    view.setFloat32(index * 8, left[index] ?? 0, true);
    view.setFloat32(index * 8 + 4, right[index] ?? 0, true);
  }
  return bytes;
}

function quantizeFloatBlock(bytes: Uint8Array, scale: number): Uint8Array {
  const source = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const output = new Uint8Array((bytes.byteLength / 8) * 4);
  const target = new DataView(output.buffer);
  for (
    let inputOffset = 0, outputOffset = 0;
    inputOffset < bytes.byteLength;
    inputOffset += 4, outputOffset += 2
  ) {
    const value = Math.max(
      -1,
      Math.min(1, source.getFloat32(inputOffset, true) * scale),
    );
    target.setInt16(
      outputOffset,
      value < 0 ? Math.round(value * 32_768) : Math.round(value * 32_767),
      true,
    );
  }
  return output;
}

export async function streamExecutionWav(
  bundle: ExecutionBundle,
  assets: ExecutionAssetBundle,
  outputPath: string,
  options: StreamWavOptions = {},
): Promise<StreamWavEvidence> {
  const sampleRate = options.sampleRate ?? 44_100;
  const frameCount = Math.ceil(bundle.plan.renderDurationSeconds * sampleRate);
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), `refrain-wav-${randomBytes(6).toString("hex")}-`),
  );
  const rawPath = join(temporaryDirectory, "render.f32le");
  const raw = await open(rawPath, "wx");
  let sourcePeak = 0;
  let rawOffset = 0;
  try {
    for await (const block of renderExecutionBlocks(
      bundle,
      assets,
      sampleRate,
      {
        blockFrames: REFERENCE_BLOCK_FRAMES,
        isCancelled: options.isCancelled,
      },
    )) {
      for (let index = 0; index < block.frameCount; index += 1) {
        sourcePeak = Math.max(
          sourcePeak,
          Math.abs(block.left[index] ?? 0),
          Math.abs(block.right[index] ?? 0),
        );
      }
      const bytes = interleavedFloatBlock(block.left, block.right);
      await raw.write(bytes, 0, bytes.byteLength, rawOffset);
      rawOffset += bytes.byteLength;
    }
  } finally {
    await raw.close();
  }
  if (options.isCancelled?.()) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw new Error("Complete-piece WAV export was cancelled.");
  }
  const amplitude = options.amplitude ?? { mode: "native-gain" };
  const scale =
    amplitude.mode === "audition-peak-matched"
      ? sourcePeak > 0
        ? amplitude.targetPeak / sourcePeak
        : 1
      : sourcePeak > bundle.plan.resolvedRenderProfile.peakCeiling
        ? bundle.plan.resolvedRenderProfile.peakCeiling / sourcePeak
        : 1;
  await mkdir(dirname(outputPath), { recursive: true });
  const output = await open(outputPath, "w");
  const input = await open(rawPath, "r");
  const hash = createHash("sha256");
  const header = wavHeader(sampleRate, frameCount);
  let outputOffset = 0;
  try {
    await output.write(header, 0, header.byteLength, outputOffset);
    hash.update(header);
    outputOffset += header.byteLength;
    const inputBytes = new Uint8Array(REFERENCE_BLOCK_FRAMES * 8);
    let inputOffset = 0;
    while (inputOffset < rawOffset) {
      if (options.isCancelled?.())
        throw new Error("Complete-piece WAV export was cancelled.");
      const requested = Math.min(
        inputBytes.byteLength,
        rawOffset - inputOffset,
      );
      const { bytesRead } = await input.read(
        inputBytes,
        0,
        requested,
        inputOffset,
      );
      if (bytesRead === 0) break;
      const quantized = quantizeFloatBlock(
        inputBytes.subarray(0, bytesRead),
        scale,
      );
      await output.write(quantized, 0, quantized.byteLength, outputOffset);
      hash.update(quantized);
      outputOffset += quantized.byteLength;
      inputOffset += bytesRead;
    }
  } catch (cause) {
    await output.close();
    await input.close();
    await rm(outputPath, { force: true });
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw cause;
  }
  await output.close();
  await input.close();
  await rm(temporaryDirectory, { recursive: true, force: true });
  return {
    format: "refrain-stream-wav-evidence@0-experimental",
    outputBytes: outputOffset,
    outputSha256: `sha256:${hash.digest("hex")}`,
    sourcePeak,
    amplitudeScale: scale,
    blockFrames: REFERENCE_BLOCK_FRAMES,
    peakWorkingBytes: REFERENCE_BLOCK_FRAMES * (4 + 4 + 8 + 4),
  };
}
