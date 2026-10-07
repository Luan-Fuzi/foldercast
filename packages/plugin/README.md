# dsh-foldercast

把任意**人类可读的目录**变成讲解视频的 DSH 插件。探目录与写讲稿是 agent 的事
（skill 里写了工作流与判据）；这个包做 agent 干不了的确定性部分：讲稿校验、
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
| 配音（显式 `voice: true`） | 逐场景 `say` 合成 + `ffprobe` 实测时长 | `<目录>/.foldercast/audio/`、`durations.json` |
| 渲染（显式 `render: true`） | 按需转换引用的素材 → Remotion 出片 | `<目录>/.foldercast/out/video.mp4` |

**渲染与配音默认不跑**：渲染要浏览器、动辄几分钟；配音要跑 TTS。两者都要显式要求。

另有 `scripts/assets/text.ts`：把 Office / PDF 的内容提取成 Markdown 打到 stdout，
给 agent 通读用（`node scripts/assets/text.ts <文件>`）。

## 设置页

插件的 `Config` schema（`src/config.ts`）就是 DSH 里的设置页，目前两组：

| 组 | 字段 | 现在生效吗 |
|---|---|---|
| 配音 | `provider`（say / mimo） | mimo 是**预留位**，选了仍用 say，工具结果里会说明 |
| 配音 | `voice`（say 音色名）、`rate`（字/分） | 生效（工具调用与讲稿里的值优先于设置页） |
| 渲染 | `browserPath`（浏览器路径） | 生效（等价于 `FOLDERCAST_BROWSER`） |
| 渲染 | `concurrency` | 生效（>1 会破坏逐帧一致，页面描述里写了） |

字段都是 `volatile()` 的：设置页保存后立即生效，不需要重启。要接第二个 TTS
（比如 mimo）时在 schema 里补字段、在 `cast.ts` 接线即可。

## 依赖

代码随包分发（`scripts/`），外部命令按需降级：

| 依赖 | 用途 | 缺了会怎样 |
|---|---|---|
| Node 22.19+ | 直接运行 TypeScript（类型剥离） | 硬条件，缺了不能用 |
| 浏览器（Chrome / Chromium / Edge） | Remotion 渲染 | 只影响出片；校验照常 |
| `say`（macOS 自带） | 配音 | 不配音，出静音片 |
| `ffmpeg` / `ffprobe` | 音频转换与实测时长、视频封面 | 配音不可用；渲染仍能出静音片 |
| `@deepseek-ai/libreoffice-kit`（optionalDependency） | Office / PDF 逐页图 | 这两类没有页图；文本提取照常 |
| `sips`（macOS 自带） | 图片缩放 | 回退到 ffmpeg |

缺失时工具会返回**可操作的说明**（缺什么、怎么装），而不是一个裸错误。
