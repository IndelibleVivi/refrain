import {
  VOICE_IDS,
  type Manifest,
  type Preset,
  type Score,
  type Session,
  type VoiceId,
} from "./contracts";
import { createScore } from "./score";
const matrices: Record<Preset, boolean[][]> = {
  manuscript: [
    [true, true, false, false],
    [true, true, false, true],
    [true, true, true, true],
    [true, false, true, false],
    [true, true, true, true],
    [true, true, true, false],
  ],
  solitude: [
    [true, false, false, false],
    [true, false, true, false],
    [true, false, true, false],
    [true, false, true, false],
    [true, true, true, false],
    [true, false, true, false],
  ],
  constellation: [
    [false, true, false, true],
    [false, true, true, true],
    [true, true, true, true],
    [false, true, true, true],
    [true, true, true, true],
    [true, true, false, true],
  ],
};
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("手稿对象无效。");
  return v as Record<string, unknown>;
}
function keys(o: Record<string, unknown>, allowed: string[]) {
  if (
    Object.keys(o).length !== allowed.length ||
    Object.keys(o).some((k) => !allowed.includes(k))
  )
    throw new Error("文件包含缺失或未知字段。");
}
export function newSession(score: Score = createScore()): Session {
  return {
    format: "nocturne-desk-session@0",
    workId: score.id,
    title: score.title,
    arrangement: structuredClone(matrices.manuscript),
  };
}
export function parseSession(
  input: unknown,
  score: Score = createScore(),
): Session {
  const o = object(input);
  keys(o, ["format", "workId", "title", "arrangement"]);
  if (o.format !== "nocturne-desk-session@0" || o.workId !== score.id)
    throw new Error("这份手稿不属于当前版本的作品。");
  if (
    typeof o.title !== "string" ||
    !o.title.trim() ||
    o.title.length > 80 ||
    /[\x00-\x1f]/.test(o.title)
  )
    throw new Error("手稿名称需要 1–80 个可显示字符。");
  if (
    !Array.isArray(o.arrangement) ||
    o.arrangement.length !== 6 ||
    o.arrangement.some(
      (r) =>
        !Array.isArray(r) ||
        r.length !== 4 ||
        r.some((v) => typeof v !== "boolean") ||
        !r.some(Boolean),
    )
  )
    throw new Error("每一页需要四个明确的开关，并至少保留一件乐器。");
  return {
    format: "nocturne-desk-session@0",
    workId: score.id,
    title: o.title,
    arrangement: structuredClone(o.arrangement),
  };
}
export function serializeSession(session: Session): string {
  return JSON.stringify(parseSession(session), null, 2) + "\n";
}
export function setVoice(
  session: Session,
  section: number,
  voice: VoiceId,
  enabled: boolean,
): Session {
  const next = parseSession(session),
    v = VOICE_IDS.indexOf(voice);
  if (
    !Number.isInteger(section) ||
    section < 0 ||
    section > 5 ||
    v < 0 ||
    typeof enabled !== "boolean"
  )
    throw new Error("编配位置无效。");
  next.arrangement[section]![v] = enabled;
  return parseSession(next);
}
export function applyArrangement(session: Session, preset: Preset): Session {
  if (!Object.hasOwn(matrices, preset)) throw new Error("未知编配。");
  return parseSession({ ...session, arrangement: matrices[preset] });
}
export function stemKey(section: number, voice: VoiceId) {
  return `${section}:${voice}`;
}
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (
    !a ||
    !b ||
    typeof a !== "object" ||
    typeof b !== "object" ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
  const ak = Object.keys(a),
    bk = Object.keys(b);
  return (
    ak.length === bk.length &&
    ak.every(
      (k) =>
        Object.hasOwn(b, k) &&
        equal(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
        ),
    )
  );
}
export function validateManifest(input: unknown): Manifest {
  const o = object(input);
  keys(o, ["format", "score", "audio", "mixGain"]);
  const score = createScore();
  if (
    o.format !== "nocturne-desk-manifest@0" ||
    !equal(o.score, score) ||
    o.mixGain !== 0.85
  )
    throw new Error("声音清单与这份乐谱不一致。");
  const audio = object(o.audio);
  const expected = score.sections.flatMap((_, i) =>
    VOICE_IDS.map((v) => stemKey(i, v)),
  );
  keys(audio, expected);
  for (const [k, value] of Object.entries(audio)) {
    const a = object(value);
    keys(a, ["file", "bytes", "sha256", "frames"]);
    const [index, voice] = k.split(":");
    if (
      typeof a.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(a.sha256) ||
      a.file !== `${index}-${voice}-${a.sha256.slice(0, 16)}.wav` ||
      !Number.isInteger(a.frames) ||
      Number(a.frames) < ((16 * 60) / 88) * 44100 ||
      Number(a.frames) > 30 * 44100 ||
      a.bytes !== 44 + Number(a.frames) * 4
    )
      throw new Error(`声音 ${k} 的引用无效。`);
  }
  return structuredClone(o) as unknown as Manifest;
}
export function sectionSeconds() {
  return (16 * 60) / 88;
}
export function sectionFrame(section: number) {
  return Math.round(section * sectionSeconds() * 44100);
}
export function durationSeconds(manifest: Manifest, session: Session): number {
  return Math.max(
    ...session.arrangement.flatMap((r, i) =>
      r.flatMap((on, v) =>
        on
          ? [
              (sectionFrame(i) +
                manifest.audio[stemKey(i, VOICE_IDS[v]!)]!.frames) /
                44100,
            ]
          : [],
      ),
    ),
  );
}
