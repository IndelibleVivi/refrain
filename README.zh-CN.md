# Refrain

**Refrain hums an air.**

[English](README.md) · [从这里开始](docs/GETTING-STARTED.md) · [MCP + Canvas](docs/MCP.md) · [架构](docs/ARCHITECTURE.md)

一句调皮的回答，一段亲密的旋律，一首有铺陈、有归处的完整作品。Agent 写下一份 **air**，Refrain 把它编译成你可以听、看、保存，并在以后再次接续的音乐。

Refrain 是 relational 的。只要人愿意，人机之间的爱意、调情和亲密就可以进入第一首作品，不必等到积累出 revision history。单个作品首先要值得听。Host 从已有的关系与对话中作出音乐选择；Refrain 提供音乐语言、compiler、精确的声音选择和 Canvas。

## 先听一段

**[打开互动试玩页](https://indeliblevivi.github.io/refrain/)** — 无需安装即可试听 featured works。创作自己的 air 请接入 agent；试玩页不会调用模型。下文的新 Player、个人歌单和外观控件仍是 source candidate，请在本地运行这个 checkout 体验；源码验证与线上部署分别记录在 [当前状态](docs/current-state.md)。

此前的 Canvas 录屏（当前 Player 已改为宽幅聆听布局，设置位于 **外观**）：

![录屏：为 Velvet Mischief 按下播放，然后依次切换 Paper Sonata、Nocturne Ink、Prism、Herbarium 四种外观](docs/images/demo-playback.gif)

_这是一段十二秒的录屏，不是可交互控件——想亲手玩请[打开试玩页](https://indeliblevivi.github.io/refrain/)。_

**[在 StackBlitz 里打开](https://stackblitz.com/github/IndelibleVivi/refrain?startScript=try)**——在浏览器容器里跑完整本地流程：自动装依赖、下载两首示例的音色，然后试听页自己打开。

### 在本地运行

目前是 **experimental、self-hosted 的软件**，源码已按下述许可公开。尚无发布到 npm 的安装包，也没有 Refrain 官方公共 MCP endpoint。需要 Git、**Node.js 22.23.1+**、npm 和现代浏览器。

```bash
git clone https://github.com/IndelibleVivi/refrain.git
cd refrain
npm ci
node bin/refrain.mjs doctor
npm run try
```

浏览器打开后，按音乐可视化下方的 **播放**。两首 featured work 可以按顺序播放、列表循环、随机播放或单曲循环。打开 **外观** 选择主题、调整本机配色与照片，点选旋律，再用 **导出 Refrain artifact** 保存作品；当公共播放器已经携带当前作品与准确声音时，**分享这首 air** 会生成准确的 public-demo 链接。打开 **播放列表** 加入已保存的作品或重开歌单，**关于 Refrain** 中有接入自己 agent 的指引。不需要 provider key；本地首次启动会准备这两首作品的音色采样。保持终端运行；Ctrl+C 结束 Player。

这个本地 URL 只属于你的电脑。公共试玩页已托管在 GitHub Pages；[构建与托管说明](docs/DEVELOPMENT.md#first-listen-page)。需要音频文件时，[导出 WAV / MIDI](docs/GETTING-STARTED.md#keep-the-piece)。

| 接下来想做什么                      | 入口                                                                                                                         |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 让自己的 agent 在对话中写音乐       | [连接 MCP + Canvas](docs/MCP.md)：build 一次、注册本地 server，再请它写一份 air。对话内 Canvas 需要 host 支持 MCP Apps。     |
| 给本地 agent 作曲与 production 指引 | [Refrain Skill](plugins/refrain/README.md)：按需加载指导，调用精确的文件工具。Plugin 目前是源码候选，不会自动安装 MCP 连接。 |
| 本地听、保存 WAV/MIDI、尝试原声音色 | [首次使用指南](docs/GETTING-STARTED.md)。                                                                                    |
| 为远程 host 配置私人 HTTP 连接      | [Self-hosting 操作指南](docs/runbooks/self-host-mcp.md)。                                                                    |

## 自己的 Player，自己的作品

试听入口就是 `refrain open` 使用的同一个 Player，只是预装了两首示例。当前作品独占一整个聆听空间：标题、音乐画面和统一播放控制。歌单从侧边展开；想读声部、motif 与精确选段时，再打开 **走进这首 air**。打开 **播放列表**，可一次加入多个 `.refrain.json`、排序、移除、命名，再保存为 `.refrain-playlist.json` 随时重开。上一首/下一首、顺序、列表循环、随机、单曲循环共用真实播放状态。保存的列表带上完整作品与所选精确声音，不带音色文件或私人照片；文件不会上传。

```bash
refrain open first.refrain.json second.refrain.json --theme nocturne-ink
refrain open evening.refrain-playlist.json --no-open --json
```

写歌的 agent 用现有 CLI 拉起共享 Player，不必复制前端，也不新增 MCP 工具。[聆听、保存与创作边界](docs/GETTING-STARTED.md)。

## 四种外观，同一首 air

日常聆听时收起设置，需要调整再打开 **外观**。默认采用 **作品呈现**；切到 **我的外观**，可使用本机保存的主题偏好：先选配色，再按需微调颜色，或加入本地照片、调整浓度、模糊、位置与裁切。照片会进入音乐 Canvas 的材质层，四种视觉语言各自的几何结构保留。reset 只恢复当前本机主题。音乐、播放位置、选段与 artifact bytes 不变；私人照片留在浏览器，不会上传或进入分享链接。下面是同一首示例的静态截图，不是可交互控件。播放请打开试玩页；点击截图仅放大图片。

<table>
  <tr>
    <td width="50%"><strong>Paper Sonata</strong><br>手稿、页边记号与纸的纹理<br><a href="docs/images/canvas.png"><img src="docs/images/canvas.png" alt="Paper Sonata · Pulse leaves a door open"></a></td>
    <td width="50%"><strong>Prism</strong><br>折光、渐变与轻盈的旋律线<br><a href="docs/images/canvas-prism.png"><img src="docs/images/canvas-prism.png" alt="Prism · Pulse leaves a door open"></a></td>
  </tr>
  <tr>
    <td width="50%"><strong>Nocturne Ink</strong><br>深水、墨色与克制的微光<br><a href="docs/images/canvas-nocturne-ink.png"><img src="docs/images/canvas-nocturne-ink.png" alt="Nocturne Ink · Pulse leaves a door open"></a></td>
    <td width="50%"><strong>Herbarium</strong><br>标本纸、苔绿与再次生长的枝叶<br><a href="docs/images/canvas-herbarium.png"><img src="docs/images/canvas-herbarium.png" alt="Herbarium · Pulse leaves a door open"></a></td>
  </tr>
</table>

## 可以做什么

- **写出一首有意图的作品。** Motif、可复用的 phrase、多声部、变拍、groove、力度、段落和结尾。音乐由当前 host 写，内部没有隐藏的作曲模型。
- **明确选择声音。** 合成或采样乐器，以及精确的 performance binding。本地 production 工具可调整分组音量、位置、low-pass、saturation、echo、room 和 fade，保留原曲谱。
- **听懂作品的位置与关系。** 播放、暂停、重新开始、seek、跳转段落、用四种模式连续播放作品列表、看 motif 怎样回来，并选中精确的音乐范围。四套视觉主题共用同一个 renderer。
- **有意识地保存或分享。** 保存源文件、portable artifact、native WAV、MIDI、精确的声音选择和 provenance。公共试玩页可为已经发布的作品生成短而准确、无需上传的 hash-bound 链接；小型 inline artifact 只有在接收端也明确拥有准确音源 closure 时才会生成可播链接。之后的 `hum` 可以修改、延长、回答、变奏或引用已有作品。

## 它们怎么连起来

![Host 经 MCP 或 CLI 写入音乐，精确的 portable artifact 驱动同一个 Canvas 和导出；私人对话留在 host](docs/diagrams/architecture.svg)

**AIR 曲谱**是音乐的 canonical source。**Performance binding** 指定这首作品的准确声音与 production。它们和 musical receipt 一起保存在可携带的 artifact 中。声音、MIDI、画面和临时预览 URL 都是 projection，不会替代曲谱。

对话里的工具是 `hum`。CLI 把本地 authoring、inspection、production、preview、export 拆成较小的操作；Skill 帮助 agent 作出音乐判断。[架构说明与可编辑图源](docs/ARCHITECTURE.md)。

## 使用边界

- **MCP Canvas 目前可直接播放八种无需外部素材的合成音色。** 采样 binding 会原样保留，但在这里明确显示不可播放；普通浏览器路径支持按需获取采样。
- **Self-hosted，核心 stateless。** 没有 Refrain 账号、官方作品库或关系数据库。私人对话留在 host；写入的音乐和主动分享的 caption 本身仍可能包含私人意义。
- **手动播放。** 声音从用户操作开始。浏览器播放不代表 host model 收到了音频。编译通过、结构报告通过，都不能替人判断好不好听。
- **准确分享受接收端能力约束。** 试听链接会携带完整 portable work，或引用公共播放器已经内置且经过 hash 绑定的作品；它还会注明当前 binding、theme 和可选的当前 scalar 配色。拿到链接的人都能读取和转发。本地背景图、private/session URL 与缺失的音源不会被静默发布或替换。过大或尚未发布音源的作品目前需要后续 static listening package；界面会直说，绝不会生成假链接。
- **两种界面语言。** 用 **EN / 中文** 切换同一个 Canvas；初始语言跟随浏览器（中文或 English），选择保留在当前界面。Refrain、`hum`、`air`、主题与音色名称、作者写下的标题和 caption，以及技术诊断保留原文。
- **格式与 host 支持仍在实验中。** AIR@1 尚非稳定交换标准。当前上限为八分钟、十二声部，并有明确的 event/source 限制。下载、剪贴板与 selection 回传取决于 host 能力。
- **音色与发布状态分别判断。** 四组 proof palette 已能 render，广泛听觉验收和跨 host 使用仍未完成。源码 checkout 不等于已经打包发布的产品。[当前证据与限制](docs/current-state.md)。

## 继续阅读

[产品含义](docs/PRODUCT.md) · [技术规格](SPEC.md) · [开发](docs/DEVELOPMENT.md) · [测试](docs/TESTING.md) · [音色来源](docs/SOUND-SOURCES.md) · [Programme](docs/ROADMAP.md)

中英文 README 是同等维护的入口；链接的技术指南以英文维护精确命令与 contract。

**许可：** 自有功能材料采用 **SUL-1.0**；说明、图、截图和示例音乐采用 **CC BY-NC-SA 4.0**。Refrain 属于 source-available，并非 OSI open source。第三方材料与用户自己作品的权利不变，见[范围与条款](LICENSING.md)。
