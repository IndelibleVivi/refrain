import "./style.css";
import type { Gesture, Layers, Rules, Session } from "./contracts";
import {
  createSession,
  momentAt,
  parseSession,
  serializeSession,
  withGesture,
} from "./model";
import { DriftEngine } from "./engine";
import { drawField, noteName, notePositions } from "./visual";
import { voicesAt } from "./kernel";

const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const clone = <T>(value: T): T => structuredClone(value);
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const time = (seconds: number) =>
  Math.floor(seconds / 60) +
  ":" +
  String(Math.floor(seconds % 60)).padStart(2, "0");
const storageKey = "refrain-drift-study-v0";
let session = createSession();
let recovered = false;
let storageAvailable = true;
try {
  const saved = localStorage.getItem(storageKey);
  if (saved) {
    session = parseSession(saved);
    recovered = true;
  }
} catch {
  storageAvailable = false;
}
const engine = new DriftEngine(session);
engine.seek(session.cursor);
engine.setVolume(0.65);
let history: { session: Session; label: string }[] = [
  { session: clone(session), label: "最初" },
];
let historyIndex = 0;
let gestureStart: { session: Session; at: number } | undefined;
let starting = false;
let seeking = false;
let playGeneration = 0;
let lastDraw = -1;
let lastStatus = engine.status;
let redraw = true;
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const canvas = el<HTMLCanvasElement>("visual");
const rules = ["drift", "erosion", "bloom"] as const;
let highlightedNote: number | undefined;
let noteSignature = "";

function notice(message: string, error = false) {
  el("notice").textContent = message;
  el("notice").classList.toggle("error", error);
}
function fail(error: unknown) {
  notice(error instanceof Error ? error.message : String(error), true);
}
function snapshot() {
  return { ...clone(session), cursor: engine.position };
}
function persist() {
  try {
    localStorage.setItem(storageKey, serializeSession(snapshot()));
    storageAvailable = true;
  } catch {
    storageAvailable = false;
  }
  el("storage").textContent = storageAvailable
    ? "已留在此浏览器"
    : "请保存文件保管";
}
function remember(next: Session, label: string) {
  history = history.slice(0, historyIndex + 1);
  history.push({ session: clone(next), label });
  if (history.length > 80) history.shift();
  historyIndex = history.length - 1;
  el<HTMLButtonElement>("undo").disabled = historyIndex === 0;
  el<HTMLButtonElement>("redo").disabled = true;
}
function commit(next: Session, label: string, position = engine.position) {
  // Store the position before this edit as the undo destination.
  history[historyIndex].session.cursor = engine.position;
  session = { ...next, cursor: position };
  engine.setSession(session, position);
  remember(session, label);
  renderBookmarks();
  renderNoteTargets();
  persist();
  redraw = true;
  notice(label);
}
function apply(gesture: Gesture, label: string) {
  try {
    commit(withGesture(session, gesture), label);
  } catch (error) {
    fail(error);
  }
}
function beginGesture() {
  gestureStart ??= { session: clone(session), at: engine.position };
}
function editRules(values: Rules) {
  beginGesture();
  try {
    session = withGesture(session, {
      at: engine.position,
      kind: "rules",
      rules: values,
    });
    engine.setSession(session);
    redraw = true;
  } catch (error) {
    fail(error);
  }
}
function endGesture(cancel = false) {
  if (!gestureStart) return;
  const before = gestureStart;
  gestureStart = undefined;
  if (cancel) {
    session = before.session;
    engine.setSession(session);
    notice("这次拨动已撤回。");
  } else if (
    JSON.stringify(session.gestures) !== JSON.stringify(before.session.gestures)
  ) {
    history[historyIndex].session.cursor = before.at;
    session = { ...session, cursor: engine.position };
    remember(session, "拨动声场");
    notice("这次拨动已留下。可以撤回，也可以继续。");
  }
  persist();
  redraw = true;
}
function moveHistory(direction: number) {
  endGesture(true);
  const index = historyIndex + direction;
  if (index < 0 || index >= history.length) return;
  historyIndex = index;
  session = clone(history[index].session);
  engine.setSession(session, session.cursor);
  el<HTMLButtonElement>("undo").disabled = index === 0;
  el<HTMLButtonElement>("redo").disabled = index === history.length - 1;
  renderBookmarks();
  renderNoteTargets();
  persist();
  redraw = true;
  notice(
    direction < 0 ? "回到上一处。声音可以从这里继续。" : "重做了这次变化。",
  );
}

