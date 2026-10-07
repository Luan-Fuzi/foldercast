# foldercast · 目录放映

把任意一个**人类可读的目录**变成一段讲解视频。不限于代码仓库——任何目录，只要里面的
内容人能读懂，就能被讲成视频。

**形态：DSH 插件**（工具 + skill + 脚本），编排层是 DSH 主 agent。

```
Agent（有 bash）：rg --files → 挑重点读 → 数数字 → 写 script.json（讲稿）
一个工具：校验 →（显式要求）say 配音 → 按需转换素材 → Remotion 出片
```

**没有分析器替 agent 干活。** 探目录、读文件、判断什么重要，都是 agent 自己做；
程序只做确定性的重活：契约校验、TTS 合成、逐帧渲染、二进制格式转换。
收缩的理由与取舍见 [决策记录](docs/decisions/0001-minimal-agent-plugin.md)。

**要说清的一件事**：foldercast 会读取目录里的文件内容用于理解，**这些内容会进入模型
上下文**。这是功能本身，不是缺陷。写稿 skill 里有一条约束：不要打开密钥样的文件
（`.env`、`*.pem`、`credentials*`），但请自行确认目录里没有不该外传的内容。

---

## 管线

```
   ┌──────────────────┐      ┌───────────────┐      ┌──────────────┐
   │ 探目录 + 写讲稿    │ ──► │ 校验 + 按需转图 │ ──► │ 配音 + 渲染   │
   └──────────────────┘      └───────────────┘      └──────────────┘
    Agent 用 bash 与眼睛        确定性程序              say / Remotion
```

两份文件落在 `<目录>/.foldercast/` 下：

| 文件 | 是什么 | 性质 |
|---|---|---|
| `script.json` | **讲稿**——分镜、旁白、引用哪些文件；画面上的一切都写在里面 | agent 写，**创作** |
| `durations.json` | 配音产物——逐场景实测时长与字幕时序 | 程序产出，可重算 |

讲稿是**自足的**：目录结构、内容盘点、文件摘录都写在讲稿里（数字是写稿的 agent
亲手数过的）；引用的文件用相对源目录的路径，必须真实存在。形状见
[script.schema.json](docs/specs/script.schema.json) 与
[示例](examples/script.example.json)。

---

## 环境与依赖

缺依赖**不会炸**：每一步开工前先探测，缺什么就给对应平台的安装指引；讲稿校验
（`--check`）在任何机器上都能跑。仓库内开发用 pnpm（版本由 `packageManager` 固定）。

| 依赖 | 什么时候需要 | macOS | Windows | Linux |
|---|---|---|---|---|
| Node 22.19+ | 必需：阶段脚本用 TypeScript 直跑（类型剥离） | 官网安装包 / brew | 官网安装包 / winget | 发行版包管理器 / nvm |
| 浏览器（Chrome / Chromium / Edge 任一） | 只有**出片**需要 | 装任一系统浏览器，或 `npx remotion browser ensure` 让 Remotion 下载（约 150–300 MB），或 `FOLDERCAST_BROWSER=<路径>` 指定 —— 三平台同样 | 同左 | 同左 |
| ffmpeg / ffprobe | 配音、实测时长、视频封面；非 mac 平台的图片缩放也回退到它 | `brew install ffmpeg` | `winget install --id Gyan.FFmpeg`（或 `choco install ffmpeg`） | `apt install ffmpeg`（或发行版等价命令） |
| `@deepseek-ai/libreoffice-kit`（提供 `dsoffice`） | 可选：Office / PDF 的逐页图与文本提取 | 随包以 optionalDependency 自动安装（公共 npm，三平台各有变体；Linux 落到 wasm 变体）。装不上只影响 office/pdf 素材，其余类型照常 | 同左 | 同左 |

macOS 自带的两样也在此列：`sips`（图片缩放，其他平台回退 ffmpeg）与 `say`
（配音的默认引擎，免密钥；其他平台不配音、出静音片）。

---

## 装进 DSH

```bash
dsh plugin --profile <profile> add dsh-foldercast
```

装完在插件管理页看到「目录放映」，对话里说「把这个目录讲一遍」即触发。agent 按
skill 走：自己探目录 → 写 `script.json` → 调 `foldercast_cast` 校验 → 起独立
subagent 评审（结论写 `review.md`）→ 评审通过后**显式传 `render: true`** 出片
（要旁白同时传 `voice: true`）。

**昂贵步骤默认不跑**：不出片就不传 `render`，只要静音片就不传 `voice`。
渲染几分钟到几十分钟；配音用 macOS 自带的 `say`（免密钥、本地）。

