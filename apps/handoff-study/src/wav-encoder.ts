import { encodePcmWav } from "@refrain/audio-engine/pcm";
import type { PhrasePcm } from "./wav";
export function encodeWav(pcm: PhrasePcm): ArrayBuffer {
  for (const channel of [pcm.left, pcm.right])
    for (const sample of channel)
      if (!Number.isFinite(sample) || Math.abs(sample) > 1)
        throw new Error("这条路线超出音频安全范围，未导出削波 WAV。");
  return encodePcmWav(
    { ...pcm, sampleRate: 44100, durationSeconds: pcm.left.length / 44100 },
    { amplitude: { mode: "native-gain" } },
  );
}