async function startPlayback(): Promise<boolean> {
  const generation = ++playGeneration;
  starting = true;
  redraw = true;
  try {
    await engine.play();
    if (generation !== playGeneration || engine.status !== "playing")
      return false;
    notice("声音正在回来。点一下音符，也可以冻结一次相遇。");
    return true;
  } catch (error) {
    if (generation === playGeneration) fail(error);
    return false;
  } finally {
    if (generation === playGeneration) starting = false;
    redraw = true;
  }
}
async function togglePlay() {
  if (starting || engine.status === "playing") {
    ++playGeneration;
    starting = false;
    engine.pause();
    persist();
    redraw = true;
    return;
  }
  await startPlayback();
}
async function pluckNote(note: number) {
  if (starting || !session.work.notes[note]) return;
  endGesture();
  if (engine.status !== "playing" && !(await startPlayback())) return;
  const at = engine.position;
  apply(
    { at, kind: "pluck", note, layers: momentAt(session, at).layers },
    "拨响 " +
      noteName(session.work.notes[note].midi) +
      "。这一声也留在了演奏里。",
  );
}
function positionNoteTargets() {
  const rect = canvas.getBoundingClientRect();
  for (const point of notePositions(session.work, rect.width, rect.height)) {
    const button = document.querySelector<HTMLButtonElement>(
      '[data-note="' + point.index + '"]',
    );
    if (button) {
      button.style.left = point.x + "px";
      button.style.top = point.y + "px";
    }
  }
}
function renderNoteTargets() {
  const signature = JSON.stringify(session.work.notes);
  if (signature === noteSignature) return;
  noteSignature = signature;
  highlightedNote = undefined;
  const root = el("note-targets");
  root.replaceChildren();
  session.work.notes.forEach((note, index) => {
    const button = document.createElement("button");
    button.className = "note-target";
    button.dataset.note = String(index);
    button.type = "button";
    const label = noteName(note.midi);
    const shortcut = index < 9 ? "，数字键 " + (index + 1) : "";
    button.setAttribute("aria-label", "拨响 " + label + shortcut);
    button.title = "拨响 " + label + shortcut;
    const caption = document.createElement("span");
    caption.textContent = label;
    button.append(caption);
    button.onclick = () => {
      void pluckNote(index);
    };
    button.onpointerenter = button.onfocus = () => {
      highlightedNote = index;
      redraw = true;
    };
    button.onpointerleave = () => {
      if (document.activeElement !== button) highlightedNote = undefined;
      redraw = true;
    };
    button.onblur = () => {
      highlightedNote = undefined;
      redraw = true;
    };
    button.onkeydown = (event) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const next =
          (index +
            (event.key === "ArrowRight" ? 1 : -1) +
            session.work.notes.length) %
          session.work.notes.length;
        root
          .querySelector<HTMLButtonElement>('[data-note="' + next + '"]')
          ?.focus();
      }
      if (event.key.startsWith("Arrow")) event.stopPropagation();
    };
    root.append(button);
  });
  positionNoteTargets();
}
el("play").onclick = () => {
  void togglePlay();
};
el("restart").onclick = () => {
  ++playGeneration;
  starting = false;
  engine.stop();
  persist();
  redraw = true;
  notice("回到开头。已记录的操作仍会在原来的时刻发生。");
};
el<HTMLInputElement>("seek").onpointerdown = () => {
  seeking = true;
};
el<HTMLInputElement>("seek").oninput = (event) => {
  engine.seek(Number((event.target as HTMLInputElement).value));
  redraw = true;
};
el<HTMLInputElement>("seek").onchange = () => {
  seeking = false;
  persist();
};
el<HTMLInputElement>("seek").onpointercancel = () => {
  seeking = false;
};
el<HTMLInputElement>("volume").oninput = (event) =>
  engine.setVolume(Number((event.target as HTMLInputElement).value) / 100);
