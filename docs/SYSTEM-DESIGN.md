# 系统设计

技术选型、数据流、模块边界。**设计取舍的理由记录在 [decisions/](decisions/)。**

---

## 一、整体架构

**每个阶段都标了执行者**：`[脚本]` 是插件里的确定性程序，`[主 agent]` 是 DSH 的模型本身。

```
                    ┌─────────────────────────────────────┐
   目标目录 ────────► │  M1 analyzer              [脚本]     │
                    │  遍历 → 分类 → 筛选 → 统计            │
                    │  引用依赖图 + 密钥排除审计             │
                    │  纯确定性，不调用模型                  │
                    └──────────────┬──────────────────────┘
                                   │ foldercast.json（解读）
                                   ▼
                    ┌─────────────────────────────────────┐
                    │  M2 assets                [脚本]     │
                    │  缩略图 / 抽帧 / PDF转图 / 高亮        │
                    │  按 mtime+hash 增量重算               │
                    └──────────────┬──────────────────────┘
                                   │ assets/ + manifest.json
                                   ▼
                    ┌─────────────────────────────────────┐
                    │  M3 narrate             [主 agent]   │
                    │  通读内容 → 写 scenes                │
                    │  切分（容器型目录 → 1+N 份）           │
                    └──────────────┬──────────────────────┘
                                   │ script.json（讲稿）
                    ┌──────────────┴──────────────┐
                    ▼                             ▼
      ┌─────────────────────────┐   ┌─────────────────────────┐
      │  M4 render      [脚本]   │   │  M5 voice       [脚本]   │
      │  Remotion → 静音 mp4     │   │  TTS → 音频 + 实测时长    │
      │  样式 token 应用          │   │  字幕切分 + 时长分配      │
      └─────────────────────────┘   └──────────────┬──────────┘
                                                   │ durations.json
                                                   ▼
                                     按实测时长重渲染 → 成片

                    ┌─────────────────────────────────────┐
                    │  M6 review              [评审 agent] │
                    │  校验幻觉路径 + 判断有没有讲错重点      │
                    └─────────────────────────────────────┘
```

**关键分界**：M3 之前的产物（解读、素材）与 M3 之后的产物（讲稿）性质不同 —— 前者**可重算**，后者**是创作**。删了 `assets/` 或 `foldercast.json` 都能重建，删了 `script.json` 就丢了创作。

**M3 与 M6 是 agent，不是程序。** 这是 [ADR 0008](decisions/0008-plugin-first.md) 的直接结果：写稿的模型就是 DSH 主 agent，所以不需要任何 LLM 凭据配置；评审同理，起一个 subagent 即可。

---

## 二、技术选型

---

## 二、技术选型

| 层 | 选型 | 理由 | ADR |
|---|---|---|---|
| 渲染 | **Remotion** | React 组件 → 逐帧截图。`lecture-videos` 已验证 | [0003](decisions/0003-remotion-as-renderer.md) |
| 分析器 | **Python** | 办公文档与 PDF 库（`python-docx`/`python-pptx`/`PyMuPDF`）都在 Python 生态，且已装 | — |
| 语法高亮 | **shiki** | 与 Remotion 同生态，主题体系成熟 | — |
| 媒体处理 | **ffmpeg / ffprobe** | 本机已有，抽帧与实测时长都靠它 | — |
| 图片缩放 | **sips**（macOS） | 零依赖。跨平台时回退 ffmpeg | — |
| PDF → 图 | **PyMuPDF** | 已装，无需 `pdftoppm`/poppler | — |
| Office | **python-docx / python-pptx / openpyxl** | 直接提取文本比转 PDF 更结构化 | — |
| 中间格式 | **JSON** | 人和模型都能读写。解读与讲稿分为两份文件 | [0002](decisions/0002-json-as-intermediate.md) |

### 明确不引入的依赖

