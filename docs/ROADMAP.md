# 里程碑

MVP 范围已收敛为**单一路径**：文案 → 视频 → 配音。不做 `quick`/`publish` 双模式，不做交互式 UI。

**形态**：第一版只做 DSH 插件（工具 + skill + 脚本），编排层是 DSH 主 agent。不做独立 CLI（[ADR 0008](decisions/0008-plugin-first.md)）。

---

## M0 · 骨架与设计（已完成）

- [x] 独立工作区 `/Users/scliang/work/foldercast`
- [x] 三步管线设计与可重跑边界
- [x] `foldercast.json` / `script.json` 格式定义
- [x] TTS 供应商调研
- [x] 风格预设系统设计
- [x] 竞品调研归档
- [x] 解读 / 讲稿分离、引用依赖进契约、密钥排除、隐私边界

**完成标准**：文档齐备，格式定死，不需要写代码就能评审设计。

---

## M1 · 插件骨架 + 分析器

目标：**一个能装进 DSH 的插件，其中一个工具能对目录产出 `foldercast.json`。**

分两块，第一块是载体，第二块是内容：

**插件骨架**（[INTEGRATION-dsh-plugin.md](INTEGRATION-dsh-plugin.md)）

- [ ] npm 包 + `dsh.bundle.patch` 声明（**必需**，漏了会静默不激活）
- [ ] `locale/zh.json` + `locale/en.json`（插件管理页的标题与描述）
- [ ] 一个工具：`foldercast_cast`，**一个参数**（目录路径），执行 → 起子进程
- [ ] skill：工作流步骤 + 「不读哪些文件」的约束
- [ ] CLI 探测与清晰报错（不是裸 `ENOENT`）

**分析器脚本**（`scripts/analyzer/`，Python，不调用模型）

- [ ] 目录遍历 + 结构树
- [ ] 文件类型分类（12 类：code / text / markup / data / office / pdf / image / video / audio / archive / binary / other）
- [ ] 角色识别（readme / entry / config / test / doc / asset / license / build）
- [ ] 语言与行数统计
- [ ] `sources` 三级筛选（include / exclude / kinds）
- [ ] 默认排除规则（含**密钥类文件名**，见 [ADR 0007](decisions/0007-secret-file-exclusion.md)）
- [ ] **引用依赖图**：`manifest[].imports` / `importedBy` + `graph` 的 roots / hubs / leaves / dangling
- [ ] **`stats.secrets` 审计输出**（只按文件名匹配，必须打印）
- [ ] 各类型的 `preview` 提取（代码注释、文本首段、文档大纲、媒体元数据）
- [ ] `maxFiles` / `maxFileSizeMb` / `maxDepth` 规模保护

**验收**：对三个真实目录跑通并人工核对 —— 一个 TS 项目、一个混杂资料目录、一个含 Office 的汇报目录。分类与排除结果无错判，大体量目录不 OOM。

**引用图的验收**：对本仓库自身跑一次，`roots` 应含 `README.md`，`hubs` 应含 `docs/specs/SPEC-pipeline.md`（被 10 个文档引用），`dangling` 应为空。

**脚本层的验收**：脚本能脱离 DSH 直接跑（`python3 scripts/analyzer/main.py <目录>`）。这是 ADR 0008 的缓解措施——没有 CLI 时，CI 靠这条测分析器。

**为什么先做这个**：它是唯一不依赖模型、不依赖渲染、不依赖网络的阶段，风险最低，且产物（目录解读）本身就有价值。

### 第一版的规模判据：无可配置空间

**判据：除了「指向哪个目录」，不需要任何其他输入。**

风格预设、自然语言风格解析、`sources` 的用户自定义、多视频切分、多 TTS provider —— **全部押后**。先做零参数的版本，理由是没看到真实成片之前，无法判断哪些东西值得暴露。

**必需 vs 可选**要分清：默认排除规则、`maxFiles` 等规模保护是**必需**的（否则 21 万文件的目录跑不动），但它们的**值先写死成常量**，不做成配置项。

