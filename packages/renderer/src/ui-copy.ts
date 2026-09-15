import type { SelenV21ThemeId } from "./selen-v21-model.js";

export type RefrainLocale = "en" | "zh-CN";

// Product names and authored music are shared across languages. This catalogue
// owns interface prose only; it never enters an AIR, receipt, or visual plan.
const en = {
  language: "Language",
  roles: { lead: "lead", echo: "echo", bass: "ground" },
  play: "Play",
  pause: "Pause",
  restart: "Restart",
  stop: "Stop",
  transport: "Playback controls",
  seek: "Seek through this air",
  position: "Playback position",
  continuous: "Through-line",
  now: "Here, now",
  about: "About this air",
  sections: "sections",
  noSections: "unsectioned",
  voices: "voices",
  occurrences: "motif appearances",
  appearance: "Appearance",
  customizeAppearance: "Make this appearance yours",
  symbolColor: "Notes and symbols",
  textColor: "Text",
  backgroundImage: "Background image",
  chooseBackground: "Choose a local image",
  removeBackground: "Remove image",
  backgroundOpacity: "Image opacity",
  backgroundBlur: "Image blur",
  resetAppearance: "Reset this appearance",
  appearanceLocal:
    "Saved only in this browser. The image never enters the air or uploads from this control.",
  appearanceSaved: "Appearance saved on this device.",
  appearanceReset: "This appearance is back to its built-in theme.",
  appearanceFailed: "The appearance could not be saved on this device.",
  invalidBackground:
    "Choose a PNG, JPEG, WebP, GIF, or AVIF image up to 12 MB.",
  shareAir: "Share this air",
  shareCurrentAppearance: "Include my current colors",
  shareDisclosure:
    "The link opens this complete air, its caption, and the exact sound you chose. Anyone with the link can read and forward it.",
  shareBackgroundLocal:
    "Your background image stays on this device. Sharing it exactly will require a static listening package.",
  share: "Share",
  copyLink: "Copy link",
  shareLink: "Share link",
  shareHandedOff: "Opened your device’s share sheet.",
  shareCopied: "Listening link copied.",
  shareCancelled: "Sharing cancelled.",
  shareManual: "Select and copy the exact link below.",
  shareUnavailable: "An exact listening link is unavailable for this air.",
  shareNeedsBundle:
    "This air needs a static listening package before it can be shared exactly.",
  sharePlayerUnavailable:
    "This build has no configured public listening player for exact sharing.",
  auditionSound: "Sound for this listening view",
  chooseSound: "Choose a carried sound",
  auditionOnly:
    "Listening choice only. Saving keeps every sound version and the original default. Copied or sent requests also name this listening choice.",
  aboutCopy:
    "Follow the voices, find a returning motif, or choose a passage to bring back into the conversation. Every mark belongs to the music in this air.",
  send: "Send to conversation",
  copy: "Copy selection",
  copied: "Copied",
  sent: "Sent to conversation",
  failed: "Could not complete this action",
  figure: "Interactive musical form",
  passage: "Current passage",
  jumps: "Jump to a section",
  inversion: "inversion",
  retrograde: "retrograde",
  original: "original form",
  exactSelection: "Choose a passage",
  chooseSelection: "Choose a section, segment, or motif",
  copyRequest: "Copy request",
  exportSelection: "Export selection",
  exportArtifact: "Export Refrain artifact",
  exportSource: "Export AIR source",
  section: "section",
  segment: "segment",
  motif: "motif",
  noMotif: "No motif in this passage",
  noMotifDefined: "An air unfolding without a named motif.",
  motifCopy:
    "Every appearance of a motif, across this air. Choose one to see where it returns and how it changes.",
  manuscript: "An air on the page",
  pressedSheet: "An air, pressed into a page",
  artifactDownloaded: "Refrain artifact downloaded.",
  sourceDownloaded: "AIR source downloaded.",
  selectionDownloaded: "Selection downloaded.",
  selectionReturned: "Selection returned to the conversation.",
  requestCopied: "Agent-readable request copied.",
  operationFailed: "The action could not be completed.",
  hostExportOpened: "File export opened through this host.",
  hostExportAccepted: "File export accepted by this host.",
  hostExportCopied:
    "This host cannot download the file here; its exact JSON was copied to the clipboard.",
  performanceUnavailable:
    "This air can be explored and saved, but its exact sound is unavailable here.",
  missingBinding: "No performance binding is attached.",
  missingSamples:
    "The sound samples required by this air are unavailable in this view.",
  missingSoundfont:
    "The SoundFont and audio runtime required by this air are unavailable in this view.",
  loadingAir: "Opening this air…",
  noAir: "Bring an air here.",
  openCommand: "Open one with",
  openFile: "Or choose a portable .refrain.json file",
  invalidFile: "This file could not be opened as a Refrain artifact.",
  sessionUnavailable:
    "This listening link has expired or is unavailable. Open the saved .refrain.json file to return to the air.",
  compiling: "An air is taking shape…",
  diagnostics: "Air diagnostics",
  compileFailed: "This air could not be compiled",
  reconstructionFailed: "This air could not be opened",
  beats: (start: number, end: number) => `Beats ${start}–${end}`,
  semitones: (n: number) => `${n > 0 ? "+" : ""}${n} semitones`,
  stretch: (n: number) => `duration ×${n}`,
  occurrence: (n: number) => `appearance ${n}`,
  families: (n: number) => `${n} motif families`,
  appearances: (n: number) => `${n} ${n === 1 ? "appearance" : "appearances"}`,
  activeVoices: (n: number) =>
    `${n} ${n === 1 ? "voice" : "voices"} in this passage.`,
  acrossVoices: (n: number) => `across ${n} ${n === 1 ? "voice" : "voices"}`,
  jump: (label: string, beat: number) => `Jump to ${label}, beat ${beat}`,
  selectMotif: (motif: string, n: number, transform: string, section: string) =>
    `Select motif ${motif}, appearance ${n}, ${transform}, ${section}`,
  figureTitle: (title: string, theme: string) =>
    `${title} · musical form in ${theme}`,
  timeOf: (current: string, total: string) => `${current} of ${total}`,
  preparingProgress: (
    completedAssets: number,
    totalAssets: number,
    megabytes: string,
  ) => `Preparing audio · ${completedAssets}/${totalAssets} · ${megabytes} MB`,
  passageMotif: (motif: string, transform: string, voice: string) =>
    `Here, ${voice} carries @${motif} (${transform}).`,
  figureDescription: (theme: SelenV21ThemeId, sections: number) => {
    const texture = {
      "paper-sonata":
        "Voices trace a manuscript; motifs leave seals in its margins.",
      prism:
        "Voices cross a field of light; motifs return as crystal signatures.",
      "nocturne-ink":
        "Voices leave brush traces in dark water; motifs catch the light.",
      herbarium:
        "Voices spread like pressed fibres; motifs return as small sprigs.",
    }[theme];
    return `${texture} ${sections ? `${sections} authored sections mark the way.` : "The air unfolds without section breaks."} Drag the playback cursor to seek; select a motif to explore it.`;
  },
  player: {
    idle: "Ready to play",
    loading: "Loading audio",
    preparing: "Preparing audio",
    playing: "Playing",
    paused: "Paused",
    buffering: "Buffering audio",
    ready: "Ready to play",
    error: "Playback unavailable",
  },
};

