# foldercast · 目录放映

把任意一个**人类可读的目录**变成一段讲解视频。不限于代码仓库——任何目录，只要里面的
内容人能读懂，就能被讲成视频。

**形态：DSH 插件**（工具 + skill + 脚本），编排层是 DSH 主 agent。

```
Agent（有 bash）：探目录 → 写 digest → 定大纲与讲稿 → 独立评审
一个工具：校验与版本回执 →（显式要求）页面 / 配音 / 渲染
```

**模型负责理解、判断与创作；程序负责精确、重复、可复现和可验证的执行。** 选材与叙事由 agent 决定，程序处理契约校验、版本一致性、素材转换、配音与渲染。职责调整见 [0008](docs/decisions/0008-trusted-execution.md)，历史收缩依据见 [0001](docs/decisions/0001-minimal-agent-plugin.md)。

**要说清的一件事**：foldercast 会读取目录里的文件内容用于理解，**这些内容会进入模型
上下文**。这是功能本身，不是缺陷。写稿 skill 里有一条约束：不要打开密钥样的文件
（`.env`、`*.pem`、`credentials*`），但请自行确认目录里没有不该外传的内容。

---

## 管线

```
   ┌─────────────┐   ┌──────────────────┐   ┌───────────────┐   ┌──────────────┐
   │ 探目录       │ ─► │ 知识压缩 digest   │ ─► │ 分镜 + 讲稿    │ ─► │ 校验 + 配音   │
   │ bash + 眼睛  │   │ 事实富集（agent） │   │ script.json   │   │ + 渲染 + 页面 │
   └─────────────┘   └──────────────────┘   └───────────────┘   └──────────────┘
```

主要文件落在 `<目录>/.foldercast/` 下：

| 文件 | 是什么 | 性质 |
|---|---|---|
| `digest.json` | **知识压缩**——结构、盘点、摘录、值得讲的数字，深度随讲述目标调整的事实库 | agent 写，**富集** |
| `script.json` | **讲稿**（`foldercast: 2`）——分镜、节拍（beats）、旁白；画面上的一切都写在里面 | agent 写，**创作** |
| `review.md` / `review.json` | 独立评审报告与绑定输入版本的回执；程序不证明事实正确 | 模型报告 / 程序记录 |
| `artifacts.json` | 产物输入版本与输出哈希 | 程序记录 |
| `durations.json` | 配音产物——逐场景实测时长与字幕时序；**节拍时刻对齐字幕** | 程序产出，可重算 |

**两阶段创作**（[0004](docs/decisions/0004-two-stage-authoring.md)）：先做知识压缩
（digest，按知识结构组织），再按受众与目标写讲稿——「合适的画面密度」
是从富集里选出来的。讲稿仍**自足**：渲染只读讲稿；引用的文件用相对源目录的路径，
必须真实存在。校验器查契约、给出密度比提示（参考画面阅读量/旁白量 1.5–3）、抽查 digest 的
计数。形状见 [script.schema.json](docs/specs/script.schema.json) 与
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

macOS 自带的 `sips`（图片缩放）也在此列：其他平台回退 ffmpeg。

---

## 装进 DSH

```bash
dsh plugin --profile <profile> add dsh-foldercast
```

装完在插件管理页看到「目录放映」，对话里说「把这个目录讲一遍」即触发。agent 按
skill 走：自己探目录 → 写 digest 与 `script.json` → 调 `foldercast_cast` 校验（机器闸门，
只给结论、不落产物）→ 起独立 subagent 评审（结论写 `review.md`）→ **评审通过后**传
`reviewRevision: revision` 记录当前版本的评审回执，再传 `page: true` 产出 `page.html` 导览页，要成片再传
`render: true`（要旁白同时传 `voice: true`）。产出顺序由 skill 驱动（0007）：默认先 HTML
再视频；用户只要导览页就停在 HTML。正式产出检查回执版本与报告哈希，工具不解析报告的自然语言结论；传 `reviewRevision` 表示 agent 声明已通过评审。`draft: true` 可生成工作草稿。HTML 与视频共享场景内容与素材准备，输出形式不同；图片超出内联预算时保留相对路径，转发需要附被引用的素材并保留相对位置。Office / PDF 页图与视频封面的相对路径指向准备产物。

