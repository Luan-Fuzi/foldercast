# AGENTS.md — foldercast 项目说明

给在本仓库工作的 agent：本文件只记录**项目事实**与日常操作。决策与理由都在
`docs/decisions/`（按编号递增）与 git 历史，直接去那里看，此处不复述。
全局规则在 `~/.zcode/AGENTS.md`，本文件只补充本项目的情况。

## 项目是什么

- 把任意人类可读的目录变成讲解视频的 DSH 插件。遵循的判据见
  [0008](docs/decisions/0008-trusted-execution.md)：**模型负责理解、判断与创作；程序负责精确、重复、可复现和可验证的执行**。统计与原文提取可以由工具提供，选材和叙事仍由模型决定。
- 全部代码在 `packages/plugin/`：`src/`（工具注册、skill、设置、编排）+ `scripts/`
  （contracts / assets / renderer / page / scenecard / voice / references）。
  全 TypeScript，Node 22.19+ 直接跑 `.ts`（类型剥离），无 Python。

## 产物与契约

- `<目录>/.foldercast/digest.json`：**知识压缩产物**（0004 两阶段创作的第一站；0005 起
  excerpts 是**块级摘录** `{ file, lines, start, why }`，digest: 2），agent 写；
  校验器会查版本、引用路径、摘录真实性并抽查 `totalFiles`。只给写稿与评审的模型消费，
  渲染器不读它。
- `<目录>/.foldercast/script.json`：讲稿（`foldercast: 2`，场景带 `beats` 节拍），agent 写，
  schema 在 `docs/specs/script.schema.json`，示例在 `examples/`。场景 11 种
  （0005 加 concept / compare / flow 三个文本原生类型）。讲稿自足：引用的文件用
  相对源目录路径，必须真实存在，校验器逐条拦编造路径与编造摘录（excerpt 须是原文、
  带 `excerptStart` 行号）。校验器还查**密度比**（摘录按扫读打折计宽）、
  **摘录行数下限**与节拍-旁白对齐，file 占比过高提醒 `layout-monotony`。
- 可选 `script.visual` 保存本次美术风格与提示词（0009、0011）：瑞士风格 / 编辑设计风格 / 科技风格共用于
  视频与默认页面；提示词由写稿模型落实，不直接执行。设置默认值通过工具的
  `visualPreferences` 返回，包含设计名称、内置 `stylePrompt` 与用户补充 `prompt`；
  共用预设在 `scripts/contracts/visual.ts`。旧名称仅用于输入兼容，不改写旧讲稿。
- 自定义风格（0012）保存 `visual.style: "自定义风格"`、`name`、非空 `prompt` 与
  `baseStyle`。名称和效果交给模型，基础预设控制实际画面参数；未指定基础预设时用瑞士风格。
- `<目录>/.foldercast/durations.json`：配音实测时长（`ffprobe`），程序产出、可重算；
  字数只用于字幕分配，不定时长。**节拍时刻对齐字幕**（第 i 拍随第 i 句旁白出现）。
- 产出步骤不默认跑（0007）：`page` / `render` / `voice` 都要显式传参，校验只给结论
  不落页面、音频或视频——正式产出要求当前评审回执，`draft: true` 允许工作草稿。
  校验返回 `revision`；独立评审写完 `review.md` 后传 `reviewRevision` 记录 `review.json`。
  revision 对讲稿、digest 与直接引用文件计算内容哈希；引用目录用文件名、大小、mtime，
  digest 的文件总数抽查也参与，不覆盖所有正文或软件版本。程序核对回执与报告哈希，不解析报告结论。默认先 HTML 再视频，可 HTML-only。
  退出码约定：2 参数/讲稿/环境问题，3 缺浏览器，4 缺密钥。缺依赖降级、不阻塞
  （`detectDependencies` 的 `required: false` 模型）。
- `<目录>/.foldercast/artifacts.json`：记录产物输入版本与输出哈希；输入变化不自动重做产物。
- 配音缓存按旁白、provider、音色、风格、格式等输入判断；旁白变化后不再仅按文件存在性复用。
  `audio/cache.json` 逐场记录合成请求与音频哈希，支持断点续跑。只改画面不重合成；改讲稿 voice 配置要重跑 voice，实际请求相同时可复用。
  渲染拒绝过期、缺少新版本记录或整条音轨不完整的 durations。旧音频无缓存记录时首次重配。
- 页面与视频共享素材准备和场景数据；页面超图片内联预算时保留相对路径，不能保证单文件转发。Office / PDF 页图与视频封面引用准备产物，转发需保留相对位置。
- 主 skill 保留工作流程，创作和评审详细参考在 `scripts/references/`。
- 设置中的创作与沟通偏好通过 `creativePreferences` 交给模型（0010），共用类型在
  `scripts/contracts/creative.ts`。受众、重点、深度和视频/阅读目标分钟数用于规划，
  不直接控制渲染；模型采用的偏好、预算依据和省略范围记入 `digest.notes`。
- 密钥只走 `VoiceEnv.secret(ref)`（来源优先级与引用名见
  [0002](docs/decisions/0002-tts-providers.md)）；值不进日志、报告与任何 JSON 产物。

## 开发环境

- pnpm workspace；Node >= 22.19。命令：`pnpm typecheck`、`pnpm test`（渲染用例起
  无头 Chrome，串行跑）、`pnpm run check`（链接 + JSON + 示例 schema）。提交前三者都要绿。
- 直跑入口：`pnpm render <目录> [--still 秒|--check]`、`pnpm voice <目录> [--provider 引擎]`、
  `pnpm text <文件>`、`pnpm page <目录>`。产出 CLI 默认草稿，`--approved` 要求有效回执。
- 测试约定：CI 只测 runner 能证明的（契约与 mock，教训见 commit `4af655d`）；
  真实 TTS 合成、听感与目检在本地做，结论落 `docs/`。测试里的 fake provider 要带
  `requiresKey: false, capabilities: []`（接口必填字段）。
- 装进 DSH：从 npm 安装 `dsh-foldercast`，也可安装 GitHub Release 的 `.tgz`，具体命令见 README；**改过 `src/` 要重启
  DSH**（入口不热加载）。发布前 `pnpm --filter dsh-foldercast prepack`（分发入口必须是
  JS；`node_modules` 里禁止类型剥离）。
- Remotion 双许可：本项目按 Free License（个人）使用；不符合免费许可条件时需 Company License
  （README 有价格表）。
- 中断渲染后可能残留后台 Chrome（`pkill -f puppeteer_dev_chrome_profile` 清掉）。
