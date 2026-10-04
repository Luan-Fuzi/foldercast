# 系统设计

技术选型、数据流、模块边界。**设计取舍的理由记录在 [decisions/](decisions/)。**

---

## 一、整体架构

```
                    ┌─────────────────────────────────────┐
   目标目录 ────────► │  M1 analyzer                        │
                    │  遍历 → 分类 → 筛选 → 统计           │
                    │  纯确定性，不调用模型                 │
                    └──────────────┬──────────────────────┘
                                   │ sources / stats / manifest
                                   ▼
                    ┌─────────────────────────────────────┐
                    │  M2 assets                          │
                    │  缩略图 / 抽帧 / PDF转图 / 高亮       │
                    │  按 mtime+hash 增量重算              │
                    └──────────────┬──────────────────────┘
                                   │ assets/ + manifest.json
                                   ▼
                    ┌─────────────────────────────────────┐
                    │  M3 narrate                         │
                    │  Agent 集群通读内容 → 写 scenes       │
                    │  切分（容器型目录 → 1+N 份）          │
                    └──────────────┬──────────────────────┘
                                   │ script.json
                    ┌──────────────┴──────────────┐
                    ▼                             ▼
      ┌─────────────────────────┐   ┌─────────────────────────┐
      │  M4 render              │   │  M5 voice               │
      │  Remotion → 静音 mp4     │   │  TTS → 音频 + 实测时长    │
      │  样式 token 应用          │   │  字幕切分 + 时长分配      │
      └─────────────────────────┘   └──────────────┬──────────┘
                                                   │ durations.json
                                                   ▼
                                     按实测时长重渲染 → 成片
```

**关键分界**：M3 之前的产物（解读、素材）与 M3 之后的产物（讲稿）性质不同 —— 前者**可重算**，后者**是创作**。删了 `assets/` 或 `foldercast.json` 都能重建，删了 `script.json` 就丢了创作。

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
  analyzer/     Python。目录 → 分析结果。不依赖渲染与 TTS
  renderer/     TypeScript + Remotion。分镜 → 视频。不依赖分析器
  cli/          编排层。串起三步，处理配置与密钥
styles/         风格预设（数据，非代码）
docs/           文档
examples/       示例分镜
```

**依赖方向必须单向**：`cli → analyzer`、`cli → renderer`。
`analyzer` 与 `renderer` **互不依赖**，耦合点是两个数据契约：`foldercast.json`（解读）与 `script.json`（讲稿）。

这样做的收益：渲染器可以拿手写分镜独立跑，分析器可以对任意目录独立跑，两边各自可测。

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

优先级：环境变量 → 项目 `.<provider>_key` 文件 → 用户级 `~/.config/foldercast/credentials.json`。

**绝不经由命令行参数或聊天记录。** `.gitignore` 已含 `.*_api_key` / `.*_key` / `credentials.json` / `.env*`。

**分析器同样不读这些文件的内容**，即使叙事层已经可以通读目录。判据与审计见 [ADR 0007](decisions/0007-secret-file-exclusion.md)。

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
| 叙事质量无指标 | 无法判断讲稿好坏 | 先人工评审；M3 验收标准待定（见 [ROADMAP.md](ROADMAP.md#已识别的坑)） |

---

## 七、相关文档

- [PRODUCT.md](PRODUCT.md) —— 产品定义
- [REQUIREMENTS.md](REQUIREMENTS.md) —— 需求追溯
- [specs/SPEC-pipeline.md](specs/SPEC-pipeline.md) —— 三步管线
- [specs/SPEC-data-format.md](specs/SPEC-data-format.md) —— 数据格式
- [decisions/](decisions/) —— 架构决策记录
- [conventions/](conventions/) —— 工程规范
- [ROADMAP.md](ROADMAP.md) —— 里程碑
