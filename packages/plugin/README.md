# dsh-foldercast

把任意**人类可读的目录**变成讲解视频的 DSH 插件。核心产物不是视频，而是「目录解读」这份
结构化事实；视频与页面都是它的视图。

## 安装

```bash
dsh plugin --profile <profile> add dsh-foldercast
```

装完在插件管理页能看到「目录放映」，对话里说「把这个目录讲一遍」就会触发 `foldercast_cast`。

## 它做什么

插件注册**一个工具**与**一个 skill**。工具做确定性的部分：

| 阶段 | 做什么 | 产物 |
|---|---|---|
| 分析 | 遍历、分类、角色识别、引用依赖图、密钥排除审计 | `<目录>/.foldercast/foldercast.json` |
| 素材 | Office/PDF 逐页图、视频关键帧、代码高亮图、提取文本 | `<目录>/.foldercast/assets/` |
| 校验 | schema、幻觉路径拦截、场景字段、字幕字数 | 结构化问题清单（带行号） |

**写稿不是工具做的**：讲什么、按什么顺序讲要靠判断，那是模型的事（skill 里写了工作流与判据）。
工具在需要写稿时返回 `next: needsScript`，把 `script.json` 的路径交回给 agent。

渲染与配音尚未实现（ROADMAP M7 / M8），所以工具不声称产出视频。

## 依赖

分析、素材、校验的代码随包分发（`scripts/`），**不需要额外安装**。外部命令按需降级：

| 依赖 | 用途 | 缺了会怎样 |
|---|---|---|
| Node 22.19+ | 直接运行 TypeScript（类型剥离） | 硬条件，缺了不能用 |
| `@deepseek-ai/libreoffice-kit`（optionalDependency） | Office / PDF 转图 | 这两类没有逐页图；其余照常 |
| `ffmpeg` / `ffprobe` | 视频抽帧与时长 | 视频没有关键帧；其余照常 |
| `sips`（macOS 自带） | 图片缩放 | 回退到 ffmpeg |

缺失时工具会返回**可操作的说明**（缺什么、怎么装），而不是一个裸错误。

## 隐私边界

默认按**文件名**排除 `.env`、`credentials.json`、`*.pem` 等密钥类文件：它们仍进结构树与计数
（「这里有个 `.env`」本身有信息量），但内容不读、不进预览、不生成素材。这条规则**不可能完备**——
硬编码在源码里的密钥、自定义命名的密钥文件都会被读到。每次运行都会打印命中的清单，
可用 `sources.rescan` 显式放回误拦的文件。见 [ADR 0007](https://github.com/Luan-Fuzi/foldercast/blob/main/docs/decisions/0007-secret-file-exclusion.md)。

## 契约

- 解读：`foldercast.json`（程序产出，可重算）
- 讲稿：`script.json`（创作，重跑会变）
- 素材：`assets/manifest.json`（可重算的缓存）

schema 在包内的 `schemas/` 下，由 `prepack` 从仓库的 `docs/specs/` 复制生成——**契约只有一份**。

## 许可

MIT。
