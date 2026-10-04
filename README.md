# foldercast · 目录放映

把任意一个**人类可读的目录**变成一段（或多段）讲解视频。

> Cast any folder into a video.
> 不限于代码仓库 —— 任何目录，只要里面的内容人能读懂，就能被讲成视频。

**当前状态：设计阶段。** 尚无代码，只有文档、契约与工程规范。

---

## 它解决什么问题

一个目录里通常混着这些东西：代码、可编辑文本、图片、视频、Office 三件套。你想让别人（或者三个月后的自己）快速理解它：

- **给别人看**：项目介绍、成果汇报、仓库导览
- **给自己看**：一次性视频，看完就理解了，不用写文档

现有工具（`paperview`、`gitreel`、`explainmyrepo`）都只吃 **git 仓库**。foldercast 的输入是**任何目录**。
赛道盘点见 [docs/PRIOR-ART.md](docs/PRIOR-ART.md)。

---

## 管线

```
   ┌─────────┐     ┌─────────┐     ┌─────────┐
   │ 1 文案  │ ──► │ 2 视频  │ ──► │ 3 配音  │
   └─────────┘     └─────────┘     └─────────┘
    分析目录         渲染画面         合成旁白
    理解内容         （静音）         烧字幕
    写出讲稿
```

配音放最后：文案与画面是创作（迭代频繁、无外部依赖），配音是渲染（有配额成本、可换音色）。详见 [ADR 0004](docs/decisions/0004-pipeline-order.md)。

---

## 三个可配置维度

| 维度 | 做法 | 文档 |
|---|---|---|
| **TTS 适配** | 不绑单一引擎。统一接口覆盖云端 API / 本地引擎 / 系统原生 | [TTS-适配调研](docs/rd/TTS-适配调研.md) |
| **内容筛选** | 三级筛选 `include` / `exclude` / `kinds`，gitignore 风格 | [数据格式](docs/specs/SPEC-data-format.md) |
| **风格预设** | 四套预设，也可以用自然语言描述 | [风格预设系统](docs/rd/风格预设系统.md) |

四套预设：`swiss`（瑞士风）/ `deck`（演示风）/ `console`（终端风）/ `paper`（纸质风），文件在 [styles/](styles/)。

---

## 文档

### 核心

| 文档 | 回答什么问题 |
|---|---|
| [PRODUCT.md](docs/PRODUCT.md) | 做什么、给谁用、**不做什么** |
| [REQUIREMENTS.md](docs/REQUIREMENTS.md) | 每条需求落在哪、怎么验收 |
| [SYSTEM-DESIGN.md](docs/SYSTEM-DESIGN.md) | 技术选型、架构、模块边界 |
| [ROADMAP.md](docs/ROADMAP.md) | 分几个阶段、每阶段的验收标准 |
| [PRIOR-ART.md](docs/PRIOR-ART.md) | 竞品做到什么程度、我们的差异在哪 |

### 规格

| 文档 | 定义什么 |
|---|---|
| [specs/SPEC-pipeline.md](docs/specs/SPEC-pipeline.md) | 三步管线的数据流与可重跑边界 |
| [specs/SPEC-data-format.md](docs/specs/SPEC-data-format.md) | `foldercast.json` 与素材目录格式 |
| [specs/foldercast.schema.json](docs/specs/foldercast.schema.json) | 上述格式的 JSON Schema（机器可读） |

### 决策与规范

| 文档 | 内容 |
|---|---|
| [decisions/](docs/decisions/) | 架构决策记录（ADR），含「为什么不那样做」 |
| [INTEGRATION-dsh-plugin.md](docs/INTEGRATION-dsh-plugin.md) | 注册为 DSH 插件的完整规范（manifest、工具契约、版本约束） |
| [conventions/git.md](docs/conventions/git.md) | 分支模型、Conventional Commits、版本策略 |
| [conventions/coding.md](docs/conventions/coding.md) | 语言、风格、测试要求 |
| [conventions/docs.md](docs/conventions/docs.md) | 文档职责划分与单一事实来源 |

### 研究材料

| 文档 | 内容 |
|---|---|
| [rd/TTS-适配调研.md](docs/rd/TTS-适配调研.md) | 供应商一手核实（含小米 MiMo 三个模型变体） |
| [rd/风格预设系统.md](docs/rd/风格预设系统.md) | 31 个样式 token、预设清单、自然语言映射 |

---

## 可直接使用的文件

| 文件 | 用途 |
|---|---|
| [docs/specs/foldercast.schema.json](docs/specs/foldercast.schema.json) | 挂到编辑器做分镜自动补全与校验 |
| [examples/foldercast.example.json](examples/foldercast.example.json) | 完整示例（讲解 `lecture-videos` 目录），已通过 schema 校验 |
| [styles/](styles/) | 四套风格预设，token 键集合完全一致（31 个），可互换 |

---

## 目录结构

```
foldercast/
├── README.md              你在这里
├── docs/                  文档（见上方索引）
│   ├── decisions/         架构决策记录
│   ├── conventions/       工程规范
│   ├── specs/             人读的规格 + 机器读的 schema
│   └── rd/                研究性材料
├── packages/              代码（待实现）
│   ├── analyzer/          Python：目录 → 分析结果
│   ├── renderer/          TypeScript + Remotion：分镜 → 视频
│   ├── cli/               编排层
│   └── dsh-plugin/        TypeScript：DSH 插件外壳，shell 出去调 CLI
├── styles/                风格预设（数据，非代码）
├── examples/              示例分镜
└── scripts/               仓库工具（链接检查等）
```

模块依赖方向单向：`cli → analyzer`、`cli → renderer`；`analyzer` 与 `renderer` **互不依赖**，唯一耦合点是 `foldercast.json`。
`dsh-plugin` 是 `cli` 的**外壳**，不反向依赖。详见 [ADR 0005](docs/decisions/0005-dsh-plugin-shape.md)。

---

## 与 lecture-videos 的关系

独立项目、独立仓库、独立运行。不共享代码。
管线设计借鉴了同作者的 [`lecture-videos`](../qiuzhao202608/lecture-videos) 中**已在真实项目验证**的做法（字幕按标点切分并按字数配时、时长以实测音频为准），理由见 [ADR 0001](docs/decisions/0001-separate-project.md)。

---

## 参与

工程规范见 [docs/conventions/](docs/conventions/)。提交前请跑：

```bash
python3 scripts/check-links.py
```
