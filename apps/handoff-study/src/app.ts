import "./style.css";
import type { Lead, StudyManifest, StudySession } from "./contracts";
import { StudyEngine } from "./engine";
import {
  choose,
  gateBeat,
  newSession,
  parseSession,
  phraseSeconds,
  routeOf,
  serializeSession,
  validateManifest,
} from "./model";
const root = document.querySelector<HTMLElement>("#app")!;
const storageKey = "refrain-handoff-study-v0";
const name = (lead: Lead) => (lead === "piano" ? "钢琴" : "木琴");
const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
function download(bytes: BlobPart, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function main(): Promise<void> {
  let manifest: StudyManifest;
  try {
    const response = await fetch(new URL("./manifest.json", document.baseURI));
    if (!response.ok || !response.headers.get("content-type")?.includes("json"))
      throw new Error("乐句还没准备好。运行 npm run handoff 后再打开这里。");
    manifest = validateManifest(await response.json());
  } catch (e) {
    root.innerHTML = `<section class="failure"><p class="eyebrow">Refrain / handoff study</p><h1>声音还没到场</h1><p>${escape(e instanceof Error ? e.message : "作品准备失败。")}</p><code>npm run handoff</code><button id="retry">重新打开</button></section>`;
    document
      .querySelector("#retry")
      ?.addEventListener("click", () => location.reload());
    return;
  }
  let session = newSession(manifest),
    original = false,
    message = "",
    saveError = "";
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) session = parseSession(saved, manifest);
  } catch {
    saveError =
      "本机旧记录与当前声音不一致，已保留旧记录。可打开对应实验文件。";
  }
  root.innerHTML = `
  <header><a href="https://github.com/IndelibleVivi/refrain" target="_blank" rel="noopener noreferrer" class="brand">Refrain<span>hums an air.</span></a><span class="study-label">Handoff study / 03</span></header>
  <section class="intro"><div><p class="eyebrow">A borrowed beat</p><h1>借来的<span>半拍</span><i>↗</i></h1></div><p class="invitation">先听它们说一句。<br>再把下一句，交给另一种声音。<small>钢琴 · 木琴 · 尼龙吉他</small></p></section>
  <section class="stage" aria-label="当前乐句与两种声音"><div class="stage-top"><span id="phrase-index">01 / 08</span><span id="phrase-title"></span><span class="on-air"><b></b><span id="status">准备好了</span></span></div><div class="score-space"><svg id="score" viewBox="0 0 800 252" role="img" aria-label="当前乐句的真实音高与起音位置"></svg><div class="voice-labels"><span class="piano">● 钢琴</span><span class="marimba">● 木琴</span><span class="guitar">吉他在下面，留一点步态</span></div></div><div class="phrase-caption" id="phrase-description"></div></section>
  <nav class="phrase-route" aria-label="八个乐句">${manifest.score.steps.map((s, i) => `<button data-step="${i}" aria-label="跳到第 ${i + 1} 句：${escape(s.title)}"><span>${String(i + 1).padStart(2, "0")}</span><b>${escape(s.title)}</b><i></i></button>`).join("")}</nav>
  <section class="transport" aria-label="播放控制"><button id="play" class="play">▶ <span>聆听</span></button><button id="restart" class="quiet">回到开头</button><div class="time"><span id="current">0:00</span><input id="seek" type="range" min="0" max="45" step="0.1" value="0" aria-label="播放位置"/><span id="total"></span></div><label class="volume"><span>音量</span><input id="volume" type="range" min="0" max="1" step="0.01" value="0.8" aria-label="监听音量"/></label></section>
  <section class="handoffs" aria-label="两次句尾交接"><div class="handoff-intro"><p class="eyebrow">Your turn</p><h2>这一句，谁来接？</h2><p>你可以提前选。到了句尾，声音才真正交过去。</p></div><div class="cue-list">${[0, 1].map((g) => `<div class="cue" data-gate="${g}"><div class="cue-heading"><span>0${g + 1}</span><h3>${g === 0 ? "中间那句" : "最后的回来"}</h3><small id="cue-state-${g}"></small></div><div class="cue-options"><button data-choice="${g}:piano" class="piano">交给钢琴 <span>↗</span></button><button data-choice="${g}:marimba" class="marimba">交给木琴 <span>↗</span></button></div><p>${g === 0 ? "接过主题的声音站到前面，另一位留出空隙。" : "熟悉的句子回来时，带着前面学到的重音。"}</p></div>`).join("")}</div></section>
  <div class="notice" id="notice" role="status" aria-live="polite"></div>
  <footer><div class="compare" role="group" aria-label="比较演奏"><button id="mine" aria-pressed="true">我的接句</button><button id="original" aria-pressed="false">原演奏</button></div><div class="custody"><button id="save">保存这一遍</button><button id="open">打开实验</button><button id="wav">带走 WAV</button></div><input id="file" type="file" accept=".json,application/json" hidden/></footer>
  <details class="about"><summary>这张小舞台里有什么？</summary><p>八个写好的乐句，两次可以提前决定的交接。它们共用一个拍点；已响起的余音会继续落下。原演奏完整走完，你的选择会改变后面的主题、回答与收束。</p><p>保存文件带着完整乐谱、四条原生 AIR 演奏和这版声音的精确引用；WAV 冻结这次乐句交叠的演出，监听音量不进入文件。它是独立实验，还没有进入正式 AIR 或 MCP Canvas 的交互契约。</p><button id="reset">恢复原来的接句</button><button id="native">带走这条路线的原生 air</button></details>`;
  const el = <T extends HTMLElement>(selector: string) =>
    root.querySelector<T>(selector)!;
  const engine = new StudyEngine(
    manifest,
    () => session,
    () => original,
    render,
    (text) => {
      message = text;
      renderNotice();
    },
  );
  function persist(): void {
    try {
      localStorage.setItem(storageKey, serializeSession(session));
      saveError = "";
    } catch {
      saveError = "本机保存不可用；用“保存这一遍”带走文件。";
    }
  }
  function renderNotice(): void {
    el("#notice").textContent = message || saveError;
  }
  let lastStep = -1,
    lastRoute = "";
  function renderScore(step: number): void {
    const route = routeOf(session, original),
      chunk = manifest.score.chunks.find(
        (c) => c.id === manifest.score.steps[step]!.chunks[route],
      )!;
    const lead = manifest.score.steps[step]!.lead[route];
    const notes = chunk.notes.filter((n) => n.voice !== "guitar");
    const dots = notes
      .map((n) => {
        const x = 72 + (n.at / manifest.score.phraseBeats) * 662;
        const lane = n.voice === "piano" ? 82 : 169;
        const y = lane - (n.midi - 66) * 2.2;
        return `<g class="note ${n.voice} ${lead === n.voice ? "leading" : "answering"}"><line x1="${x}" y1="${y}" x2="${x + Math.max(7, (n.beats / 8) * 662)}" y2="${y}"/><circle cx="${x}" cy="${y}" r="${lead === n.voice ? 5.5 : 4}"/><title>${name(n.voice as Lead)} · MIDI ${n.midi} · 第 ${n.at + 1} 拍</title></g>`;
      })
      .join("");
    const paths = (["piano", "marimba"] as const)
      .map((voice) => {
        const sorted = notes
          .filter((n) => n.voice === voice)
          .sort((a, b) => a.at - b.at);
        if (!sorted.length) return "";
        return `<polyline class="melody-path ${voice}" points="${sorted.map((n) => `${72 + (n.at / 8) * 662},${(voice === "piano" ? 82 : 169) - (n.midi - 66) * 2.2}`).join(" ")}"/>`;
      })
      .join("");
    el("#score").innerHTML =
      `<defs><linearGradient id="lane" x2="1" y2="0"><stop stop-color="#b6a4ba" stop-opacity="0"/><stop offset=".5" stop-color="#b6a4ba" stop-opacity=".4"/><stop offset="1" stop-color="#b6a4ba" stop-opacity="0"/></linearGradient></defs>${[82, 169].map((y) => `<line class="lane" x1="48" y1="${y}" x2="752" y2="${y}"/>`).join("")}${Array.from({ length: 9 }, (_, i) => `<line class="beat" x1="${72 + (i / 8) * 662}" y1="26" x2="${72 + (i / 8) * 662}" y2="218"/>`).join("")}${paths}${dots}<line id="playhead" x1="72" y1="25" x2="72" y2="219"/>`;
    el("#phrase-title").textContent = manifest.score.steps[step]!.title;
    el("#phrase-index").textContent =
      `${String(step + 1).padStart(2, "0")} / 08`;
    el("#phrase-description").textContent =
      manifest.score.steps[step]!.description;
    el(".stage").dataset.lead = lead;
  }
  function render(): void {
    const stride = phraseSeconds(manifest.score),
      step = Math.min(7, Math.floor(engine.time / stride)),
      route = routeOf(session, original);
    if (step !== lastStep || route !== lastRoute) {
      renderScore(step);
      lastStep = step;
      lastRoute = route;
    }
    const line = el<SVGElement & HTMLElement>("#playhead");
    const local = Math.min(8, Math.max(0, engine.beat - step * 8));
    line.setAttribute("x1", String(72 + (local / 8) * 662));
    line.setAttribute("x2", String(72 + (local / 8) * 662));
    const statuses = {
      ready: "准备好了",
      preparing: "声音在到场",
      playing: "正在说话",
      paused: "停一会儿",
      ended: "这一遍说完了",
    };
    el("#status").textContent = statuses[engine.status];
    el(".stage").dataset.playing = String(engine.status === "playing");
    el("#play").innerHTML =
      `${engine.status === "playing" ? "Ⅱ" : engine.status === "preparing" ? "◌" : "▶"} <span>${engine.status === "playing" ? "暂停" : engine.status === "preparing" ? "取消准备" : engine.status === "ended" ? "再听一遍" : "聆听"}</span>`;
    el("#current").textContent = clock(engine.time);
    el("#total").textContent = clock(engine.duration);
    const seek = el<HTMLInputElement>("#seek");
    seek.max = String(engine.duration);
    if (document.activeElement !== seek) seek.value = String(engine.time);
    root.querySelectorAll<HTMLButtonElement>("[data-step]").forEach((b) => {
      const active = Number(b.dataset.step) === step;
      b.classList.toggle("active", active);
      b.setAttribute("aria-current", active ? "step" : "false");
    });
    root.querySelectorAll<HTMLButtonElement>("[data-choice]").forEach((b) => {
      const [g, l] = b.dataset.choice!.split(":") as [string, Lead],
        gate = Number(g) as 0 | 1;
      b.disabled = !engine.canChoose(gate);
      const selected = original
        ? session.work.defaultRoute[gate]
        : (session.choices.find((c) => c.gate === gate)?.lead ??
          session.work.defaultRoute[gate]);
      b.setAttribute("aria-pressed", String(selected === l));
    });
    for (const gate of [0, 1] as const)
      el(`#cue-state-${gate}`).textContent = original
        ? "听原演奏中"
        : engine.canChoose(gate)
          ? `第 ${gateBeat(session.work, gate) / 4 + 1} 小节进入`
          : "已交出去";
    el("#mine").setAttribute("aria-pressed", String(!original));
    el("#original").setAttribute("aria-pressed", String(original));
    renderNotice();
  }
  el("#play").addEventListener("click", () =>
    engine.status === "playing" || engine.status === "preparing"
      ? engine.pause()
      : void engine.play(),
  );
  el("#restart").addEventListener("click", () => {
    engine.stop();
    message = "从开头再接一次，保留你的选择。";
    render();
  });
  el<HTMLInputElement>("#seek").addEventListener(
    "change",
    (e) => void engine.seek(Number((e.target as HTMLInputElement).value)),
  );
  el<HTMLInputElement>("#volume").addEventListener("input", (e) =>
    engine.setVolume(Number((e.target as HTMLInputElement).value)),
  );
  root
    .querySelectorAll<HTMLButtonElement>("[data-step]")
    .forEach((b) =>
      b.addEventListener(
        "click",
        () =>
          void engine.seek(
            Number(b.dataset.step) * phraseSeconds(manifest.score),
          ),
      ),
    );
  root.querySelectorAll<HTMLButtonElement>("[data-choice]").forEach((b) =>
    b.addEventListener("click", () => {
      const [g, l] = b.dataset.choice!.split(":") as [string, Lead],
        gate = Number(g) as 0 | 1;
      if (!engine.canChoose(gate)) return;
      session = choose(session, gate, l, Math.max(0, engine.beat));
      persist();
      message = `下一句交给${name(l)}；到第 ${gateBeat(session.work, gate) / 4 + 1} 小节进入。`;
      render();
    }),
  );
  for (const mode of ["mine", "original"])
    el(`#${mode}`).addEventListener("click", () => {
      const next = mode === "original";
      if (original === next) return;
      engine.stop();
      original = next;
      message = next
        ? "原演奏保留。点聆听，完整听一次它们原来的来往。"
        : "回到你的接句。点聆听重放这一遍。";
      render();
    });
  el("#reset").addEventListener("click", () => {
    engine.stop();
    session = newSession(manifest);
    original = false;
    persist();
    message = "恢复了原来的交接。";
    render();
  });
  el("#save").addEventListener("click", () => {
    download(
      serializeSession(original ? newSession(manifest) : session),
      "a-borrowed-beat.handoff.json",
      "application/json",
    );
    message = "这一遍已保存，包含完整乐谱和你的交接。";
    renderNotice();
  });
  el("#open").addEventListener("click", () =>
    el<HTMLInputElement>("#file").click(),
  );
  el<HTMLInputElement>("#file").addEventListener("change", async (e) => {
    const input = e.target as HTMLInputElement,
      file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > 4 * 1024 * 1024) throw new Error("实验文件超过 4 MiB。");
      const restored = parseSession(await file.text(), manifest);
      engine.stop();
      session = restored;
      original = false;
      persist();
      message = "这一遍回来了。点聆听重放；打开文件不会自动发声。";
      render();
    } catch (error) {
      message = error instanceof Error ? error.message : "实验文件无法打开。";
      renderNotice();
    } finally {
      input.value = "";
    }
  });
  el("#wav").addEventListener("click", async () => {
    const b = el<HTMLButtonElement>("#wav");
    b.disabled = true;
    try {
      const bytes = await engine.wav();
      download(
        bytes,
        original
          ? "a-borrowed-beat.original.wav"
          : "a-borrowed-beat.my-handoff.wav",
        "audio/wav",
      );
      message = "完整 WAV 已带走；包含句尾余音，不受监听音量影响。";
    } catch (e) {
      message = e instanceof Error ? e.message : "WAV 导出失败。";
    } finally {
      b.disabled = false;
      renderNotice();
    }
  });
  el("#native").addEventListener("click", () =>
    download(
      JSON.stringify(session.work.routes[routeOf(session, original)], null, 2) +
        "\n",
      "a-borrowed-beat.refrain.json",
      "application/vnd.refrain+json",
    ),
  );
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) engine.pause();
  });
  window.addEventListener("pagehide", () => engine.dispose());
  document.addEventListener("keydown", (e) => {
    if (
      e.code !== "Space" ||
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLButtonElement ||
      e.target instanceof HTMLTextAreaElement
    )
      return;
    e.preventDefault();
    el("#play").click();
  });
  render();
}
void main();