| 不用 | 替代 | 原因 |
|---|---|---|
| `pdftoppm` / poppler | `PyMuPDF` | 已装，少一个系统依赖 |
| `LibreOffice`（转图） | 直接提取文本 + `PyMuPDF` 渲染 | 启动慢、体积大，MVP 不需要 |
| `moviepy` | `ffmpeg` + Remotion | 多一层抽象，且我们有 Remotion |
| 数据库 | 文件系统 | 无状态，JSON 即状态 |
| Web 框架 | 无 | MVP 是 CLI |

---

## 三、模块边界

```
packages/
  plugin/                     DSH 插件（第一版唯一的入口）
    ├── (npm 包根)             工具注册、skill、locale
    └── scripts/
        ├── analyzer/          Python：目录 → 解读
        └── renderer/          Node + Remotion：讲稿 + 素材 → 视频
packages/cli/                  预留。独立 CLI 推迟，是否做以后再评估（ADR 0008）
styles/                        风格预设（数据，非代码）
docs/                          文档
examples/                      示例
```

**编排层是 DSH 主 agent，不是代码。** 三步管线的驱动者：

| 步骤 | 谁做 |
|---|---|
| ①-1 分析 | 主 agent 调 `scripts/analyzer/` |
| ①-2 写稿 | **主 agent 自己**（读解经 + 通读内容） |
| ② 视频 | 主 agent 调 `scripts/renderer/` |
| ③ 配音 | 主 agent 调脚本 |

**`analyzer` 与 `renderer` 互不依赖**，耦合点是两个数据契约：`foldercast.json`（解读）与 `script.json`（讲稿）。
这样两边各自可测：分析器可以对任意目录独立跑，渲染器可以拿手写讲稿独立跑。

**待确认**：`scripts/` 之下是否再分 `analyzer/` 与 `renderer/` 两个子目录，还是平铺。分开的理由与上文一致——保住「两侧互不依赖」这条边界在目录结构上可见。

**脚本必须保持独立可跑**（stdin/stdout + 参数）。这是 ADR 0008 的一条缓解措施：没有 CLI 的情况下，CI 仍要能直接调脚本测分析器。

---

## 四、关键设计点

### 4.1 分镜必须运行时加载（C1）

`lecture-videos` 用静态 import：

```tsx
import lec00 from '../content/00-calculus.json';
const lectures = [lec00, ..., lec06];
```

**每加一个目录就要改 TypeScript 源码** —— 对「指向任意目录就出片」的工具是致命的。

foldercast 必须运行时读取：`calculateMetadata` 里按传入路径动态加载分镜。这是「一个视频项目」与「一个工具」的分界线。

### 4.2 字幕在渲染层画（C2）

实测本机 ffmpeg 未编译 libass/freetype：

```
$ ffmpeg -filters | grep -xE 'subtitles|drawtext'
（无输出）
```

**`subtitles` 与 `drawtext` 滤镜都不可用**，ffmpeg 无法烧字幕。

因此字幕是渲染层的组件职责，通过 `<Caption>` 用 React 绘制。这反而更好控：字体、描边、位置、换行完全确定，不依赖系统字体配置。

### 4.3 时长以实测音频为准（C3/C5）

不同 TTS 引擎读同一段文字，时长差异可达 30%。所以：

- 阶段② 用**预估**时长渲染 → 快，用于反复调画面
- 阶段③ `ffprobe` **实测** → 按实测时长重渲染 → 准，用于成片

**两遍渲染是设计的一部分，不是浪费。**

### 4.4 分析器不调用模型，叙事层可以通读（ADR 0006）

管线分两层，性质不同：

| 层 | 谁做 | 能看什么 | 确定性 |
|---|---|---|---|
| 事实层（M1/M2） | 程序 | 目录本身 | 可复现 |
| 叙事层（M3） | Agent 集群 | 事实层产物 **+ 文件内容** | 不可复现 |

分析器不调用模型，理由收窄为两条：**可复现、成本可控**。交给模型会漏文件、编造不存在的文件，且结果不可复现。

**隐私不再是理由。** 叙事层会把文件内容送进模型上下文，这是设计的一部分（[ADR 0006](decisions/0006-narration-layer-moves-up.md)）。唯一的读取例外是密钥类文件（[ADR 0007](decisions/0007-secret-file-exclusion.md)）。