---

## M2 · 素材（assets）

目标：**manifest → `assets/`**。

- [ ] 图片缩放与缩略图（`sips`）
- [ ] 视频抽帧与封面（`ffmpeg`）
- [ ] PDF 逐页转图（`PyMuPDF`）
- [ ] Office 文本提取（`python-docx` / `python-pptx` / `openpyxl`）
- [ ] 代码语法高亮截图（`shiki`）
- [ ] `assets/manifest.json` 增量重算（按 mtime + hash 跳过未变文件）

**验收**：三类内容各生成可用素材；重复运行第二次全部命中缓存、秒级完成。

**风险点**：Office 转图是本阶段最重的部分。若 `shiki` 引入的依赖体积过大，退路是用等宽字体 + 简单着色，或复用 `highlight.js`。

---

## M3 · 写稿（主 agent 工作流）

**这一阶段没有脚本，它由 DSH 主 agent 完成。** 目标：**解读 + 通读内容 → `script.json`**。

- [ ] skill 里写清写稿步骤与判据（这是本阶段的主要交付物）
- [ ] 场景类型选择：`cover` / `tree` / `inventory` / `file` / `gallery` / `clip` / `document` / `outro`
- [ ] 通读策略：哪些文件读全文、哪些只读摘要、按什么顺序读（大目录要靠 subagent 分工）
- [ ] 中文字幕切分规则（写进 skill，由脚本或 agent 执行）
- [ ] 输出合法 `script.json`

**验收**：对 M1 的三个目录各生成一份讲稿，`narration` 与实际内容相符、不编造不存在的文件。

**关键约束**：讲稿只能引用解读里存在的路径。生成后必须校验，幻觉路径要拦截（见 M6）。

**这一阶段的验收靠 M6 的评审 agent**，因为叙事质量没有机器判据（见下方「已识别的坑」第 5 条）。

---

## M4 · 视频（render 脚本）

目标：**`script.json` + `assets/` → 静音 mp4**。

- [ ] Remotion 工程骨架（`scripts/renderer/`）
- [ ] 运行时加载讲稿（**不能静态 import**，见下方「已识别的坑」）
- [ ] 样式 token 应用层
- [ ] 八种场景组件
- [ ] 字幕渲染组件（由渲染层绘制，不走 ffmpeg）
- [ ] 时长驱动时序（无音频时按字数预估）

**验收**：同一份讲稿渲染两次，输出逐帧一致。

---

## M5 · 配音（voice 脚本）

目标：**成片配音 + 字幕对齐**。

- [ ] TTS 适配层（统一接口 + provider 注册）
- [ ] 第一版一个 provider 够用（多 provider 押后）
- [ ] `ffprobe` 实测时长
- [ ] 字幕块时长分配
- [ ] `durations.json` 输出
- [ ] 按实测时长重渲染
- [ ] 换音色只重跑本阶段

**验收**：换 provider 或音色后重跑本阶段，画面不变、仅音色与时长不同。

**凭据**：TTS 的 key 按 [C6](REQUIREMENTS.md) 的优先级（环境变量 > 项目 `.<provider>_key` > 用户级配置）。**注意与叙事层的区别**——写稿不需要凭据（主 agent 自己做），只有配音需要。

---

## M6 · 评审 agent

目标：**给叙事层一个可执行的验收**（解决「已识别的坑」第 5 条）。

分两层，机器能查的交给脚本，语义的交给评审 agent：

**机器可查的（校验脚本）**

- [ ] 讲稿引用的每个路径都在解读的 `manifest` 里 —— 幻觉路径拦截
- [ ] 场景 `type` 在开放枚举内
- [ ] 字幕块 ≤24 字
- [ ] `script.json` 通过 schema 校验

**语义的（评审 agent）**