**昂贵步骤默认不跑**：不出片就不传 `render`，只要静音片就不传 `voice`。
渲染几分钟到几十分钟；配音走云端 TTS——默认 `edge`（免密钥），`mimo` 中文更自然但要
`MIMO_API_KEY`（缺密钥时以退出码 4 结束并给配置办法，见
[决策记录](docs/decisions/0002-tts-providers.md)）。**配音需要网络**，断网时只剩
静音片（`voice` 不传即可）。

**改过 `src/` 之后要重启 DSH**（插件入口不热加载），否则旧代码会报「插件包不完整」。

**发布前要构建**：Node 不允许在 `node_modules` 里剥离 TypeScript，分发的入口必须是 JS。
`pnpm --filter dsh-foldercast prepack`（复制 schema + `tsc`）生成 `lib/` 与 `schemas/`，
两者都是构建产物、不入库。

---

## 脱离 DSH 直跑

以下入口都能独立跑（仓库内 Node 22.19+ 直接运行 TypeScript，不需要构建）：

```bash
pnpm render <目录>              # 讲稿 → mp4（默认静音；有效配音产物存在时带旁白）
pnpm render <目录> --still 3.5  # 出一张静帧，调画面用，不必整片重渲
pnpm render <目录> --check      # 只校验讲稿并报时长分镜，不需要浏览器
pnpm voice  <目录>              # 讲稿 → 逐场景音频 + 实测时长 + 整条音轨（--provider edge|mimo）
pnpm page   <目录>              # 讲稿 → HTML 导览页（--style 素稿|杂志|夜幕）
pnpm text   <文件>              # Office / PDF → Markdown 打到 stdout（agent 通读用）
```

revision 对讲稿、digest 与直接引用文件计算内容哈希；引用目录使用文件名、大小和修改时间，digest 的文件总数抽查也参与。它不覆盖全部源文件正文或软件版本。产物状态 current 表示仍匹配登记时的输入与参数，不证明内容正确或适合新设置。

产出 CLI 默认生成工作草稿，`--approved` 要求当前评审回执。`--check` 只校验，不要求回执。

**时长以实测为准**：配音跑过之后，画面时间轴来自 `ffprobe` 实测的音频时长（不是
字数预估）。同一份讲稿渲染两次**逐帧视觉一致**（差异上限为字形抗锯齿噪声，每帧 PSNR ≥ 45dB）；换音色会改变音轨、时长以及节拍时序。音频按每场旁白、provider、音色、风格、格式等输入判断缓存，逐场请求和音频哈希保存在 `audio/cache.json`，中断后可续跑。只改画面不需要重合成；改讲稿中的 voice 配置需重跑 voice，但实际请求相同的场景可复用。渲染拒绝过期、缺少新版本记录或整条音轨不完整的 durations。

**旧项目迁移**：讲稿与 digest 的 schema 版本不变。旧 `review.md` 需重新评审并绑定当前回执；旧音频缺少逐场缓存记录，第一次重跑 voice 会重配。旧 durations 缺少新版本记录，不能直接用于渲染。

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
│       ├── page/          TypeScript：共享场景数据 → HTML 导览页（三套风格预设）
│       ├── voice/         TypeScript：讲稿 → 逐场景音频 + 实测时长（edge / mimo）
│       └── references/    按需读取的场景与独立评审参考
├── examples/              讲稿示例（已通过 schema 校验）
└── scripts/               仓库工具（链接、JSON、示例 schema 检查）
```

**全 TypeScript，没有 Python。** 插件本体、prep、渲染器同栈，`script.json` 的类型
定义三方共用。编排层是 DSH 主 agent，不是代码：模型通过工具或 CLI 执行阶段，程序检查产物依赖与版本。

---

## 参与

提交前请跑：

```bash
pnpm install      # 首次，或依赖变更后
pnpm typecheck    # TypeScript 类型检查
pnpm run check    # 链接 + JSON + 示例 schema
pnpm test         # 单元与集成测试（渲染用例会起无头 Chrome，串行跑）
```