el("freeze").onclick = () => {
  const frozen = !momentAt(session, engine.position).frozen;
  apply(
    { at: engine.position, kind: "freeze", frozen },
    frozen
      ? "相遇留住了。循环继续，演化停在这里。"
      : "松开了。两道声音继续走向各自的地方。",
  );
};
document
  .querySelectorAll<HTMLInputElement>('input[name="layers"]')
  .forEach((input) => {
    input.onchange = () =>
      apply(
        { at: engine.position, kind: "layers", layers: input.value as Layers },
        input.value === "both"
          ? "两道声音都回来了。"
          : "只留下 " +
              input.value.toUpperCase() +
              "。另一层仍在作品里，可以随时找回。",
      );
  });
for (const key of rules) {
  const input = el<HTMLInputElement>(key);
  input.onpointerdown = beginGesture;
  input.oninput = () =>
    editRules({
      ...momentAt(session, engine.position).rules,
      [key]: Number(input.value) / 100,
    });
  input.onchange = () => endGesture();
  input.onpointercancel = () => endGesture(true);
  input.onkeydown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      endGesture(true);
    }
  };
}
el("undo").onclick = () => moveHistory(-1);
el("redo").onclick = () => moveHistory(1);

const field = el("field");
let dragging: number | undefined;
let lastPointerAt = 0;
function touchField(event: PointerEvent) {
  const rect = field.getBoundingClientRect();
  editRules({
    ...momentAt(session, engine.position).rules,
    drift: clamp((event.clientX - rect.left) / rect.width),
    bloom: clamp(1 - (event.clientY - rect.top) / rect.height),
  });
}
field.onpointerdown = (event) => {
  if (
    event.button !== 0 ||
    (event.target as HTMLElement).closest(".note-target")
  )
    return;
  event.preventDefault();
  dragging = event.pointerId;
  field.setPointerCapture(event.pointerId);
  beginGesture();
  touchField(event);
  lastPointerAt = performance.now();
};
field.onpointermove = (event) => {
  if (dragging !== event.pointerId || performance.now() - lastPointerAt < 40)
    return;
  lastPointerAt = performance.now();
  touchField(event);
};
field.onpointerup = (event) => {
  if (dragging !== event.pointerId) return;
  touchField(event);
  dragging = undefined;
  endGesture();
};
field.onpointercancel = () => {
  dragging = undefined;
  endGesture(true);
};
field.onkeydown = (event) => {
  if (event.key === "Escape") {
    dragging = undefined;
    endGesture(true);
    return;
  }
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key))
    return;
  event.preventDefault();
  const current = momentAt(session, engine.position).rules;
  const next = { ...current };
  if (event.key === "ArrowLeft" || event.key === "ArrowRight")
    next.drift = clamp(
      current.drift + (event.key === "ArrowRight" ? 0.05 : -0.05),
    );
  else
    next.bloom = clamp(
      current.bloom + (event.key === "ArrowUp" ? 0.05 : -0.05),
    );
  editRules(next);
  endGesture();
};

