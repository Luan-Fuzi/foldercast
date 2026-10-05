# 需求追溯矩阵

追踪每一条用户需求 → 落在哪个设计决策 → 哪个文档 → 哪个里程碑 → 如何验收。

**用法**：改设计前先查这里，确认不破坏上游需求。新增需求先在这里登记，再往下游走。

状态：`已设计` / `部分设计` / `未开始` / `已验证`

---

## 一、原始需求逐条追溯

### R1 · 输入是任意目录，不限于仓库

| 项 | 内容 |
|---|---|
| 原文 | 「不光是 repo，它可以是任意的文件夹。只要这个文件夹在某种程度上是人类可阅读的，就可以被做成科普视频」 |
| 设计决策 | 目录 ≠ 仓库：不假设 git 存在，不读 commit 历史，不做 diff |
| 文档 | [PRODUCT.md](PRODUCT.md#输入定义的边界)、[SPEC-data-format.md](specs/SPEC-data-format.md) |
| 里程碑 | M1 分析器（解读） |
| 状态 | 已设计 |
| 验收 | 对非 git 目录（如纯资料目录）跑通全流程 |

### R2 · 输出是一个或多个视频

| 项 | 内容 |
|---|---|
| 原文 | 「理论上可以把任意一个目录转化成一个或多个视频」 |
| 设计决策 | 容器型目录 → 1 总览 + N 项目视频；共用同一份分析结果与素材 |
| 文档 | [SPEC-pipeline.md](specs/SPEC-pipeline.md#多个视频) |
| 里程碑 | M5 写稿（切分动作在此，押后） |
| 状态 | 已设计 |
| 验收 | 对 `/Users/scliang/work` 这类工作区能产出 1+N 个分镜 |

### R3 · 展示组织结构

| 项 | 内容 |
|---|---|
| 原文 | 「组织结构」 |
| 设计决策 | 场景类型 `tree`，`highlight` 指定需强调的子路径 |
| 文档 | [SPEC-data-format.md](specs/SPEC-data-format.md#场景类型清单mvp) |
| 里程碑 | M1（分析出结构树）+ M7（tree 场景组件） |
| 状态 | 已设计 |
| 验收 | 结构树准确反映真实层级，不遗漏顶层目录 |

### R4 · 统计并展示有多少块可读内容，按类型分

| 项 | 内容 |
|---|---|
| 原文 | 「具体分成了多少块可阅读的内容，包括但不限于：(a) 代码 (b) 电脑上可以编辑的文本 (c) 图片 (d) 视频 (e) 办公几件套」 |
| 设计决策 | 12 类 `kind` 枚举；场景类型 `inventory` 按 kind 分组盘点 |
| 文档 | [SPEC-data-format.md](specs/SPEC-data-format.md#stats--分析统计) |
| 里程碑 | M1（分类统计）+ M7（inventory 场景组件） |
| 状态 | 已设计 |
| 验收 | 对含五类内容的目录，分类无错判，计数与 `find` 结果一致 |

**12 类 kind 与需求 (a)-(e) 的对应**：

| 需求 | kind |
|---|---|
| (a) 代码 | `code` `markup` `data` |
| (b) 可编辑文本 | `text` |
| (c) 图片 | `image` |
| (d) 视频 | `video` |
| (e) 办公几件套 | `office` `pdf` |
| 其余 | `audio` `archive` `binary` `other` |

### R5 · 每类内容都要生成演示画面

| 项 | 内容 |
|---|---|
| 原文 | 「针对这些内容，都需要生成一个比较简单的演示视频」 |
| 设计决策 | 场景类型 `file`（代码/文本）、`gallery`（图片墙）、`clip`（视频片段）、`document`（Office/PDF 分页）；素材提取方案见下 |
| 文档 | [SPEC-data-format.md](specs/SPEC-data-format.md#各类内容的提取方式零新系统依赖) |
| 里程碑 | M2 素材 + M7 场景组件 |
| 状态 | 已设计 |
| 验收 | 五类内容各产出可辨认的演示画面 |

**提取方案（已实测工具可用）**：

| kind | 方案 | 依赖状态 |
|---|---|---|
| `image` | 缩放缩略图 | `sips` ✅ |
| `video` | 抽关键帧 | `ffmpeg` ✅ |
| `pdf` | 逐页转 PNG | **`dsoffice render`** ✅（预编译 LibreOffice 引擎，接受 PDF 输入） |
| `office` | 文本结构化提取 + 转图 | `officeparser`（Node，产出带层级 AST）+ `dsoffice render` |
| `office` `.xlsx` 公式 | 重算取计算值 | `dsoffice recalculate` ✅ |
| `code` | 语法高亮截图 | `shiki` 需安装 |

**注**：原方案写的是 `PyMuPDF`，**实测它不在 DSH 捆绑 Python 里**，已改用 `dsoffice`。

### R6 · TTS 模型可配置，含小米 TTS

| 项 | 内容 |
|---|---|
| 原文 | 「让用户自定义选择使用什么样的 TTS。包括 HTTS，我个人可能会配小米的 TTS，以及一些其他的，我们做一点简单的适配」 |
| 设计决策 | 适配层统一 `synth()` 接口；provider 可插拔；音色是 provider 内参数，不做跨 provider 统一枚举 |
| 文档 | [rd/TTS-适配调研.md](rd/TTS-适配调研.md) |
| 里程碑 | M8 配音 |
| 状态 | 已设计（API 已一手核实） |
| 验收 | 同一份分镜用三个 provider 各出一版，画面一致、仅音色与时长不同 |

**已核实的小米 MiMo 能力**（超出原始预期）：

- `mimo-v2.5-tts`：9 个预置音色
- `mimo-v2.5-tts-voiceclone`：**声音克隆**
- `mimo-v2.5-tts-voicedesign`：**音色设计**
- 坑：`user` 消息 = 风格指令，`assistant` 消息 = 要读的正文

### R7 · 用户可自由选择排除哪些内容

| 项 | 内容 |
|---|---|
| 原文 | 「希望用户可以自由选择，比如提供一个目录让用户去选，把哪些内容排除出去。这个我不确定好不好做，如果好做的话可以做一下」 |
| 结论 | **好做**。本质是 glob 匹配，不需要模型参与 |
| 设计决策 | 三级筛选 `include` / `exclude` / `kinds`，外加规模保护 `maxFiles` |
| 文档 | [SPEC-data-format.md](specs/SPEC-data-format.md#sources--内容筛选维度-2) |
| 里程碑 | M1 分析器（解读） |
| 状态 | 已设计 |
| 验收 | 对 21 万文件的工作区，默认排除后降到可处理规模 |

**已知陷阱**：排除规则必须按**目录**匹配而非子串匹配，否则 `build/**` 会误伤 `build.gradle`。

### R8 · 预设几种艺术风格（瑞士风格 + PPT 风格）

| 项 | 内容 |
|---|---|
| 原文 | 「想预设几种艺术风格。比如我个人更倾向于用瑞士风格，还可以预设一些比较常用的 PPT 播放类型的视频风格」 |
| 设计决策 | 四套预设：`swiss` / `deck` / `console` / `paper`；31 个 token，四套键集合完全一致 |
| 文档 | [rd/风格预设系统.md](rd/风格预设系统.md) |
| 里程碑 | 押后（见 ROADMAP） |
| 状态 | 已设计，预设文件已落地并通过校验 |
| 验收 | 同一份分镜用四套预设各渲染一版，观感差异明显且都可用 |

`swiss` 不是凭空设计的 —— 它沿用同作者 `lecture-videos` 里**已在真实项目中验证**的 `theme.ts` 视觉体系。

### R9 · 用户可用自然语言写风格

| 项 | 内容 |
|---|---|
| 原文 | 「也可以让用户自己用自然语言去写」 |
| 设计决策 | 两段式：写稿阶段用模型把自然语言解析成 token 覆盖 → **回写进 `overrides`** → 渲染阶段只读 JSON，不调模型 |
| 文档 | [rd/风格预设系统.md](rd/风格预设系统.md#五自然语言--token-的映射) |
| 里程碑 | 押后（见 ROADMAP） |
| 状态 | 已设计 |
| 验收 | 常见描述能正确映射；映射不了的写进 `style.unresolved` 并报错，不静默丢弃 |

**三条硬约束**：① 只允许覆盖已存在的 token（不能发明）② 枚举值必须落在白名单 ③ 解析结果必须回写，保证渲染确定性。

---

## 二、设计过程中新增的约束

不是用户提的，是实现约束推导出来的。**这些同样是硬需求。**

| 编号 | 约束 | 来源 | 文档 | 状态 |
|---|---|---|---|---|
| C1 | **分镜不能静态 import**。每加一个目录都改 `.tsx` 等于不是一个工具 | 读 `lecture-videos/src/Root.tsx` 发现 | [ROADMAP.md](ROADMAP.md#已识别的坑) | 未开始 |
| C2 | **字幕不能走 ffmpeg**。本机 ffmpeg 未编译 libass，`subtitles`/`drawtext` 均不可用 | 实测 `ffmpeg -filters` | [SPEC-data-format.md](specs/SPEC-data-format.md) | 已设计 |
| C3 | **时长必须实测**。不同 TTS 引擎读同一段文字，时长差异可达 30% | 工程推导 | [SPEC-pipeline.md](specs/SPEC-pipeline.md) | 已设计 |
| C4 | **渲染需指定本机 Chrome**。当前网络下不了 Chrome Headless Shell | `lecture-videos/remotion.config.ts` 的现成处理 | [ROADMAP.md](ROADMAP.md#已识别的坑) | 待验证 |
| C5 | **两遍渲染是设计的一部分**。阶段②用预估时长（调画面），阶段③用实测时长（出成片） | 由 C3 推导 | [SPEC-pipeline.md](specs/SPEC-pipeline.md) | 已设计 |
| C6 | **密钥不进配置、聊天记录与命令行**。复用 DSH 的凭据 seam（`ctx.credentials`），配置里只放**引用名**。解析优先级由 DSH 固定：启动环境 → 凭据存储 → 项目 `.env` → `$DSH_HOME/.env` | 旧项目把 key 放项目根，有误提交风险；DSH 已提供凭据 seam，自己实现没有收益 | [rd/TTS-适配调研.md](rd/TTS-适配调研.md#key-的存放) | 已设计 |
| C7 | **叙事层必须能读文件内容**。只看摘要写不出内容层的语义，混杂资料目录会失效 | 设计过程中发现循环依赖 | [ADR 0006](decisions/0006-narration-layer-moves-up.md) | 已设计 |
| C8 | **密钥类文件按文件名排除，不做内容检测，且必须声明边界**。判据只做一层：零成本、确定、无误报 | 作者提问「不读它怎么知道它是密钥文件」；调研后否决内容检测（同类工具无一实现，实测上限不可靠） | [ADR 0007](decisions/0007-secret-file-exclusion.md) | 已设计 |

---

## 三、需求 → 里程碑覆盖检查

**里程碑编号按执行顺序排**（[ROADMAP.md](ROADMAP.md)），不完全是管线顺序：

| 编号 | 内容 | 执行者 |
|---|---|---|
| M1 | 分析器（解读） | 脚本 |
| M2 | 素材 | 脚本 |
| M3 | 契约校验脚本 | 脚本 |
| M4 | 插件骨架 | npm 包 |
| M5 | 写稿 + 评审 agent | 主 agent + subagent |
| M6 | HTML 视图 | 脚本 |
| M7 | 视频 | 脚本 |
| M8 | 配音 | 脚本 |

**两处刻意的偏离**（理由见 [ROADMAP.md 排序原则](ROADMAP.md#排序原则)）：校验（M3）早于写稿（M5），因为这项目的最大空白是叙事质量没有判据；HTML 视图（M6）早于视频（M7），因为它不需要渲染与配音，反馈最快。

| 需求 | M1 解读 | M2 素材 | M3 校验 | M4 骨架 | M5 写稿 | M6 HTML | M7 视频 | M8 配音 |
|---|---|---|---|---|---|---|---|---|
| R1 任意目录 | ● | | | | | | | |
| R2 一个或多个视频 | | | | | ● | | | |
| R3 组织结构 | ● | | | | | ● | ● | |
| R4 内容分类统计 | ● | | | | | ● | ● | |
| R5 各类型演示 | | ● | | | | ● | ● | |
| R6 TTS 可配 | | | | | | | | ● |
| R7 内容筛选 | ● | | | | | | | |
| R8 风格预设 | | | | | | | ● | |
| R9 自然语言风格 | | | | | ● | | | |
| C1 运行时加载 | | | | | | | ● | |
| C2 字幕渲染层 | | | | | | | ● | |
| C3 实测时长 | | | | | | | | ● |
| C4 浏览器获取 | | | | | | | ● | |
| C6 凭据 seam | | | | ● | | | | ● |
| C7 叙事层通读 | | | | | ● | | | |
| C8 密钥不读 | ● | | | | | | | |

**无孤儿需求**：每条需求至少被一个里程碑承接。
**无孤儿里程碑**：每个里程碑都在承接需求。

**押后的部分**：R7 的用户自定义、R8 / R9 整体、R2 的多视频切分形态不属第一版，见 [ROADMAP.md 押后表](ROADMAP.md#押后设计已定第一版不做)。

---

## 四、变更记录

| 日期 | 变更 | 影响 |
|---|---|---|
| 2026-10-04 | MVP 范围收敛：取消 `quick`/`publish` 双模式，固定「文案→视频→配音」单一路径 | 原 ROADMAP 的双模式设计废弃 |
| 2026-10-04 | 中文名定为「目录放映」 | 仅影响文档表述，不影响设计 |
| 2026-10-04 | 项目定名 `foldercast`，独立工作区，不与 `lecture-videos` 融合 | 目录结构 |
| 2026-10-04 | 叙事层下移给 Agent 集群，可通读文件内容；隐私不再作为架构理由 | ADR 0006；`PRODUCT.md` 与 `SYSTEM-DESIGN.md` 的隐私表述作废 |
| 2026-10-04 | 解读与讲稿分为 `foldercast.json` / `script.json` 两份文件 | 契约、schema、示例、渲染器读取路径全部调整 |
| 2026-10-04 | 引用依赖成为理解的一部分，进 `manifest[].imports` 与 `graph` | M1 范围扩大 |
| 2026-10-04 | 密钥类文件按文件名排除，`stats.secrets` 审计；否决内容检测 | ADR 0007（初版三层判据被否决） |
| 2026-10-04 | 第一版判据：无可配置空间 | R6/R7/R8/R9 与多视频切分押后 |
| 2026-10-04 | 里程碑按依赖重排：M3 = 契约校验脚本（早于写稿），M6 = HTML 视图（早于视频），M4 = 插件骨架，M8 = 配音 | 编号与管线顺序不再一致；追溯表的里程碑列重画 |
| 2026-10-04 | Office 与 PDF 转图改用 `dsoffice`（DeepSeek 的 `libreoffice-kit`）；删除 PyMuPDF 与 poppler | 依赖清单、M2 清单、许可清单同步 |
| 2026-10-04 | 仓库全面去 Python：`check-links.py` 等四个检查脚本改写为 TypeScript，CI 由 Python 3.11 改为 Node 22.19 + pnpm | 新增根目录 `package.json` / `tsconfig.json` / `scripts/lib/`；`check-links.py` 删除；`.gitignore` 去掉 Python 段 |
| 2026-10-04 | 第一版只注册一个工具 `foldercast_cast`；细粒度工具（analyze/script/render/voice）押后 | 消除 ROADMAP M4 与 INTEGRATION 工具表的冲突 |
| 2026-10-04 | npm 包名定为 `dsh-foldercast`（两候选在 registry 均未被占用，选带前缀者） | M4 发布；`foldercast` 留给日后的独立 CLI |
| 2026-10-04 | 契约类型移到共享模块 `packages/plugin/scripts/contracts/`，analyzer 与 renderer 都依赖它 | 原来「类型放 renderer」会让 analyzer 依赖 renderer，违反两者互不依赖 |
| 2026-10-04 | 工作根定为 `<源目录>/.foldercast/`，内含解读、讲稿、素材、音频、成片；`outputDir` 第一版不做成配置 | M1 的输出契约；明确两条路径基准（源目录 / 工作根） |
| 2026-10-04 | schema 各层收紧为 `additionalProperties: false`，映射字段除外；`check-json.ts` 增加重复键检测 | 修掉 `foldercast.schema.json` 里 `graph` 被定义两遍（`JSON.parse` 静默保留后者）；M3 校验强度提高 |
| 2026-10-04 | **M1 完成**：分析器落地（`packages/plugin/scripts/analyzer/`），四条验收全部通过 | 新增 `packages/plugin` 包与 workspace；契约类型在 `scripts/contracts/`；实测 21.3 万文件 0.34 秒、124 MB。office/pdf/video 的 preview 深化提取顺延到 M2 |
| 2026-10-05 | **M2 完成**：素材阶段落地（`packages/plugin/scripts/assets/`），office/pdf/video 的 preview 已补齐 | 新增依赖 `officeparser` / `shiki` / `@deepseek-ai/libreoffice-kit`（optional）；`assets/manifest.json` 契约定型；代码素材用 SVG；`.gitignore` 的 `assets/` 改为 `/assets/`（原写法把产品代码目录也忽略了） |
| 2026-10-05 | **M3 完成**：契约校验脚本落地（`packages/plugin/scripts/validate/`），验收「故意写坏的讲稿全部报出」通过 | 新增 `contracts/script.ts`（讲稿类型）与 `contracts/subtitles.ts`（字幕切分，校验与配音共用）；`script.schema.json` 用 `allOf` 补上各场景的必需字段；字幕的「24 字」明确为按显示宽度折算 |
| 2026-10-05 | **契约补第三份 schema**：`docs/specs/assets.schema.json`（素材清单原来只有人读说明），校验器顺带校验它 | 三处表示同步的规矩从两份契约扩到三份；`check-examples` 负责 schema 自身的写法 |
| 2026-10-05 | **M4 完成**：插件 `dsh-foldercast` 落地（一个工具 `foldercast_cast` + 一个随包 skill + 空 `Config`），三条验收通过两条、第三条数据面已验 | 插件侧零框架依赖（不用 `dsh-tools`/`cordis`）；发布版必须 `tsc` 编译（`node_modules` 里禁止 TS 类型剥离）；随包 `schemas/` 由 `prepack` 生成 |
| 2026-10-05 | **修 M4 留下的路径 bug**：`PACKAGE_ROOT` 原来按「上一级目录」算，在编译产物（`lib/src`）里会算成 `lib/`，装进 desktop profile 后工具直接报「插件包不完整」 | 包根改为上溯找 `package.json`；阶段入口按「在不在 `node_modules` 里」选 `.ts` / `lib/**/*.js`；新增从 `lib/` 加载编译产物的守卫测试，CI 里构建提前到测试之前 |
| 2026-10-05 | **修分析器的密钥审计漏洞**：密钥类文件会被 `maxFiles` 截断一起丢掉，于是既不在清单、也不在 `stats.secrets.excluded` 里（实测：200 文件的目录里 `lecture-videos/.mimo_api_key` 就是这样消失的） | 密钥文件不占 `maxFiles` 配额、也不被截断 —— 它们本来就不读内容，而审计必须完整；补测试钉住「截断后密钥仍在清单与审计里」 |
| 2026-10-05 | **M6 完成**：HTML 视图落地（`packages/plugin/scripts/html/`），解读 + 素材 → 单文件静态页；对三个真实目录各生成一份，三名不知情的读者只读页面复述目录结构，据此修掉数字口径、标签定义与图像呈现上的六处问题 | 页面**零 JavaScript、零外部资源**（CSS 内联、图片按页面尺寸缩小后内联，超预算的退相对路径并在页脚说明）；依赖图在生成时算好分层（稠密列号，避免空列把画布撑到上万像素）；工具新增 `html` 阶段与 `htmlPath`，**不依赖讲稿**所以写完稿之前就能看 |
| 2026-10-05 | **M5 完成**：写稿 + 评审 agent 落地。skill 从 97 行扩到 200 行（六步工作流、通读策略与降级路径、场景选择判据、写稿要求、六条评审判据）；三个真实目录各出一份讲稿并过契约校验；评审由**独立 subagent** 执行、结论落盘 | 工作根新增 `review.md`（agent 产出，不入 schema——校验器管机器能判的，评审管语义）；工具新增 `next: needsReview` 与 `reviewPath` / `review`（`missing` / `stale` / `fresh`），**改过讲稿旧评审自动作废**；skill 与 schema 的一致性交给 `src/tests/skill.test.ts` |
