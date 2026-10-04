# 系统设计

技术选型、数据流、模块边界。**设计取舍的理由记录在 [decisions/](decisions/)。**

---

## 一、整体架构

**每个阶段都标了执行者**：`[脚本]` 是插件里的确定性程序，`[主 agent]` 是 DSH 的模型本身。
**阶段编号对应 [ROADMAP.md](ROADMAP.md) 的里程碑编号**（按执行顺序排，不完全是管线顺序）。

```
                    ┌─────────────────────────────────────┐
   目标目录 ────────► │  M1 analyzer              [脚本]     │
                    │  遍历 → 分类 → 筛选 → 统计            │
                    │  引用依赖图 + 密钥排除审计             │
                    │  纯确定性，不调用模型                  │
                    └──────────────┬──────────────────────┘
                                   │ foldercast.json（解读）
          ┌────────────────────────┼────────────────────────┐
          ▼                        ▼                        ▼
┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐
│ M2 assets [脚本]   │  │ M3 校验 [脚本]     │  │ M6 HTML  [脚本]    │
│ 缩略图/抽帧/转图    │  │ schema + 路径      │  │ 解读 → 静态页面    │
│ mtime+hash 增量    │  │ 枚举 + 字数        │  │ 无浏览器无 TTS     │
└─────────┬─────────┘  └─────────┬─────────┘  └───────────────────┘
          │ assets/              │ 校验规则
          │                      ▼
          │            ┌─────────────────────────────────────┐
          │            │  M5 narrate             [主 agent]   │
          └───────────►│  通读内容 → 写 scenes                │
                       │  切分（容器型目录 → 1+N 份）           │
                       └──────────────┬──────────────────────┘
                                      │ script.json（讲稿）
                       ┌──────────────┴──────────────┐
                       │  M5 评审          [subagent] │
                       │  编造 / 重点 / 遗漏枢纽       │
                       └──────────────┬──────────────┘
                                      │ 通过
                                      ▼
                    ┌─────────────────────────────────────┐
                    │  M7 render              [脚本]       │
                    │  Remotion → 静音 mp4                 │
                    └──────────────┬──────────────────────┘
                                   │
                                   ▼
                    ┌─────────────────────────────────────┐
                    │  M8 voice               [脚本]       │
                    │  TTS → 音频 + 实测时长 → 重渲染        │
                    └─────────────────────────────────────┘
```

**关键分界**：M5 之前的产物（解读、素材）与 M5 之后的产物（讲稿）性质不同 —— 前者**可重算**，后者**是创作**。删了 `assets/` 或 `foldercast.json` 都能重建，删了 `script.json` 就丢了创作。

**M5 是 agent，M3 与 M2/M6/M7/M8 是程序。** 这是 [ADR 0008](decisions/0008-plugin-first.md) 的直接结果：写稿的模型就是 DSH 主 agent，所以不需要任何 LLM 凭据配置；评审同理，起一个 subagent 即可。

