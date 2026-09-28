import "./style.css";
import companionUrl from "../../../examples/breath-study/a-little-room-between.refrain.json?url";
import type { Work, Settings, Status } from "./contracts";
import { initialWork } from "./seed";
import { compileWork, parseWork } from "./model";
import { BreathEngine } from "./engine";

const $ = <T extends HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const storageKey = "refrain-breath-study-v0";
let work = initialWork();
let initialMessage = "拉开中央的空隙，或者先听一遍。";
try {
  const saved = localStorage.getItem(storageKey);
  if (saved) {
    work = parseWork(saved);
    initialMessage = "已找回上次的实验。声音等你点下聆听。";
  }
} catch {
  initialMessage = "上次的本地文件未能读取，已打开初始作品。";
}
let cursor = 0;
let reference = false,
  section = 0,
  undo: Work[] = [],
  redo: Work[] = [];
let gesture: { before: Work; playing: boolean } | null = null;
let status: Status = "idle";
let auditionTicket = 0;
let audition: { id: string; at: number } | null = null;
const engine = new BreathEngine((next) => {
  status = next;
  if (next === "paused" || next === "ended") cursor = engine.time;
  syncTransport();
});
function stopAt(at = 0) {
  auditionTicket++;
  engine.stop();
  cursor = at;
  audition = null;
}
function position() {
  return status === "playing" ? engine.time : cursor;
}
function sectionCount() {
  return Math.ceil(work.lengthBeats / 16);
}
let program = compileWork(work);
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ]!,
  );
const pitchName = (midi: number) =>
  ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][midi % 12] +
  (Math.floor(midi / 12) - 1);
const seconds = (n: number) =>
  `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;
const icon = (kind: string) =>
  ({
    play: '<path d="m7 4 13 8-13 8z"/>',
    pause: '<path d="M7 4h4v16H7zm7 0h4v16h-4z"/>',
    stop: '<path d="M6 6h12v12H6z"/>',
    save: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    undo: '<path d="m8 5-5 5 5 5M3 10h11a6 6 0 0 1 0 12"/>',
  })[kind] ?? "";
const svgIcon = (kind: string) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${icon(kind)}</svg>`;

