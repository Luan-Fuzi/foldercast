# 里程碑

**形态**：第一版只做 DSH 插件（工具 + skill + 脚本），编排层是 DSH 主 agent。不做独立 CLI（[ADR 0008](decisions/0008-plugin-first.md)）。

**主线**：解读 → 讲稿 → 视图。视频是视图之一，不是唯一产物。

---

## 排序原则

里程碑的编号**就是执行顺序**，按三条原则排：

| 原则 | 含义 |
|---|---|
| **依赖优先** | 前者是后者的输入。分析没跑通就不能写稿，契约没定就不能校验讲稿 |
| **验收前置** | **验收手段先于被验收的东西**。校验脚本（M3）与评审 agent（M5）都必须早于它们要检查的写稿质量 |
| **反馈回路尽早闭合** | HTML 视图（M6）不需要 Remotion、不需要浏览器、不需要 TTS，是验证「解读得对不对」最快的一条路 |

**一个刻意的偏离**：管线的自然顺序是「文案 → 视频 → 配音」（[ADR 0004](decisions/0004-pipeline-order.md)），但**评审与 HTML 插在了写稿之后、视频之前**。理由是：写完稿却无法判断写得好不好，等于把最大的风险（叙事质量）拖到最后。

---

## M0 · 骨架与设计（已完成）

- [x] 独立工作区 `/Users/scliang/work/foldercast`
- [x] 三步管线设计与可重跑边界
- [x] `foldercast.json` / `script.json` 格式定义
- [x] TTS 供应商调研、风格预设系统设计、竞品调研归档
- [x] 解读 / 讲稿分离、引用依赖进契约、密钥排除、隐私边界、凭据 seam、浏览器与 Office 引擎选型

**完成标准**：文档齐备，格式定死，不需要写代码就能评审设计。

---

## M1 · 分析器（解读）（已完成）

目标：**目录 → `foldercast.json`**。纯确定性程序，TypeScript，不调用模型。

这是整个项目的地基：**「理解」是核心产物**，而解读就是它的载体。

- [x] 目录遍历 + 结构树（**结构树即 `manifest` 的路径集合 + `stats.topDirs`**；契约里没有单独的树结构，见 SPEC-data-format.md）
- [x] 文件类型分类（12 类：code / text / markup / data / office / pdf / image / video / audio / archive / binary / other）
- [x] 角色识别（readme / entry / config / test / doc / asset / license / build）
- [x] 语言与行数统计
- [x] `sources` 三级筛选（include / exclude / kinds）
- [x] 默认排除规则（含**密钥类文件名**，见 [ADR 0007](decisions/0007-secret-file-exclusion.md)）
- [x] **引用依赖图**：`manifest[].imports` / `importedBy` + `graph` 的 roots / hubs / leaves / dangling
- [x] **`stats.secrets` 审计输出**（只按文件名匹配，必须打印）
- [x] 各类型的 `preview` 提取 —— 代码/文本/数据/标记/图片已做；**office / pdf / video 的深化提取视同 M2**（要 `dsoffice`、`officeparser`、`ffprobe`，M1 不引入这些依赖，留空而不是编一个）
- [x] `maxFiles` / `maxFileSizeMb` / `maxDepth` 规模保护

**验收（2026-10-04 实测）**

1. ✅ 三个真实目录跑通并人工核对：

   | 目录 | 结果 |
   |---|---|
   | `qiuzhao202608/lecture-videos`（TS + Remotion） | 94 文件；audio 68 / data 10 / code 9 / image 4；**命中 `.mimo_api_key`**（真实密钥文件名，审计如实打印）；枢纽 `src/components.tsx`、`src/types.ts` 与人工判断一致 |
   | `qiuzhao202608/resume`（Office 汇报） | 22 文件；office 8 / pdf 7 / text 7，无错判；无引用关系时不编造入口（roots 为空） |
   | `qiuzhao202608`（混杂资料） | 1040 文件 → 按重要性保留 200；枢纽是「智能体开发」系列的 5 篇八股文档，符合实际阅读顺序 |

   验收过程中修掉三类误判（都写进了测试）：Markdown 链接目标含括号被截断、代码块里的 `[name](arg)` 被当成链接、JSON 里的裸文件名被当成路径。

2. ✅ 对本仓库自身：`roots` 含 `README.md`，`hubs` 含 `docs/specs/SPEC-pipeline.md`（入 10），`dangling` 为空
3. ✅ 脱离 DSH 直接跑：`node packages/plugin/scripts/analyzer/main.ts <目录>`，无需构建步骤
4. ✅ 大体量不 OOM：对 `/Users/scliang/work`（21.3 万文件）跑完 **0.34 秒、峰值内存 124 MB**；按重要性截断到 200 个文件，截断数量如实打印

**语言**：TypeScript（Node 22.19+），与插件、渲染器同栈。**项目无 Python 依赖**——当初选 Python 是为了 Office/PDF 库，那两块现在都在 Node 侧。

**为什么排第一**：唯一不依赖模型、不依赖渲染、不依赖网络的阶段，风险最低，产物本身有价值。

**注意**：本阶段**不含**插件骨架。骨架与技能放在 M4，因为它只服务于「让 agent 调用脚本」这一件事。


---

## M2 · 素材（已完成）

目标：**解读里的文件 → `assets/`**。

