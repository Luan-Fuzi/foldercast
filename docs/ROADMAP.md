# 里程碑

MVP 范围已收敛为**单一路径**：文案 → 视频 → 配音。不做 `quick`/`publish` 双模式，不做交互式 UI。

---

## M0 · 骨架与设计（当前）

- [x] 独立工作区 `/Users/scliang/work/foldercast`
- [x] 三步管线设计与可重跑边界
- [x] `foldercast.json` 格式定义
- [x] TTS 供应商调研
- [x] 风格预设系统设计
- [x] 竞品调研归档

**完成标准**：文档齐备，格式定死，不需要写代码就能评审设计。

---

## M1 · 分析器（analyze）

目标：**目录 → `foldercast.json` 的 `sources` / `stats` / `manifest` / `graph` 四节**（不含讲稿，讲稿在 `script.json`）。

不调用模型，纯确定性程序。

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

## M3 · 写稿（narrate）

目标：**分析结果 → `scenes`**。

- [ ] 提示词设计：输入是 `stats` + `manifest`（不是原始目录）
- [ ] 场景类型选择：`cover` / `tree` / `inventory` / `file` / `gallery` / `clip` / `document` / `outro`
- [ ] `targetDurationSec` 反推字数上限
- [ ] 中文字幕切分（按标点 + 按字数，沿用已验证规则）
- [ ] 输出合法 `foldercast.json`

**验收**：对 M1 的三个目录各生成一份分镜，`narration` 与实际内容相符、不编造不存在的文件。

**关键约束**：模型只能引用 `manifest` 里存在的路径。生成后需校验，出现幻觉路径要拦截。

---

## M4 · 视频（render）

目标：**`foldercast.json` + `assets/` → 静音 mp4**。

- [ ] Remotion 工程骨架
- [ ] 运行时加载分镜（**不能静态 import**，见下方「已识别的坑」）
- [ ] 样式 token 应用层
- [ ] 八种场景组件
- [ ] 字幕渲染组件（由渲染层绘制，不走 ffmpeg）
- [ ] 时长驱动时序（无音频时按字数预估）

**验收**：同一份分镜渲染两次，输出逐帧一致。

---

## M5 · 配音（voice）

目标：**成片配音 + 字幕对齐**。

- [ ] TTS 适配层（统一接口 + provider 注册）
- [ ] 至少三个 provider：MiMo、Edge-TTS、macOS `say`
- [ ] `ffprobe` 实测时长
- [ ] 字幕块时长分配
- [ ] `durations.json` 输出
- [ ] 按实测时长重渲染
- [ ] 换音色只重跑本阶段

**验收**：同一份分镜用三个 provider 各出一版，画面一致、仅音色与时长不同。

---

## M6 · 风格预设

- [ ] 四套预设：`swiss` / `deck` / `console` / `paper`
- [ ] 自然语言 → token 覆盖的解析
- [ ] 覆盖结果回写 `overrides`（渲染阶段不再调模型）

**验收**：同一份分镜用四套预设各渲染一版，观感差异明显且都可用。

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
- ❌ 网页形态产物 —— 只出视频
- ❌ 与 `lecture-videos` 共享代码 —— 保持独立（可借鉴实现，注释标注来源）
