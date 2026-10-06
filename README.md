# foldercast · 目录放映

把任意一个**人类可读的目录**变成一段（或多段）讲解视频。

> Cast any folder into a video.
> 不限于代码仓库 —— 任何目录，只要里面的内容人能读懂，就能被讲成视频。

**核心产物是「目录解读」，不是视频。** 解读是一份结构化的事实：这里有什么、怎么组织的、谁引用谁、哪些是关键。视频、讲解 poster 都是它的视图。
详见 [PRODUCT.md](docs/PRODUCT.md#3-解读是事实来源讲稿是它的视图)。

**当前状态：已压缩成 MVP。** 分析器把任意目录变成 `foldercast.json`（21.3 万文件 0.34 秒），
里面**只有机械事实**：每条文件的路径、类别（12 类）、字节、行数、截断预览，外加密钥排除审计与
规模审计（丢了多少文件、跳过了多少）。素材阶段把解读里的图片 / 视频 / Office / PDF 变成可用素材
并**增量重算**（第二次运行毫秒级命中），Office/PDF 同时抽出全文 Markdown 供通读。契约校验能拦住
编出来的路径、场景字段错误与超长字幕。插件 `dsh-foldercast` 装进 DSH 后，对话里说「把这个目录
讲一遍」就会触发工具；skill 带完整的工作流与判据，**写稿由主 agent 做、评审由另一个独立 subagent
做**，结论写到 `<目录>/.foldercast/review.md`。成片要显式要求（`render: true`，需配音再加
`voice: true`）：默认用 macOS 自带的 `say`（免密钥），逐场景合成、`ffprobe` 实测时长、字幕与
声音对齐；画面八种场景、字幕画在渲染层，同一份讲稿渲染两次**逐帧一致**，换音色重跑**画面不变**。

**这一版刻意去掉的东西**：HTML 视图模块、角色推断（`roles`）、引用依赖图与枢纽排名（`graph` /
`imports`）、代码高亮素材、以及工具里那套 `next` 状态枚举与自动串联。判据是**程序只给模型自己
得不到的东西**——规模上的穷尽性与机械上的确定性；「哪个重要、怎么组织」是模型读内容后的判断。
工具现在只报事实：磁盘上有什么、各自什么状态（`missing` / `stale` / `fresh`），下一步做什么由
skill 与模型决定。

**形态：第一版是 DSH 插件**（工具 + skill + 脚本），编排层是 DSH 主 agent。**只能在 DeepSeek Harness 内使用**——独立 CLI 与脱离 DSH 的用法推迟，是否做以后再评估（[ADR 0008](docs/decisions/0008-plugin-first.md)）。

---

## 它解决什么问题

一个目录里通常混着这些东西：代码、可编辑文本、图片、视频、Office 三件套。你想让别人（或者三个月后的自己）快速理解它：

- **给别人看**：项目介绍、成果汇报、仓库导览
- **给自己看**：一次性视频，看完就理解了，不用写文档

现有工具（`paperview`、`gitreel`、`explainmyrepo`）都只吃 **git 仓库**。foldercast 的输入是**任何目录**。
赛道盘点见 [docs/PRIOR-ART.md](docs/PRIOR-ART.md)。

**要说清的一件事**：foldercast 会读取目录里的文件内容用于理解，**这些内容会进入模型上下文**。这是功能本身，不是缺陷。

我们默认排除 `.env`、`credentials.json`、`*.pem` 等密钥文件名（[清单](docs/specs/SPEC-data-format.md#sources--内容筛选维度-2)），但**这个列表不可能完备** —— 硬编码在源码里的密钥、自定义命名的密钥文件都会被读到。请自行确认目录里没有不该外传的内容。

不做内容检测是刻意的选择：同类工具（Cursor / Copilot / Claude Code）没有一家做，而实测显示模式匹配在真实上下文里会成片失效。一个漏掉一半密钥的检测器比没有检测器更糟 —— 它让人以为有保护。理由见 [ADR 0007](docs/decisions/0007-secret-file-exclusion.md)。

---

## 管线

```
   ┌──────────────┐     ┌─────────┐     ┌─────────┐
   │ 1 文案        │ ──► │ 2 视频  │ ──► │ 3 配音  │
   └──────────────┘     └─────────┘     └─────────┘
    分析目录              渲染画面         合成旁白
    Agent 通读内容        （静音）         烧字幕
    写出讲稿
```

管线分两层：**事实层**（遍历、分类、统计、引用关系）是确定性程序，可复现；**叙事层**（讲什么、什么顺序）由 Agent 集群执行，会通读文件内容。详见 [ADR 0006](docs/decisions/0006-narration-layer-moves-up.md)。

配音放最后：文案与画面是创作（迭代频繁、无外部依赖），配音是渲染（有配额成本、可换音色）。详见 [ADR 0004](docs/decisions/0004-pipeline-order.md)。

---

## 两个文件

| 文件 | 是什么 | 性质 |
|---|---|---|
| `foldercast.json` | **目录解读** —— 结构、统计、文件清单、引用依赖图、密钥排除审计 | 程序产出，**可重算** |
| `script.json` | **讲稿** —— 分镜与旁白 | 人或叙事层产出，**是创作** |

分家的理由：一份解读可以配多份讲稿（讲给同事的 / 讲给三个月后自己的），而且重跑分析不会覆盖讲稿。

---

## 三个「可插拔」维度（设计已定，**第一版不暴露**）

| 维度 | 做法 | 文档 |
|---|---|---|
| **TTS 适配** | 不绑单一引擎。统一接口覆盖云端 API / 本地引擎 / 系统原生 | [TTS-适配调研](docs/rd/TTS-适配调研.md) |
| **内容筛选** | 三级筛选 `include` / `exclude` / `kinds`，gitignore 风格 | [数据格式](docs/specs/SPEC-data-format.md) |
| **风格预设** | 四套预设，也可以用自然语言描述 | [风格预设系统](docs/rd/风格预设系统.md) |

四套预设：`swiss`（瑞士风）/ `deck`（演示风）/ `console`（终端风）/ `paper`（纸质风），文件在 [styles/](styles/)。

> **第一版的判据是「除了指向哪个目录，不需要任何其他输入」。** 上表三个维度都设计好了，但先不暴露成配置项 —— 没看到真实成片之前，无法判断哪些东西值得暴露。默认排除规则与规模保护是必需的，但值先写死成常量。见 [ROADMAP.md](docs/ROADMAP.md#第一版的规模判据无可配置空间)。

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
| [specs/SPEC-data-format.md](docs/specs/SPEC-data-format.md) | `foldercast.json`（解读）、`script.json`（讲稿）与素材目录格式 |
| [specs/foldercast.schema.json](docs/specs/foldercast.schema.json) | 目录解读的 JSON Schema（机器可读） |
| [specs/script.schema.json](docs/specs/script.schema.json) | 讲稿的 JSON Schema（机器可读） |

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
| [docs/specs/foldercast.schema.json](docs/specs/foldercast.schema.json) | 挂到编辑器做解读文件的自动补全与校验 |
| [docs/specs/script.schema.json](docs/specs/script.schema.json) | 挂到编辑器做讲稿的自动补全与校验 |
| [examples/foldercast.example.json](examples/foldercast.example.json) | 解读示例（`lecture-videos` 目录），已通过 schema 校验 |
| [examples/script.example.json](examples/script.example.json) | 与上面配套的讲稿示例，已通过 schema 校验 |
| [styles/](styles/) | 四套风格预设，token 键集合完全一致（31 个），可互换 |

## 现在能跑的五步

```bash
pnpm analyze  <目录>   # 目录 → 解读，写到 <目录>/.foldercast/foldercast.json
pnpm assets   <目录>   # 解读 → 素材，写到 <目录>/.foldercast/assets/
pnpm validate <目录>   # 校验解读、讲稿与配音产物（退出码 0/1/2）
pnpm voice    <目录>   # 讲稿 → 逐场景音频 + 实测时长，写到 <目录>/.foldercast/durations.json
pnpm render   <目录>   # 讲稿 + 素材 + 音轨 → mp4，写到 <目录>/.foldercast/out/video.mp4
```

五个脚本都能**脱离 DSH 直跑**（`node packages/plugin/scripts/<阶段>/main.ts <目录>`），仓库内
Node 22.19+ 直接运行 TypeScript，不需要构建步骤。加 `--json` 可拿到机器可读的报告。

**配音默认免密钥**：`say` 是 macOS 自带的，不指定音色时它自动挑一个中文音色（系统默认是
英文的）。要更好的音色换云端 provider：`pnpm voice <目录> --provider mimo`，并配好
`MIMO_API_KEY`（进程环境、项目根的 `.env`、或 DSH 的凭据存储都行）。**缺密钥时退出码 4 并
给出三种配法**，不会等 401 才发现。

**渲染要浏览器**，且只在出片时需要：缺浏览器时脚本**不会替你下载**，而是打印三种办法
（装 Chrome / `npx remotion browser ensure` / `FOLDERCAST_BROWSER=<路径>`）并以退出码 3 结束。
分析与校验都不需要浏览器。调画面用 `pnpm render <目录> --still <秒>`（出一张静帧）
或 `--frames <A-B>`（出一小段），不必整片重渲。

**工具默认不出片、不配音**：`foldercast_cast` 只跑分析与素材（素材可用 `skipAssets` 跳过），
并把磁盘上现有的产物报回来。要成片就显式传 `render: true`（要先配音就同时传 `voice: true`）——
渲染几分钟到几十分钟、配音会消耗 TTS 配额，不该由「顺手调一次工具」触发。

**中断渲染之后**可能留下一个后台 Chrome 进程（`puppeteer_dev_chrome_profile-*`）。它不影响正确性，
但会抢 CPU、让「逐帧一致」在满载时不再逐位相同 —— 实测踩过一次，杀掉它就恢复正常：
`pkill -f puppeteer_dev_chrome_profile`。

**时长以实测为准**：配音跑过之后，画面时间轴来自 `ffprobe` 实测的音频时长（不是字数预估）。
同一份讲稿渲染两次**逐帧一致**（`concurrency` 默认 1 就是为了这个：多并发时 Chrome 的字形
缓存会让画面漂）；**换音色重跑，画面不变**（只有音轨与片长变）。

**评审不是脚本**（[M5](docs/ROADMAP.md)）：写稿与评审都是模型在做，第二个脚本管不了对错。
主 agent 按 skill 写讲稿，**另一个独立 subagent** 按 skill 的六条评审判据复核，结论写到
`<目录>/.foldercast/review.md`。工具会报告它的状态：改过讲稿之后旧评审自动作废（`stale`）。

## 装进 DSH

```bash
dsh plugin --profile <profile> add dsh-foldercast
```

装完在插件管理页看到「目录放映」，对话里说「把这个目录讲一遍」即触发 `foldercast_cast`
（分析 → 素材 → 页面 → 校验），随后由 agent 按 skill 写讲稿、再调一次工具校验；讲稿通过后由
**另一个 subagent** 评审，结论写到 `<目录>/.foldercast/review.md`；评审是新的（`fresh`）之后
再调一次就**配音并出片**，成片落在 `<目录>/.foldercast/out/video.mp4`（带旁白）。
只要页面不出片传 `skipRender`，只要静音片传 `skipVoice`，换音色传 `ttsVoice`。

**发布前要构建**：Node 不允许在 `node_modules` 里剥离 TypeScript 类型，所以分发的入口与阶段脚本
必须是 JS。`pnpm --filter dsh-foldercast prepack`（= 复制 schema + `tsc`）会生成 `lib/` 与
`schemas/`，两者都是构建产物、不入库。

---

## 许可提示：Remotion 是双许可

出片这一步用 [Remotion](https://www.remotion.dev/) 渲染画面。它**不是纯开源**，请按自家情况判断：

| 你的情况 | 适用档位 | 价格（2026-10-05 复核） |
|---|---|---|
| 个人，或 ≤3 人的公司 | Free License | $0，含无限商业使用 |
| 4 人以上公司，为自己组织做视频（含用 AI agent） | Creators | $25/月/座 |
| **把 foldercast 嵌进自己的产品**、做成视频创作工具对外的 | Automators | **$0.01/次渲染，$100/月起** |

**foldercast 本身按 Free License 使用**（个人项目）。**发布 foldercast 不改变你的义务**：装到 4 人
以上的公司里用它出片，或把它包进产品里卖，都要按上表自行取得许可。渲染时 Remotion 会按其
[遥测政策](https://www.remotion.dev/docs/telemetry) 上报用量，可以用环境变量关掉。

出片还需要浏览器（Chrome / Chromium / Edge）：**我们不分发它**，用系统已装的，或让 Remotion 下载。

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
├── packages/
│   └── plugin/            DSH 插件（第一版唯一的入口，也是全部代码）
│       ├── src/           工具注册、Config schema
│       ├── locale/        中英文标题与描述
│       └── scripts/
│           ├── contracts/ 四份 JSON 契约的类型 + 字幕切分与时长分配，各阶段共用
│           ├── analyzer/  TypeScript：目录 → 解读（遍历、分类、密钥审计、每文件机械事实）
│           ├── assets/    TypeScript：解读 → 素材（缩略图 / 关键帧 / 逐页图 / 提取文本）
│           ├── validate/  TypeScript：解读与讲稿的契约校验（含幻觉路径拦截）
│           ├── renderer/  TypeScript + Remotion：讲稿 + 素材（+ 音轨）→ mp4
│           └── voice/     TypeScript：讲稿 → 逐场景音频 + 实测时长 + durations.json
├── styles/                风格预设（数据，非代码）
├── examples/              示例解读与讲稿
├── scripts/               仓库工具（TypeScript：链接、JSON、风格 token、示例 schema）
│   └── lib/repo.ts        四个检查脚本共用的遍历与读取
├── package.json           仓库工具的依赖与脚本（产品依赖在 packages/plugin 下）
└── tsconfig.json          仓库工具的类型检查配置
```

**全 TypeScript，没有 Python**——包括仓库工具。插件本体、分析器、渲染器同栈，`foldercast.json` 的类型定义三方共用。`scripts/` 下的检查脚本由 Node 直接运行（类型剥离，不需要构建步骤）。

**编排层是 DSH 主 agent，不是代码。** 脚本由模型用 `bash` 调起，没有 CLI 包装层。分析器与渲染器**互不依赖**，耦合点是两个数据契约——`foldercast.json`（解读，程序产出）与 `script.json`（讲稿，叙事层产出）。

理由见 [ADR 0008](docs/decisions/0008-plugin-first.md)（插件优先）与 [ADR 0006](docs/decisions/0006-narration-layer-moves-up.md)（叙事层下移）。

---

## 与 lecture-videos 的关系

独立项目、独立仓库、独立运行。不共享代码。
管线设计借鉴了同作者的 [`lecture-videos`](../qiuzhao202608/lecture-videos) 中**已在真实项目验证**的做法（字幕按标点切分并按字数配时、时长以实测音频为准），理由见 [ADR 0001](docs/decisions/0001-separate-project.md)。

---

## 参与

工程规范见 [docs/conventions/](docs/conventions/)。提交前请跑：

```bash
pnpm install      # 首次，或依赖变更后
pnpm run check    # 链接 + JSON + 风格 token + 示例 schema
```