- [x] 图片缩放与缩略图（`sips`，非 macOS 回退 `ffmpeg`）
- [x] 视频抽帧与封面（`ffmpeg`）+ 元数据（`ffprobe`：时长 / 分辨率 / 编码）
- [x] **Office 与 PDF 转图（`dsoffice render`）** —— 一个工具覆盖两类
- [x] Office / PDF 文本结构化提取（**`officeparser`** —— 一个库覆盖 docx / pptx / xlsx / pdf 等，产出带层级的 AST）
- [x] **xlsx 公式值重算（`dsoffice recalculate`）**
- [x] 代码语法高亮图（`shiki` → **SVG**：渲染器本来就是浏览器，不需要截图工具，见 [SPEC-data-format.md](specs/SPEC-data-format.md#三assets-素材目录)）
- [x] `assets/manifest.json` 增量重算（按 mtime + size 命中，产物还在才算命中；mtime 变了才重算哈希）
- [x] 顺带补齐 M1 顺延的 **office / pdf / video 的 `preview`**（素材阶段回填进解读）

**验收（2026-10-05 实测）**

| 场景 | 结果 |
|---|---|
| Office 汇报目录（`qiuzhao202608/resume`） | 15 个 Office/PDF → **20 张页图 + 15 份文本**，15.0 秒；预览全部补齐，例如「2 页 · 4 个表格」「1 页 · 梁师成」 |
| 本仓库自身 | 47 个代码文件 → 47 张 SVG，**502 毫秒** |
| 第二次运行（两处都是） | **全部命中缓存：0–1 毫秒**（`resume` 15 个文件 0 毫秒，仓库 47 个文件 1 毫秒） |

**`officeparser` 的验证（本阶段必做，已完成）**：夹具与真实文件各跑一遍，结论是**够用，不退回 `mammoth` + `exceljs`**。

| 输入 | 提取结果 |
|---|---|
| 夹具 docx | 标题层级 `Heading1` / `Heading2` ✓，表格 1 个（row / cell 齐全）✓ |
| 夹具 xlsx | 工作表名 `Summary` ✓；公式 `SUM(B2:B3)` 无缓存值，**重算后取到 4600** ✓ |
| 夹具 pptx | 2 张幻灯片，题目 `项目概述` / `架构分层` ✓ |
| 夹具 pdf | 文本层 5 段 ✓（扫描版没有文本层属已知边界） |
| 真实简历 docx | 6 个表格、2945 字 ✓ |
| 真实简历 pdf | 2437 字 + **元数据标题** ✓ |
| 真实 59 页课程 pptx | 46 个标题 + 5 个表格 + 8088 字 ✓ |
| 真实 xlsx | 75 行 297 个单元格 ✓ |

**依赖说明**：全部 TypeScript，**无 Python**。转图统一走 `dsoffice`（`@deepseek-ai/libreoffice-kit`，作为 `optionalDependencies` 自动安装；缺它时 office/pdf 素材会**报可操作的失败**而不是崩溃，其他类型照常）；文本提取走 `officeparser`；高亮走 `shiki`。

**为什么排在写稿之前**：写稿阶段要引用素材路径（`file` 场景的 `asset`、`gallery` 的 `items`）。没有素材，讲稿只能引用文件而不能引用画面。

**风险点（已消解）**：Office 转图是最重的部分——实测每个文件约 1 秒（起 LibreOffice/pdfium 引擎），并且**不保证与 Microsoft Office 分页一致**（官方声明）。`shiki` 体积的担心没有成立：它按需加载语言文法，47 张高亮图共 502 毫秒。


---

## M3 · 契约校验脚本（已完成）

目标：**机器可查的验收，先于被验收的产物。**

**为什么单独成为里程碑**：它是 M5（写稿）的前提。把校验混在写稿里，等于「先做，再想怎么判断做对没有」——而这个项目最大的空白正是叙事质量没有判据（见「已识别的坑」第 5 条）。

- [x] `foldercast.json` / `script.json` 通过各自 schema 校验
- [x] 讲稿引用的每个路径都在解读的 `manifest` 里 —— **幻觉路径拦截**
- [x] 场景 `type` 在开放枚举内
- [x] 字幕块 ≤24 字
- [x] 结构树与 `stats` 的一致性（计数与清单对得上）

落地时补了三条（都在原目标的判据之内，只是原清单没写全）：

- **场景字段按类型查**：schema 的字段集合是各类型的并集，所以「`cover` 场景里出现 `groups`」schema 拦不住，要按类型再查一遍；同时把各场景的必需字段用 `allOf` 写进 `script.schema.json`（原来只在 SPEC 的表格里）
- **素材路径的存在性**：`asset` / `items` / `poster` / `pages` 相对工作根，要在素材清单或工作根里能找到，否则要到渲染阶段才发现
- **`stats` 反查路径**：`stats.roles` / `stats.secrets` / `graph.roots|hubs|leaves|dangling` 里列出的路径都必须在 `manifest` 里，图上度数也要与 `imports` / `importedBy` 对得上

**用法**

```bash
pnpm validate <目录>            # 默认校验 <目录>/.foldercast/ 下的解读与讲稿
pnpm validate <目录> --json     # 机器可读报告（M4 的工具与 CI 用）
```

退出码：`0` 通过（可能有 warning）、`1` 有 blocker、`2` 参数或环境有误。blocker 必须修，warning 是「可能是笔误，自己确认」。

**验收（2026-10-05 实测）**

| 场景 | 结果 |
|---|---|
| `qiuzhao202608/lecture-videos`（TS + Remotion，94 文件） | 解读 **0 blocker**；塞入故意写坏的讲稿后报出 **11 条**，全部带文件名与行列号 |
| `qiuzhao202608/resume`（Office 汇报，22 文件） | 解读 **0 blocker** |
| `qiuzhao202608`（混杂资料，1040 文件 → 按重要性保留 200） | 解读 **0 blocker** |
| 本仓库自身 | 解读 **0 blocker**，且已进 CI（分析器产出的解读必须能过校验） |

前三条是**与输入无关的证据**：解读是分析器刚跑出来的，校验器在真实语料上没有误报。

**「故意写坏」的讲稿**（`packages/plugin/scripts/validate/tests/fixtures/bad-script.json`）覆盖十类错误，每类都在测试里对着 `(code, JSON 指针, 场景 id, 字段, 行号)` 断言：

| # | 错误 | 报出 |
|---|---|---|
| 1 | `cover` 缺必需字段 `title` | `scene-field-missing` `/scenes/0/title` |
| 2 | 引用编出来的路径 `src/main.ts` | `path-hallucinated`，并给出相近候选 |
| 3 | `focusLines` 超出文件真实行数 | `focus-lines-out-of-range` |
| 4 | 两个场景 `id` 重复 | `scene-id-duplicate` |
| 5 | 素材基准写错（多一层 `assets/`） | `asset-missing`，并说明该写成什么 |
| 6 | 素材不存在 | `asset-missing` |
| 7 | 盘点数量与解读不符 | `inventory-group-count-mismatch`（warning） |
| 8 | `tree` 强调不存在的子路径 | `path-hallucinated` |
| 9 | `cover` 场景里出现 `groups` | `scene-field-unused` |
| 10 | 一整句没有标点，切不出 ≤24 字的字幕块 | `subtitle-too-long`，报出最长一块的宽度 |

**三条判据取舍**

- **字幕的「24 字」按显示宽度折算**：中日韩文字与全角标点算 1，其余算 0.5。24 本来就是屏幕一行的容量，中英混排按折算算才与画面一致；纯中文下与「数汉字个数」等价。已写进 [SPEC-data-format.md](specs/SPEC-data-format.md)，代码在 `contracts/subtitles.ts`（`SUB_LIMIT`）—— **校验与配音共用一份实现**，避免「校验按一套、配音按另一套」。
- **切不动的块报错，不硬切**：整块没有任何可切点时，硬切会产生半个词。所以切分器原样返回它，由校验器报出来让人改稿。
- **盘点数量报 warning 不报 blocker**：解说可以取整或概括（「大约七十个代码文件」），只有差得离谱才值得核对；路径与字段这类硬事实才是 blocker。

**这一层的边界**：它只查机器能判断的。**「有没有讲错重点」不是它能管的**，那是 M5 的事。

**留给 M4 的一件事（已完成）**：schema 只有一份，在 `docs/specs/` 下，校验器按仓库布局找它（**不复制第二份**，否则会多出一个会漂移的权威）。M4 的做法是：`prepack` 把三份 schema 复制进包的 `schemas/`（构建产物，不入库），校验器从模块位置**往上找第一个含 `script.schema.json` 的目录** —— 包内优先，仓库兜底，不依赖「上溯几级」。

---

## M4 · 插件骨架（已完成）

目标：**一个能装进 DSH 的插件，agent 能调起 M1 的分析器。**

- [x] npm 包 + `dsh.bundle.patch` 声明（**必需**，漏了会静默不激活）
- [x] `locale/zh.json` + `locale/en.json`（插件管理页的标题与描述）
- [x] `Config` schema 声明（**第一版不暴露字段**，只立机制 —— 宿主据此生成设置页，见 [ADR 0009](decisions/0009-settings-via-config-schema.md)）
- [x] 一个工具：`foldercast_cast`，**一个必需参数**（目录路径）+ 一个可选的 `skipAssets`
- [x] skill：工作流步骤 + 「不读哪些文件」的约束
- [x] 依赖探测与清晰报错（不是裸 `ENOENT`）

**工具做什么**：一次调用把**事实层**做完 —— 分析（M1）→ 素材（M2）→ 校验（M3），返回结构化结果。
**它不写稿**：讲什么、按什么顺序讲要靠判断，那是模型的事，所以它在需要写稿时返回
`next: needsScript` 并把 `script.json` 的路径交回给 agent。渲染与配音尚未实现（M7 / M8），
所以工具不声称产出了视频。

**skill 怎么发**：`ctx.skills.register()` 注册**内存 skill**，随包走 —— 不需要往用户的项目目录里放
文件，装到哪台机器上都有效。

**八条实测结论**（都写进了 [INTEGRATION](INTEGRATION-dsh-plugin.md)，本机 DSH `0.2.0-rc.2`）：

1. **插件入口可以直接是 `.ts`**，但**只在仓库内开发时成立**：Node 拒绝在 `node_modules` 里剥离
   类型（`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`，实测 v26.8.1）。所以**发布版必须编译**：
   `src/` 与 `scripts/` 由 `tsc` 编到 `lib/`，`main` 指向 `lib/src/index.js`。仓库内仍可直跑 `.ts`。
2. **不能依赖 `@deepseek-ai/dsh-tools`**。把 `defineTool` 当插件依赖装进 profile，会让宿主的
   加载器起不来（`Cannot read properties of undefined (reading 'prepare')`）。改用
   `ctx.tools.register()` 直传定义 + 原生 JSON Schema，**工具侧零框架依赖**。
   `@deepseek-ai/schemastery` 可以依赖（装在哪一侧都安全），`Config` 用它。
3. **参数与输出 schema 有子集限制**：不支持类型数组（`type: ['integer','null']` 会被拒），
   只认 `type / oneOf / properties / required / additionalProperties / items / enum / const`
   与四个注解关键字。不合法时**插件不激活**，只在启动日志里留一条警告 —— 所以加了测试钉住白名单。
4. **`ctx.skills.register()` 必须带 `source`**，否则读取时报
   `loaded skill "foldercast" source must be a string`（注册时能过，加载时才查）。
5. **`exec.signal` 可能在调用前就已取消**：不先查 `signal.aborted` 就 spawn，监听器永远等不到事件。
6. **依赖漏声明在本机看不出来**：`ignore`、`ajv`、`ajv-formats`、`jsonc-parser` 都能从仓库根的
   `node_modules` 解析到，只有装到别处才会 `ERR_MODULE_NOT_FOUND`。加了守卫测试。
7. **包根不能靠「上一级目录」算**：编译产物比源码深一层（`src` vs `lib/src`），原来的
   `resolve(MODULE_DIR, '..')` 在装上去之后把包根算成 `lib/`，随包脚本「全部找不到」。
   改成上溯找 `package.json`，阶段入口按「在不在 `node_modules` 里」选 `.ts` / `lib/**/*.js`。
8. **条目代码不会热加载**（加载器是裸 `import()`，没有缓存失效）：改 `src/` 要重启宿主；
   阶段脚本是子进程，改 `scripts/` 立即生效。宿主是 Electron 也不影响 —— 子进程继承
   `ELECTRON_RUN_AS_NODE=1`，实测该运行时是 Node 24.18.1、类型剥离可用。

**验收（2026-10-05 实测）**

| # | 验收 | 结果 |
|---|---|---|
| 1 | 对话里一句话触发工具 | ✅ 用隔离 profile（`DSH_HOME` 指向临时目录）跑 `dsh --profile <p> "把这个目录讲一遍：…"`：工具被调用并返回解读；接着按 skill 写出 `script.json`，再调一次工具，校验 **0 blocker**、`next: validated` |
| 2 | 依赖缺失时**可操作** | ✅ 目录不存在 → 「目录不存在：…」；缺 `dsoffice` → 「装上后重试：pnpm add @deepseek-ai/libreoffice-kit」；缺 `ffmpeg`（用受限 PATH 实测）→ 「视频抽帧需要 ffmpeg（macOS：brew install ffmpeg）」，且其余照常 |
| 3 | 插件管理页显示标题与描述 | ⚠️ 数据面已验：用宿主自己的 `readPluginMeta()` 读到 `{zh: 目录放映 / FolderCast, 描述…}`；页面本身**未截图**（本机未授予屏幕录制与辅助访问权限）。请在插件页确认 |

**另外验过的**：打包装到仓库外（临时目录）后 —— 入口 `lib/src/index.js` 能被 import 并注册工具、
随包脚本以 JS 正常运行、校验器从**包内** `schemas/` 解析契约。包内容 48 个文件，不含测试与产物。

**装进 desktop profile 时又抓到一处（2026-10-05 补）**：M4 的验收是在隔离 profile 里用 CLI 跑的，
那时插件入口还是 `.ts`；后来为了让发布版能跑而把入口改成 `lib/src/index.js`，**这一改把包根算错了**
（第 7 条）。仓库内测试全绿、隔离 profile 的结论也没错——两边都是源码布局，看不出问题。
装进 desktop profile（`link:` 安装）后工具直接报「插件包不完整」。

修法：包根改为上溯找 `package.json`；阶段入口按布局选（仓库内跑 `scripts/*/main.ts`，
落在 `node_modules` 里跑 `lib/scripts/*/main.js`）；可选依赖 `dsoffice` 增加按包名解析的兜底。
新增守卫测试**从 `lib/` 加载编译产物**再断言（`src/tests/runtime.test.ts`），CI 里构建提前到测试之前。
修复后在 desktop 运行时（Electron 44 / Node 24.18、`ELECTRON_RUN_AS_NODE=1`）里两条分支各跑通一次：
`link:` 安装跑 `.ts` 源码、tarball 安装跑包内 `lib/**/*.js`，都返回 `next: needsScript` 的正确解读。

**这一步才做骨架的理由**：骨架/技能只服务于「让 agent 调脚本」。先有脚本，才有东西可调。

---

## M5 · 写稿 + 评审 agent

目标：**解读 + 通读内容 → `script.json`，并且能判断写得好不好。**

**这一阶段没有脚本**，由 DSH 主 agent + 一个评审 subagent 完成。**已完成（2026-10-05）。**

**写稿（主 agent）**

- [x] skill 里写清写稿步骤与判据（**主要交付物**）。六步工作流：跑事实层 → 通读 → 定场景 → 写稿 → 校验 → 评审
- [x] 场景类型选择：八种类型各给了「什么时候用」的判据，并给顺序（`roots` → `hubs` → 其余）与规模建议（8–15 场景、每场 40–80 字）
- [x] **通读策略**：先读解读、再全文读 `roots` 与 `hubs`、其余读摘要；大目录用 subagent 分工；**开不出 subagent 时怎么降级**（子 agent 有深度上限，被委派的写手常常已经在最后一层）
- [x] 中文字幕切分规则：M3 已实现切分器，这里写成写稿时的硬约束（≤24 显示宽度、一句无标点就切不开）
- [x] 输出合法 `script.json`，并通过 M3 的校验

**评审（subagent）**

- [x] 判据写进 skill：六条（编造 / 重点 / 遗漏 / 结构与顺序 / 语言 / 边界），**每条都要求给证据**（文件路径 + 原文片段）
- [x] 起 subagent 执行，输入只有解读 + 讲稿 + 目录；**不告诉它写稿时的理由**，否则它会为那些选择辩护
- [x] 评审结果落盘 `<工作根>/review.md`（格式与判据都在 skill 里）

**验收（2026-10-05 实测）**

| 目录 | 讲稿 | M3 校验 | 评审结论 |
|---|---|---|---|
| `qiuzhao202608/resume`（22 文件，Office/PDF 档案） | 10 场景 / 426 字 | 0 blocker | **通过**：初评 1 处待确认 + 2 条建议 → 整改两轮 → 通过 |
| `qiuzhao202608/lecture-videos`（94 文件，Remotion 工程） | 14 场景 / 743 字 | 0 blocker | **通过**：初评 1 处不精确 + 1 处语义错误 + 1 处重点缺口 → 整改 → 通过 |
| `qiuzhao202608`（混杂资料，1040+ 文件里按重要性收 201 条） | 15 场景 / 1550 字 | 0 blocker | **通过**：约 60 条断言逐条核对无编造；6 处精度与口径建议 → 整改 → 复核 |

**评审抓到的五处，全是机器判不了的**（校验器全绿，路径、字段、字幕都没问题）：

1. **「三月初的第一版两页」**：`pageCount=2` 来自 LibreOffice 转换，而 docx 内嵌 `<Pages>` 是 1、
   同日 PDF 是 1 页、第 2 页渲染图**全白**（非白像素占比 0.0%）。念出去等于把排版残留当事实讲。
2. **密钥那句话的主语**：放在讲 `tts.py` 的场景里容易被听成「tts.py 不读它」，而 `tts.py:99-101`
   的 `load_mimo_key()` 明确会读该文件当 key —— 「只按文件名命中」说的是**这次解读**的排除规则。
3. **「自建知识库」**：那个目录是 `github.com/Akun-python/autumn-recruitment` 的克隆，26 次提交
   作者均为 akun，README 自述「个人发起、社区共建」。改成引用它的自述。
4. **「其余是十份数据、九份代码和四张结果图」**：94−68=26，列出的只有 23，漏了 2 份文本与 1 份其他。
5. **「被引用最多的组件」**：实为并列第一（`components.tsx` 与 `types.ts` 的 `importedBy` 都是 3）。

**人工抽查评审本身**（ROADMAP 要求的「评审 agent 也会错」）：逐条独立复核了评审的关键论断 ——
docx 的 `<Pages>1</Pages>`、同日 PDF 1 页、第 2 页全白；`tts.py` 确实读 `.mimo_api_key`；
`out/` 下确实有 7 个 mp4；`Root.tsx` 扇出 12（最大）；94−68−10−9−4=3。**评审在可核实的事实上
全部成立，没有误报**；唯一的瑕疵是行号引用偶有偏差（`:481` 实际 `:473`、`:17` 实际 `:18`），
论断本身不受影响 —— 这也是为什么判据要求「每条都给证据」：证据可查，结论才可抽检。

**这一阶段顺带修掉一个 M1 的真 bug**：密钥类文件会被 `maxFiles` 截断一起丢掉，于是既不在清单、
也不在 `stats.secrets.excluded` 里 —— 一个 200 文件的目录里 `lecture-videos/.mimo_api_key` 就是
这样消失的（评审把它当成「判据允许不提」放过了，但顺着它的附注查下去发现了根因）。
修法与后果见 [SPEC-data-format](specs/SPEC-data-format.md#statssecrets--密钥文件的排除审计) 与
[ADR 0007](decisions/0007-secret-file-exclusion.md)。

**还改了 skill 自己的一处矛盾**：场景上限写 8–15，而 200 文件的目录按判据讲完必然超过 15 场 ——
结果那份讲稿 15 条解说里 13 条超过「40–80 字」的建议（最长 131 字），评审判为「单场信息量偏大」。
上限本来是给节奏用的，不该被当成内容上限：改成大目录可以到 20 场，一场超过约 120 字就拆。

**CI 又抓到一条只有 Linux 会红的用例**（和 M3 那次同一类）：评审是否作废靠 mtime 比较，
而那条用例靠「先写评审、再写讲稿」制造时间差 —— runner 上两次写入落在同一毫秒，`review >= script`
就判成「评审是新的」。改成用 `utimesSync` 显式设到 60 秒前与 1 秒前，与文件系统精度无关。

**写进 skill 的三条领域教训**（都是这一阶段实测出来的）：`pageCount` 是弱证据；资料型目录的
`roots` / `hubs` 常常是空的，这时改用 `topDirs` / `roles` / 体积判重点；开不出 subagent 时的通读降级路径。

**为什么评审与写稿同一个里程碑**：评审是写稿的验收，两者必须一起交付。分开就会出现「写完了，但没法判断」。

---

## M6 · HTML 视图

目标：**把 `foldercast.json` 渲染成一个静态自包含页面**，作为第一个可看的产物。

**为什么它值得早做**：这是**唯一一条不需要 Remotion、不需要浏览器、不需要 TTS、不需要逐帧确定性**的视图路径。它验证的是项目的核心目标——「解读能不能替代翻目录」——而不是渲染管线的正确性。

**已完成（2026-10-05）。** 落在 `packages/plugin/scripts/html/`，四个模块：`collect.ts`（解读 + 素材 →
视图模型）、`render.ts`（视图模型 → HTML，纯函数）、`embed.ts`（图片按页面尺寸缩小后内联）、
`main.ts`（CLI）。插件里由 `foldercast_cast` 顺手跑（阶段名 `html`），返回 `htmlPath`。

- [x] 结构树视图（`graph.roots` / `hubs` 高亮，目录汇总文件数与体积）
- [x] 内容盘点（`stats.kindCounts` / `roles` / `topDirs` / `languages`，每项都写清分母）
- [x] 文件卡片（`manifest` 的 `title` / `preview` / 缩略图 + Office/PDF 的提取文本开头）
- [x] 引用依赖图的可视化（生成时算好分层，稠密列号；点少时直接把文件名写进图里）
- [x] `stats.secrets` 审计清单可查看
- [x] 单文件输出，无外部依赖，可直接用浏览器打开（**零 JavaScript、零外部资源**）

**验收（2026-10-05 实测）**

对 M1 的三个目录各生成一份：`resume` 22 文件 / 1.5 MB 单文件、`lecture-videos` 94 文件 / 496 KB、
`qiuzhao202608` 201 文件 / 342 KB。生成耗时 0.3–4 秒（含图片缩小）。

**三名不知情的读者**（各自只看自己那一页，明令禁止翻目录）复述结果：三人都说对了「这是什么目录、
分成哪几块」；两人能指出该先看哪几个文件，一人指出「这个目录没有入口这回事」并说出依据（页面给的
0 入口/0 枢纽）。**读者提出的问题比答案更有价值**，其中六条是页面自己的毛病，都已修：

1. **同一个数三个口径**：页头报的是「画出来的边」（96），读者拿卡片上的引用数一加是 117，解读里
   实际是 133 —— 现在三个数分开写：画了 60 个点 / 96 条边、**97 个文件参与引用关系**、解读共 133 条边。
2. **「未画出」低报**：只按 `imports` 算参与数漏掉了「只出现在别人的 `importedBy` 里」的文件，
   21 应为 37。
3. **画布被撑到上万像素**：有环时层号会一路涨到节点数，60 层里只有 4 层有节点 —— 改成稠密列号，
   同一张图从 10280×750 变成 590×750。
4. **「按角色」加不起来**：79/94 有角色却按 94 算占比 —— 补「未分类」一行并写明分母。
5. **「语言 100%」误导**：Office/PDF 没有行数，占比的分母是「可计行的文本」—— 面板上写明。
6. **data URI 声明 png、字节是 jpeg**：缩小产物是 JPEG，mime 必须跟着实际字节走。

还有三处是「页面没说的」而非写错，也补了：引用列表有上限（卡片清单可能不全）、卡片标题是分析器
提取的（不保证是作者写的标题）、代码高亮图只画文件开头若干行。

**边界**：静态页面，**不是网页产品**（无服务器、**无交互逻辑** —— 折叠用 `<details>`，悬浮用 CSS，
一行 JavaScript 都没有）。见 [PRODUCT.md](PRODUCT.md) 非目标表后的说明。

---

## M7 · 视频（render 脚本）

目标：**`script.json` + `assets/` → 静音 mp4**。

落在 `packages/plugin/scripts/renderer/`。**已完成（2026-10-05）。** 模块分工：

| 文件 | 职责 | 进浏览器 bundle |
|---|---|---|
| `load.ts` | 读讲稿/解读/素材/样式预设，错误带「先跑哪一步」 | 否 |
| `estimate.ts` | 时长预估（中文约 4.3 字/秒 + 标点停顿 + 场景留白）与字幕块时序 | 是 |
| `plan.ts` | 讲稿 + 解读 + 素材 → **纯数据的渲染计划**（场景、素材地址、帧数、token） | 是 |
| `styles.ts` | 预设 JSON + `style.overrides` → 扁平 token → CSS 变量 | 是 |
| `embed.ts` / `embed-node.ts` | 图片内联的类型边界（浏览器侧）与实现（Node 侧） | 只类型 |
| `browser.ts` | 浏览器获取与结构化引导；`main.ts` 里做依赖探测也用它 | 否 |
| `entry.ts` + `scenes/` | Remotion 组合、八种场景组件、字幕组件 | **是** |
| `bundle.ts` / `render.ts` / `main.ts` | 打包、渲染、CLI | 否 |

- [x] Remotion 工程骨架（`scripts/renderer/`）
- [x] **运行时加载讲稿**：CLI 读 `script.json` 算成计划，经 `inputProps` 交给浏览器；
      bundle 里没有任何讲稿，加一个目录不改一行代码（见「已识别的坑」第 1 条）
- [x] 浏览器获取与检查：系统 Chrome / Chromium / Edge → 已下载的 Headless Shell → 结构化引导
      （**不静默下载**，退出码 3），插件侧只报依赖状态。`FOLDERCAST_IGNORE_SYSTEM_BROWSER=1`
      可以强制走「没有浏览器」那条路 —— 本机装了 Chrome，否则这条分支永远测不到
- [x] 样式 token 应用层：四套预设任选（默认 `deck`），`style.overrides` 走点号路径，认不出的键报警告
- [x] 八种场景组件（`cover` / `tree` / `inventory` / `file` / `gallery` / `clip` / `document` / `outro`）
- [x] 字幕渲染组件（由渲染层绘制，不走 ffmpeg —— 本机 ffmpeg 没有 libass）
- [x] 时长驱动时序（无音频时按字数预估；写了 `targetDurationSec` 按比例缩放）
- [x] 源文件没有素材图时用解读提取的正文开头顶上（文本、数据、密钥这类文件不再只显示一句「没有素材」）
- [x] **已经出过片且讲稿没再改时不重渲**（工具返回 `video: fresh`）—— 渲染是最贵的一步，
      不这么判，agent 每次调工具都要重出一次整片

**验收（2026-10-05 实测）**：同一份讲稿渲染两次，**逐帧一致**。

判据怎么定的（这一条花了几次返工）：Remotion 4.0.532 的 `renderFrames` 在**按帧范围**出图时
会画错帧 —— 最小复现（组合只显示 `useCurrentFrame()`，`frameRange: [100,103]`）里第 101、102、
103 帧分别画出了第 101、100、102 帧的内容，小范围（`[7,10]`）却是对的。所以判据改成
**整片渲染两次比 sha256**：输入帧完全相同时 ffmpeg 的产物也确定，字节相同即逐帧相同。
这条理由写在 `render.ts` 的注释里 —— 否则下一个人会觉得「多跑一遍没必要」而把它删掉。

证据：

- `tests/e2e.test.ts` 里有一条真跑两次渲染、比 mp4 sha256 的用例（夹具 3 个场景，约 22 秒）。
  它同时验了容器规格：只有一条 h264 视频流、没有音轨（M8 才配音）。
- **逐帧一致 ≠ 版式正确**：画面细节靠静帧人工核对（`pnpm render <目录> --still <秒>`），
  四套预设各看过一遍；浅底预设（`swiss` / `paper`）暴露过一次写死深色配色的问题，已改成从
  预设派生（见坑 8）。

| 目录 | 场景 | 时长 | 帧数 | 成片 | 内联图片 | 渲染耗时 |
|---|---|---|---|---|---|---|
| `resume` 22 文件 | 10 | 1 分 49 秒 | 3268 | 3.0 MB | 4 张 / 1.4 MB | 3 分 35 秒 |
| `lecture-videos` 94 文件 | 14 | 2 分 48 秒 | 5036 | 3.6 MB | 9 张 / 691 KB | 6 分 08 秒 |
| `qiuzhao202608` 201 文件 | 15 | 5 分 36 秒 | 10081 | 7.9 MB | 1 张 / 11 KB | 11 分 45 秒 |

实测吞吐 **13–15 帧/秒**（1920×1080、单并发、本机 M 系列），所以「约 7 帧/秒」的保守估计换成
实测值。**场景数与时长都由讲稿决定**：`qiuzhao202608` 那份写得多（1550 字），片长就是 7 分钟 ——
想短就改讲稿，或用 `video.targetDurationSec` 压。

**九条实测出来的坑**（都写进了代码注释，因为每一条都看起来像「不必这么麻烦」）：

1. **`file://` 图片读不了**：Remotion 把 bundle 挂在 `http://localhost:<端口>`，页面里的
   `<img src="file://…">` 被 Chrome 按跨源拦掉，整片渲染直接失败。图片只能在渲染前读成
   `data:` URI（先缩到画面上够用的宽度）。`<video>` 不受这条限制。
2. **`node:*` 不能出现在浏览器侧**：`plan.ts` 原来直接 import 内联实现，webpack 报
   `UnhandledSchemeError`。类型与实现拆成 `embed.ts` / `embed-node.ts`，并用
   `tests/boundary.test.ts` 钉住可达 import 图。
3. **无头 Chrome 不居中「内容撑高的面板」**：字幕条原来是 flex 居中，实测面板按一行算、
   文字掉到盒子外。现在字幕条所有尺寸都是像素级确定值（面板绝对定位 + 行高等于面板高）。
4. **`premountFor` 给整片长度会画出重复帧**：改成 1 秒（足够让下一场的图片提前解码）。
5. **素材清单只收「有产物」的文件**：文本、数据、密钥这类没有产物的文件，得靠解读的
   `preview` 兜底，否则画面只能显示文件名。
6. **`sips` 只在 macOS 有**：其他平台回退 ffmpeg，都没有就内联原图并在报告里说明。
7. **同一份代码有两套布局，所有路径都要上溯找标记而不是数层级**：`main.ts` 在仓库内是
   `scripts/renderer/`、发布版是 `lib/scripts/renderer/`，按 `../../..` 数层级在发布版里把
   样式目录算成 `packages/styles`（实测「样式预设 deck 不在 …」）。打包入口同理：
   发布版只有 `entry.js`。两处都改成「找文件」并补了测试。

**还有两条与画面无关但同样会咬人的**：

8. **组件里的颜色必须从预设派生**。早期把深色配色写死在组件里，换 `swiss` / `paper`（浅底）
   之后分类条与字幕几乎看不见 —— 现在派生色按底色深浅决定明暗（`styles.ts` 的 `kindColor` /
   `captionColors`），并有测试钉住「四套预设下都要能读」。
9. **测试文件必须串行跑**。出片用例会起无头 Chrome 逐帧渲染，与其他用例并行时抢 CPU，
   表现是「单跑必过、全量偶发失败」—— 实测撞过一次。`vitest.config.ts` 里因此显式
   `singleFork`：全量跑 3 分 10 秒，比并行还快一点。

**边界**：

- 出片是静音的（M8 才配音）；风格只暴露预设名与 token 覆盖，不做自然语言解析（押后）。
- **`clip` 场景放的是封面图，不是活动画面**。Remotion 的 `<OffthreadVideo>` 只接受
  `http(s)://`（实测报 `Can only download URLs starting with http:// or https://`），
  而素材在被讲解目录里、这一版没有本地 HTTP 服务层。画面因此显示素材阶段抽的封面图 +
  文件名 + 讲稿指定的片段区间，并在画面里写明这一点。要真播视频，得先有一个能服务本地
  文件的层 —— 那是独立的一件事，不塞进 M7。

**与 M6 的关系**：两者消费同一份解读/讲稿，**互不依赖**。M6 先做的理由是它的风险低一个数量级。

---

## M8 · 配音（voice 脚本）

目标：**成片配音 + 字幕对齐**。

- [ ] TTS 适配层（统一接口 + provider 注册）
- [ ] 第一版一个 provider 够用（多 provider 押后）。**默认 `say`**（免密钥，装了就能跑）
- [ ] `ffprobe` 实测时长
- [ ] 字幕块时长分配
- [ ] `durations.json` 输出
- [ ] 按实测时长重渲染
- [ ] 换音色只重跑本阶段

**验收**：换 provider 或音色后重跑本阶段，画面不变、仅音色与时长不同。

**凭据**：复用 DSH 凭据 seam，配置里只放引用名（[C6](REQUIREMENTS.md)）。**写稿不需要凭据，只有配音需要。**

**未配置密钥时的行为**：默认 `say` 免密钥，所以装了就能跑；用户选 MiMo 但没配 key 时，**先 `describe` 再调用**，返回结构化引导而不是等 401。见 [rd/TTS-适配调研.md](rd/TTS-适配调研.md#key-未配置时的行为)。

---

## 第一版的规模判据：无可配置空间

**判据：除了「指向哪个目录」，不需要任何其他输入。**

风格预设、自然语言风格解析、`sources` 的用户自定义、多视频切分、多 TTS provider —— **全部押后**。理由是没看到真实成片之前，无法判断哪些值得暴露。

**必需 vs 可选**要分清：默认排除规则、`maxFiles` 等规模保护是**必需**的（否则 21 万文件的目录跑不动），但它们的**值先写死成常量**，不做成配置项。

---

## 押后（设计已定，第一版不做）

这些不是被否决，是排序。

| 项 | 依赖 | 何时做 |
|---|---|---|
| **`depth` 粒度开关**（`overview` / `normal` / `detailed`）：同时控制扫描深度与叙事详略 | M1 + M5 | 见 [INTEGRATION §11.5](INTEGRATION-dsh-plugin.md#115-计划暴露给用户的配置日后)。**它控制成本，比风格更早该暴露** |
| 风格预设（R8）：四套预设 | M7 出片 | 看到真实成片、知道想改什么之后。第一版用一套硬编码 |
| 自然语言风格（R9） | 风格预设 | 有多套预设才有意义 |
| 多视频切分（R2 容器型目录） | M5 的切分规则 | 切分判据定下来之后 |
| 用户自定义筛选（R7）与规模参数 | M1 | 默认规则不够用时 |
| 设置页里的自定义内容（`settings.section`，如解读概要图表） | 另发客户端包 | 配置表单不用它——那走 `Config` schema（[ADR 0009](decisions/0009-settings-via-config-schema.md)）。第一版已声明 schema 但无字段 |
| TTS 多 provider（R6） | M8 | 先跑通一个 |
| 插件配置项 | 全部 | 出现第一个真实需求时 |
| **独立 CLI** | — | 第一版之后评估是否脱离 DSH（ADR 0008） |
| CI 里的完整管线 | 独立 CLI | 第一版靠脚本直调满足 CI 需求（M1 验收 3） |

---

## 已识别的坑

### 1. 讲稿不能静态 import

`lecture-videos` 的做法是：

```tsx
import lec00 from '../content/00-calculus.json';
const lectures = [lec00, ..., lec06];
```

**每加一个目录就要改 TypeScript 源码**。对「指向任意目录就出片」的工具这是致命的。foldercast 必须运行时加载（`calculateMetadata` 里按传入路径读取，或生成 manifest 索引）。

这是「一个视频项目」与「一个工具」的分界线，**M7 第一件事就要解决**。

### 2. 本机 ffmpeg 没有 libass

`subtitles` 和 `drawtext` 滤镜都不可用，**ffmpeg 无法烧字幕**。字幕必须在渲染层画。这决定了 M7 的字幕组件是必做项，不是可选项。

### 3. 渲染需要浏览器（C4）

**为什么需要**：Remotion ≈ 无头浏览器 + 帧驱动 + 编码。React 只描述结构，**布局必须靠排版引擎**——见 [SYSTEM-DESIGN.md §4.6](SYSTEM-DESIGN.md#46-为什么必须有浏览器c4)。

**怎么获取**：

| 顺序 | 来源 |
|---|---|
| ① | 系统已有的 Chrome / Chromium（本机已实测：`/Applications/Google Chrome.app`） |
| ② | `npx remotion browser ensure` 下载 Chrome Headless Shell |

**失败处理**：首次渲染前检查，缺失时返回结构化引导，**不崩溃**。**这不是插件加载的硬条件**——缺浏览器时 M1/M2/M5 都能跑，只有 M7 不能。

### 4. 时长必须实测

不同 TTS 引擎读同一段文字，时长差异可达 30%。所以：
- M7 用预估时长渲染（快，用于调画面）
- M8 之后用实测时长重渲染（准，用于成片）

两遍渲染是**设计的一部分**，不是浪费。

### 5. 叙事质量没有指标

事实层可以断言「分类无错判」，叙事层没有对应的判据。

**这一条现在有应对了**，也是重新排序的原因：M3 管机器能查的（路径、枚举、字数），M5 的评审 agent 管语义（编造、重点、遗漏）。两层都不完美——评审 agent 自己也会错，需要人工抽查——但**比「只能人工评审」可执行得多**。

---

## 明确不做（MVP）

- ❌ `quick` / `publish` 双模式 —— 收敛为单一路径
- ❌ 交互式选目录 UI —— 用配置文件
- ❌ 多视频批量编排 —— 手工跑多次
- ❌ 网页产品形态（站点、交互式页面、在线服务）—— 交付物是文件。**注意：M6 的静态 HTML 视图不在禁止之列**
- ❌ HTML 当渲染中间层 —— 见 [ADR 0002](decisions/0002-json-as-intermediate.md)
- ❌ 与 `lecture-videos` 共享代码 —— 保持独立（可借鉴实现，注释标注来源）