$("#app").innerHTML = `
<main class="desk">
  <header class="masthead"><a href="https://github.com/IndelibleVivi/refrain" target="_blank" rel="noreferrer">Refrain<span class="brand-dot">.</span></a><span class="edition">SOUND STUDIES <b>02 / BREATH</b></span><button id="open" class="text-button">打开实验 <span>↗</span></button><input type="file" id="file" accept=".json,application/json" hidden></header>
  <section class="intro"><div><p class="eyebrow">A SMALL INSTRUMENT FOR HESITATION</p><h1>Breath <em>study</em></h1></div><p class="invitation">让一句旋律，<br>多停留一会儿。</p></section>
  <section class="instrument" aria-label="旋律与呼吸实验">
    <div class="instrument-top"><span id="piece-title"></span><div class="comparison" role="group" aria-label="原句与变形对照"><button id="original" aria-pressed="false">原句</button><button id="edited" aria-pressed="true">我的变形</button></div></div>
    <div id="field" class="field"><svg id="strings" viewBox="0 0 840 310" preserveAspectRatio="none" aria-hidden="true"></svg><div id="notes" class="notes"></div><div class="breath-line" id="breath-line"><span>留白</span><button id="gap-handle" class="gap-handle" aria-label="拖动调整留白" title="左右拖动；也可用下方留白滑杆"><i></i><i></i><small>↔</small></button></div><span class="field-caption">TOUCH A NOTE. LEAVE SOME AIR.</span></div>
    <div class="phrase-row" role="group" aria-label="乐句"><button data-section="0" aria-pressed="true"><span>Ⅰ</span> 初见</button><button data-section="1" aria-pressed="false"><span>Ⅱ</span> 回响</button><button data-section="2" aria-pressed="false"><span>Ⅲ</span> 落下</button><p>点亮一颗音符，听它的声音。</p></div>
  </section>
  <section class="listening" aria-label="播放控制"><button id="play" class="play-button">${svgIcon("play")}<span>聆听</span></button><button id="stop" class="icon-button" aria-label="回到开头">${svgIcon("stop")}</button><span id="time" class="time">0:00</span><input id="seek" type="range" min="0" max="1" value="0" step="0.01" aria-label="播放位置"><span id="duration" class="time"></span><label class="volume">音量<input id="volume" type="range" min="0" max="1" value="0.7" step="0.01" aria-label="监听音量"></label></section>
  <section class="controls" aria-label="声音变形">
    <label class="control"><span><b>留白</b><output id="breath-value">0.65 s</output></span><input id="breath" aria-label="留白" data-setting="breath" type="range" min="0" max="2" step="0.05"><small>一句中间，多留一点呼吸</small></label>
    <label class="control"><span><b>折光</b><output id="color-value">24%</output></span><input id="color" aria-label="折光" data-setting="color" type="range" min="0" max="1" step="0.01"><small>温暖拨弦 <i>→</i> 玻璃泛音</small></label>
    <label class="control"><span><b>余温</b><output id="space-value">35%</output></span><input id="space" aria-label="余温" data-setting="space" type="range" min="0" max="1" step="0.01"><small>贴近耳边 <i>→</i> 留在房间</small></label>
  </section>
  <div class="lower"><div class="history"><button id="undo" class="text-button">↶ 撤回</button><button id="redo" class="text-button">↷ 重做</button><span class="divider"></span><button id="reset" class="text-button">回到初始</button></div><div class="keep"><button id="save" class="text-button">保存实验</button><button id="wav" class="save-button">${svgIcon("save")}<span>带走 WAV</span></button></div></div>
  <p id="message" class="message" role="status" aria-live="polite"></p>
  <details class="about"><summary>关于这片声音</summary><div class="about-grid"><div><label class="title-label">作品名字<input id="title" maxlength="100"></label><p>同一句旋律，三次经过。留白只拉开时间，折光与余温只改变声音。调节时会暂歇，松手后从当前乐句重新聆听。</p><p>点奏是临时试听，不写入作品；保存和 WAV 保留你调整后的完整编排。原句对照不覆盖你的变形。快捷键：空格播放 / 暂停，数字 1–9 点奏，⌘ / Ctrl Z 撤回。</p></div><div><p>这是一个独立的 Refrain 声音实验。音色是本地合成拨弦与玻璃泛音，没有外部采样、上传或模型调用。不是原声吉他录音。</p><p>实验文件保留完整音符与声音参数，可在这里重新打开；它不是 AIR 或正式 performance binding。监听音量只影响当前播放。WAV 导出当前选择的原句或变形，保留原生力度。</p><p><a class="companion-link" href="${companionUrl}" download="a-little-room-between.refrain.json">↓ 带走这首 air 的尼龙吉他版</a><br>这是同一旋律的正式 Artifact，可用 Refrain Player 打开；它保留自己的准确采样与房间处理，不跟随这里的变形。</p><p>本机自动保留最近一份实验。浏览器或端口变化不会带走它，请保存文件。</p></div></div></details>
  <footer><span>Refrain hums an air.</span><span>AN EXPERIMENT, KEPT CLOSE.</span></footer>
</main>`;

