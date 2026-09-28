import type {
  Program,
  ScoreNote,
  Settings,
  SoundNote,
  Work,
} from "./contracts";

const MAX_BYTES = 1024 * 1024;
const MAX_DURATION = 150;
const TAIL_SECONDS = 5;
const PARTS = ["melody", "harmony", "bass"] as const;

const WORK_KEYS = [
  "format",
  "title",
  "tempo",
  "lengthBeats",
  "notes",
  "breaths",
  "settings",
];
const NOTE_KEYS = ["id", "at", "beats", "midi", "velocity", "pan", "part"];
const SETTINGS_KEYS = ["breath", "color", "space"];

function object(
  value: unknown,
  keys: readonly string[],
  path: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(path + " 应当是一个对象。");
  const item = value as Record<string, unknown>;
  if (
    Object.keys(item).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(item, key))
  )
    throw new Error(path + " 含有缺失或未知字段。");
  return item;
}

function number(
  value: unknown,
  min: number,
  max: number,
  path: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new Error(path + " 超出了支持范围。");
  return value;
}

function integer(
  value: unknown,
  min: number,
  max: number,
  path: string,
): number {
  const n = number(value, min, max, path);
  if (!Number.isInteger(n)) throw new Error(path + " 需要整数。");
  return n;
}

function text(value: unknown, max: number, path: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(path + " 需要 1–" + max + " 个字符。");
  return value;
}

function settings(value: unknown): Settings {
  const s = object(value, SETTINGS_KEYS, "settings");
  return {
    breath: number(s.breath, 0, 2, "换气长度"),
    color: number(s.color, 0, 1, "音色"),
    space: number(s.space, 0, 1, "空间"),
  };
}

/** Strict reader for one authored Breath study work. No inference, no repair. */
export function parseWork(input: string): Work {
  if (new TextEncoder().encode(input).length > MAX_BYTES)
    throw new Error("作品文件不能超过 1 MiB。");
  let json: unknown;
  try {
    json = JSON.parse(input);
  } catch {
    throw new Error("这不是有效的 JSON 作品文件。");
  }
  const w = object(json, WORK_KEYS, "作品");
  if (w.format !== "breath-study-work@0")
    throw new Error(
      "不支持这个作品版本；此入口不导入 AIR 或 RefrainArtifact。",
    );
  const tempo = number(w.tempo, 40, 160, "速度");
  const lengthBeats = number(w.lengthBeats, 1, 96, "作品长度");

  if (!Array.isArray(w.notes) || w.notes.length < 1 || w.notes.length > 256)
    throw new Error("乐谱需要 1–256 个音。");
  const ids = new Set<string>();
  const notes: ScoreNote[] = w.notes.map((item: unknown) => {
    const n = object(item, NOTE_KEYS, "音符");
    const id = text(n.id, 64, "音符编号");
    if (ids.has(id)) throw new Error("音符编号需要唯一。");
    ids.add(id);
    const at = number(n.at, 0, lengthBeats, "音符位置");
    const beats = number(n.beats, 0, lengthBeats, "音符时值");
    if (!(beats > 0)) throw new Error("音符时值需要为正数。");
    if (at >= lengthBeats || at + beats > lengthBeats)
      throw new Error("音符需要完整落在作品长度之内。");
    const part = n.part;
    if (typeof part !== "string" || !PARTS.includes(part as never))
      throw new Error("未知的声部。");
    return {
      id,
      at,
      beats,
      midi: integer(n.midi, 36, 96, "音高"),
      velocity: number(n.velocity, 0.05, 1, "力度"),
      pan: number(n.pan, -1, 1, "声像"),
      part: part as ScoreNote["part"],
    };
  });

  if (!Array.isArray(w.breaths) || w.breaths.length > 512)
    throw new Error("最多记录 512 个换气位置。");
  let previous = Number.NEGATIVE_INFINITY;
  const breaths = w.breaths.map((item: unknown) => {
    const at = number(item, 0, lengthBeats, "换气位置");
    if (at <= previous) throw new Error("换气位置需要按从小到大排列且不重复。");
    previous = at;
    return at;
  });

  const resolved = settings(w.settings);
  const musicEnd =
    (lengthBeats * 60) / tempo + breaths.length * resolved.breath;
  if (musicEnd + TAIL_SECONDS > MAX_DURATION + 1e-9)
    throw new Error("作品渲染长度不能超过 150 秒。");

  return {
    format: "breath-study-work@0",
    title: text(w.title, 120, "标题"),
    tempo,
    lengthBeats,
    notes,
    breaths,
    settings: resolved,
  };
}

/**
 * Resolve the authored beats into seconds without inventing notes. A gap at a
 * beat delays every onset at or after it; notated note durations (tails) are
 * unchanged. `reference` keeps the score and resets only the instrument
 * settings, so a neutral listen can be compared against any authored colour.
 */
export function compileWork(work: Work, reference = false): Program {
  const resolved: Settings = reference
    ? { breath: 0, color: 0, space: 0.18 }
    : { ...work.settings };
  const secondsPerBeat = 60 / work.tempo;
  const gapSeconds = resolved.breath;

  const delaysBefore = (beat: number) => {
    let count = 0;
    for (const breath of work.breaths) if (breath <= beat) count++;
    return count;
  };
  const notes: SoundNote[] = work.notes.map((note) => ({
    ...note,
    start: note.at * secondsPerBeat + delaysBefore(note.at) * gapSeconds,
    duration: note.beats * secondsPerBeat,
  }));

  const gaps: Program["gaps"] = [];
  if (gapSeconds > 0)
    work.breaths.forEach((breath, index) => {
      const start = breath * secondsPerBeat + index * gapSeconds;
      gaps.push({ start, end: start + gapSeconds });
    });

  const musicEnd =
    (work.lengthBeats * 60) / work.tempo + work.breaths.length * gapSeconds;
  const duration = musicEnd + TAIL_SECONDS;
  if (duration > MAX_DURATION + 1e-9)
    throw new Error("作品渲染长度不能超过 150 秒。");
  return { notes, duration, musicEnd, settings: resolved, gaps };
}

/** Canonical save form; reopening it yields exactly the same work. */
export function serializeWork(work: Work): string {
  return JSON.stringify(parseWork(JSON.stringify(work)), null, 2) + "\n";
}