**改过 `src/` 之后要重启 DSH**（插件入口不热加载），否则旧代码会报「插件包不完整」。

**发布前要构建**：Node 不允许在 `node_modules` 里剥离 TypeScript，分发的入口必须是 JS。
`pnpm --filter dsh-foldercast prepack`（复制 schema + `tsc`）生成 `lib/` 与 `schemas/`，
两者都是构建产物、不入库。

---

## 脱离 DSH 直跑

五个入口都能独立跑（仓库内 Node 22.19+ 直接运行 TypeScript，不需要构建）：

```bash
pnpm render <目录>              # 讲稿 → mp4（默认静音；配音产物存在时自动带旁白）
pnpm render <目录> --still 3.5  # 出一张静帧，调画面用，不必整片重渲
pnpm render <目录> --check      # 只校验讲稿并报时长分镜，不需要浏览器
pnpm voice  <目录>              # 讲稿 → 逐场景音频 + 实测时长 + 整条音轨
pnpm text   <文件>              # Office / PDF → Markdown 打到 stdout（agent 通读用）
```

**时长以实测为准**：配音跑过之后，画面时间轴来自 `ffprobe` 实测的音频时长（不是
字数预估）。同一份讲稿渲染两次**逐帧一致**；换音色重跑，画面不变、只有音轨与片长变。

**缺浏览器时**渲染脚本不会替你下载，而是打印三种办法（装 Chrome /
`npx remotion browser ensure` / `FOLDERCAST_BROWSER=<路径>`）并以退出码 3 结束。
**中断渲染之后**可能留下一个后台 Chrome 进程（`puppeteer_dev_chrome_profile-*`），
杀掉它才不影响下一次渲染的可复现性：`pkill -f puppeteer_dev_chrome_profile`。

**评审不是脚本**：写稿与评审都是模型在做。主 agent 按 skill 写讲稿，**另一个独立
subagent** 按 skill 的六条评审判据复核（编造 / 数字 / 重点 / 遗漏 / 结构 / 语言），
每条必须给证据，结论写到 `<目录>/.foldercast/review.md`。

---

## 许可提示：Remotion 是双许可

出片这一步用 [Remotion](https://www.remotion.dev/) 渲染画面。它**不是纯开源**，请按
自家情况判断：

| 你的情况 | 适用档位 | 价格（2026-10 复核） |
|---|---|---|
| 个人，或 ≤3 人的公司 | Free License | $0，含无限商业使用 |
| 4 人以上公司，为自己组织做视频 | Creators | $25/月/座 |
| **把 foldercast 嵌进自己的产品**对外提供 | Automators | **$0.01/次渲染，$100/月起** |

**foldercast 本身按 Free License 使用**（个人项目）。把它包进产品里卖，要按上表自行
取得许可。渲染时 Remotion 会按其[遥测政策](https://www.remotion.dev/docs/telemetry)
上报用量，可以用环境变量关掉。

出片还需要浏览器（Chrome / Chromium / Edge）：**我们不分发它**，用系统已装的，
或让 Remotion 下载。

---

## 目录结构

```
foldercast/
├── README.md              你在这里
├── docs/
│   ├── decisions/         决策记录（收缩的理由与取代关系）
│   └── specs/             script.schema.json（讲稿契约，机器可读）
├── packages/plugin/       DSH 插件（唯一的入口，也是全部代码）
│   ├── src/               工具注册、skill、编排
│   └── scripts/
│       ├── contracts/     讲稿/时长契约的类型 + 字幕切分与时长分配，各阶段共用
│       ├── assets/        prep（按需转换 + mtime 缓存）、text 提取、转换本体
│       ├── renderer/      TypeScript + Remotion：讲稿 → mp4（含契约校验 check）
│       └── voice/         TypeScript：讲稿 → 逐场景音频 + 实测时长
├── examples/              讲稿示例（已通过 schema 校验）
└── scripts/               仓库工具（链接、JSON、示例 schema 检查）
```

**全 TypeScript，没有 Python。** 插件本体、prep、渲染器同栈，`script.json` 的类型
定义三方共用。编排层是 DSH 主 agent，不是代码：脚本由模型用 bash 调起。

---

## 参与

提交前请跑：

```bash
pnpm install      # 首次，或依赖变更后
pnpm run check    # 链接 + JSON + 示例 schema
pnpm test         # 单元与集成测试（渲染用例会起无头 Chrome，串行跑）
```
