import type { StudySession } from "./contracts";
import { phraseFrames, routeChunks } from "./model";
export interface PhrasePcm {
  left: Float32Array;
  right: Float32Array;
}
/** Combine the exact decoded phrase projections, retaining overlapping releases. */
export function assemble(
  session: StudySession,
  pcm: Map<string, PhrasePcm>,
  original = false,
): PhrasePcm {
  const ids = routeChunks(session, original),
    stride = phraseFrames(session.work);
  const length = Math.max(
    ...ids.map((id, i) => i * stride + pcm.get(id)!.left.length),
  );
  const left = new Float32Array(length),
    right = new Float32Array(length);
  ids.forEach((id, step) => {
    const p = pcm.get(id)!;
    for (let i = 0; i < p.left.length; i++) {
      left[step * stride + i] += p.left[i] * session.mixGain;
      right[step * stride + i] += p.right[i] * session.mixGain;
    }
  });
  return { left, right };
}
/** Read frozen stereo PCM16 ourselves so replay and export never depend on a decoder's resampling. */
export function decodePhrase(
  buffer: ArrayBuffer,
  expectedFrames: number,
): PhrasePcm {
  const v = new DataView(buffer);
  const tag = (at: number) =>
    String.fromCharCode(...new Uint8Array(buffer, at, 4));
  if (buffer.byteLength < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE")
    throw new Error("乐句 WAV 头无效。");
  let fmt = false,
    data = -1,
    size = 0;
  for (let at = 12; at + 8 <= buffer.byteLength;) {
    const n = v.getUint32(at + 4, true);
    if (at + 8 + n > buffer.byteLength) throw new Error("乐句 WAV 被截断。");
    if (tag(at) === "fmt ") {
      if (
        n < 16 ||
        v.getUint16(at + 8, true) !== 1 ||
        v.getUint16(at + 10, true) !== 2 ||
        v.getUint32(at + 12, true) !== 44100 ||
        v.getUint16(at + 22, true) !== 16
      )
        throw new Error("乐句需要 44.1 kHz stereo PCM16。");
      fmt = true;
    }
    if (tag(at) === "data") {
      data = at + 8;
      size = n;
    }
    at += 8 + n + (n % 2);
  }
  if (!fmt || data < 0 || size !== expectedFrames * 4)
    throw new Error("乐句 WAV 长度不一致。");
  const left = new Float32Array(expectedFrames),
    right = new Float32Array(expectedFrames);
  for (let i = 0; i < expectedFrames; i++) {
    left[i] = v.getInt16(data + i * 4, true) / 32768;
    right[i] = v.getInt16(data + i * 4 + 2, true) / 32768;
  }
  return { left, right };
}
