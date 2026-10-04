# 「仓库 → 介绍视频」竞品调研

> 调研日期：2026-10-04
> 调研目的：判断「为某个仓库/代码库生成可定制介绍视频」这条赛道是否已有占位者，以及我们该补位、差异化还是放弃。
> 数据来源：GitHub REST API、npm registry API、各项目 README 一手抓取。所有 star / 时间戳均为当日实测值。

---

## TL;DR

1. **赛道几乎空的。** 全网能同时做到「输入是代码库」+「输出是视频」的项目只有 2 个（`paperview`、`repo2reel`），合计 12 star。其余全是「输入是 prompt/主题/PR/HTML」的邻近品类。
2. **唯一真正的对手是 `paperview`**（9 star，2026-06-16 后停更）：架构选型跟我们想的几乎一致——本地 Remotion 渲染 + 本地 Kokoro TTS + 可编辑 JSON 分镜 + 时长可控。它验证了方向，但**没做完**，也**没做起来**。
3. **五档定制需求，没有一家做全。** 最接近的 `paperview` 覆盖「时长可控」「配音可换」「分镜可改」，但 **TTS 模型不可配置**（写死 Kokoro）、**字幕不是一等公民**、**艺术风格不可配**（单一模板）。
4. **结论：值得做，但不要正面重做 `paperview`。** 差异化支点应该放在它和所有竞品都没做的那一列：**可配置的 TTS 供应商 / 明确的一等字幕管线 / 可切换的艺术风格主题**。这三项恰好是 DSH 插件生态最擅长承载的形态。
5. **不要碰 `gitreel` 的定位**（PR 影评式短片）——它形态更成熟（Remotion + Kokoro + agent skill 分工清晰），但它是「PR diff 视角」，跟我们「仓库导览视角」不冲突，可以借鉴其工程分层。

---

## 一、竞品全表（按与目标形态的距离排序）

维度说明：「仓库输入」= 能否直接吃一个 repo/codebase；「视频输出」= 产物是不是视频（而非网页/PPT）。