- [ ] 判据写进 skill：有没有编造、有没有讲错重点、有没有漏掉枢纽文件（`graph.hubs` 里的文件一个都没讲，就是漏）
- [ ] 起 subagent 执行，输入是解读 + 讲稿
- [ ] 评审结果落盘，作为验收记录

**验收**：对 M1 的三个目录各跑一次评审，输出「通过／不通过 + 理由」。**人工抽查评审结论本身对不对**——评审 agent 也会错，它自身需要被抽检。

---

## 押后（设计已定，第一版不做）

见「第一版的规模判据」。这些不是被否决，是排序。

| 项 | 依赖 | 何时做 |
|---|---|---|
| **HTML 视图**：把 `foldercast.json` 渲染成静态自包含页面 | 无（与视频并列的视图） | 等 M1 的解读稳定。它验证「理解」这个核心目标比视频更快 |
| **风格预设**（R8）：四套预设 `swiss` / `deck` / `console` / `paper` | M4 出片 | 看到真实成片、知道想改什么之后。第一版用一套硬编码 |
| 自然语言风格（R9） | 风格预设 | 有多套预设才有意义 |
| 多视频切分（R2 容器型目录） | M3 的切分规则 | 切分判据定下来之后 |
| 用户自定义筛选（R7）与规模参数 | M1 | 默认规则不够用时 |
| TTS 多 provider（R6） | M5 | 先跑通一个 |
| 插件配置项 | 全部 | 出现第一个真实需求时 |
| **独立 CLI** | — | 第一版之后评估是否脱离 DSH（ADR 0008） |
| CLI 调用（CI） | 独立 CLI | 同上。第一版靠脚本直调满足 CI 需求 |

---

## 已识别的坑

### 1. 分镜不能静态 import

`lecture-videos` 的做法是：

```tsx
import lec00 from '../content/00-calculus.json';
const lectures = [lec00, ..., lec06];
```

**每加一个目录就要改 TypeScript 源码**。对「指向任意目录就出片」的工具这是致命的。foldercast 必须运行时加载（`calculateMetadata` 里按传入路径读取，或生成 manifest 索引）。

这是「一个视频项目」与「一个工具」的分界线，M4 第一件事就要解决。

### 2. 本机 ffmpeg 没有 libass

`subtitles` 和 `drawtext` 滤镜都不可用，**ffmpeg 无法烧字幕**。字幕必须在渲染层画。这决定了 M4 的字幕组件是必做项，不是可选项。

### 3. 渲染需要本机 Chrome

`lecture-videos` 的 `remotion.config.ts` 里显式指定了本机 Chrome，因为当前网络访问不到 Google 存储、下不了 Chrome Headless Shell。foldercast 需要沿用这个处理，或在文档里说明。

### 4. 时长必须实测

不同 TTS 引擎读同一段文字，时长差异可达 30%。所以：
- 阶段② 用预估时长渲染（快，用于调画面）
- 阶段③ 用实测时长重渲染（准，用于成片）

两遍渲染是**设计的一部分**，不是浪费。

### 5. 叙事质量没有指标（M3 的最大空白）

事实层可以断言「分类无错判」，叙事层没有对应的判据。
「讲稿好不好」「重点选得对不对」目前只能人工评审。

这不是可以绕过的工程问题，它决定了 M3 的验收标准怎么写。
在它解决之前，M3 的进度只能按「能跑通」衡量，不能按「跑得好」衡量。

---

## 明确不做（MVP）

- ❌ `quick` / `publish` 双模式 —— 收敛为单一路径
- ❌ 交互式选目录 UI —— 用配置文件
- ❌ 多视频批量编排 —— 手工跑多次
- ❌ 网页产品形态（站点、交互式页面、在线服务）—— 交付物是文件。**注意：静态 HTML 视图不在禁止之列**，见上方「押后」
- ❌ HTML 当渲染中间层 —— 见 [ADR 0002](decisions/0002-json-as-intermediate.md)
- ❌ 与 `lecture-videos` 共享代码 —— 保持独立（可借鉴实现，注释标注来源）