「理解」的范围包括**结构与分类统计**、**文件之间的引用依赖**，以及由此得出的**知识压缩**。后两项是叙事层能否讲出内容的关键。

### 4.5 密钥处理（C6）

**复用 DSH 的凭据 seam，自己不实现密钥查找。**

配置里只放**引用名**，不放值：

```jsonc
"ttsProvider": "mimo",
"ttsKeyRef": "MIMO_API_KEY"     // 引用名；值在凭据存储里
```

解析优先级由 `dsh-credentials-local` 固定，**我们不用写代码**：

| 顺序 | 位置 | 可写 |
|---|---|---|
| 1 | 启动环境（`MIMO_API_KEY=… dsh`） | ❌ 只读，**无法从产品内覆盖** |
| 2 | 凭据存储 `$DSH_HOME/.credentials.yaml` | ✅ 界面或 `ctx.credentials.set` |
| 3 | 项目 `.env`（`<cwd>/.env`） | 不在此处 |
| 4 | `$DSH_HOME/.env` | 不在此处 |

**绝不经由命令行参数或聊天记录。**

**两处仍是我们的责任**：

- `.gitignore` 已含 `.*_api_key` / `.*_key` / `credentials.json` / `.env*`
- **分析器不读这些文件的内容**，判据与审计见 [ADR 0007](decisions/0007-secret-file-exclusion.md)

**注意这不是隔离**：凭据文件只对 OS 用户可读，而 agent 的工具进程以同一用户身份运行。官方原话：「这是审慎，不是边界。」

### 4.6 为什么必须有浏览器（C4）

**这不是我们选的，是"用 CSS 排版"这条路自带的。**

```
场景组件（React / TSX）
      │  ① 输出 HTML + CSS（只是结构描述，不含像素）
      ▼
 无头 Chrome
      │  ② 布局引擎算位置：flexbox / grid / 字体度量 / 换行
      │  ③ 真实渲染引擎画出每一帧
      ▼
   像素 → ④ 逐帧截图 → ffmpeg 编码 → mp4
```

**React 不产生像素，Node 没有排版引擎。** 要知道一段文字落在哪个像素、怎么换行，必须有排版引擎——这正是浏览器做的事。

| 谁 | 能算排版吗 |
|---|---|
| React / JSX | ❌ 只描述结构 |
| Node.js | ❌ 无排版引擎 |
| 浏览器 | ✅ 这是它的本职 |
| Pillow | ⚠️ 能画，但要自己算每个文字块的位置与换行 |

这与 [ADR 0002](decisions/0002-json-as-intermediate.md) 否掉"HTML 中间层"是同一件事的两面——**Remotion ≈ 无头浏览器 + 帧驱动 + 编码**。

**岔路口在 [ADR 0003](decisions/0003-remotion-as-renderer.md)**：

```
要不要用真正的排版引擎画画面？
  ├── 要 → 需要浏览器（Remotion / Playwright / Puppeteer）
  └── 不要 → 不需要浏览器，但要自己写排版引擎（ffmpeg + Pillow）
```

### 4.7 浏览器运行时的获取与失败处理

| 项 | 做法 |
|---|---|
| 获取顺序 | ① 系统已有的 Chrome / Chromium → ② `npx remotion browser ensure` 下载 |
| 何时检查 | **首次渲染之前**，不是安装时 |
| 缺失时的行为 | 返回结构化引导，**不是崩溃** |
| 网络 | **仅获取需要网络**。渲染本身全本地，符合"分析 + 渲染不需要网络"的非功能要求 |

**它不是插件加载的硬条件。** 缺浏览器时：

| 阶段 | 能否工作 |
|---|---|
| 插件加载 | ✅ |
| M1 分析 / M2 素材 / M3 写稿 | ✅ |
| M4 渲染 | ❌ 直到有浏览器 |

**所以"要不要装浏览器"的门槛设在渲染那一步，不设在整个插件。** 这与 TTS 密钥的处理同构（缺 key 不影响分析，只影响配音）。

---

## 五、非功能性要求

