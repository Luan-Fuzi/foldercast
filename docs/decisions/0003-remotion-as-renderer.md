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

## 附注（2026-10-04 补：许可约束与运行时体积）

**决策本身不变**（用 Remotion），但补两条此前没记录的事实。

### 许可

Remotion 是**双许可**，不是纯开源：

| 许可 | 适用 | 价格 |
|---|---|---|
| Free License | 个人，或**最多 3 人的公司** | $0，含无限商业使用 |
| **Remotion for Creators** | 4 人及以上公司，为自己的组织做视频（含用 AI agent） | $25/月/座 |
| **Remotion for Automators** | **构建视频创作工具**（视频编辑器、prompt-to-video 应用、嵌入 Player） | **$0.01/次渲染，$100/月最低** |

**对本项目的含义**：

- **发布 foldercast 不需要我们付费**——我们是个人开发者，落在 Free License
- **用户需要自行判断**：拿它给 4 人以上的公司做视频 → Creators 档；把它嵌进自己的产品卖 → Automators 档
- **必须写进 README**，否则等于把法律风险默默转嫁给用户
- 若 foldercast 自身要商业化，**自动进入 Automators 档**

### 运行时体积

Remotion 本身很小（npm 包合计约 5 MB），**大头是它需要的浏览器**（150–300 MB）。这不是 Remotion 的锅——"用 CSS 排版"这条路必然要一个排版引擎，见 [SYSTEM-DESIGN.md §4.6](../SYSTEM-DESIGN.md#46-为什么必须有浏览器c4)。

加上 Office 侧的 `libreoffice-kit` 引擎（147 MB），**最终产品带两个几百 MB 量级的运行时**。这一点应写进 README 的安装预期。

### 实现记录（2026-10-05 补：M7 落地后实测到的四件事）

决策不变（用 Remotion），但下面这些是**只有真跑起来才知道**的，改代码时别再踩：

1. **`file://` 资源读不了。** 渲染时 bundle 挂在 `http://localhost:<端口>` 上，页面里的
   `<img src="file://…">` 被 Chrome 按跨源拦掉，报 `Error loading image with src: …`，**整片渲染
   直接失败**。所以素材图片在渲染前读成 `data:` URI（先按画面需要缩小）。`<video>` 不受这条限制。
2. **浏览器侧不能碰 `node:*`。** 计划模块原来直接 import 内联实现（要 `node:child_process`），
   webpack 报 `UnhandledSchemeError`。类型与实现拆开，并用可达 import 图的测试钉住。
3. **并发会让画面不可复现。** 同一份讲稿连渲三次，默认并发下帧 sha256 互不相同（差异集中在
   片头一百多帧，疑似 Chrome 字形缓存状态不同）；**`concurrency: 1` 时两次渲染的 mp4 字节完全相同**。
   所以确定性是默认值，速度是可选项。
4. **`renderFrames` 的 `frameRange` 会画错帧。** 最小复现：组合只显示 `useCurrentFrame()`，
   `frameRange: [100,103]` 时第 101、102、103 帧分别画出第 101、100、102 帧的内容（小范围正常）。
   逐帧核对只能走整片渲染。

## 一个仍然开放的问题

**渲染后端是否可替换**。纯 ffmpeg + Pillow 不需要浏览器、没有许可约束，但要做手写排版（见本文「备选方案」的代价表）。

现状：**契约与后端无关**（`script.json` 里没有帧号、spring 参数等 Remotion 特有字段），所以将来加后端只需写渲染器，契约不用动。**第一版不做双后端**，但守住"契约不出现后端特有字段"这条规则。

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
