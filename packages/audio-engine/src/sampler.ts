import type {
  PerformanceEvent,
  PerformanceVoice,
  ResolvedSampleAttack,
} from "./performance.js";

export interface DecodedWave {
  sampleRate: number;
  channels: Float32Array[];
  frameCount: number;
}

function chunkName(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

export function decodeWave(buffer: ArrayBuffer): DecodedWave {
  const view = new DataView(buffer);
  if (
    view.byteLength < 44 ||
    chunkName(view, 0) !== "RIFF" ||
    chunkName(view, 8) !== "WAVE"
  ) {
    throw new Error("Sampler asset is not a RIFF/WAVE file.");
  }
  let format:
    | {
        audioFormat: number;
        channelCount: number;
        sampleRate: number;
        blockAlign: number;
        bitsPerSample: number;
      }
    | undefined;
  let dataOffset = 0;
  let dataBytes = 0;
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const name = chunkName(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (name === "fmt " && size >= 16) {
      format = {
        audioFormat: view.getUint16(body, true),
        channelCount: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        blockAlign: view.getUint16(body + 12, true),
        bitsPerSample: view.getUint16(body + 14, true),
      };
    } else if (name === "data") {
      dataOffset = body;
      dataBytes = Math.min(size, view.byteLength - body);
    }
    offset = body + size + (size % 2);
  }
  if (
    !format ||
    format.audioFormat !== 1 ||
    ![1, 2].includes(format.channelCount) ||
    ![16, 24].includes(format.bitsPerSample) ||
    dataBytes === 0
  ) {
    throw new Error(
      "Sampler WAV must be mono/stereo PCM with 16-bit or 24-bit samples.",
    );
  }
  const frameCount = Math.floor(dataBytes / format.blockAlign);
  const channels = Array.from(
    { length: format.channelCount },
    () => new Float32Array(frameCount),
  );
  const bytesPerSample = format.bitsPerSample / 8;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < format.channelCount; channel += 1) {
      const sampleOffset =
        dataOffset + frame * format.blockAlign + channel * bytesPerSample;
      let sample: number;
      if (format.bitsPerSample === 16) {
        sample = view.getInt16(sampleOffset, true) / 32_768;
      } else {
        let raw =
          view.getUint8(sampleOffset) |
          (view.getUint8(sampleOffset + 1) << 8) |
          (view.getUint8(sampleOffset + 2) << 16);
        if (raw & 0x800000) raw |= ~0xffffff;
        sample = raw / 8_388_608;
      }
      channels[channel]![frame] = sample;
    }
  }
  return {
    sampleRate: format.sampleRate,
    channels,
    frameCount,
  };
}

const dbToGain = (db: number): number => 10 ** (db / 20);

function sampleAt(channel: Float32Array, position: number): number {
  const index = Math.floor(position);
  const fraction = position - index;
  const first = channel[index] ?? 0;
  const second = channel[index + 1] ?? first;
  return first + (second - first) * fraction;
}

function loopedSampleAt(
  channel: Float32Array,
  sourcePosition: number,
  sample: ResolvedSampleAttack,
): number {
  if (sample.loop.mode !== "sustain" || sourcePosition < sample.loop.startFrame)
    return sampleAt(channel, sourcePosition);
  const loopLength = sample.loop.endFrame - sample.loop.startFrame;
  const loopPosition =
    sample.loop.startFrame +
    ((sourcePosition - sample.loop.startFrame) % loopLength);
  const crossfade = sample.loop.crossfadeFrames ?? 0;
  if (crossfade === 0 || loopPosition < sample.loop.endFrame - crossfade)
    return sampleAt(channel, loopPosition);
  const progress =
    (loopPosition - (sample.loop.endFrame - crossfade)) / crossfade;
  const wrappedPosition = sample.loop.startFrame + progress * crossfade;
  return (
    sampleAt(channel, loopPosition) * (1 - progress) +
    sampleAt(channel, wrappedPosition) * progress
  );
}

