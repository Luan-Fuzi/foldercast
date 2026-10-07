# 0002 · TTS provider 层重做：弃 say，edge 默认、mimo 高配

日期：2026-10-07　状态：生效（接口已落地，实现分批接入）　关联：0001（收缩成最小 agent 插件）

## 背景

`say` 是零配置的兜底 provider，但实际听感差，弃用。这动摇不了 0001 的判据——TTS 合成
仍是「程序做的确定性重活」，换的只是引擎。同时它也是配音唯一的平台锁（macOS 独占），
弃用后两个 provider 都是云端 HTTP，**配音不再有平台分支**。

## 决定

| provider | 角色 | 密钥 | 状态 |
|---|---|---|---|
| `say` | **弃用**（听感差）。voice-engine 分支删除 | — | 现存，将被删 |
| `edge` | **默认**：Edge「大声朗读」端点，接替 say 的零配置角色（免密钥），三平台一致 | 不需要 | 接入中 |
| `mimo` | 高配：小米 MiMo TTS，中文自然，有费用与配额 | `MIMO_API_KEY` | 从 `ed7ebde^` 复活 |

**副作用（接受）**：配音从此需要网络；断网或端点不可用时只剩静音片（`voice` 不传即可）。

## 接口（P0 seam，已落地）

- `TtsProvider`（`scripts/contracts/durations.ts`）：`name` / `requiresKey` / `capabilities` /
  `describe` / `preflight` / `synth`，可选 `listVoices` / `resolveVoice`。实现各占
  `voice/providers/` 一个文件，注册表在 `voice/main.ts`，加 provider = 加一行。
- `VoiceEnv.secret(ref)` 是密钥唯一读取口：进程环境 > 被讲解目录 `.env` > `$DSH_HOME/.env`。
  值不进日志、报告与 `durations.json`。引用名集中在 `KEY_REFS`（当前只有 `MIMO_API_KEY`）。
- CLI 契约：`pnpm voice <目录> --provider <name>`；插件侧 `cast.ts` 把设置页的
  `voice.provider` 经 `--provider` 透传。未实现的 provider 在配音阶段报错退出 2，不静默换引擎。
- 缺密钥是专用退出码 `EXIT_CREDENTIAL_MISSING`（4）：可操作的环境问题，不是崩溃。
- 时长机制不变：任何 provider 的产物都过 `ffprobe` 实测，字数只用于字幕分配。

## 验收

- **CI 只测 runner 能证明的**（教训来自 `4af655d`）：请求体构造（mimo 的 user/assistant
  位置）、坏响应路径、参数解析，全部 mock，不发真请求。
- **真实合成本地验收**：`pnpm voice <目录> --provider <p> --limit 1` 出样音，机器判据
  （ffprobe 时长 > 0、单声道 44.1kHz）+ 人工听感，结论记回本目录。