| 项目 | ★ | 建仓 / 最后 push | 仓库输入 | 视频输出 | 一句话定性 |
|---|---|---|---|---|---|
| [ssrajadh/paperview](https://github.com/ssrajadh/paperview) | **9** | 2026-06-02 / **2026-06-16** | ✅ 论文 + 代码库 | ✅ | **最直接对手。已停更近 4 个月** |
| [Sweatha1052004/repo2reel](https://github.com/Sweatha1052004/repo2reel) | 3 | 2025-07-20 / 2025-08-26 | ✅ | ✅ | Flask Web 形态，一年前停更，Edge TTS + MoviePy |
| [stuinfla/Repo-Explainer](https://github.com/stuinfla/Repo-Explainer)（npm `explainmyrepo`） | **62** | 2026-06-19 / 2026-09-20 | ✅ | ❌ **静态网页** | 赛道内最知名者，但**不是视频**，是「讲解页」 |
| [mohasarc/gitreel](https://www.npmjs.com/package/gitreel) | — | npm 2026-06-11，仅 1 个版本 | ❌ PR diff | ✅ | Remotion + Kokoro 本地，**PR 预告片**视角 |
| [Mng-dev-ai/explainer-video](https://github.com/Mng-dev-ai/explainer-video) | 19 | 2026-05-27 / **2026-05-27** | ❌ 主题 | ✅ | 建仓即停更，从未维护 |
| [vakovalskii/nd-video-studio](https://github.com/vakovalskii/nd-video-studio) | 21 | 2026-09-29 / 2026-09-30 | ❌ HTML | ✅ | HyperFrames→MP4，依赖 NeuralDeep 模型 |
| [centraltowerlabs/diagram-tour](https://github.com/centraltowerlabs/diagram-tour) | 6 | 2026-04-28 / **2026-04-28** | ✅ 代码库 | ✅ | 建仓即停更，Claude Skill |
| [theBstar/shipreel](https://github.com/theBstar/shipreel) | 2 | 2026-09-30 / 2026-09-30 | ❌ PR | ✅ | 4 天新，Mac 零配置 |
| [shashankswe2020-ux/demo-reel](https://github.com/shashankswe2020-ux/demo-reel) | 0 | 2026-09-29 / 2026-10-03 | ✅ repo/网站/录屏 | ✅ | 9:16 竖版营销号方向，自称 51 道质量门 |
| [Neelshah1810/Claude-Video-Skills](https://github.com/Neelshah1810/Claude-Video-Skills) | 5 | 2026-10-02 / 2026-10-03 | ❌ 主题 | ✅ | 11 个动效技能，HTML+MP4 |
| [authrain-cloud-abdullahformuli/explainer-video-skills](https://github.com/authrain-cloud-abdullahformuli/explainer-video-skills) | — | — | ❌ 主题 | ✅ | 偏年终总结/动画图解 |
| [Alisa0808/vox-director](https://github.com/Alisa0808/vox-director) | **2118** | 2026-08-11 | ❌ 主题 | ✅ | 赛道内唯一高星，但吃 topic 不吃 repo，且绑 Atlas Cloud |
| [Vincentwei1021/anything2explainer](https://github.com/Vincentwei1021/anything2explainer) | — | 抓取时 404 | ❌ 主题 | ✅ | 已消失或转私有 |

**星数分布的关键事实**：整个「repo→video」品类最高的 9 star。而话题内无关项目（`vox-director` 2118★、`open-design` 99k★）说明**流量存在，只是没人用正确形态接住**。

---

## 二、质量评估：对五档配置需求的覆盖度

✅ 支持 ／ ⚠️ 部分 ／ ❌ 无

| 项目 | ① TTS 模型可配 | ② 视频风格 | ③ 字幕 | ④ 艺术风格 | ⑤ 时长 | 致命短板 |
|---|---|---|---|---|---|---|
| **paperview** | ❌ 写死 Kokoro | ⚠️ 单一模板 | ⚠️ 不明确 | ❌ 不可配 | ✅ `2 minutes` 等参数 | 停更；风格/字幕/音色不可换 |
| **gitreel** | ❌ 写死 Kokoro | ⚠️ Fireship 风 | ❌ | ⚠️ 场景原语可组合 | ✅ 短/长两档 | 只吃 PR diff，不做仓库导览 |
| **repo2reel** | ❌ 写死 Edge TTS | ⚠️ 固定版式 | ❌ |❌ |❌ | 停更一年，Flask 单体 |
| **Repo-Explainer** | — | — | — | — | — | **根本不是视频** |
| **vox-director** | ❌ | ❌ 风格写死 | ❌ | ❌ 纸拼贴写死 | ❌ | 吃 topic；绑 Atlas Cloud 付费 |
| **nd-video-studio** | ⚠️ 单一 AI 旁白 | ⚠️ | ❌ | ⚠️ | ❌ | 吃 HTML 不吃 repo |
| **demo-reel** | ⚠️ | ⚠️ 竖版营销 | ✅ 提及 | ⚠️ | ⚠️ | 0 star，太新，营销号定位 |

### 逐项差距分析

**① TTS 模型可配置 —— 全场空缺。** 每一个项目都硬绑单一引擎：`paperview`/`gitreel`→Kokoro，`repo2reel`→Edge TTS，`vox-director`→Atlas Cloud。没有任何一家让你在 `edge-tts` / `Kokoro` / `Index-TTS2` / `CosyVoice` / OpenAI 兼容云端之间切换。这是最干净的空位。

**② 视频风格 —— 基本等于写死。** `paperview` 是单一视觉模板，`vox-director` 是纸拼贴，`gitreel` 是 Fireship 快剪。没有「同一份分镜换一套版式模板」的抽象。

**③ 字幕 —— 生态最薄弱的一环。** 只有 `demo-reel` 的营销文案提到字幕。整个 DSH 插件生态里 `topic:dsh-plugin+subtitle` 只有 **6 个仓库**。这不是「有人做了但做得差」，是**几乎没人做**。

**④ 艺术风格 —— 没有一家把它当成可配置维度。** 都是「一套设计定终身」。配色/字体/质感/动效节奏作为主题 token 被继承覆写，是空白。

**⑤ 时长 —— paperview 唯一做对的。** 它的 `/ppv:gen <repo>, 2 minutes, focus on the architecture` 正是「时长 + 重点」的自然语言参数化，且有 `scenes.json` 可编辑、`ppv validate` 免渲染预检、`ppv tts` 产出 `durations.json` —— **这套分层值得直接借鉴**（分镜 JSON 为中枢，TTS 产出时长清单，渲染确定性可复现）。

---

## 三、结论：该不该做

### 判断：**值得做，但必须差异化**

理由三条：

1. **没有既好又知名的占位者。** 唯一架构对路且做了一半的 `paperview` 只有 9 star、停更 4 个月。有知名度的是 `Repo-Explainer`（62★），但它解决的是另一个问题（静态讲解页，不是视频）——它甚至反向证明了「仓库可读性」这个需求成立，只是用错了形态。
2. **五档配置里有两档是全场空白**（TTS 可配、艺术风格可配），一档是生态荒漠（字幕）。这不是跟别人抢饭吃，是补没人站的位。
3. **形态契合 DSH。** 现有竞品清一色是 Claude Code / Codex skill，**没有一个是 DSH 插件或 DSH skill**。而 DSH 的插件机制（`dsh.bundle` + `cordis.patch.yml` + 设置页 slot）天然适合承载「TTS 供应商选择」「艺术风格主题切换」这类需要配置 UI 的能力。

### 建设性风险提示

- 这个品类的**用户量天花板可能不高**（开发者不常需要给自己的仓库做视频），所以别按「做产品」投入，按「做一个自己顺手、顺便开源能收 star」投入。
- 别重蹈 `paperview` 的覆辙：它技术上没做错什么，但停更了。**它的死因很可能是「每加一个风格都要改代码」**——这恰好是我们可以用「主题 token + 分镜 schema」架构规避的。
- 渲染栈选择上，Remotion（`paperview`/`gitreel` 都用）画质与动效上限高，但引入 React + Chromium 依赖；本机 ffmpeg + Pillow 更轻但动效受限。**建议分两层**：轻量路径先跑通，Remotion 作为可选高画质后端。

### 差异化定位（一句话）

> `paperview` 做的是「论文/代码库 → 固定风格解说视频」；
> 我们要做的是「仓库 → **可换音色、可换版式、可换艺术风格、字幕可控、时长可控**的解说视频」，且**原生长在 DSH 里**。

不做的事（避免重合与冲突）：
- 不做 PR diff 影评短片（`gitreel` 的地盘）
- 不做竖版短视频营销号（`demo-reel` 的地盘）
- 不做静态讲解页（`Repo-Explainer` 的地盘）
- 不做文生视频素材（`vox-director`、`dsh-video-gen` 的地盘）

---

## 四、可复用与可借鉴

| 用途 | 现成资产 | 怎么用 |
|---|---|---|
| 分镜中枢 + 时长预检的思路 | [`paperview`](https://github.com/ssrajadh/paperview) | 抄它的 `scenes.json` + `validate`/`tts`/`render` 三段式 CLI 分层 |
| Remotion 接入 DSH | [`dsh-remotion`](https://github.com/STARDUSTLC666/dsh-remotion) | 官方 Remotion 技能移植，含 captions 组件 |
| ffmpeg 工具薄封装 | [`dsh-ffmpeg`](https://github.com/STARDUSTLC666/dsh-ffmpeg) | 10 个视频工具，含 subtitle 参数 |
| HTML 视频创作 | [`dsh-hyperframes`](https://github.com/STARDUSTLC666/dsh-hyperframes) | HeyGen HyperFrames 20 个技能 |
| TTS 供应商抽象 | [`@memef1f1y/dsh-plugin-tts`](https://www.npmjs.com/package/@memef1f1y/dsh-plugin-tts) | 已实现 Edge TTS / RVC / Index-TTS2 / CosyVoice / Google Cloud 五引擎切换，**可直接参考其供应商抽象层设计** |
| 字幕工作流 | [`subtitle-studio`](https://github.com/JohnXu22786/subtitle-studio) | SRT/VTT 解析、双语合并、断点续跑 |

---

## 五、本机渲染栈现状（实测）

| 能力 | 状态 | 备注 |
|---|---|---|
| ffmpeg | ✅ 9.0.2 | libx264 / h264_videotoolbox / aac / libmp3lame 齐备 |
| ⚠️ libass / freetype | ❌ **未编译进 ffmpeg** | **`subtitles` 与 `drawtext` 滤镜均不可用**，ffmpeg 无法直接烧字幕 |
| Pillow | ✅ | 逐帧绘制画面与字幕的可行替代 |
| macOS `say` | ✅ | 含中文音色（Mei-Jia、Eddy、Flo 等） |
| edge-tts | ❌ 未装 | `pip install edge-tts`，免密钥 |
| Kokoro | ❌ 未装 | `paperview`/`gitreel` 用的本地 TTS |
| Remotion | ❌ 未装 | 需 `npx @remotion/cli` + Chromium |
| Node | ✅ v26.8.1 | 满足 DSH 插件 ≥22 要求 |

> **最关键的实测结论**：本机 Homebrew ffmpeg **不带 libass**，所以「ffmpeg 烧字幕」这条路走不通。硬字幕必须走 **Pillow 逐帧绘制**，或改用 Remotion 的 captions 组件，或输出**软字幕**（mkv 内挂 SRT，播放器可开关）。这直接决定了需求 ③ 的实现选型。

---

## 附：调研方法与口径

- star / 建仓时间 / 最后 push：GitHub REST API `/repos/{owner}/{repo}`，2026-10-04 实测。
- npm 包元数据与月下载量：`registry.npmjs.org` 与 `api.npmjs.org/downloads/point/last-month`。
- 竞品能力判定：抓取各项目 README 原文关键词交叉比对，未跑通其代码；标 ⚠️ 者为 README 未明确声明、需实测确认。
- `Vincentwei1021/anything2explainer` 在搜索结果中存在但 API 返回 404，已标注为不可达。
- 未做：实际安装运行任何一个竞品；因此「渲染质量」维度未纳入评分，仅评「能力覆盖度」。