const zh: typeof en = {
  language: "语言",
  roles: { lead: "主声部", echo: "应答", bass: "低音" },
  play: "播放",
  pause: "暂停",
  restart: "重新开始",
  stop: "停止",
  transport: "播放控制",
  seek: "调整这首 air 的播放进度",
  position: "播放位置",
  continuous: "连续段",
  now: "此刻",
  about: "关于这首 air",
  sections: "分节",
  noSections: "无分节",
  voices: "声部",
  occurrences: "motif 出现",
  appearance: "外观",
  customizeAppearance: "让这个外观更像你",
  symbolColor: "音符与符号",
  textColor: "文字",
  backgroundImage: "背景图片",
  chooseBackground: "选择本地图片",
  removeBackground: "移除图片",
  backgroundOpacity: "图片透明度",
  backgroundBlur: "图片模糊",
  resetAppearance: "恢复当前主题",
  appearanceLocal:
    "只保存在这个浏览器里。图片不会进入 air，也不会通过这个控件上传。",
  appearanceSaved: "外观已保存在这台设备上。",
  appearanceReset: "当前外观已恢复为内置主题。",
  appearanceFailed: "这台设备未能保存外观设置。",
  invalidBackground:
    "请选择不超过 12 MB 的 PNG、JPEG、WebP、GIF 或 AVIF 图片。",
  shareAir: "分享这首 air",
  shareCurrentAppearance: "带上我现在的配色",
  shareDisclosure:
    "链接会打开这首完整的 air、题记和你选定的准确声音。任何拿到链接的人都可以读取和转发它。",
  shareBackgroundLocal:
    "背景图片仍只留在这台设备上。要准确分享它，需要生成静态听歌包。",
  share: "分享",
  copyLink: "复制链接",
  shareLink: "分享链接",
  shareHandedOff: "已打开设备的分享面板。",
  shareCopied: "试听链接已复制。",
  shareCancelled: "已取消分享。",
  shareManual: "请选择并复制下面的准确链接。",
  shareUnavailable: "这首 air 暂时无法生成准确的试听链接。",
  shareNeedsBundle: "这首 air 需要静态听歌包，才能被准确分享。",
  sharePlayerUnavailable: "当前 build 尚未配置用于准确分享的公共试听播放器。",
  auditionSound: "当前试听声音",
  chooseSound: "选择作品携带的声音版本",
  auditionOnly:
    "仅切换试听；保存保留全部声音版本与原默认值。复制或发送的请求也会注明当前试听选择。",
  aboutCopy:
    "沿着声部听下去，找到再次出现的 motif，或选一段带回对话。这里的每一道痕迹，都属于这首 air。",
  send: "交给对话",
  copy: "复制选段",
  copied: "已复制",
  sent: "已交给对话",
  failed: "操作未完成",
  figure: "可交互的音乐曲式",
  passage: "当前段落",
  jumps: "跳到分节",
  inversion: "倒影",
  retrograde: "逆行",
  original: "原形",
  exactSelection: "选择一段",
  chooseSelection: "选择分节、乐句片段或 motif",
  copyRequest: "复制请求",
  exportSelection: "导出选段",
  exportArtifact: "导出 Refrain artifact",
  exportSource: "导出 AIR source",
  section: "分节",
  segment: "片段",
  motif: "motif",
  noMotif: "此处没有 motif",
  noMotifDefined: "这首 air 自由展开，尚未命名 motif。",
  motifCopy:
    "一个 motif 在整首 air 里的每一次出现。点亮一处，看看它回到了哪里，又变成了什么样子。",
  manuscript: "一首 air，落在纸上",
  pressedSheet: "一首 air，藏进这一页",
  artifactDownloaded: "已下载 Refrain artifact。",
  sourceDownloaded: "已下载 AIR source。",
  selectionDownloaded: "已下载选段。",
  selectionReturned: "已把选段交给对话。",
  requestCopied: "已复制可交给 agent 的请求。",
  operationFailed: "这次操作未能完成。",
  hostExportOpened: "已通过当前宿主打开文件导出。",
  hostExportAccepted: "当前宿主已接收文件导出。",
  hostExportCopied: "当前宿主无法在这里下载文件；完整 JSON 已复制到剪贴板。",
  performanceUnavailable:
    "这首 air 可以查看和保存，但这里暂时无法播放它绑定的声音。",
  missingBinding: "这首 air 尚未绑定演奏音色。",
  missingSamples: "当前界面无法取得这首 air 所需的采样素材。",
  missingSoundfont:
    "当前界面无法取得这首 air 所需的 SoundFont 和音频运行环境。",
  loadingAir: "正在打开这首 air…",
  noAir: "把一首 air 带到这里。",
  openCommand: "用这条命令打开",
  openFile: "或选择已保存的 .refrain.json 文件",
  invalidFile: "无法将这个文件作为 Refrain artifact 打开。",
  sessionUnavailable:
    "这个试听链接已过期或暂时不可用。打开保存的 .refrain.json 文件，就能回到这首 air。",
  compiling: "一首 air 正在成形…",
  diagnostics: "Air 诊断",
  compileFailed: "这首 air 未能编译",
  reconstructionFailed: "这首 air 未能打开",
  beats: (start, end) => `第 ${start}–${end} 拍`,
  semitones: (n) => `${n > 0 ? "+" : ""}${n} 半音`,
  stretch: (n) => `时值 ×${n}`,
  occurrence: (n) => `第 ${n} 次出现`,
  families: (n) => `${n} 个 motif 家族`,
  appearances: (n) => `${n} 次出现`,
  activeVoices: (n) => `${n} 个声部在此处活动。`,
  acrossVoices: (n) => `穿过 ${n} 个声部`,
  jump: (label, beat) => `跳到 ${label}，第 ${beat} 拍`,
  selectMotif: (motif, n, transform, section) =>
    `选择 motif ${motif}，第 ${n} 次出现，${transform}，${section}`,
  figureTitle: (title, theme) => `${title} · ${theme} 中的音乐曲式`,
  timeOf: (current, total) => `${current}，共 ${total}`,
  preparingProgress: (completedAssets, totalAssets, megabytes) =>
    `正在准备声音 · ${completedAssets}/${totalAssets} · ${megabytes} MB`,
  passageMotif: (motif, transform, voice) =>
    `@${motif} 以「${transform}」出现，落在 ${voice} 上。`,
  figureDescription: (theme, sections) => {
    const texture = {
      "paper-sonata": "声部在手稿上延展，motif 在页边留下印记。",
      prism: "声部穿过光场，motif 以晶体般的纹样再次出现。",
      "nocturne-ink": "声部在暗水中留下笔触，motif 捕捉微光。",
      herbarium: "声部像压制的纤维铺展，motif 如小枝再次出现。",
    }[theme];
    return `${texture}${sections ? `${sections} 个创作时写下的分节标出行进的路。` : "这首 air 连续展开，没有分节。"}拖动播放游标调整进度，或选中一个 motif 查看。`;
  },
  player: {
    idle: "等待播放",
    loading: "正在加载声音",
    preparing: "正在准备声音",
    playing: "正在播放",
    paused: "已暂停",
    buffering: "正在缓冲声音",
    ready: "可以播放",
    error: "暂时无法播放",
  },
};

export const uiCopy = (locale: RefrainLocale) => (locale === "zh-CN" ? zh : en);
export type UiMessageKey = {
  [K in keyof typeof en]: (typeof en)[K] extends string ? K : never;
}[keyof typeof en];

export function resolveRefrainLocale(language?: string | null): RefrainLocale {
  return language?.toLowerCase().split("-")[0] === "zh" ? "zh-CN" : "en";
}
