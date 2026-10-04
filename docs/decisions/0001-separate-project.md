# 0001 · 独立项目，不与 lecture-videos 融合

- 状态：已接受
- 日期：2026-10-04
- 决策者：项目作者

## 背景

同作者已有一个可工作的 Remotion 视频管线 [`lecture-videos`](../../../qiuzhao202608/lecture-videos)（数学讲义讲解视频），其中若干实现是通用的：

- `split_subs()`：按标点切分字幕、按字数分配时长
- `measure_duration()`：`ffprobe` 实测音频时长
- `Caption` / `Page` 组件与 `calculateMetadata` 的时长驱动时序
- `theme.ts` 的瑞士风格视觉体系

而 foldercast 要做的是「任意目录 → 讲解视频」。两者共享技术栈（Remotion + TTS），因此存在融合的诱惑。

作者明确要求：「首要目的应该是新建一个工作区，不要跟现有的工作区融合在一起。」

## 决策

**foldercast 是独立项目、独立仓库、独立运行。不与 `lecture-videos` 共享代码。**

可以**借鉴实现**（复制代码并在注释标注来源），但不做跨仓库 import。

## 理由

1. **两者的输入模型根本不同。** `lecture-videos` 是「讲稿驱动」——人写 `content/*.json`，工具负责渲染。foldercast 是「目录驱动」——工具负责分析目录并生成讲稿。前者是渲染器，后者是分析器 + 渲染器。

2. **耦合会双向冻结演进。** 跨仓库路径依赖意味着任何一边重构都要考虑另一边。`lecture-videos` 已经产出七讲样片，处于可用状态，不该被一个实验性项目拖住。

3. **可复用的是设计，不是代码。** 真正值钱的是「字幕按标点切分再按字数配时」「时长以实测音频为准」这些**判断**，它们是几行逻辑，复制成本极低。

4. **循环依赖风险。** 若将来 foldercast 需要 lecture-videos 的渲染组件、而 lecture-videos 又想用 foldercast 的分析器，跨仓库依赖会变成网状。

## 后果

**正面**：
- 两边独立演进、独立发布、独立废弃
- foldercast 可以自由做破坏性重构
- 不存在「改 A 弄坏 B」

**负面**：
- 字幕切分、TTS 适配等逻辑存在重复实现
- 修 bug 要修两处

**缓解**：等 foldercast 稳定后（M6 完成），再评估是否抽出共享包 `@foldercast/video-kit`，届时两边都已定型，抽取性价比更高。

## 备选方案

| 方案 | 否决理由 |
|---|---|
| foldercast 作为 `lecture-videos` 的子目录 | 违背作者明确要求；且输入模型不同，会污染两者的目录结构 |
| 抽出共享包，两边都依赖 | 过早抽象。foldercast 尚未定型，抽出的接口必然会返工 |
| 直接 fork `lecture-videos` 改造 | 会背上「数学讲义」的场景假设（`formula`/`diagram`/`flashcards` 等专有场景），清洗成本高于重写 |

## 参见

- [0002 · 分镜 JSON 是单一事实来源](0002-json-as-intermediate.md)
- [SYSTEM-DESIGN.md](../SYSTEM-DESIGN.md)
