# dsh-foldercast

把任意**人类可读的目录**变成讲解视频的 DSH 插件。探目录与写讲稿是 agent 的事
（skill 里写了工作流与判据）；这个包负责精确、重复、可验证的执行部分：讲稿校验、
按需素材转换、配音与逐帧渲染。

## 安装

```bash
dsh plugin --profile <profile> add dsh-foldercast
```

装完在插件管理页能看到「目录放映」，对话里说「把这个目录讲一遍」就会触发 `foldercast_cast`。

## 它做什么

插件注册**一个工具**与**一个 skill**：

| 步骤 | 做什么 | 产物 |
|---|---|---|
| 校验（有讲稿才跑） | schema、场景字段、引用路径存在性、字幕切分 | 结构化问题清单 |
| 页面（显式 `page: true`） | 讲稿与素材 → 零 JS 的 HTML 导览页 | `<目录>/.foldercast/out/page.html` |
| 配音（显式 `voice: true`） | 逐场景云端合成（edge / mimo）+ `ffprobe` 实测时长 | `<目录>/.foldercast/audio/`、`durations.json` |
| 渲染（显式 `render: true`） | 按需转换引用的素材 → Remotion 出片 | `<目录>/.foldercast/out/video.mp4` |

**页面、渲染与配音默认都不跑**，必须显式要求。正式产出需要与当前输入匹配的评审回执；`draft: true` 允许工作草稿。校验返回 `revision`，末轮独立评审通过并写好 `review.md` 后，传 `reviewRevision: revision` 记录回执。传参表示 agent 声明评审通过。程序检查版本和报告哈希，不解析自然语言结论，不证明内容正确。revision 对讲稿、digest 与直接引用文件计算内容哈希；引用目录使用文件名、大小和修改时间，digest 的文件总数抽查也参与。它不覆盖全部源目录正文或软件版本。

`artifacts.json` 记录产物的输入版本、实际参数、文件依赖与输出哈希。current 仅表示仍匹配记录中的输入与参数，不表示内容正确或适合新设置。场景音频按旁白、provider、音色、风格、格式等输入复用；合成输入改变或音频被改动后自动失效，逐场记录保存在 `audio/cache.json`，支持断点续跑。只改画面不需要重合成；改讲稿中的 voice 配置需重跑 voice，实际请求相同的场景仍可复用。渲染拒绝过期、缺少新版本记录或整条音轨不完整的 durations。HTML 与视频共享素材准备和场景内容，输出形式不同。HTML 超过图片内联预算时使用相对路径，转发需要附带被引用素材并保留相对位置；Office / PDF 页图与视频封面指向准备产物。

主 skill 给工作流，场景与评审详细参考随包位于 `scripts/references/`。直跑 CLI 默认生成草稿，`--approved` 检查当前评审回执。

另有 `scripts/assets/text.ts`：把 Office / PDF 的内容提取成 Markdown 打到 stdout，
给 agent 通读用（`node scripts/assets/text.ts <文件>`）。

## 旧项目迁移

讲稿与 digest 的 schema 版本不变。旧 `review.md` 需重新评审并记录当前回执。没有逐场缓存记录的旧音频，第一次重跑 voice 会重配；旧 durations 缺少新版本记录，不能直接用于渲染。

## 设置页

插件的 `Config` schema（`src/config.ts`）就是 DSH 里的设置页，目前三组：

| 组 | 字段 | 说明 |
|---|---|---|
| 配音 | `provider`（edge / mimo） | 都要网络。edge 免密钥（默认）；mimo 要 `MIMO_API_KEY`（缺密钥时配音以退出码 4 结束） |
| 配音 | `voice`（音色）、`style`（怎么读） | 工具调用与讲稿里的值优先于设置页 |
| 渲染 | `browserPath`、`concurrency` | `browserPath` 等价于 `FOLDERCAST_BROWSER`；`concurrency`>1 会破坏逐帧一致 |
| 页面 | `style`（素稿 / 杂志 / 夜幕） | 导览页风格预设 |

字段都是 `volatile()` 的：设置页保存后立即生效，不需要重启。

## 依赖

代码随包分发（`scripts/`），外部命令按需降级：

| 依赖 | 用途 | 缺了会怎样 |
|---|---|---|
| Node 22.19+ | 直接运行 TypeScript（类型剥离） | 硬条件，缺了不能用 |
| 浏览器（Chrome / Chromium / Edge） | Remotion 渲染 | 只影响出片；校验与页面照常 |
| 网络 | 配音的云端 TTS（edge / mimo） | 不配音，出静音片 |
| `ffmpeg` / `ffprobe` | 音频转换与实测时长、视频封面 | 配音不可用；渲染仍能出静音片 |
| `@deepseek-ai/libreoffice-kit`（optionalDependency） | Office / PDF 逐页图 | 这两类没有页图；文本提取照常 |
| `sips`（macOS 自带） | 图片缩放 | 回退到 ffmpeg |

缺失时工具会返回**可操作的说明**（缺什么、怎么装），而不是一个裸错误。
