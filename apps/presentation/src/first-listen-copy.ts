import type { RefrainLocale } from "@refrain/renderer";

export function firstListenCopy(locale: RefrainLocale) {
  return locale === "zh-CN"
    ? {
        player: {
          player: "Player",
          playlist: "播放列表",
          help: "关于 Refrain",
          welcome:
            "从这两首开始听，也可以放进你自己的作品。声音只在你按下播放后响起。",
          title: "列表名称",
          untitled: "我的播放列表",
          add: "添加作品 / 打开列表",
          save: "保存播放列表",
          previous: "上一首",
          next: "下一首",
          up: "上移",
          down: "下移",
          remove: "从列表移除",
          empty: "把保存的作品或播放列表放进来，继续听。",
          local:
            "文件只在本机读取。保存列表会带上完整作品，不包含音色文件或私人照片。",
          examples: "打开示例列表",
          footer: "音乐由你的 agent 写下，作品由你保管。",
        },
        playbackModes: {
          sequential: "顺序播放",
          "repeat-all": "列表循环",
          shuffle: "随机播放",
          "repeat-one": "单曲循环",
        },
        changePlaybackMode: (current: string, next: string) =>
          `当前${current}；切换为${next}`,
        open: "打开作品文件",
        local:
          "文件只在你的浏览器中读取，不会上传。这两首保留原来的声音选择；按播放后加载所需音色。其他作品可能需要在自己的 Refrain 中准备音色。",
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
        player: {
          player: "Player",
          playlist: "Playlist",
          help: "About Refrain",
          welcome:
            "Begin with these two airs, or bring your own. Nothing plays until you press Play.",
          title: "Playlist title",
          untitled: "My playlist",
          add: "Add airs / open playlist",
          save: "Save playlist",
          previous: "Previous air",
          next: "Next air",
          up: "Move up",
          down: "Move down",
          remove: "Remove from playlist",
          empty: "Bring a saved air or playlist here and keep listening.",
          local:
            "Files stay on this device. A saved playlist carries complete works, not sound files or personal photos.",
          examples: "Open example playlist",
          footer: "Written by your agent. Yours to keep.",
        },
        playbackModes: {
          sequential: "Sequential playback",
          "repeat-all": "Repeat all",
          shuffle: "Shuffle",
          "repeat-one": "Repeat one",
        },
        changePlaybackMode: (current: string, next: string) =>
          `${current}; change to ${next}`,
        open: "Open a saved air",
        local:
          "Files are read in your browser and never uploaded. These two works keep their original sounds, loaded after Play. Other works may need sounds prepared in your own Refrain runtime.",
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
