# The Lantern Score · 灯下乐谱

一间可以亲手编配的白色琴房。窗光、植物和一只睡在琴凳上的猫，把钢琴、竖琴、大提琴和马林巴放进同一个空间。六页、24 小节的完整室内乐先由 agent 写定，再由你决定每页有哪些乐器在场。

```bash
npm ci
npm run desk
# http://127.0.0.1:4393
npm run test:desk
```

这是独立的 source candidate，不替换正式 Player 或共享 MCP Canvas，也没有自动部署到公共试玩页。Refrain 的 thesis 不变：当前 agent 创作音乐，核心执行可检查、可保存的明确选择；琴房不调用模型或补写音符。

## 在琴房里玩

- **碰乐器**：单独听它在当前页的句子，会暂停整曲，但不修改编配。鼠标靠近或键盘聚焦后，画面下方出现这件乐器的名字与圆点；点圆点决定它是否加入这一页。每页至少留一件。
- **播放 / 暂停**：底部圆形按钮开始或继续合奏。打开页面、选择页码、读入文件都不会自动播放。Space 可在控件外开始或暂停；乐器与植物支持 Tab、Enter / Space。
- **六个页码**：选择编配的段落，不改变正在演奏的位置。页名旁的小箭头从选中页开始。演奏默认跟随乐谱；手动选页后可以安排后面的段落。未来页可边听边改；修改已开始或已经过的页会先暂停。
- **橄榄树**：开关轻柔的风叶声，可单独播放或伴随音乐。它是本机合成的有色噪声，不是录音，也不参与作曲。暂停音乐不会关闭风声；停止键、离开可见页面或再次碰树会关闭它。风声不写入手稿、WAV 或原生 air。
- **进度条 / 停止**：seek、停止并回到开头。暂停中的 seek 保持安静。整曲保留乐句之间重叠的自然尾音。
- **右上角**：展开编配与保存。原手稿、独处、星群是三套写好的声部组合；不随机生成音符。撤回 / 重做保留至多 50 次编配或命名修改。原稿对照暂时切回原写法，再点一次返回自己的版本。
- **耳边音量 / 叶间风声**：分别控制总监听和环境声大小，不改变音乐导出。

琴键、琴弦、弓和木槌的细节跟随实际音符的起音与音长；不是随机装饰或频谱。Reduced motion 保留静态明暗提示，停止位移。桌面与手机使用同一场景的独立构图，绑定同一份音乐与交互状态。插画为生成式创作，具体 prompt 与素材说明见 [artwork provenance](src/assets/README.md)；可点击区域与演奏细节由代码明确标定。它是艺术化表现，不声称机械结构或演奏动作完全写实。

[Anatomy](https://github.com/wheresryan22/anatomy) 提供了可操作部件与同步反馈的设计参考；本实验没有复制它的代码、模板或素材。

## 保存与继续

**保存手稿**下载 `nocturne-desk-session@0`，带有作品 identity、名称和六页四声部的完整编配。当前 build 严格检查版本、作品 identity 与每个选择；不匹配或损坏文件不会替换正在编辑的作品。它是本实验的编辑文件，音乐原文由这个精确版本的作品提供。LocalStorage 只属于当前 browser origin；换设备或端口请下载再打开。

**原生 air**导出可移植的 Artifact@3：包含严格 AIR@1 音乐原文、原生 receipt 与精确 sampled binding。未选声部在对应段落保持休止；不依赖本页或 localStorage 才能解释。可通过普通 `refrain open` / `refrain export` 演奏，也可以交给 agent 继续写。

**带走 WAV**在点击时快照完整编配，使用与琴房音乐演奏相同的 frozen stem PCM 和 mixer，保留完整尾音，不加入监听音量或环境声。它是实验演奏的冻结投影，不带原生 RenderReceipt。原生 air 按整曲执行，sample round robin / DSP 与分段 stem 的历史可能不同；两者不声称字节一致。

## 声音准备与构建

`desk:prepare` 通过现有内容寻址 store 选择性准备确切采样，使用 canonical audio engine 把各页的四个声部 render 为忽略目录 `.audio/` 下的 WAV，并附带字节数、SHA-256 和素材 notices。首次可能下载所需样本，后续复用验证后的 stems，并重新生成完整混音、原生 artifacts 与 notices。音源沿用现有 chamber binding，未新增 sound candidate。

浏览器在用户显式演奏、试听或导出之后才请求 WAV，使用前验证字节数和 digest。单独播放植物风声不请求音乐样本。没有账号、上传或外部 composer。声音素材和运行缓存不提交为大二进制文件。

```bash
npm run build:desk
# Serve apps/nocturne-desk/dist on localhost or HTTPS.
# file:// is not supported.
```

`build:desk` 包含声音准备，生成相对路径 static listening package。普通 workspace build 只构建 app，完整听音分发使用 `build:desk`。不要把 `.audio/` 或 `dist/` 当作 canonical music source。

## 实现与证据

`score.ts` 拥有作者写定的音符、六段结构和原生 artifact 构造；`model.ts` 拥有编配与存档校验；`scripts/prepare-nocturne-desk.ts` 拥有 canonical preparation；`engine.ts` / `wav.ts` 执行验证后的 frozen PCM。`ambience.ts` 独立实现本机环境噪声；`app.ts` 拥有本机交互与历史；`drawing.ts` / `style.css` 和两幅 artwork 只表达这件实验作品。

运行 `test:desk` 检查 source/model/PCM/noise、TypeScript 与 prepared build。浏览器另行检查真实手势播放、准备取消、试听、暂停/继续/seek/结束、编配与对照、撤回、下载/重开、坏文件保留、桌面/窄屏、键盘与 reduced motion。测试不能替代听觉、美术或 physical-device 验收，也不证明部署或 MCP integration。当前验证状态见 [current state](../../docs/current-state.md)。