**为什么 HTML 视图（M6）与校验（M3）插在管线中间**：两者都不依赖渲染与配音，能更早给出反馈——见 [ROADMAP.md 的排序原则](ROADMAP.md#排序原则)。

---

## 二、技术选型

| 层 | 选型 | 理由 | ADR |
|---|---|---|---|
| 渲染 | **Remotion** | React 组件 → 逐帧截图。`lecture-videos` 已验证 | [0003](decisions/0003-remotion-as-renderer.md) |
| 分析器 | **TypeScript**（Node 22.19+） | 与插件、渲染器同栈。遍历、分类、依赖图无外部依赖 | — |
| Office / PDF → 图 | **`dsoffice`**（`@deepseek-ai/libreoffice-kit`） | 预编译 LibreOffice 引擎，Office 与 PDF **都能直接渲染成 PNG**，不需要系统装 LibreOffice | — |
| Office / PDF 文本提取 | **`officeparser`** | 一个库覆盖 docx / pptx / xlsx / pdf / odt / rtf / csv / md / epub / tex，产出**带层级的 AST**（heading 含级别、table/row/cell、list、脚注） | — |
| 表格公式 | **`dsoffice recalculate`** | 能重算 xlsx，拿到公式的计算值（`officeparser` 也能取缓存值，但重算更准） | — |
| 语法高亮 | **shiki** | 与 Remotion 同生态，主题体系成熟 | — |
| 媒体处理 | **ffmpeg / ffprobe** | 本机已有，抽帧与实测时长都靠它 | — |
| 图片缩放 | **sips**（macOS） | 零依赖。跨平台时回退 ffmpeg | — |
| 中间格式 | **JSON** | 人和模型都能读写。解读与讲稿分为两份文件 | [0002](decisions/0002-json-as-intermediate.md) |

### 2.1 两个文档工具的分工（为什么两个都要）

`dsoffice` 与 `officeparser` **不重叠**，回答的是两个不同的问题：

| | `officeparser` | `dsoffice` |
|---|---|---|
| **回答什么** | 这份文档**说了什么** | 这份文档**长什么样** |
| **产出** | AST：`heading`（含级别）/ `table` / `list` / 脚注 | **PNG 逐页图**、PDF、重算后的 xlsx |
| **方向** | 文档 → 文本 | 文档 → 图像 |
| **技术** | 纯 JS（`pdfjs-dist`、`@xmldom/xmldom`） | LibreOffice 编译的原生引擎 |

**`officeparser` 没有渲染能力**——它的输出格式只有 DOCX / ODT / LaTeX / Markdown / HTML / CSV / RTF / PDF / EPUB / Plain Text / RAG Chunks，**没有图片**。而 `document` 场景类型要的是**页面图**（`pages: ["assets/report_p1.png", …]`），所以 `dsoffice` 不可替代。

**两者结合才有「指着画面讲」**：

```
officeparser  →  H1「年度总结」、H2「营收」、H2「成本」…
dsoffice      →  这份文档渲染成 12 页 PNG
                        ↓
              讲「营收」时画面停在第 3 页，并知道这一节在哪
```

**已知边界**：`officeparser` 给文本结构，`dsoffice` 给页面图，**两者的分页不一定对得上**（LibreOffice 的分页与 Word 都可能不同）。跨引用只能做到「第 N 页大概是这一节」，**不做像素级高亮**。

**唯一的重叠是 PDF 文本**（两者都能读 PDF）。不冲突：转成图仍然只有 `dsoffice` 能做。

### 2.2 用户要下载什么（体积预期）

分三个时点，**多数用户实际只需要第一个**：

| 时点 | 下载什么 | 体积 |
|---|---|---|
| **装插件** | npm 包：插件本体 + `officeparser` + Remotion + `shiki` + `libreoffice-kit` | ~**75 MB**（tarball）。已装过 DSH 的机器上，引擎可能从缓存复用 |
| **首次渲染** | 浏览器。**系统已有 Chrome / Edge 则零下载** | 0 或 150–300 MB |
| **用 TTS** | 云端合成或系统本地合成，**无下载**（`say` 是 macOS 自带） | 0 |

**磁盘占用**（解包后）：npm 依赖约 190 MB，浏览器另计。

分项（解包后）：

| 包 | 解包 | 何时需要 |
|---|---|---|
| `libreoffice-kit-darwin-arm64`（引擎） | **153 MB** | M2 素材（Office / PDF 转图） |
| `officeparser`（含 `pdfjs-dist` 35 MB） | 31 MB | M1 分析（文本提取） |
| Remotion 三件套 + `remotion` | 5 MB | M7 视频 |
| `shiki` | 0.6 MB | M2 代码高亮 |
| `libreoffice-kit`（主包） | 0.3 MB | 同上 |

**平台只装一个引擎**：引擎是 `optionalDependencies`（`darwin-arm64` / `darwin-x64` / `win32-x64` / `win32-arm64` / `wasm`）。

**关于复用**：本机 DSH 已带同一引擎（实测 147 MB，在 `app.asar.unpacked` 里）。**插件能否复用那份未验证**——pnpm 的内容寻址存储会避免重复下载同一个 tarball，但那只覆盖 DSH 自己用 pnpm 装过的情况。

**引擎的能力边界**（官方声明）：

- **不保证与 Microsoft Office 或另一引擎的输出完全一致**。字体度量差异仍可能改变换行与分页
- 不捆绑字体集合，运行时加载部署环境提供的字体；`missingFonts` 报告声明了但不可用的字体族
- 支持二进制 Office 97–2003（OLE 复合文档），不接受改了后缀的 RTF/HTML 或 `.wps`

### 2.3 许可清单

| 组件 | 许可 | 对我们的约束 |
|---|---|---|
| **Remotion** | 双许可：个人与 ≤3 人公司免费；4 人以上公司需付费 | ⚠️ **必须在 README 里声明**，用户自行判断。见 [ADR 0003 附注](decisions/0003-remotion-as-renderer.md) |
| **`@deepseek-ai/libreoffice-kit`** | **MPL-2.0** | 文件级 copyleft。我们只调用、不修改其文件，**自己的代码不受影响**；**再分发要带它的 LICENSE / NOTICE**（包内已有） |
| Chromium / Chrome | BSD 系 | 无。**我们不分发它**（用系统的或让 Remotion 下载） |
| React | MIT | 无 |
| ffmpeg | LGPL / GPL（视编译选项） | 用系统的，不分发 |
| `@deepseek-ai/*`（DSH 运行时） | 见其各自 LICENSE | 声明 peer 依赖，不打包 |

### 明确不引入的依赖

| 不用 | 替代 | 原因 |
|---|---|---|
| `pdftoppm` / poppler | `dsoffice` | 少一个系统依赖 |
| `PyMuPDF` | `dsoffice` | **不在 DSH 捆绑 Python 里**（已实测），而 `dsoffice` 能渲染 PDF |
| **Python 本体** | 全 TypeScript | 当初选它是为了 Office/PDF 库，这两块现在都是 Node 的；留它等于为一个功能维护第二套工具链 |
| `python-docx` / `python-pptx` / `openpyxl` | `officeparser` | 一个库覆盖三种格式，且带层级结构 |
| 系统 `LibreOffice` | `libreoffice-kit` 的预编译引擎 | 不需要用户装；引擎随 npm 包分发 |
| `moviepy` | `ffmpeg` + Remotion | 多一层抽象，且我们有 Remotion |
| 数据库 | 文件系统 | 无状态，JSON 即状态 |
| Web 框架 | 无 | 第一版是 DSH 插件 |

---

## 三、模块边界

```
packages/
  plugin/                     DSH 插件（第一版唯一的入口，也是全部代码）
    ├── (npm 包根)             工具注册、Config schema、skill、locale
    └── scripts/
        ├── contracts/        两个 JSON 契约的 TypeScript 类型，两侧共用
        ├── analyzer/          TypeScript：目录 → 解读
        └── renderer/          TypeScript + Remotion：讲稿 + 素材 → 视频
styles/                        风格预设（数据，非代码）
docs/                          文档
examples/                      示例
scripts/                       仓库工具（与上面的 scripts/ 无关）
```

**编排层是 DSH 主 agent，不是代码。** 三步管线的驱动者：

| 步骤 | 谁做 |
|---|---|
| ①-1 分析 | 主 agent 调 `scripts/analyzer/` |
| ①-2 写稿 | **主 agent 自己**（读解经 + 通读内容） |
| ② 视频 | 主 agent 调 `scripts/renderer/` |
| ③ 配音 | 主 agent 调脚本 |

**`analyzer` 与 `renderer` 互不依赖**，耦合点是 `contracts/` 里的两个数据契约类型——对应 `foldercast.json`（解读）与 `script.json`（讲稿）。
这样两边各自可测：分析器可以对任意目录独立跑，渲染器可以拿手写讲稿独立跑。

**`scripts/` 之下分子目录已定**（2026-10-04）：`analyzer/` 与 `renderer/` 分开，因为要让「两侧互不依赖」这条边界在目录结构上可见；两侧都要用的类型放 `contracts/`，否则 analyzer 就得依赖 renderer（见 [coding.md](conventions/coding.md#类型定义的位置)）。

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
| M1 分析 / M2 素材 / M3 校验 / M5 写稿 / M6 HTML 视图 | ✅ |
| M7 渲染 | ❌ 直到有浏览器 |

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
| Office 转图与原文分页不一致 | 演示画面与用户预期不符 | `dsoffice` 官方声明**不保证与 Microsoft Office 完全一致**（字体度量差异会改变换行与分页）。README 里写明，不承诺逐页相同 |
| `shiki` 体积大 | 安装负担 | 退路：`highlight.js` 或等宽字体 + 简单着色 |
| 容器型目录切分不准 | 视频结构混乱 | 切分结果写进 JSON 供人工调整，不做黑盒自动化 |
| 大目录分析慢 | 体验差 | 默认排除 + 并行遍历 + 进度输出 |
| 自然语言风格解析失败率高 | 用户困惑 | `style.unresolved` 明确报错，不静默忽略 |
| 密钥随内容外传 | 密钥进模型上下文 | 按文件名排除 + `stats.secrets` 审计（ADR 0007）。**不做内容检测**，判据不可能完备，靠声明与审计补偿 |
| **`officeparser` 是最新引入的依赖** | 文本提取质量未验证 | M2 里验证：对真实 docx/pptx/xlsx/pdf 各跑一次，比对提取出的标题层级与表格是否可用。不满意可退回分开用 `mammoth` + `exceljs`（已查证可用） |
| 叙事质量无指标 | 无法判断讲稿好坏 | 两层验收：M3 管机器能查的（路径、枚举、字数），M5 的评审 agent 管语义（编造、重点、遗漏）。评审 agent 自身需人工抽查 |

#### PDF 提取的依赖缺口（已实测，已解决）

> 本节是**当时的实测记录**，保留它是因为「为什么不用 PyMuPDF」需要证据。当时评估过走 Python，**现已全部移除，项目不含任何 Python 依赖**（[coding.md](conventions/coding.md#一语言与运行时)）。

原先文档多处写着「`PyMuPDF` 已装」，**实测与此不符**：

| 环境 | `fitz`(PyMuPDF) | 其他 |
|---|---|---|
| DSH 捆绑 Python | ❌ 无 | ✅ `python-docx` / `python-pptx` / `openpyxl` / `Pillow` / `numpy` / `pandas` / `lxml` |
| 系统 python3 | ✅ 1.26.5 | 未逐项核对 |
| `pdftoppm`（poppler） | ❌ 未安装 | — |

**解决方式**：不用 PyMuPDF，改用 **`dsoffice`**（DeepSeek 自己的 `@deepseek-ai/libreoffice-kit`，预编译 LibreOffice 引擎）。

```sh
dsoffice render --input report.docx --output-dir pages --pages 1   # Office → PNG
dsoffice render --input paper.pdf   --output-dir pages             # PDF → PNG
dsoffice recalculate --input budget.xlsx --output recalc.xlsx      # 表格公式重算
```

**它替换了三件事**：Office 转图、PDF 逐页转图、xlsx 公式求值。**文本提取走 `officeparser`**（一个 Node 库覆盖全部格式，产出带层级的 AST）。

**PDF 的文字提取也由 `officeparser` 顺带解决**（v8 起它对带标签 PDF 产出真正的 heading 层级与表格节点），所以不需要为此单独决策。

---

## 七、相关文档

- [PRODUCT.md](PRODUCT.md) —— 产品定义
- [REQUIREMENTS.md](REQUIREMENTS.md) —— 需求追溯
- [specs/SPEC-pipeline.md](specs/SPEC-pipeline.md) —— 三步管线
- [specs/SPEC-data-format.md](specs/SPEC-data-format.md) —— 数据格式
- [decisions/](decisions/) —— 架构决策记录
- [conventions/](conventions/) —— 工程规范
- [ROADMAP.md](ROADMAP.md) —— 里程碑
