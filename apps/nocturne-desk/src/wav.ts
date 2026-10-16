import { encodePcmWav } from "@refrain/audio-engine/pcm";
import { decodePhrase, type PhrasePcm } from "../../handoff-study/src/wav";
import { VOICE_IDS, type Manifest, type Session } from "./contracts";
import { durationSeconds, parseSession, sectionFrame, stemKey } from "./model";
export { decodePhrase };
export type { PhrasePcm };
export function assemble(
  manifest: Manifest,
  session: Session,
  pcm: Map<string, PhrasePcm>,
): PhrasePcm {
  parseSession(session, manifest.score);
  const frames = Math.round(durationSeconds(manifest, session) * 44100),
    left = new Float32Array(frames),
    right = new Float32Array(frames);
  session.arrangement.forEach((row, s) =>
    row.forEach((on, v) => {
      if (!on) return;
      const key = stemKey(s, VOICE_IDS[v]!),
        p = pcm.get(key);
      if (
        !p ||
        p.left.length !== manifest.audio[key]!.frames ||
        p.right.length !== p.left.length
      )
        throw new Error("声音还没有完整准备好。");
      const start = sectionFrame(s);
      for (let i = 0; i < p.left.length; i++) {
        left[start + i] += p.left[i]! * manifest.mixGain;
        right[start + i] += p.right[i]! * manifest.mixGain;
      }
    }),
  );
  return { left, right };
}
export function encodeWav(pcm: PhrasePcm): Uint8Array {
  if (!pcm.left.length || pcm.left.length !== pcm.right.length)
    throw new Error("声道长度不一致。");
  for (const c of [pcm.left, pcm.right])
    for (const x of c)
      if (!Number.isFinite(x) || Math.abs(x) > 1)
        throw new Error("声音超出安全范围，未导出。");
  return new Uint8Array(
    encodePcmWav(
      { ...pcm, sampleRate: 44100, durationSeconds: pcm.left.length / 44100 },
      { amplitude: { mode: "native-gain" } },
    ),
  );
}