function say(text: string) {
  $("#message").textContent = text;
}
function persist() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(work));
  } catch {
    say("本地自动保存不可用，请用“保存实验”带走。");
  }
}
function refresh() {
  section = Math.max(0, Math.min(sectionCount() - 1, section));
  program = compileWork(work, reference);
  $("#piece-title").textContent = work.title;
  $("#duration").textContent = seconds(program.duration);
  $<HTMLInputElement>("#seek").max = String(program.duration);
  for (const name of ["breath", "color", "space"] as const) {
    $<HTMLInputElement>("#" + name).value = String(work.settings[name]);
    $("#" + name + "-value").textContent =
      name === "breath"
        ? work.settings[name].toFixed(2) + " s"
        : Math.round(work.settings[name] * 100) + "%";
  }
  $("#original").setAttribute("aria-pressed", String(reference));
  $("#edited").setAttribute("aria-pressed", String(!reference));
  const row = $(".phrase-row");
  if (row.dataset.count !== String(sectionCount())) {
    row.dataset.count = String(sectionCount());
    row.innerHTML =
      Array.from(
        { length: sectionCount() },
        (_, i) =>
          `<button data-section="${i}" aria-pressed="false"><span>${["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "Ⅵ"][i]}</span> ${["初见", "回响", "落下"][i] ?? "续句"}</button>`,
      ).join("") + "<p>点亮一颗音符，听它的声音。</p>";
  }
  document
    .querySelectorAll("[data-section]")
    .forEach((el) =>
      el.setAttribute(
        "aria-pressed",
        String(Number((el as HTMLElement).dataset.section) === section),
      ),
    );
  $<HTMLButtonElement>("#undo").disabled = !undo.length;
  $<HTMLButtonElement>("#redo").disabled = !redo.length;
  $<HTMLInputElement>("#title").value = work.title;
  document.documentElement.style.setProperty(
    "--glass",
    String(work.settings.color),
  );
  mountNotes();
  syncTransport();
}
function sectionStart(index: number) {
  const beat = Math.min(index * 16, work.lengthBeats);
  return (
    (beat * 60) / work.tempo +
    work.breaths.filter((at) => at <= beat).length *
      (reference ? 0 : work.settings.breath)
  );
}
function phraseNotes() {
  return program.notes.filter(
    (n) =>
      n.part === "melody" && n.at >= section * 16 && n.at < (section + 1) * 16,
  );
}
function positions() {
  const notes = phraseNotes(),
    start = sectionStart(section);
  const phraseEnd = Math.min(program.musicEnd, sectionStart(section + 1));
  const low = Math.min(64, ...notes.map((n) => n.midi)),
    high = Math.max(80, ...notes.map((n) => n.midi));
  return notes.map((n) => ({
    note: n,
    x: 55 + ((n.start - start) / Math.max(1, phraseEnd - start)) * 730,
    y: 215 - ((n.midi - low) / (high - low)) * 125,
  }));
}
function mountNotes() {
  const focused =
    document.activeElement instanceof HTMLElement
      ? document.activeElement.dataset.note
      : undefined;
  $("#notes").innerHTML = positions()
    .map(
      ({ note, x, y }, i) =>
        `<button class="note" data-note="${escape(note.id)}" style="left:${(x / 840) * 100}%;top:${(y / 310) * 100}%" aria-label="点奏 ${pitchName(note.midi)}，音符 ${i + 1}"><span class="bead"></span><span class="note-label">${pitchName(note.midi)}</span></button>`,
    )
    .join("");
  document.querySelectorAll<HTMLButtonElement>(".note").forEach((el) => {
    el.onclick = () => void pluck(el.dataset.note!);
    el.onkeydown = (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const buttons = [
          ...document.querySelectorAll<HTMLButtonElement>(".note"),
        ];
        const at = buttons.indexOf(el);
        buttons[
          (at + (e.key === "ArrowRight" ? 1 : buttons.length - 1)) %
            buttons.length
        ].focus();
      }
    };
  });
  if (focused)
    document
      .querySelector<HTMLButtonElement>(`[data-note="${CSS.escape(focused)}"]`)
      ?.focus();
  draw();
}
function draw() {
  const now = position(),
    geometry = positions(),
    reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let paths = "";
  for (const { note, x, y } of geometry) {
    let age = status === "playing" ? now - note.start : -1;
    if (audition?.id === note.id)
      age = (performance.now() - audition.at) / 1000;
    const level = age >= 0 && age < 4 ? Math.exp(-age / 1.15) : 0;
    const shake = reduced ? 0 : Math.sin(age * 25) * level * 7;
    paths += `<path d="M ${x} 278 Q ${x - 22 + shake} ${y + 35} ${x} ${y}" stroke="${level > 0.1 ? "#ead6af" : "#6b7071"}" stroke-opacity="${0.36 + level * 0.5}" stroke-width="${0.8 + level * 0.65}"/><path d="M ${x} ${y} Q ${x + 38} ${y - 64} ${x + 12} 32" stroke="#c4b49a" stroke-opacity=".12"/>`;
    if (level > 0.02)
      paths += `<circle cx="${x}" cy="${y}" r="${7 + age * 17}" stroke="#e8c89d" stroke-opacity="${level * 0.32}"/><circle cx="${x}" cy="${y}" r="${3 + level * 4}" fill="#eed8b3" fill-opacity="${level * 0.7}" stroke="none"/>`;
    document
      .querySelector<HTMLElement>(`[data-note="${CSS.escape(note.id)}"]`)
      ?.style.setProperty("--level", String(level));
  }
  const gap = program.gaps.find(
    (g) =>
      g.start >= sectionStart(section) - 0.01 &&
      g.start < sectionStart(section + 1) - 0.01,
  );
  const width = gap
    ? ((gap.end - gap.start) /
        (sectionStart(section + 1) - sectionStart(section))) *
      730
    : 0;
  const gx = gap
    ? 55 +
      ((gap.start - sectionStart(section)) /
        (sectionStart(section + 1) - sectionStart(section))) *
        730
    : 420;
  const route = geometry
    .map(({ x, y }, i) => `${i ? "L" : "M"} ${x} ${y}`)
    .join(" ");
  $("#strings").innerHTML =
    `<defs><linearGradient id="air-gap"><stop stop-color="#eacda7" stop-opacity="0"/><stop offset=".5" stop-color="#eacda7" stop-opacity=".07"/><stop offset="1" stop-color="#eacda7" stop-opacity="0"/></linearGradient></defs><rect x="${gx - 8}" y="30" width="${Math.max(16, width + 16)}" height="240" fill="url(#air-gap)"/><path d="M 36 278 H 810" stroke="#788080" stroke-opacity=".22"/><path d="${route}" stroke="#ddc29d" stroke-opacity=".14"/>${paths}`;
  $("#breath-line").style.left = `${((gx + width / 2) / 840) * 100}%`;
  if (status === "playing") {
    const next = Math.min(
      sectionCount() - 1,
      Math.max(
        0,
        Array.from({ length: sectionCount() }, (_, i) => i).filter(
          (s) => now >= sectionStart(s),
        ).length - 1,
      ),
    );
    if (next !== section) {
      section = next;
      refresh();
    }
  }
}
function syncTransport() {
  if (!document.querySelector("#play")) return;
  const running = status === "playing",
    preparing = status === "preparing";
  $("#play").innerHTML =
    svgIcon(running ? "pause" : "play") +
    `<span>${preparing ? "准备声音…" : running ? "暂停" : status === "paused" ? "继续聆听" : status === "ended" ? "再听一遍" : "聆听"}</span>`;
  $("#play").setAttribute(
    "aria-label",
    preparing
      ? "取消准备"
      : running
        ? "暂停"
        : status === "paused"
          ? "继续聆听"
          : "聆听",
  );
  document.documentElement.dataset.playing = String(running);
}
async function listen() {
  try {
    if (status === "preparing") {
      stopAt(cursor);
      return;
    }
    if (status === "playing") {
      engine.pause();
      return;
    }
    if (status === "ended") {
      section = 0;
      cursor = 0;
      refresh();
    }
    const start = cursor;
    await engine.play(work, reference, start);
  } catch (error) {
    say(
      `声音未能开始：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
async function pluck(id: string) {
  const ticket = ++auditionTicket;
  try {
    await engine.audition(work, id, reference);
    if (ticket === auditionTicket) audition = { id, at: performance.now() };
  } catch (error) {
    say(
      `点奏未能开始：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
function begin() {
  if (gesture) return;
  gesture = { before: work, playing: status === "playing" };
  auditionTicket++;
  engine.stop();
  audition = null;
  reference = false;
  cursor = sectionStart(section);
}
function setSetting(key: keyof Settings, value: number) {
  begin();
  const next = { ...work, settings: { ...work.settings, [key]: value } };
  try {
    compileWork(next);
  } catch (error) {
    refresh();
    say(error instanceof Error ? error.message : String(error));
    return;
  }
  work = next;
  refresh();
}
async function commit() {
  const current = gesture;
  if (!current) return;
  gesture = null;
  if (JSON.stringify(current.before) !== JSON.stringify(work)) {
    undo.push(current.before);
    undo = undo.slice(-50);
    redo = [];
    persist();
  }
  cursor = sectionStart(section);
  refresh();
  if (current.playing)
    try {
      await engine.play(work, false, sectionStart(section));
    } catch (error) {
      say(String(error));
    }
}
function cancel() {
  if (!gesture) return;
  work = gesture.before;
  gesture = null;
  stopAt(sectionStart(section));
  refresh();
  say("已取消这次调整。");
}
function replace(next: Work) {
  stopAt();
  undo.push(work);
  undo = undo.slice(-50);
  redo = [];
  work = next;
  reference = false;
  section = 0;
  persist();
  refresh();
}
function history(direction: "undo" | "redo") {
  if (gesture) cancel();
  const source = direction === "undo" ? undo : redo,
    target = direction === "undo" ? redo : undo;
  const next = source.pop();
  if (!next) return;
  stopAt();
  section = 0;
  target.push(work);
  work = next;
  reference = false;
  persist();
  refresh();
}
for (const name of ["breath", "color", "space"] as const) {
  const slider = $<HTMLInputElement>("#" + name);
  slider.addEventListener("input", () =>
    setSetting(name, Number(slider.value)),
  );
  slider.addEventListener("change", () => void commit());
  slider.addEventListener("pointercancel", cancel);
}
let drag: { x: number; value: number; pointer: number } | null = null;
const handle = $<HTMLButtonElement>("#gap-handle");
handle.onpointerdown = (e) => {
  begin();
  drag = { x: e.clientX, value: work.settings.breath, pointer: e.pointerId };
  handle.setPointerCapture(e.pointerId);
};
handle.onpointermove = (e) => {
  if (drag)
    setSetting(
      "breath",
      Math.max(
        0,
        Math.min(
          2,
          Math.round((drag.value + (e.clientX - drag.x) / 100) * 20) / 20,
        ),
      ),
    );
};
handle.onpointerup = () => {
  drag = null;
  void commit();
};
handle.onpointercancel = () => {
  drag = null;
  cancel();
};
handle.onkeydown = (e) => {
  if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
    e.preventDefault();
    setSetting(
      "breath",
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? 2
          : Math.max(
              0,
              Math.min(
                2,
                work.settings.breath + (e.key === "ArrowLeft" ? -0.05 : 0.05),
              ),
            ),
    );
    void commit();
  }
};
$("#play").onclick = () => void listen();
$("#stop").onclick = () => {
  stopAt();
  section = 0;
  refresh();
};
$("#undo").onclick = () => history("undo");
$("#redo").onclick = () => history("redo");
$("#reset").onclick = () => replace(initialWork());
for (const id of ["original", "edited"])
  $("#" + id).onclick = () => {
    auditionTicket++;
    engine.stop();
    reference = id === "original";
    cursor = sectionStart(section);
    audition = null;
    refresh();
    say(
      reference
        ? "原句：不加留白，保留温暖拨弦。点聆听作对照。"
        : "已回到你的变形。",
    );
  };
$(".phrase-row").onclick = async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "[data-section]",
  );
  if (!button) return;
  section = Number(button.dataset.section);
  const at = sectionStart(section);
  if (status === "playing") await engine.seek(at);
  else engine.pause();
  cursor = at;
  refresh();
};
$<HTMLInputElement>("#volume").oninput = (e) => {
  engine.volume = Number((e.target as HTMLInputElement).value);
};
engine.volume = 0.7;
$<HTMLInputElement>("#seek").onchange = async (e) => {
  const at = Number((e.target as HTMLInputElement).value);
  if (status === "playing") await engine.seek(at);
  else engine.pause();
  cursor = at;
  section = Math.min(
    sectionCount() - 1,
    Array.from({ length: sectionCount() }, (_, i) => i).filter(
      (s) => at >= sectionStart(s),
    ).length - 1,
  );
  refresh();
};
$<HTMLInputElement>("#title").onchange = (e) => {
  const title = (e.target as HTMLInputElement).value.trim();
  if (title) replace({ ...work, title });
  else refresh();
};
function download(bytes: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("#save").onclick = () => {
  download(
    JSON.stringify(work, null, 2) + "\n",
    "breath-study.experiment.json",
    "application/json",
  );
  say("实验文件已准备下载，包含音符与当前变形。");
};
$("#open").onclick = () => $<HTMLInputElement>("#file").click();
$<HTMLInputElement>("#file").onchange = async (e) => {
  const input = e.target as HTMLInputElement,
    file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > 1_048_576) throw new Error("实验文件最多 1 MiB。");
    const next = parseWork(await file.text());
    replace(next);
    say("已打开实验。声音等你点下聆听。");
  } catch (error) {
    say(
      `未打开，当前作品已保留：${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    input.value = "";
  }
};
let exporter: Worker | null = null;
$("#wav").onclick = () => {
  if (exporter) return;
  const snapshot = compileWork(work, reference),
    mode = reference ? "original" : "variation";
  const button = $<HTMLButtonElement>("#wav");
  button.disabled = true;
  button.querySelector("span")!.textContent = "正在渲染…";
  exporter = new Worker(new URL("./render-worker.ts", import.meta.url), {
    type: "module",
  });
  const finish = () => {
    exporter?.terminate();
    exporter = null;
    button.disabled = false;
    button.querySelector("span")!.textContent = "带走 WAV";
  };
  exporter.onmessage = (e) => {
    const data = e.data;
    if (data.error) {
      say(`导出失败：${data.error}`);
    } else {
      download(data.bytes, `breath-study-${mode}.wav`, "audio/wav");
      say(
        `已导出${mode === "original" ? "原句" : "变形"}的完整一路，监听音量未写入 WAV。`,
      );
    }
    finish();
  };
  exporter.onerror = () => {
    say("WAV 渲染失败，请重试。");
    finish();
  };
  exporter.postMessage({
    id: 1,
    kind: "wav",
    program: snapshot,
    sampleRate: 32000,
  });
};
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    drag = null;
    cancel();
    return;
  }
  if ((e.target as HTMLElement).matches("input,textarea,select")) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    history(e.shiftKey ? "redo" : "undo");
  } else if (
    e.code === "Space" &&
    !(e.target as HTMLElement).closest("button,summary")
  ) {
    e.preventDefault();
    void listen();
  } else if (/^[1-9]$/.test(e.key)) {
    const note = phraseNotes()[Number(e.key) - 1];
    if (note) void pluck(note.id);
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    auditionTicket++;
    audition = null;
    engine.pause();
    if (gesture) cancel();
  }
});
window.addEventListener("pagehide", () => {
  auditionTicket++;
  engine.dispose();
  exporter?.terminate();
});
refresh();
say(initialMessage);
let lastFrame = 0;
function animate(now: number) {
  const limit = matchMedia("(prefers-reduced-motion: reduce)").matches
    ? 160
    : 33;
  if (now - lastFrame >= limit) {
    lastFrame = now;
    draw();
    $("#time").textContent = seconds(position());
    if (document.activeElement?.id !== "seek")
      $<HTMLInputElement>("#seek").value = String(position());
  }
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