| 维度 | 要求 | 说明 |
|---|---|---|
| 确定性 | 同一讲稿 + 同素材 → 逐帧一致 | 渲染阶段不得有任何模型调用或随机性 |
| 增量 | 源文件未变则跳过重算 | 素材按 mtime + hash 判定 |
| 规模 | 21 万文件目录不 OOM | 靠默认排除 + `maxFiles` 截断 |
| 离线 | 分析 + 渲染不需要网络 | 仅 TTS 与叙事层需要 |
| 隐私 | **不做承诺**（ADR 0006）。读取例外仅密钥类文件 | 叙事层会把内容送进模型上下文；密钥文件不读（ADR 0007） |
| 可中断 | 任意阶段可中断后续跑 | 素材与音频逐文件落盘 |

---

## 六、风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| Office 转图质量差 | 演示画面不可用 | 优先直接渲染（Pillow）而非转 PDF；必要时用 LibreOffice |
| `shiki` 体积大 | 安装负担 | 退路：`highlight.js` 或等宽字体 + 简单着色 |
| 容器型目录切分不准 | 视频结构混乱 | 切分结果写进 JSON 供人工调整，不做黑盒自动化 |
| 大目录分析慢 | 体验差 | 默认排除 + 并行遍历 + 进度输出 |
| 自然语言风格解析失败率高 | 用户困惑 | `style.unresolved` 明确报错，不静默忽略 |
| 密钥随内容外传 | 密钥进模型上下文 | 按文件名排除 + `stats.secrets` 审计（ADR 0007）。**不做内容检测**，判据不可能完备，靠声明与审计补偿 |
| **PyMuPDF 不在 DSH 捆绑 Python 里** | PDF 逐页转图不可用 → 需求 R5 的 pdf 一类缺演示画面 | 见下方「PDF 提取的依赖缺口」 |
| 叙事质量无指标 | 无法判断讲稿好坏 | 先人工评审；M3 验收标准待定（见 [ROADMAP.md](ROADMAP.md#已识别的坑)） |

#### PDF 提取的依赖缺口（已实测）

[SPEC-data-format.md](specs/SPEC-data-format.md) 与 [rd/TTS-适配调研.md](rd/TTS-适配调研.md) 多处写着「`PyMuPDF` 已装」，**实测结果与此不符**：

| 环境 | `fitz`(PyMuPDF) | 其他 |
|---|---|---|
| **DSH 捆绑 Python** | ❌ 无 | ✅ `python-docx` / `python-pptx` / `openpyxl` / `Pillow` / `numpy` / `pandas` / `lxml` |
| **系统 python3** | ✅ PyMuPDF 1.26.5 | 未逐项核对 |
| `pdftoppm`（poppler） | ❌ 未安装 | — |

**影响**：需求 R5 要求 pdf 一类有演示画面，而渲染 PDF 是那条路的关键步骤。

**三条出路**（第一版选一条，M2 决定）：

| 方案 | 代价 |
|---|---|
| 用系统 python3（但它有 PyMuPDF） | 违反"用 DSH 捆绑 Python"的既定策略；且系统 Python 版本未知、库不可控 |
| 把 PyMuPDF 作为可选依赖，缺失时降级 | 可接受：**PDF 元数据与首页文本仍可提取**（无需渲染），只是没有逐页图 |
| 引导安装 poppler / PyMuPDF | 引入系统依赖，与"零新系统依赖"的目标冲突 |

**注意**：这条与"零新系统依赖"的既有目标直接冲突，M2 开始前必须先解决。

---

## 七、相关文档

- [PRODUCT.md](PRODUCT.md) —— 产品定义
- [REQUIREMENTS.md](REQUIREMENTS.md) —— 需求追溯
- [specs/SPEC-pipeline.md](specs/SPEC-pipeline.md) —— 三步管线
- [specs/SPEC-data-format.md](specs/SPEC-data-format.md) —— 数据格式
- [decisions/](decisions/) —— 架构决策记录
- [conventions/](conventions/) —— 工程规范
- [ROADMAP.md](ROADMAP.md) —— 里程碑
