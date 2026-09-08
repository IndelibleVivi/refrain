import type { RefrainLocale } from "@refrain/renderer";

export function firstListenCopy(locale: RefrainLocale) {
  return locale === "zh-CN"
    ? {
        title: "先听一首，再带上你们的故事。",
        intro:
          "这是 agent 写下的一首 air。按播放听听，换一种外观，点亮图里的旋律——它每次回来，都有迹可循。",
        label: "第一次来？",
        keep: "喜欢就保存",
        keepBody:
          "在作品下方选择「导出 Refrain artifact」，把这首带走。以后用这里的「打开作品文件」重新打开。",
        open: "打开作品文件",
        local:
          "文件只在你的浏览器中读取，不会上传。这个试听页使用合成音色；需要采样的作品请在自己的 Refrain 中打开。",
        reset: "回到这首示例",
        next: "让你的 agent 为你写一首",
        nextBody:
          "Refrain 是你们对话的一部分。熟悉你的 agent 把此刻写成音乐，Refrain 让它响起来、看得见、带得走。这个页面先让你试听；创作从接入自己的 agent 开始。",
        guide: "接入 agent · 设置指南",
        promptLabel: "接好以后，把这句话带回你们的对话",
        prompt:
          "用 Refrain 为我们的此刻写一段音乐吧。要有能记住的旋律、一个转折和完整的结尾，用 Canvas 可用的合成音色。私人对话留在 host，只把音乐和我愿意分享的题记交给 Refrain。",
        copy: "复制给 agent",
        copied: "已复制",
        manual: "可以选中上面的文字手动复制。",
      }
    : {
        title: "Listen first. Bring your story next.",
        intro:
          "An air written by an agent. Press Play, try another appearance, and touch a melody in the score. You can follow it each time it returns.",
        label: "Your first air",
        keep: "Keep what you hear",
        keepBody:
          "Choose “Export Refrain artifact” below the piece to keep it. Use “Open a saved air” here whenever you want to return.",
        open: "Open a saved air",
        local:
          "Files are read in your browser and never uploaded. This listening page uses synthetic sounds; open works that need samples in your own Refrain runtime.",
        reset: "Back to the example",
        next: "Let your agent write one for you",
        nextBody:
          "Refrain belongs in your conversation. The agent who knows you writes the moment into music; Refrain makes it audible, visible, and yours to keep. This page is a first listen. Connect your own agent to begin creating.",
        guide: "Connect your agent · Setup guide",
        promptLabel: "After setup, bring this into your conversation",
        prompt:
          "Use Refrain to write a musical reply to this moment between us. Give it a memorable melody, a contrasting turn, and a complete ending. Use the Canvas’s available synthetic instruments. Keep our private conversation in the host; send only the music and a caption I would choose to share.",
        copy: "Copy for my agent",
        copied: "Copied",
        manual: "Select the text above to copy it manually.",
      };
}