function renderBookmarks() {
  const root = el("bookmarks");
  root.replaceChildren();
  if (!session.bookmarks.length) {
    const p = document.createElement("p");
    p.className = "empty-keeps";
    p.textContent = "还没有留下岔口。随时都可以。";
    root.append(p);
    return;
  }
  session.bookmarks.forEach((bookmark, index) => {
    const button = document.createElement("button");
    button.className = "bookmark";
    button.setAttribute("aria-label", "回到「" + bookmark.name + "」");
    const label = document.createElement("span");
    label.className = "bookmark-name";
    label.textContent = bookmark.name;
    const sub = document.createElement("small");
    sub.textContent = "↶ 回到这一刻";
    label.append(sub);
    const at = document.createElement("time");
    at.textContent = time(bookmark.at);
    button.append(label, at);
    button.onclick = () => {
      const saved = session.bookmarks[index];
      commit(
        { ...session, gestures: clone(saved.gestures) },
        "回到「" + saved.name + "」。可以从这里走出新的一支。",
        saved.at,
      );
    };
    root.append(button);
  });
}
el<HTMLFormElement>("bookmark-form").onsubmit = (event) => {
  event.preventDefault();
  if (session.bookmarks.length >= 12) {
    notice("这份实验已留下 12 个岔口。先保存文件，再开始另一份实验。", true);
    return;
  }
  const input = el<HTMLInputElement>("bookmark-name");
  const name =
    input.value.trim() ||
    "相遇 " + String(session.bookmarks.length + 1).padStart(2, "0");
  const bookmark = {
    name,
    at: engine.position,
    gestures: clone(session.gestures),
  };
  commit(
    { ...session, bookmarks: [...session.bookmarks, bookmark] },
    "已留下「" + name + "」。",
  );
  input.value = "";
};
function download(bytes: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
el("save").onclick = () => {
  try {
    download(
      serializeSession(snapshot()),
      "drift-study.experiment.json",
      "application/json",
    );
    persist();
    notice("材料、做法和这一遍，都已保存在实验文件里。");
  } catch (error) {
    fail(error);
  }
};
el("open").onclick = () => el<HTMLInputElement>("file").click();
let fileVersion = 0;
el<HTMLInputElement>("file").onchange = async (event) => {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0],
    version = ++fileVersion;
  if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024)
      throw new Error("实验文件不能超过 2 MiB。");
    const next = parseSession(await file.text());
    if (version !== fileVersion) return;
    ++playGeneration;
    starting = false;
    engine.pause();
    commit(
      next,
      "实验已打开。按播放，从 " + time(next.cursor) + " 继续。",
      next.cursor,
    );
  } catch (error) {
    fail(error);
  } finally {
    input.value = "";
  }
};
el("new-session").onclick = () => {
  ++playGeneration;
  starting = false;
  engine.pause();
  commit(createSession(), "回到最初的实验。上一份仍可用「撤回」找回。", 0);
};
el("export-wav").onclick = async () => {
  const button = el<HTMLButtonElement>("export-wav");
  button.disabled = true;
  button.textContent = "正在把这一遍写成声音…";
  const worker = new Worker(new URL("./export-worker.ts", import.meta.url), {
    type: "module",
  });
  try {
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      worker.onmessage = (event) =>
        event.data.error
          ? reject(new Error(event.data.error))
          : resolve(event.data.bytes);
      worker.onerror = (event) => reject(new Error(event.message));
      worker.postMessage(snapshot());
    });
    download(bytes, "drift-study.performance.wav", "audio/wav");
    notice("完整演奏已导出。要继续修改做法，也请保留实验 JSON。");
  } catch (error) {
    fail(error);
  } finally {
    worker.terminate();
    button.disabled = false;
    button.textContent = "导出这一遍 WAV ↗";
  }
};
document.addEventListener("keydown", (event) => {
  if (
    (event.target as HTMLElement).matches("input,textarea,select") ||
    event.altKey
  )
    return;
  if (
    !event.metaKey &&
    !event.ctrlKey &&
    /^[1-9]$/.test(event.key) &&
    !event.repeat
  ) {
    event.preventDefault();
    void pluckNote(Number(event.key) - 1);
  } else if (
    (event.metaKey || event.ctrlKey) &&
    event.key.toLowerCase() === "z"
  ) {
    event.preventDefault();
    moveHistory(event.shiftKey ? 1 : -1);
  } else if (
    event.code === "Space" &&
    (event.target === document.body || event.target === field)
  ) {
    event.preventDefault();
    void togglePlay();
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && (engine.status === "playing" || starting)) {
    ++playGeneration;
    starting = false;
    engine.pause();
    persist();
    redraw = true;
    notice("页面离开前已暂停。按播放继续。");
  }
});
window.addEventListener("pagehide", () => {
  persist();
  engine.dispose();
});
new ResizeObserver(() => {
  positionNoteTargets();
  redraw = true;
}).observe(field);

