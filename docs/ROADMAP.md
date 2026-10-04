# 里程碑

**形态**：第一版只做 DSH 插件（工具 + skill + 脚本），编排层是 DSH 主 agent。不做独立 CLI（[ADR 0008](decisions/0008-plugin-first.md)）。

**主线**：解读 → 讲稿 → 视图。视频是视图之一，不是唯一产物。

---

## 排序原则

里程碑的编号**就是执行顺序**，按三条原则排：

| 原则 | 含义 |
|---|---|
| **依赖优先** | 前者是后者的输入。分析没跑通就不能写稿，契约没定就不能校验讲稿 |
| **验收前置** | **验收手段先于被验收的东西**。校验脚本（M3）与评审 agent（M5）都必须早于它们要检查的写稿质量 |
| **反馈回路尽早闭合** | HTML 视图（M6）不需要 Remotion、不需要浏览器、不需要 TTS，是验证「解读得对不对」最快的一条路 |

**一个刻意的偏离**：管线的自然顺序是「文案 → 视频 → 配音」（[ADR 0004](decisions/0004-pipeline-order.md)），但**评审与 HTML 插在了写稿之后、视频之前**。理由是：写完稿却无法判断写得好不好，等于把最大的风险（叙事质量）拖到最后。

---

## M0 · 骨架与设计（已完成）

- [x] 独立工作区 `/Users/scliang/work/foldercast`
- [x] 三步管线设计与可重跑边界
- [x] `foldercast.json` / `script.json` 格式定义
- [x] TTS 供应商调研、风格预设系统设计、竞品调研归档
- [x] 解读 / 讲稿分离、引用依赖进契约、密钥排除、隐私边界、凭据 seam、浏览器与 Office 引擎选型

**完成标准**：文档齐备，格式定死，不需要写代码就能评审设计。

---

## M1 · 分析器（解读）（已完成）

目标：**目录 → `foldercast.json`**。纯确定性程序，TypeScript，不调用模型。

这是整个项目的地基：**「理解」是核心产物**，而解读就是它的载体。

- [x] 目录遍历 + 结构树（**结构树即 `manifest` 的路径集合 + `stats.topDirs`**；契约里没有单独的树结构，见 SPEC-data-format.md）
- [x] 文件类型分类（12 类：code / text / markup / data / office / pdf / image / video / audio / archive / binary / other）
- [x] 角色识别（readme / entry / config / test / doc / asset / license / build）
- [x] 语言与行数统计
- [x] `sources` 三级筛选（include / exclude / kinds）
- [x] 默认排除规则（含**密钥类文件名**，见 [ADR 0007](decisions/0007-secret-file-exclusion.md)）
- [x] **引用依赖图**：`manifest[].imports` / `importedBy` + `graph` 的 roots / hubs / leaves / dangling
- [x] **`stats.secrets` 审计输出**（只按文件名匹配，必须打印）
- [x] 各类型的 `preview` 提取 —— 代码/文本/数据/标记/图片已做；**office / pdf / video 的深化提取视同 M2**（要 `dsoffice`、`officeparser`、`ffprobe`，M1 不引入这些依赖，留空而不是编一个）
- [x] `maxFiles` / `maxFileSizeMb` / `maxDepth` 规模保护

**验收（2026-10-04 实测）**

1. ✅ 三个真实目录跑通并人工核对：

   | 目录 | 结果 |
   |---|---|
   | `qiuzhao202608/lecture-videos`（TS + Remotion） | 94 文件；audio 68 / data 10 / code 9 / image 4；**命中 `.mimo_api_key`**（真实密钥文件名，审计如实打印）；枢纽 `src/components.tsx`、`src/types.ts` 与人工判断一致 |
   | `qiuzhao202608/resume`（Office 汇报） | 22 文件；office 8 / pdf 7 / text 7，无错判；无引用关系时不编造入口（roots 为空） |
   | `qiuzhao202608`（混杂资料） | 1040 文件 → 按重要性保留 200；枢纽是「智能体开发」系列的 5 篇八股文档，符合实际阅读顺序 |

   验收过程中修掉三类误判（都写进了测试）：Markdown 链接目标含括号被截断、代码块里的 `[name](arg)` 被当成链接、JSON 里的裸文件名被当成路径。

