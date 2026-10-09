# AGENTS.md — foldercast 项目说明

给在本仓库工作的 agent：本文件只记录**项目事实**与日常操作。决策与理由都在
`docs/decisions/`（按编号递增）与 git 历史，直接去那里看，此处不复述。
全局规则在 `~/.zcode/AGENTS.md`，本文件只补充本项目的情况。

## 项目是什么

- 把任意人类可读的目录变成讲解视频的 DSH 插件。遵循的判据见
  [0001](docs/decisions/0001-minimal-agent-plugin.md)：**程序只做 agent 干不了的事**
  （契约校验、TTS、逐帧渲染、二进制转换）；探目录、读文件、数数字、判断重要性
  都是模型（DSH 主 agent）自己做。动「替模型干活」的提案前先过这条判据。
- 全部代码在 `packages/plugin/`：`src/`（工具注册、skill、设置、编排）+ `scripts/`
  （contracts / assets / renderer / voice；HTML 页面渲染接入后在 `scripts/page/`）。
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
- `<目录>/.foldercast/durations.json`：配音实测时长（`ffprobe`），程序产出、可重算；
  字数只用于字幕分配，不定时长。**节拍时刻对齐字幕**（第 i 拍随第 i 句旁白出现）。
- 贵步骤不默认跑：`render` / `voice` 都要显式传参。退出码约定：2 参数/讲稿/环境
  问题，3 缺浏览器，4 缺密钥。缺依赖降级、不阻塞（`detectDependencies` 的
  `required: false` 模型）。
- 密钥只走 `VoiceEnv.secret(ref)`（来源优先级与引用名见
  [0002](docs/decisions/0002-tts-providers.md)）；值不进日志、报告与任何 JSON 产物。

## 开发环境

- pnpm workspace；Node >= 22.19。命令：`pnpm typecheck`、`pnpm test`（渲染用例起
  无头 Chrome，串行跑）、`pnpm run check`（链接 + JSON + 示例 schema）。提交前三者都要绿。
- 直跑入口：`pnpm render <目录> [--still 秒|--check]`、`pnpm voice <目录> [--provider 引擎]`、
  `pnpm text <文件>`、`pnpm page <目录>`（HTML 页面渲染接入前的占位）。
- 测试约定：CI 只测 runner 能证明的（契约与 mock，教训见 commit `4af655d`）；
  真实 TTS 合成、听感与目检在本地做，结论落 `docs/`。测试里的 fake provider 要带
  `requiresKey: false, capabilities: []`（接口必填字段）。
- 装进 DSH：`dsh plugin --profile <profile> add dsh-foldercast`；**改过 `src/` 要重启
  DSH**（入口不热加载）。发布前 `pnpm --filter dsh-foldercast prepack`（分发入口必须是
  JS；`node_modules` 里禁止类型剥离）。
- Remotion 双许可：本项目按 Free License（个人）使用；嵌入产品对外提供需另取许可
  （README 有价格表）。
- 中断渲染后可能残留后台 Chrome（`pkill -f puppeteer_dev_chrome_profile` 清掉）。
