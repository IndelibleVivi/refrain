import type {
  Gesture,
  Layers,
  Moment,
  Rules,
  Session,
  Work,
} from "./contracts";

export function createSession(): Session {
  return {
    format: "drift-study-session@0",
    work: {
      format: "drift-study-work@0",
      title: "Drift study",
      duration: 72,
      loopSeconds: 4.8,
      notes: [
        { midi: 64, at: 0, duration: 0.45 },
        { midi: 71, at: 0.1875, duration: 0.3 },
        { midi: 78, at: 0.5, duration: 0.6 },
        { midi: 69, at: 0.8125, duration: 0.55 },
      ],
      rules: { drift: 0.48, erosion: 0.62, bloom: 0.65 },
    },
    gestures: [],
    cursor: 0,
    bookmarks: [],
  };
}

function object(
  value: unknown,
  keys: string[],
  path: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(path + " 应当是一个对象。");
  const item = value as Record<string, unknown>;
  if (
    Object.keys(item).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(item, key)) ||
    Object.keys(item).some((key) => !keys.includes(key))
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
function text(value: unknown, max: number, path: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(path + " 需要 1–" + max + " 个字符。");
  return value;
}
function rules(value: unknown): Rules {
  const r = object(value, ["drift", "erosion", "bloom"], "rules");
  return {
    drift: number(r.drift, 0, 1, "drift"),
    erosion: number(r.erosion, 0, 1, "erosion"),
    bloom: number(r.bloom, 0, 1, "bloom"),
  };
}
function layers(value: unknown): Layers {
  if (value !== "both" && value !== "a" && value !== "b")
    throw new Error("未知的声音层。");
  return value;
}
function gestures(value: unknown, duration: number): Gesture[] {
  if (!Array.isArray(value) || value.length > 2048)
    throw new Error("一份演奏最多记录 2048 次控制变化。");
  let previous = 0;
  return value.map((item: unknown) => {
    if (!item || typeof item !== "object") throw new Error("无效的操作。");
    const kind = (item as { kind?: unknown }).kind;
    const key =
      kind === "rules"
        ? "rules"
        : kind === "freeze"
          ? "frozen"
          : kind === "layers"
            ? "layers"
            : undefined;
    if (!key) throw new Error("未知的操作类型。");
    const g = object(item, ["at", "kind", key], "gesture");
    const at = number(g.at, previous, duration, "操作时间");
    previous = at;
    if (kind === "rules") return { at, kind, rules: rules(g.rules) };
    if (kind === "layers") return { at, kind, layers: layers(g.layers) };
    if (typeof g.frozen !== "boolean")
      throw new Error("frozen 应当是 boolean。");
    return { at, kind: "freeze", frozen: g.frozen };
  });
}
export function parseSession(input: string): Session {
  if (new TextEncoder().encode(input).length > 2 * 1024 * 1024)
    throw new Error("实验文件不能超过 2 MiB。");
  let json: unknown;
  try {
    json = JSON.parse(input);
  } catch {
    throw new Error("这不是有效的 JSON 实验文件。");
  }
  const s = object(
    json,
    ["format", "work", "gestures", "cursor", "bookmarks"],
    "experiment",
  );
  if (s.format !== "drift-study-session@0")
    throw new Error(
      "不支持这个实验版本；此入口不导入 AIR 或 RefrainArtifact。",
    );
  const w = object(
    s.work,
    ["format", "title", "duration", "loopSeconds", "notes", "rules"],
    "work",
  );
  if (w.format !== "drift-study-work@0")
    throw new Error("不支持这个作品规则版本。");
  const duration = number(w.duration, 12, 120, "路线长度");
  const loopSeconds = number(w.loopSeconds, 1, 12, "循环长度");
  if (!Array.isArray(w.notes) || w.notes.length < 1 || w.notes.length > 16)
    throw new Error("材料需要 1–16 个音。");
  let previous = 0;
  const notes = w.notes.map((item: unknown) => {
    const n = object(item, ["midi", "at", "duration"], "note");
    const midi = number(n.midi, 36, 96, "音高");
    if (!Number.isInteger(midi)) throw new Error("音高需要整数 MIDI 值。");
    const at = number(n.at, previous, 1 - Number.EPSILON, "音符位置");
    previous = at;
    return {
      midi,
      at,
      duration: number(n.duration, 0.03, loopSeconds, "音符时长"),
    };
  });
  const work: Work = {
    format: "drift-study-work@0",
    title: text(w.title, 100, "标题"),
    duration,
    loopSeconds,
    notes,
    rules: rules(w.rules),
  };
  if (!Array.isArray(s.bookmarks) || s.bookmarks.length > 12)
    throw new Error("最多保留 12 个岔口。");
  return {
    format: "drift-study-session@0",
    work,
    gestures: gestures(s.gestures, duration),
    cursor: number(s.cursor, 0, duration, "当前位置"),
    bookmarks: s.bookmarks.map((item: unknown) => {
      const b = object(item, ["name", "at", "gestures"], "bookmark");
      return {
        name: text(b.name, 48, "岔口名称"),
        at: number(b.at, 0, duration, "岔口位置"),
        gestures: gestures(b.gestures, duration),
      };
    }),
  };
}
export function serializeSession(session: Session): string {
  return JSON.stringify(parseSession(JSON.stringify(session)), null, 2) + "\n";
}
export function withGesture(session: Session, gesture: Gesture): Session {
  const next = {
    ...session,
    gestures: [
      ...session.gestures.filter((g) => g.at <= gesture.at),
      structuredClone(gesture),
    ],
    cursor: gesture.at,
  };
  // Same-time order is meaningful; a new past action retires only the later path.
  gestures(next.gestures, session.work.duration);
  return next;
}

export interface Span {
  start: number;
  end: number;
  offset: number;
  evolution: number;
  erosion: number;
  bloom: number;
  rules: Rules;
  frozen: boolean;
  layers: Layers;
}
const trajectories = new WeakMap<Session, Span[]>();
function evolved(span: Span, at: number) {
  const dt = span.frozen ? 0 : at - span.start;
  return {
    offset: span.offset + (dt * span.rules.drift) / 30,
    evolution: span.evolution + dt,
    erosion: Math.min(1, span.erosion + (dt * span.rules.erosion) / 38),
    bloom: Math.min(1, span.bloom + (dt * span.rules.bloom) / 48),
  };
}
export function trajectory(session: Session): Span[] {
  const cached = trajectories.get(session);
  if (cached) return cached;
  let span: Span = {
    start: 0,
    end: session.work.duration,
    offset: 0,
    evolution: 0,
    erosion: 0,
    bloom: 0.12,
    rules: session.work.rules,
    frozen: false,
    layers: "both",
  };
  const spans: Span[] = [];
  for (const gesture of session.gestures) {
    if (gesture.at > span.start) spans.push({ ...span, end: gesture.at });
    span = { ...span, ...evolved(span, gesture.at), start: gesture.at };
    if (gesture.kind === "rules") span.rules = gesture.rules;
    else if (gesture.kind === "freeze") span.frozen = gesture.frozen;
    else span.layers = gesture.layers;
  }
  spans.push(span);
  trajectories.set(session, spans);
  return spans;
}
export function momentAt(session: Session, seconds: number): Moment {
  const at = Math.max(0, Math.min(session.work.duration, seconds));
  const spans = trajectory(session);
  const span = spans.find((s) => s.end > at) ?? spans[spans.length - 1];
  const state = evolved(span, at);
  const phase = at / session.work.loopSeconds;
  return {
    phaseA: phase % 1,
    phaseB: (phase + state.offset) % 1,
    evolution: state.evolution,
    erosion: state.erosion,
    bloom: state.bloom,
    frozen: span.frozen,
    layers: span.layers,
    rules: { ...span.rules },
  };
}