function refresh(now: number) {
  const position = engine.position,
    status = engine.status;
  if (lastStatus !== status) {
    if (status === "ended") {
      persist();
      notice("这一遍到这里结束。留下一个岔口，或从头重听。");
    }
    redraw = true;
    lastStatus = status;
  }
  const active = status === "playing";
  if (redraw || (active && now - lastDraw > (reduced.matches ? 160 : 30))) {
    const moment = momentAt(session, position);
    const voices = voicesAt(session, position);
    drawField(
      canvas,
      moment,
      session.work,
      active,
      voices,
      highlightedNote,
      reduced.matches,
    );
    el("elapsed").textContent = time(position);
    el("duration").textContent = time(session.work.duration);
    const seek = el<HTMLInputElement>("seek");
    seek.max = String(session.work.duration);
    if (!seeking) seek.value = String(position);
    const label = starting
      ? "正在唤醒…"
      : active
        ? "暂停"
        : status === "ended"
          ? "再听一遍"
          : position > 0
            ? "继续聆听"
            : "开始聆听";
    el("play-label").textContent = label;
    el("play").setAttribute("aria-label", label);
    el("play-icon").textContent = active ? "Ⅱ" : "▶";
    el("transport-status").textContent = active
      ? moment.frozen
        ? "相遇已冻结"
        : "正在演化"
      : status === "ended"
        ? "这一遍结束了"
        : "一条 " + session.work.duration + " 秒的路线";
    el("field-state").textContent = active
      ? moment.frozen
        ? "相遇留住了"
        : "声音正在走散"
      : position
        ? "停在这里"
        : "等待触碰";
    const delta = (((moment.phaseB - moment.phaseA) % 1) + 1) % 1;
    el("phase").textContent = "Δ " + delta.toFixed(2);
    el("freeze").setAttribute("aria-pressed", String(moment.frozen));
    el("freeze-label").textContent = moment.frozen
      ? "松开，让它继续"
      : "冻结这次相遇";
    el("freeze-note").textContent = moment.frozen
      ? "演化已停住，循环仍然继续。"
      : "停住演化，声音继续回来。";
    for (const key of rules) {
      const input = el<HTMLInputElement>(key),
        value = Math.round(moment.rules[key] * 100);
      if (document.activeElement !== input || !gestureStart)
        input.value = String(value);
      el(key + "-value").textContent = value + "%";
    }
    document
      .querySelectorAll<HTMLInputElement>('input[name="layers"]')
      .forEach((input) => {
        input.checked = input.value === moment.layers;
      });
    redraw = false;
    lastDraw = now;
  }
  requestAnimationFrame(refresh);
}
renderBookmarks();
renderNoteTargets();
if (recovered)
  notice("上次的实验还在。按播放，从 " + time(session.cursor) + " 继续。");
if (!storageAvailable) {
  el("storage").textContent = "请保存文件保管";
  notice("浏览器未能恢复本地草稿；文件保存和打开仍可使用。");
}
requestAnimationFrame(refresh);

// Read-only observable state for local behavior checks; no alternative editing path.
Object.defineProperty(window, "driftStudy", {
  value: Object.freeze({
    session: () => snapshot(),
    moment: () => clone(momentAt(session, engine.position)),
    audio: () => ({
      ...engine.evidence,
      status: engine.status,
      position: engine.position,
    }),
    history: () => ({ index: historyIndex, length: history.length }),
    voices: () => clone(voicesAt(session, engine.position)),
  }),
});
