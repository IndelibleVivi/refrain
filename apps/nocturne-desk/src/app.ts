import "./style.css";
import type { Manifest, Session, VoiceId } from "./contracts";
import {
  newSession,
  parseSession,
  setVoice,
  applyArrangement,
  serializeSession,
  validateManifest,
} from "./model";
import { DeskEngine } from "./engine";
import { buildArtifact } from "./score";
import {
  deskArtwork,
  setSceneLayout,
  instrumentMotion,
  voices,
} from "./drawing";

const root = document.querySelector<HTMLDivElement>("#app")!;
const storageKey = "refrain.lantern-score.session.v0";
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const clone = (s: Session): Session => structuredClone(s);
const playIcon =
  '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 3L17 10 6 17Z"/></svg>';
const pauseIcon =
  '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 3H8V17H5ZM12 3H15V17H12Z"/></svg>';
const pad = (n: number) => String(n).padStart(2, "0");
const clock = (n: number) => `${Math.floor(n / 60)}:${pad(Math.floor(n % 60))}`;

async function boot() {
  const response = await fetch(new URL("./manifest.json", document.baseURI));
  if (!response.ok)
    throw new Error("乐谱还没有准备好。请在 repo 运行 npm run desk。");
  const manifest: Manifest = validateManifest(await response.json());
  const score = manifest.score;
  let session = newSession(score);
  let restoreNotice = "";
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) session = parseSession(JSON.parse(saved), score);
  } catch {
    restoreNotice = "本机旧手稿无法读取，先展开原手稿；旧存档未被覆盖。";
  }
  let selected = 0,
    comparison = false,
    busy = false,
    followPlayback = true,
    raf = 0;
  const undo: Session[] = [],
    redo: Session[] = [];
  const original = newSession(score);
  const current = () => (comparison ? original : session);
  const stride = (score.beatsPerSection * 60) / score.tempo;
  const engine = new DeskEngine(manifest, current, updateTransport, notice);

  root.innerHTML = `<main class="room">

  <header class="masthead"><a class="brand" href="./" aria-label="Refrain">Refrain<span>hums an air.</span></a><button id="tools-open" class="icon-button" aria-label="打开编配与保存" title="编配与保存"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 17h16M9 4v6M16 14v6"/></svg></button></header>
  <section class="stage" aria-label="阳光里的四件乐器">${deskArtwork()}</section>
  <section class="conductor" aria-label="音乐指挥台">
   <div class="chapter-heading"><span id="page-kicker" class="sr-only"></span><h1 id="section-title"></h1><button id="play-section" class="icon-button" aria-label="从这一页听" title="从这一页听"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5v14M11 5l9 7-9 7Z"/></svg></button></div>
   <nav class="phrases" aria-label="六页乐谱">${score.sections.map((s, i) => `<button class="phrase" data-section="${i}" aria-current="${i === 0}" aria-label="第 ${i + 1} 页 ${escape(s.title)}"><span>${["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "Ⅵ"][i]}</span><i class="playing-line"></i></button>`).join("")}</nav>
   <div class="transport"><button id="stop" class="icon-button" aria-label="停止并回到开头" title="回到开头"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h12v12H6Z"/></svg></button><button id="play" class="play-button" aria-label="开始演奏">${playIcon}</button><span class="time"><span id="time">0:00</span><span class="sr-only"> / <span id="duration"></span></span></span></div>
   <input type="range" id="seek" min="0" max="100" step="0.05" value="0" aria-label="演奏位置"/>
   <p id="touch-hint" class="touch-hint">碰一碰，让房间响起来</p>
   <span id="transport-status" class="sr-only" role="status"></span>
  </section>
  <p id="notice" class="notice" role="status" aria-live="polite"></p>
  <dialog id="tools" aria-labelledby="tools-title"><div class="dialog-head"><h2 id="tools-title">这一遍</h2><button id="tools-close" class="icon-button" aria-label="关闭编配与保存">×</button></div>
   <label class="title-label">名字<input id="work-title" maxlength="80" aria-label="手稿名称"/></label>
   <p id="section-harmony" class="harmony"></p><p id="voice-status" class="sr-only"></p>
   <div class="presets" aria-label="写好的编配"><button data-preset="manuscript">原手稿</button><button data-preset="solitude">独处</button><button data-preset="constellation">星群</button></div><span id="custom-mark" class="sr-only"></span>
   <div class="history-controls"><button id="undo" aria-label="撤回编配">↶ 撤回</button><button id="redo" aria-label="重做编配">↷ 重做</button><button id="compare" aria-pressed="false">原稿对照</button></div>
   <label class="volume-label">耳边音量<input type="range" id="volume" min="0" max="1" step="0.01" value="0.8" aria-label="监听音量"/></label>
   <label class="volume-label">叶间风声<input type="range" id="wind-volume" min="0" max="1" step="0.01" value="0.42" aria-label="风声大小"/></label>
   <div class="file-tools"><button id="save">保存手稿 ↗</button><button id="open">打开手稿</button><button id="wav">带走 WAV ↗</button><button id="air">原生 air ↗</button></div>
   <details id="about"><summary>怎么玩</summary><p>碰一下乐器，听它这一页的句子。乐器下面的圆点决定它是否加入合奏；每页至少留一件。六个页码只选段落，页名旁的箭头从这一页演奏。</p><p>还没开始的页可边听边改；修改已响过的页会先暂停。编配自动留在本机，也能保存后重开。「原稿对照」不覆盖你的版本。</p><p>点橄榄树开关轻轻的风叶声，可以单独听，也能陪合奏。它是本机合成的环境噪声，不写入音乐、手稿或 WAV；停止键和离开页面会关掉它。</p><p>WAV 保存这次分段合奏和完整尾音，耳边音量不写入。原生 air 保留音符、编制和精确音源，能交给 agent 继续写；整曲演奏的尾音与采样轮替可能略有不同。</p><p>Space 播放 / 暂停，Tab 选择乐器。当前 agent 写音乐，这个空间执行你的选择。没有账号、上传或隐藏作曲模型。</p></details>
  </dialog><input class="import-input" id="file" type="file" accept=".json,application/json"/>
 </main>`;

  const stage = root.querySelector<HTMLElement>(".stage")!;
  const mobileLayout = matchMedia("(max-width:700px)");
  setSceneLayout(stage, mobileLayout.matches);
  mobileLayout.addEventListener("change", (event) =>
    setSceneLayout(stage, event.matches),
  );
  function el<T extends HTMLElement = HTMLElement>(id: string): T {
    return document.getElementById(id) as T;
  }
  function notice(text: string) {
    if (document.getElementById("notice")) el("notice").textContent = text;
  }
  function persist() {
    try {
      localStorage.setItem(storageKey, serializeSession(session));
    } catch {
      notice("本机自动保存不可用，请用「保存手稿」带走这一遍。");
    }
  }
  function commit(next: Session) {
    if (serializeSession(next) === serializeSession(session)) return;
    undo.push(clone(session));
    if (undo.length > 50) undo.shift();
    redo.length = 0;
    session = next;
    persist();
    renderWork();
  }
  function leaveComparison() {
    if (comparison) {
      engine.stop();
      comparison = false;
    }
  }
  function editVoice(voice: VoiceId) {
    if (busy) return;
    leaveComparison();
    const idx = voices.findIndex((v) => v.id === voice);
    try {
      const next = setVoice(
        session,
        selected,
        voice,
        !session.arrangement[selected]![idx],
      );
      if (engine.status === "preparing" || !engine.canEdit(selected)) {
        engine.pause();
        notice("已暂停。点页名旁的箭头，从这一页听。");
      } else
        notice(
          `${score.sections[selected]!.title} · ${voices[idx]!.name}${next.arrangement[selected]![idx] ? "加入" : "歇一会儿"}`,
        );
      commit(next);
    } catch (error) {
      notice(error instanceof Error ? error.message : "这一页至少留一件乐器。");
    }
  }
  function renderWork() {
    const active = current();
    el("page-kicker").textContent =
      `PAGE ${pad(selected + 1)} / 06 · BARS ${selected * 4 + 1}–${selected * 4 + 4}`;
    el("section-title").textContent = score.sections[selected]!.title;
    el("section-harmony").textContent = score.sections[selected]!.harmony;
    for (const [v, voice] of voices.entries()) {
      const on = active.arrangement[selected]![v]!;
      root
        .querySelector(`[data-toggle="${voice.id}"]`)!
        .setAttribute("aria-pressed", String(on));
      root.querySelector(`[data-toggle="${voice.id}"] span`)!.textContent = on
        ? "在场"
        : "加入";
      root
        .querySelector(`[data-toggle="${voice.id}"]`)!
        .setAttribute(
          "aria-label",
          `${voice.name}${on ? "退出" : "加入"}这一页`,
        );
    }
    el("voice-status").textContent =
      `${active.arrangement[selected]!.filter(Boolean).length} 件乐器在场${comparison ? " · 正在看原稿" : " · 这页由你安排"}`;
    score.sections.forEach((_, i) => {
      const button = root.querySelector<HTMLElement>(`[data-section="${i}"]`)!;
      button.setAttribute("aria-current", String(selected === i));
    });
    let found = false;
    root
      .querySelectorAll<HTMLButtonElement>("[data-preset]")
      .forEach((button) => {
        const p = applyArrangement(
          original,
          button.dataset.preset as "manuscript" | "solitude" | "constellation",
        );
        const match =
          JSON.stringify(active.arrangement) === JSON.stringify(p.arrangement);
        found ||= match;
        button.classList.toggle("active", match);
        button.setAttribute("aria-pressed", String(match));
      });
    el("custom-mark").textContent = found ? "" : "your arrangement";
    el<HTMLButtonElement>("undo").disabled = undo.length === 0 || busy;
    el<HTMLButtonElement>("redo").disabled = redo.length === 0 || busy;
    el("compare").setAttribute("aria-pressed", String(comparison));
    el("compare").textContent = comparison ? "回到我的编配" : "原稿对照";
    el<HTMLInputElement>("work-title").value = session.title;
    updateTransport();
  }
  function updateTransport() {
    if (!document.getElementById("play")) return;
    const playing = engine.status === "playing",
      loading = engine.status === "preparing";
    el("play").innerHTML = playing || loading ? pauseIcon : playIcon;
    el("play").setAttribute(
      "aria-label",
      loading ? "取消声音准备" : playing ? "暂停演奏" : "开始演奏",
    );
    el("transport-status").textContent = loading
      ? "正在准备声音…"
      : playing
        ? `${comparison ? "原稿 · " : ""}${score.sections[Math.min(5, Math.floor(engine.time / stride))]!.title} · 演奏中`
        : engine.status === "ended"
          ? "演奏结束"
          : engine.status === "paused"
            ? "暂停 · 余下的慢慢来"
            : "乐器就位";
    el("duration").textContent = clock(engine.duration);
    el("time").textContent = clock(engine.time);
    el("plant").setAttribute("aria-pressed", String(engine.windOn));
    el("plant").setAttribute(
      "aria-label",
      engine.windOn ? "关闭风叶声" : "听叶间的风",
    );
    root.classList.toggle("wind-on", engine.windOn);
    root.classList.toggle("is-playing", playing);
    el<HTMLInputElement>("seek").max = String(engine.duration);
    el<HTMLInputElement>("seek").disabled = loading;
  }
  async function playPause() {
    if (engine.status === "playing" || engine.status === "preparing")
      engine.pause();
    else {
      followPlayback = true;
      await engine.play();
    }
    updateTransport();
  }
  async function fromSection() {
    followPlayback = true;
    engine.pause();
    await engine.seek(selected * stride);
    await engine.play();
  }
  root.querySelectorAll<SVGElement>("[data-instrument]").forEach((button) => {
    const select = () =>
      stage.setAttribute("data-active-voice", button.dataset.instrument!);
    button.addEventListener("pointerenter", select);
    button.addEventListener("focus", select);
    button.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        button.dispatchEvent(new MouseEvent("click"));
      }
    });
    button.addEventListener("click", async () => {
      select();
      if (busy) return;

      const voice = button.dataset.instrument as VoiceId;
      if (await engine.audition(selected, voice))
        notice(
          `${voices.find((v) => v.id === voice)!.name} · ${score.sections[selected]!.title}`,
        );
    });
  });
  root
    .querySelectorAll<HTMLButtonElement>("[data-toggle]")
    .forEach((b) =>
      b.addEventListener("click", () => editVoice(b.dataset.toggle as VoiceId)),
    );
  root.querySelectorAll<HTMLButtonElement>("[data-section]").forEach((b) =>
    b.addEventListener("click", () => {
      selected = Number(b.dataset.section);
      followPlayback = false;
      renderWork();
    }),
  );
  root.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((b) =>
    b.addEventListener("click", () => {
      if (busy) return;
      engine.stop();
      leaveComparison();
      commit(
        applyArrangement(
          session,
          b.dataset.preset as "manuscript" | "solitude" | "constellation",
        ),
      );
      notice(`已换成「${b.textContent}」，点播放听完整一遍。`);
      renderWork();
    }),
  );
  el("plant").addEventListener("click", () => void engine.toggleWind());
  el("plant").addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void engine.toggleWind();
    }
  });
  el<HTMLInputElement>("wind-volume").addEventListener("input", (event) =>
    engine.setWindVolume(Number((event.target as HTMLInputElement).value)),
  );
  el("play").addEventListener("click", () => void playPause());
  el("play-section").addEventListener("click", () => void fromSection());
  el("stop").addEventListener("click", () => {
    engine.stop();
    updateTransport();
  });
  el<HTMLInputElement>("seek").addEventListener("input", (event) => {
    void engine.seek(Number((event.target as HTMLInputElement).value));
  });
  el<HTMLInputElement>("volume").addEventListener("input", (event) =>
    engine.setVolume(Number((event.target as HTMLInputElement).value)),
  );
  el("undo").addEventListener("click", () => {
    if (!undo.length) return;
    engine.stop();
    comparison = false;
    redo.push(clone(session));
    session = undo.pop()!;
    persist();
    renderWork();
    notice("找回了上一种编配。");
  });
  el("redo").addEventListener("click", () => {
    if (!redo.length) return;
    engine.stop();
    comparison = false;
    undo.push(clone(session));
    session = redo.pop()!;
    persist();
    renderWork();
    notice("回到刚才那种编配。");
  });
  el("compare").addEventListener("click", () => {
    engine.stop();
    comparison = !comparison;
    renderWork();
    notice(comparison ? "原稿对照中，你自己的编配还在。" : "回到了你的编配。");
  });
  el("tools-open").addEventListener("click", () =>
    el<HTMLDialogElement>("tools").showModal(),
  );
  el("tools-close").addEventListener("click", () =>
    el<HTMLDialogElement>("tools").close(),
  );
  el<HTMLDialogElement>("tools").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) {
      const r = el("tools").getBoundingClientRect();
      if (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      )
        el<HTMLDialogElement>("tools").close();
    }
  });
  el<HTMLInputElement>("work-title").addEventListener("change", (event) => {
    const title = (event.target as HTMLInputElement).value.trim();
    if (title) {
      leaveComparison();
      try {
        commit({ ...session, title });
      } catch (error) {
        (event.target as HTMLInputElement).value = session.title;
        notice(error instanceof Error ? error.message : "名字未保存。");
      }
    } else {
      (event.target as HTMLInputElement).value = session.title;
      notice("给手稿留一个名字吧。");
    }
  });
  function download(bytes: BlobPart, name: string, type: string) {
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function filename() {
    return (
      current()
        .title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
        .slice(0, 65) || "lantern-score"
    );
  }
  el("save").addEventListener("click", () => {
    download(
      serializeSession(current()),
      `${filename()}.lantern.json`,
      "application/json",
    );
    notice("手稿已交给浏览器下载；这六页的编配可以重新打开。");
  });
  el("open").addEventListener("click", () =>
    el<HTMLInputElement>("file").click(),
  );
  el<HTMLInputElement>("file").addEventListener("change", async (event) => {
    const input = event.target as HTMLInputElement,
      file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error("手稿超过 1 MiB，未打开。");
      const next = parseSession(JSON.parse(await file.text()), score);
      engine.stop();
      comparison = false;
      commit(next);
      renderWork();
      notice(`重新展开了「${next.title}」。`);
    } catch (error) {
      notice(
        `没有改动当前手稿：${error instanceof Error ? error.message : "文件无法读取。"}`,
      );
    }
  });
  el("wav").addEventListener("click", async () => {
    if (busy) return;
    const snapshot = clone(current());
    const name = filename();
    busy = true;
    el<HTMLButtonElement>("wav").disabled = true;
    notice("正在把完整一遍装进 WAV…");
    try {
      const bytes = await engine.exportWav(snapshot);
      download(bytes as Uint8Array<ArrayBuffer>, `${name}.wav`, "audio/wav");
      notice("完整 WAV 已交给浏览器下载，耳边音量没有写入作品。");
    } catch (error) {
      notice(
        `WAV 未导出：${error instanceof Error ? error.message : "请重试。"}`,
      );
    } finally {
      busy = false;
      el<HTMLButtonElement>("wav").disabled = false;
      renderWork();
    }
  });
  el("air").addEventListener("click", async () => {
    if (busy) return;
    const snapshot = clone(current());
    const name = filename();
    busy = true;
    el<HTMLButtonElement>("air").disabled = true;
    try {
      const artifact = await buildArtifact(snapshot);
      download(
        JSON.stringify(artifact, null, 2),
        `${name}.refrain.json`,
        "application/vnd.refrain+json",
      );
      notice("原生 air 已交给浏览器下载，可以交给 agent 继续改写。");
    } catch (error) {
      notice(
        `air 未导出：${error instanceof Error ? error.message : "请重试。"}`,
      );
    } finally {
      busy = false;
      el<HTMLButtonElement>("air").disabled = false;
    }
  });
  window.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement;
    if (
      target.closest("button,input,textarea,select,summary,[role=button]") ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return;
    if (event.code === "Space") {
      event.preventDefault();
      void playPause();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      engine.stopWind();
      engine.pause();
      updateTransport();
    }
  });
  window.addEventListener("pagehide", () => {
    engine.dispose();
    cancelAnimationFrame(raf);
  });
  function frame() {
    const time = engine.time,
      beat = engine.beat,
      playing = engine.status === "playing";
    el("time").textContent = clock(time);
    if (document.activeElement !== el("seek"))
      el<HTMLInputElement>("seek").value = String(time);
    const section = Math.min(5, Math.floor(beat / score.beatsPerSection));
    const local = beat - section * score.beatsPerSection;
    if (playing && followPlayback && selected !== section) {
      selected = section;
      renderWork();
    }
    root.querySelectorAll<HTMLElement>("[data-section]").forEach((b, i) => {
      b.style.setProperty(
        "--progress",
        playing && section === i
          ? `${Math.min(100, (local / score.beatsPerSection) * 100)}%`
          : "0%",
      );
    });
    const audition = engine.auditionPosition;
    voices.forEach((v, vi) => {
      const soundingSection = audition?.section ?? section;
      const soundingBeat = audition?.beat ?? local;
      const enabled = audition
        ? audition.voice === v.id
        : playing && current().arrangement[section]![vi];
      const place = root.querySelector<SVGElement>(`[data-place="${v.id}"]`)!;
      instrumentMotion(
        place,
        v.id,
        score.sections[soundingSection]!.notes[v.id],
        enabled ? soundingBeat : -100,
      );
    });
    raf = requestAnimationFrame(frame);
  }
  renderWork();
  notice(restoreNotice);
  raf = requestAnimationFrame(frame);
}
void boot().catch((error) => {
  root.innerHTML =
    '<main class="boot"><h1>手稿还没展开</h1><p class="boot"></p><p>在 repo 运行 <code>npm run desk</code>，然后刷新。</p></main>';
  root.querySelector(".boot")!.textContent =
    error instanceof Error ? error.message : "无法加载这张乐谱。";
});