2. ✅ 对本仓库自身：`roots` 含 `README.md`，`hubs` 含 `docs/specs/SPEC-pipeline.md`（入 10），`dangling` 为空
3. ✅ 脱离 DSH 直接跑：`node packages/plugin/scripts/analyzer/main.ts <目录>`，无需构建步骤
4. ✅ 大体量不 OOM：对 `/Users/scliang/work`（21.3 万文件）跑完 **0.34 秒、峰值内存 124 MB**；按重要性截断到 200 个文件，截断数量如实打印

**语言**：TypeScript（Node 22.19+），与插件、渲染器同栈。**项目无 Python 依赖**——当初选 Python 是为了 Office/PDF 库，那两块现在都在 Node 侧。

**为什么排第一**：唯一不依赖模型、不依赖渲染、不依赖网络的阶段，风险最低，产物本身有价值。

**注意**：本阶段**不含**插件骨架。骨架与技能放在 M4，因为它只服务于「让 agent 调用脚本」这一件事。


---

## M2 · 素材（已完成）

目标：**解读里的文件 → `assets/`**。

- [x] 图片缩放与缩略图（`sips`，非 macOS 回退 `ffmpeg`）
- [x] 视频抽帧与封面（`ffmpeg`）+ 元数据（`ffprobe`：时长 / 分辨率 / 编码）
- [x] **Office 与 PDF 转图（`dsoffice render`）** —— 一个工具覆盖两类
- [x] Office / PDF 文本结构化提取（**`officeparser`** —— 一个库覆盖 docx / pptx / xlsx / pdf 等，产出带层级的 AST）
- [x] **xlsx 公式值重算（`dsoffice recalculate`）**
- [x] 代码语法高亮图（`shiki` → **SVG**：渲染器本来就是浏览器，不需要截图工具，见 [SPEC-data-format.md](specs/SPEC-data-format.md#三assets-素材目录)）
- [x] `assets/manifest.json` 增量重算（按 mtime + size 命中，产物还在才算命中；mtime 变了才重算哈希）
- [x] 顺带补齐 M1 顺延的 **office / pdf / video 的 `preview`**（素材阶段回填进解读）

**验收（2026-10-05 实测）**

| 场景 | 结果 |
|---|---|
| Office 汇报目录（`qiuzhao202608/resume`） | 15 个 Office/PDF → **20 张页图 + 15 份文本**，15.0 秒；预览全部补齐，例如「2 页 · 4 个表格」「1 页 · 梁师成」 |
| 本仓库自身 | 47 个代码文件 → 47 张 SVG，**502 毫秒** |
| 第二次运行（两处都是） | **全部命中缓存：0–1 毫秒**（`resume` 15 个文件 0 毫秒，仓库 47 个文件 1 毫秒） |

**`officeparser` 的验证（本阶段必做，已完成）**：夹具与真实文件各跑一遍，结论是**够用，不退回 `mammoth` + `exceljs`**。

| 输入 | 提取结果 |
|---|---|
| 夹具 docx | 标题层级 `Heading1` / `Heading2` ✓，表格 1 个（row / cell 齐全）✓ |
| 夹具 xlsx | 工作表名 `Summary` ✓；公式 `SUM(B2:B3)` 无缓存值，**重算后取到 4600** ✓ |
| 夹具 pptx | 2 张幻灯片，题目 `项目概述` / `架构分层` ✓ |
| 夹具 pdf | 文本层 5 段 ✓（扫描版没有文本层属已知边界） |
| 真实简历 docx | 6 个表格、2945 字 ✓ |
| 真实简历 pdf | 2437 字 + **元数据标题** ✓ |
| 真实 59 页课程 pptx | 46 个标题 + 5 个表格 + 8088 字 ✓ |
| 真实 xlsx | 75 行 297 个单元格 ✓ |

**依赖说明**：全部 TypeScript，**无 Python**。转图统一走 `dsoffice`（`@deepseek-ai/libreoffice-kit`，作为 `optionalDependencies` 自动安装；缺它时 office/pdf 素材会**报可操作的失败**而不是崩溃，其他类型照常）；文本提取走 `officeparser`；高亮走 `shiki`。

**为什么排在写稿之前**：写稿阶段要引用素材路径（`file` 场景的 `asset`、`gallery` 的 `items`）。没有素材，讲稿只能引用文件而不能引用画面。

**风险点（已消解）**：Office 转图是最重的部分——实测每个文件约 1 秒（起 LibreOffice/pdfium 引擎），并且**不保证与 Microsoft Office 分页一致**（官方声明）。`shiki` 体积的担心没有成立：它按需加载语言文法，47 张高亮图共 502 毫秒。


---

## M3 · 契约校验脚本

目标：**机器可查的验收，先于被验收的产物。**

**为什么单独成为里程碑**：它是 M5（写稿）的前提。把校验混在写稿里，等于「先做，再想怎么判断做对没有」——而这个项目最大的空白正是叙事质量没有判据（见「已识别的坑」第 5 条）。

- [ ] `foldercast.json` / `script.json` 通过各自 schema 校验
- [ ] 讲稿引用的每个路径都在解读的 `manifest` 里 —— **幻觉路径拦截**
- [ ] 场景 `type` 在开放枚举内
- [ ] 字幕块 ≤24 字
- [ ] 结构树与 `stats` 的一致性（计数与清单对得上）

**验收**：对一份**故意写坏**的讲稿（含幻觉路径、非法 type、超长字幕块）能全部报出，并指出具体位置。

**这一层的边界**：它只查机器能判断的。**「有没有讲错重点」不是它能管的**，那是 M5 的事。

---

## M4 · 插件骨架

目标：**一个能装进 DSH 的插件，agent 能调起 M1 的分析器。**

- [ ] npm 包 + `dsh.bundle.patch` 声明（**必需**，漏了会静默不激活）
- [ ] `locale/zh.json` + `locale/en.json`（插件管理页的标题与描述）
- [ ] `Config` schema 声明（**第一版不暴露字段**，只立机制 —— 宿主据此生成设置页，见 [ADR 0009](decisions/0009-settings-via-config-schema.md)）
- [ ] 一个工具：`foldercast_cast`，**一个参数**（目录路径）
- [ ] skill：工作流步骤 + 「不读哪些文件」的约束
- [ ] 依赖探测与清晰报错（不是裸 `ENOENT`）

**验收**

1. 装进 DSH 后，对话里说「把这个目录讲一遍」能触发工具
2. 分析器缺失或失败时，报错**可操作**（说清哪个依赖、怎么装）
3. 插件管理页能看到标题与描述

**这一步才做骨架的理由**：骨架/技能只服务于「让 agent 调脚本」。先有脚本，才有东西可调。

---

## M5 · 写稿 + 评审 agent

目标：**解读 + 通读内容 → `script.json`，并且能判断写得好不好。**

**这一阶段没有脚本**，由 DSH 主 agent + 一个评审 subagent 完成。

**写稿（主 agent）**

- [ ] skill 里写清写稿步骤与判据（**主要交付物**）
- [ ] 场景类型选择：`cover` / `tree` / `inventory` / `file` / `gallery` / `clip` / `document` / `outro`
- [ ] **通读策略**：哪些文件读全文、哪些只读摘要、按什么顺序读（大目录靠 subagent 分工）
- [ ] 中文字幕切分规则
- [ ] 输出合法 `script.json`，并通过 M3 的校验

**评审（subagent）**

- [ ] 判据写进 skill：有没有编造、有没有讲错重点、有没有漏掉枢纽文件（`graph.hubs` 里的一个都没讲，就是漏）
- [ ] 起 subagent 执行，输入是解读 + 讲稿
- [ ] 评审结果落盘，作为验收记录

**验收**：三个目录各生成一份讲稿；M3 校验全过；评审 agent 输出「通过／不通过 + 理由」。**人工抽查评审结论本身对不对**——评审 agent 也会错，它自身需要被抽检。

**为什么评审与写稿同一个里程碑**：评审是写稿的验收，两者必须一起交付。分开就会出现「写完了，但没法判断」。

---

## M6 · HTML 视图

目标：**把 `foldercast.json` 渲染成一个静态自包含页面**，作为第一个可看的产物。

**为什么它值得早做**：这是**唯一一条不需要 Remotion、不需要浏览器、不需要 TTS、不需要逐帧确定性**的视图路径。它验证的是项目的核心目标——「解读能不能替代翻目录」——而不是渲染管线的正确性。

- [ ] 结构树视图（`graph.roots` / `hubs` 高亮）
- [ ] 内容盘点（`stats.kindCounts` / `roles`）
- [ ] 文件卡片（`manifest` 的 `title` / `preview` / 缩略图）
- [ ] 引用依赖图的可视化
- [ ] `stats.secrets` 审计清单可查看
- [ ] 单文件输出，无外部依赖，可直接用浏览器打开

**验收**：对 M1 的三个目录各生成一份；**找一个不了解这个目录的人读一遍**，看能否说出「这个目录是干什么的、分成哪几块、主要入口在哪」。这直接对应 [PRODUCT.md](PRODUCT.md#成功判据) 成功判据 1。

**边界**：静态页面，**不是网页产品**（无服务器、无交互逻辑）。见 [PRODUCT.md](PRODUCT.md) 非目标表后的说明。

---

## M7 · 视频（render 脚本）

目标：**`script.json` + `assets/` → 静音 mp4**。

- [ ] Remotion 工程骨架（`scripts/renderer/`）
- [ ] 运行时加载讲稿（**不能静态 import**，见「已识别的坑」第 1 条）
- [ ] 浏览器获取与检查（优先系统 Chrome，退路 `remotion browser ensure`，缺失时结构化引导）
- [ ] 样式 token 应用层
- [ ] 八种场景组件
- [ ] 字幕渲染组件（由渲染层绘制，不走 ffmpeg）
- [ ] 时长驱动时序（无音频时按字数预估）

**验收**：同一份讲稿渲染两次，输出**逐帧一致**。

**与 M6 的关系**：两者消费同一份解读/讲稿，**互不依赖**。M6 先做的理由是它的风险低一个数量级。

---

## M8 · 配音（voice 脚本）

目标：**成片配音 + 字幕对齐**。

- [ ] TTS 适配层（统一接口 + provider 注册）
- [ ] 第一版一个 provider 够用（多 provider 押后）。**默认 `say`**（免密钥，装了就能跑）
- [ ] `ffprobe` 实测时长
- [ ] 字幕块时长分配
- [ ] `durations.json` 输出
- [ ] 按实测时长重渲染
- [ ] 换音色只重跑本阶段

**验收**：换 provider 或音色后重跑本阶段，画面不变、仅音色与时长不同。

**凭据**：复用 DSH 凭据 seam，配置里只放引用名（[C6](REQUIREMENTS.md)）。**写稿不需要凭据，只有配音需要。**

**未配置密钥时的行为**：默认 `say` 免密钥，所以装了就能跑；用户选 MiMo 但没配 key 时，**先 `describe` 再调用**，返回结构化引导而不是等 401。见 [rd/TTS-适配调研.md](rd/TTS-适配调研.md#key-未配置时的行为)。

---

## 第一版的规模判据：无可配置空间

**判据：除了「指向哪个目录」，不需要任何其他输入。**

风格预设、自然语言风格解析、`sources` 的用户自定义、多视频切分、多 TTS provider —— **全部押后**。理由是没看到真实成片之前，无法判断哪些值得暴露。

**必需 vs 可选**要分清：默认排除规则、`maxFiles` 等规模保护是**必需**的（否则 21 万文件的目录跑不动），但它们的**值先写死成常量**，不做成配置项。

---

## 押后（设计已定，第一版不做）

这些不是被否决，是排序。

| 项 | 依赖 | 何时做 |
|---|---|---|
| **`depth` 粒度开关**（`overview` / `normal` / `detailed`）：同时控制扫描深度与叙事详略 | M1 + M5 | 见 [INTEGRATION §11.5](INTEGRATION-dsh-plugin.md#115-计划暴露给用户的配置日后)。**它控制成本，比风格更早该暴露** |
| 风格预设（R8）：四套预设 | M7 出片 | 看到真实成片、知道想改什么之后。第一版用一套硬编码 |
| 自然语言风格（R9） | 风格预设 | 有多套预设才有意义 |
| 多视频切分（R2 容器型目录） | M5 的切分规则 | 切分判据定下来之后 |
| 用户自定义筛选（R7）与规模参数 | M1 | 默认规则不够用时 |
| 设置页里的自定义内容（`settings.section`，如解读概要图表） | 另发客户端包 | 配置表单不用它——那走 `Config` schema（[ADR 0009](decisions/0009-settings-via-config-schema.md)）。第一版已声明 schema 但无字段 |
| TTS 多 provider（R6） | M8 | 先跑通一个 |
| 插件配置项 | 全部 | 出现第一个真实需求时 |
| **独立 CLI** | — | 第一版之后评估是否脱离 DSH（ADR 0008） |
| CI 里的完整管线 | 独立 CLI | 第一版靠脚本直调满足 CI 需求（M1 验收 3） |

---

## 已识别的坑

### 1. 讲稿不能静态 import

`lecture-videos` 的做法是：

```tsx
import lec00 from '../content/00-calculus.json';
const lectures = [lec00, ..., lec06];
```

**每加一个目录就要改 TypeScript 源码**。对「指向任意目录就出片」的工具这是致命的。foldercast 必须运行时加载（`calculateMetadata` 里按传入路径读取，或生成 manifest 索引）。

这是「一个视频项目」与「一个工具」的分界线，**M7 第一件事就要解决**。

### 2. 本机 ffmpeg 没有 libass

`subtitles` 和 `drawtext` 滤镜都不可用，**ffmpeg 无法烧字幕**。字幕必须在渲染层画。这决定了 M7 的字幕组件是必做项，不是可选项。

### 3. 渲染需要浏览器（C4）

**为什么需要**：Remotion ≈ 无头浏览器 + 帧驱动 + 编码。React 只描述结构，**布局必须靠排版引擎**——见 [SYSTEM-DESIGN.md §4.6](SYSTEM-DESIGN.md#46-为什么必须有浏览器c4)。

**怎么获取**：

| 顺序 | 来源 |
|---|---|
| ① | 系统已有的 Chrome / Chromium（本机已实测：`/Applications/Google Chrome.app`） |
| ② | `npx remotion browser ensure` 下载 Chrome Headless Shell |

**失败处理**：首次渲染前检查，缺失时返回结构化引导，**不崩溃**。**这不是插件加载的硬条件**——缺浏览器时 M1/M2/M5 都能跑，只有 M7 不能。

### 4. 时长必须实测

不同 TTS 引擎读同一段文字，时长差异可达 30%。所以：
- M7 用预估时长渲染（快，用于调画面）
- M8 之后用实测时长重渲染（准，用于成片）

两遍渲染是**设计的一部分**，不是浪费。

### 5. 叙事质量没有指标

事实层可以断言「分类无错判」，叙事层没有对应的判据。

**这一条现在有应对了**，也是重新排序的原因：M3 管机器能查的（路径、枚举、字数），M5 的评审 agent 管语义（编造、重点、遗漏）。两层都不完美——评审 agent 自己也会错，需要人工抽查——但**比「只能人工评审」可执行得多**。

---

## 明确不做（MVP）

- ❌ `quick` / `publish` 双模式 —— 收敛为单一路径
- ❌ 交互式选目录 UI —— 用配置文件
- ❌ 多视频批量编排 —— 手工跑多次
- ❌ 网页产品形态（站点、交互式页面、在线服务）—— 交付物是文件。**注意：M6 的静态 HTML 视图不在禁止之列**
- ❌ HTML 当渲染中间层 —— 见 [ADR 0002](decisions/0002-json-as-intermediate.md)
- ❌ 与 `lecture-videos` 共享代码 —— 保持独立（可借鉴实现，注释标注来源）