function mixReleaseSample(
  event: PerformanceEvent,
  voice: PerformanceVoice,
  sample: ResolvedSampleAttack,
  wave: DecodedWave,
  tempo: number,
  sampleRate: number,
  left: Float32Array,
  right: Float32Array,
): void {
  if (!sample.releaseSample) return;
  const noteOffSeconds = (event.noteOffBeat * 60) / tempo;
  const startSample = Math.floor(noteOffSeconds * sampleRate);
  const sourceStep =
    (wave.sampleRate / sampleRate) * sample.releaseSample.playbackRate;
  const requestedFrames = Math.max(
    0,
    Math.ceil((sample.renderEndSeconds - noteOffSeconds) * sampleRate),
  );
  const outputFrames = Math.min(
    requestedFrames,
    Math.floor(wave.frameCount / sourceStep),
    left.length - startSample,
  );
  const gain =
    dbToGain(
      event.effectiveGainDb + sample.gainDb + sample.releaseSample.gainDb,
    ) * event.performanceVelocity;
  const pan = Math.max(-1, Math.min(1, voice.pan));
  const leftPan = Math.cos(((pan + 1) * Math.PI) / 4);
  const rightPan = Math.sin(((pan + 1) * Math.PI) / 4);
  const leftSource = wave.channels[0]!;
  const rightSource = wave.channels[1] ?? leftSource;
  const attackFrames = Math.max(1, Math.round(sampleRate * 0.003));
  for (let frame = 0; frame < outputFrames; frame += 1) {
    const envelope = Math.min(1, frame / attackFrames) * gain;
    const sourcePosition = frame * sourceStep;
    left[startSample + frame]! +=
      sampleAt(leftSource, sourcePosition) * envelope * leftPan;
    right[startSample + frame]! +=
      sampleAt(rightSource, sourcePosition) * envelope * rightPan;
  }
}

export function mixSamplerEvent(
  event: PerformanceEvent,
  voice: PerformanceVoice,
  waves: ReadonlyMap<string, DecodedWave>,
  tempo: number,
  sampleRate: number,
  left: Float32Array,
  right: Float32Array,
): void {
  const sample = event.sample;
  if (!sample)
    throw new Error(`${voice.candidateId} has no resolved sample attack.`);
  const wave = waves.get(sample.attackAssetId);
  if (!wave)
    throw new Error(`Sampler asset ${sample.attackAssetId} was not decoded.`);
  const startSeconds = (event.startBeat * 60) / tempo;
  const noteSeconds = (event.soundingDurationBeats * 60) / tempo;
  const startSample = Math.floor(startSeconds * sampleRate);
  const outputFrames = Math.min(
    Math.max(
      0,
      Math.ceil((sample.renderEndSeconds - startSeconds) * sampleRate),
    ),
    left.length - startSample,
  );
  const sourceStep = (wave.sampleRate / sampleRate) * sample.playbackRate;
  const gain =
    dbToGain(event.effectiveGainDb + sample.gainDb) * event.performanceVelocity;
  const pan = Math.max(-1, Math.min(1, voice.pan));
  const leftPan = Math.cos(((pan + 1) * Math.PI) / 4);
  const rightPan = Math.sin(((pan + 1) * Math.PI) / 4);
  const leftSource = wave.channels[0]!;
  const rightSource = wave.channels[1] ?? leftSource;
  const attackFrames = Math.max(
    1,
    Math.round(sampleRate * sample.attackSeconds),
  );
  const releaseStart = Math.round(noteSeconds * sampleRate);
  const releaseFrames =
    sample.release.mode === "envelope"
      ? Math.max(1, Math.round(sample.release.seconds * sampleRate))
      : sample.release.mode === "sample"
        ? Math.max(1, Math.round(sampleRate * 0.01))
        : 0;
  for (let frame = 0; frame < outputFrames; frame += 1) {
    const sourcePosition = frame * sourceStep;
    if (sample.loop.mode === "none" && sourcePosition >= wave.frameCount) break;
    const attack = Math.min(1, frame / attackFrames);
    let release = 1;
    if (sample.release.mode !== "natural" && frame > releaseStart) {
      release = Math.max(0, 1 - (frame - releaseStart) / releaseFrames);
    }
    if (release <= 0) break;
    const envelope = attack * release * gain;
    left[startSample + frame]! +=
      loopedSampleAt(leftSource, sourcePosition, sample) * envelope * leftPan;
    right[startSample + frame]! +=
      loopedSampleAt(rightSource, sourcePosition, sample) * envelope * rightPan;
  }
  if (sample.releaseSample) {
    const releaseWave = waves.get(sample.releaseSample.assetId);
    if (!releaseWave)
      throw new Error(
        `Release asset ${sample.releaseSample.assetId} was not decoded.`,
      );
    mixReleaseSample(
      event,
      voice,
      sample,
      releaseWave,
      tempo,
      sampleRate,
      left,
      right,
    );
  }
}
