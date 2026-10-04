# 0003 · 用 Remotion 做渲染器

- 状态：已接受
- 日期：2026-10-04
- 决策者：项目作者

## 背景

需要把分镜 JSON + 素材渲染成 mp4。候选方案：

1. Remotion（React 组件 → 逐帧截图 → 编码）
2. 纯 ffmpeg（`ffmpeg` 滤镜图 + Pillow 逐帧绘制）
3. Manim（Python 数学动画库）
4. 各家文生视频 API

本机已实测的环境约束：

- ffmpeg 9.0.2，有 libx264 / h264_videotoolbox / aac / libmp3lame
- **ffmpeg 未编译 libass/freetype** → `subtitles` 与 `drawtext` 滤镜不可用
- 有 Pillow，无 moviepy / manim / cairo

同作者的 `lecture-videos` 已用 Remotion 产出七讲样片。

## 决策

**用 Remotion 作为渲染器。**

## 理由

1. **已验证。** `lecture-videos` 用同一技术栈产出了七讲可用的视频，包含 KaTeX 公式、手绘 SVG 动画、图片场景与字幕。风险已被实测排除。

2. **版式能力强。** 需求要求展示结构树、图片墙、视频片段、Office 分页、代码高亮 —— 这些需要真正的布局引擎（flexbox / grid / 字体排版）。CSS 直接可用。

3. **字幕必须在渲染层画（本机硬约束）。** ffmpeg 缺 libass，`subtitles`/`drawtext` 不可用。Remotion 用 React 组件画字幕，字体、描边、换行完全可控，不依赖系统字体配置。

4. **帧驱动模型适配「按音频时长对齐」。** Remotion 的 `Sequence` + `calculateMetadata` 天然支持「每段时长由外部数据决定」——这正是配音回填时长后重渲染所需要的。

5. **动效能力。** `interpolate` / `spring` / `Easing` 提供声明式动画，手写 ffmpeg 滤镜图做不到。

## 后果

**正面**：
- 版式与动效上限高
- 字幕完全可控
- 可复用 `lecture-videos` 的组件设计经验
- Remotion Studio 提供免费实时预览

**负面**：
- 引入 Node + React + 无头浏览器依赖，安装体积大
- 需要本机 Chrome（见下）
- 渲染速度受浏览器截图限制，长视频较慢

**已识别的具体问题**（详见 [ROADMAP.md](../ROADMAP.md#已识别的坑)）：

- **必须指定本机 Chrome。** `lecture-videos/remotion.config.ts` 里显式设置了 `setBrowserExecutable('/Applications/Google Chrome.app/...')`，注释说明原因是「当前网络下不了 Chrome Headless Shell」。foldercast 需沿用此处理，或提供 fallback 逻辑。
- **分镜必须运行时加载。** Remotion 的常规用法是静态 import 组合，但 foldercast 需要按传入路径动态加载（见 ADR 0002 与 C1 约束）。

## 备选方案

| 方案 | 否决理由 |
|---|---|
| 纯 ffmpeg + Pillow | 本机缺 libass/freetype，文本渲染受限；复杂版式要手写布局引擎；动效需手工插值。可作为降级后端，不适合作为主方案 |
| Manim | 面向数学动画，版式能力弱；中文排版支持差；需要 cairo 等额外系统依赖 |
| 文生视频 API | 明确列为非目标。我们是「讲清已有内容」而非「凭空生成画面」，且成本与可控性都不可接受 |
| HyperFrames（HTML → MP4） | 本质同类方案，但生态与文档不如 Remotion；且引入外部服务依赖 |

## 参见

- [SYSTEM-DESIGN.md](../SYSTEM-DESIGN.md)
- [0002 · 分镜 JSON 是单一事实来源](0002-json-as-intermediate.md)
