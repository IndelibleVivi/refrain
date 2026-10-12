import type {
  AudioReference,
  Choice,
  Lead,
  RouteKey,
  StudyManifest,
  StudyScore,
  StudySession,
} from "./contracts";
export const GATE_STEPS = [2, 5] as const;
export const SESSION_LIMIT = 4 * 1024 * 1024;
const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
function keys(v: Record<string, unknown>, expected: string[]): void {
  if (
    Object.keys(v).length !== expected.length ||
    expected.some((k) => !Object.hasOwn(v, k))
  )
    throw new Error("文件字段不完整，或包含不支持的字段。");
}
export function exactJson(v: unknown, depth = 0): string {
  if (depth > 48) throw new Error("文件嵌套过深。");
  if (Array.isArray(v))
    return `[${v.map((x) => exactJson(x, depth + 1)).join(",")}]`;
  if (isRecord(v))
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${exactJson(v[k], depth + 1)}`)
      .join(",")}}`;
  return JSON.stringify(v);
}
export function validateManifest(value: unknown): StudyManifest {
  if (
    !isRecord(value) ||
    value.format !== "handoff-study-audio@0" ||
    !isRecord(value.score) ||
    !isRecord(value.audio)
  )
    throw new Error("乐句准备文件不完整，请运行 npm run handoff:prepare。");
  const m = value as unknown as StudyManifest;
  const s = m.score;
  if (
    s.format !== "handoff-study-work@0" ||
    s.steps.length !== 8 ||
    s.phraseBeats !== 8 ||
    s.tempo !== 96 ||
    s.chunks.length > 32 ||
    !Number.isFinite(m.mixGain) ||
    m.mixGain <= 0 ||
    m.mixGain > 1
  )
    throw new Error("不支持这份乐句作品。");
  const ids = new Set(s.chunks.map((c) => c.id));
  if (ids.size !== s.chunks.length || Object.keys(m.audio).length !== ids.size)
    throw new Error("乐句音频列表不完整。");
  for (const c of s.chunks) {
    const a = m.audio[c.id];
    if (
      !a ||
      !/^[a-z0-9-]+\.wav$/.test(a.file) ||
      !/^[a-f0-9]{64}$/.test(a.sha256) ||
      !Number.isSafeInteger(a.bytes) ||
      a.bytes < 44 ||
      a.bytes > 8 * 1024 * 1024 ||
      a.sampleRate !== 44100 ||
      !Number.isSafeInteger(a.frames) ||
      a.frames < 1 ||
      a.frames > 44100 * 20
    )
      throw new Error("乐句音频引用无效。");
  }
  for (const step of s.steps)
    for (const route of ["pp", "pm", "mp", "mm"] as const)
      if (
        !ids.has(step.chunks[route]) ||
        !["piano", "marimba"].includes(step.lead[route])
      )
        throw new Error("乐句路线没有闭合。");
  return m;
}
export function newSession(manifest: StudyManifest): StudySession {
  return {
    format: "handoff-study-session@0",
    work: structuredClone(manifest.score),
    audio: structuredClone(manifest.audio),
    mixGain: manifest.mixGain,
    choices: [],
  };
}
export function gateBeat(work: StudyScore, gate: 0 | 1): number {
  return GATE_STEPS[gate] * work.phraseBeats;
}
export function routeOf(session: StudySession, original = false): RouteKey {
  const leads = [...session.work.defaultRoute];
  if (!original)
    for (const choice of session.choices) leads[choice.gate] = choice.lead;
  return `${leads[0] === "piano" ? "p" : "m"}${leads[1] === "piano" ? "p" : "m"}` as RouteKey;
}
export function choose(
  session: StudySession,
  gate: 0 | 1,
  lead: Lead,
  requestedBeat: number,
): StudySession {
  const effectiveBeat = gateBeat(session.work, gate);
  if (
    requestedBeat < 0 ||
    requestedBeat >= effectiveBeat ||
    !Number.isFinite(requestedBeat)
  )
    throw new Error("这次交接已经开始；回到开头后可以重新选择。");
  return {
    ...session,
    choices: [
      ...session.choices.filter((c) => c.gate !== gate),
      { gate, lead, requestedBeat, effectiveBeat },
    ].sort((a, b) => a.gate - b.gate),
  };
}
export function serializeSession(session: StudySession): string {
  return JSON.stringify(session, null, 2) + "\n";
}
export function parseSession(
  input: string,
  manifest: StudyManifest,
): StudySession {
  if (new TextEncoder().encode(input).length > SESSION_LIMIT)
    throw new Error("实验文件超过 4 MiB。");
  const value: unknown = JSON.parse(input);
  if (!isRecord(value)) throw new Error("实验文件必须是对象。");
  keys(value, ["format", "work", "audio", "mixGain", "choices"]);
  if (value.format !== "handoff-study-session@0")
    throw new Error("不支持这个实验文件版本。");
  if (
    exactJson(value.work) !== exactJson(manifest.score) ||
    exactJson(value.audio) !== exactJson(manifest.audio) ||
    value.mixGain !== manifest.mixGain
  )
    throw new Error(
      "这份实验属于另一版作品或声音。原文件保留完整乐谱；请用对应版本重新打开。",
    );
  if (!Array.isArray(value.choices) || value.choices.length > 2)
    throw new Error("交接记录无效。");
  const seen = new Set<number>();
  const choices: Choice[] = value.choices.map((c) => {
    if (!isRecord(c)) throw new Error("交接记录无效。");
    keys(c, ["gate", "lead", "requestedBeat", "effectiveBeat"]);
    if (
      (c.gate !== 0 && c.gate !== 1) ||
      seen.has(c.gate) ||
      (c.lead !== "piano" && c.lead !== "marimba") ||
      typeof c.requestedBeat !== "number" ||
      !Number.isFinite(c.requestedBeat) ||
      c.requestedBeat < 0 ||
      c.requestedBeat >= gateBeat(manifest.score, c.gate) ||
      c.effectiveBeat !== gateBeat(manifest.score, c.gate)
    )
      throw new Error("交接的生效位置无效。");
    seen.add(c.gate);
    return c as unknown as Choice;
  });
  return {
    ...newSession(manifest),
    choices: choices.sort((a, b) => a.gate - b.gate),
  };
}
export function phraseSeconds(work: StudyScore): number {
  return (work.phraseBeats * 60) / work.tempo;
}
export function phraseFrames(work: StudyScore): number {
  return Math.round(phraseSeconds(work) * 44100);
}
export function routeChunks(session: StudySession, original = false): string[] {
  const route = routeOf(session, original);
  return session.work.steps.map((s) => s.chunks[route]);
}
export function durationSeconds(
  session: StudySession,
  original = false,
): number {
  const frames = phraseFrames(session.work);
  return Math.max(
    ...routeChunks(session, original).map(
      (id, i) => (i * frames + session.audio[id]!.frames) / 44100,
    ),
  );
}
export function audioReferences(
  value: StudySession,
): Record<string, AudioReference> {
  return value.audio;
}
