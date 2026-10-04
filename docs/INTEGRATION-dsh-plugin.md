# DSH 插件集成指南

把 foldercast 注册为 DeepSeek Harness 插件需要遵守的规范。

**本文的每一条都经一手核实**：DSH 官方文档（`docs/user/develop/`、`docs/develop/`）、随 App 分发的包 README（`dsh-plugin-manager`、`dsh-agent-preset-registry`、`dsh-client-ui-slots`、`dsh-client-ui-settings`、`dsh-skill-filesystem`、`dsh-tool-skill`）、npm registry 上的实际包元数据，以及本机实测（`dsh --help`、`dsh --profile web --dump-config`、读 `~/.dsh/profiles/desktop/`、解压会话日志核对 `agentPreset` 与权限事件）。核实日期 2026-10-04，本机 DSH 版本 `0.2.0-rc.2`。

**每条都标了验证状态**：

| 标记 | 含义 |
|---|---|
| **已实测** | 在本机跑过、读过实际产物 |
| **文档记载** | 官方文档明写，本机未复现 |
| **未验证** | 由结构推断，需实测确认 |

---

## 一、插件形态

foldercast 是**工具提供方（Consumer）插件**，通过子进程调用独立 CLI。理由与取舍见 [ADR 0005](decisions/0005-dsh-plugin-shape.md)。

```
DSH 进程
  └── foldercast 插件（TypeScript，轻量）
        │  ctx.tools.register(defineTool(...))
        │  execute() → 子进程
        ▼
      foldercast CLI（独立；Python + Node + ffmpeg）
```

**插件进程内不做渲染、不做分析、不加载 Python 依赖。**

### 1.1 插件能提供什么（四件事，不是一件）

原本文档只写了「注册工具」。实际能力面更大：

| 能力 | 机制 | 前置 | 验证状态 |
|---|---|---|---|
| 注册工具 | `ctx.tools.register(defineTool(...))` | 无 | 文档记载 |
| 注册 Cordis 服务 | `ctx.plugin(SomeService)` | 无 | 文档记载 |
| 暴露配置 schema | `Config`（`@deepseek-ai/schemastery`），放在 `dependencies` | 无 | 文档记载 |
| **贡献 Web / Desktop UI** | `ctx.slots.register()` | 需另发客户端包 | 文档记载（本机未注册过插槽） |

第四项是最重的一块：要写 TypeScript + React、要构建、要跟 `ui-renderer` 配合。**第一版不做**（见 [第十节](#十第一阶段的能力边界)）。

### 1.2 我们第一版只用第一项

理由是「无可配置空间」的判据（[ROADMAP.md](ROADMAP.md#第一版的规模判据无可配置空间)）：一个工具 + 对话触发就够，不需要设置页，也不需要侧边栏。

---

## 二、Manifest 规范

### 2.1 完整 `package.json`

```jsonc
{
  "name": "foldercast",                    // 或 dsh-foldercast
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",

  "exports": {
    ".": "./lib/index.js",
    "./package.json": "./package.json",     // 必需：供展示元信息回退读取
    "./locale/*.json": "./locale/*.json",   // 必需：供标题/描述读取
    "./icon": "./icon.svg"                  // 可选：卡片图标
  },
  "files": ["lib", "locale", "icon.svg", "cordis.patch.yml"],

  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" }
  },

  "peerDependencies": {
    "@deepseek-ai/cordis": "~4.0.4",
    "@deepseek-ai/dsh-tools": "^0.2.0-rc.2",
    "@deepseek-ai/schemastery": "~3.18.4"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "~4.0.4",
    "@deepseek-ai/dsh-tools": "^0.2.0-rc.2",
    "@deepseek-ai/schemastery": "~3.18.4"
  },

  "engines": { "node": "^22.19.0 || >=24.0.0" },
  "license": "MIT",
  "keywords": ["dsh", "dsh-plugin", "video", "agent"]
}
```

### 2.2 `dsh.bundle` —— 声明这是一个组合包（**必需**）

```json
{ "dsh": { "bundle": { "patch": "./cordis.patch.yml" } } }
```

`patch` 可以是**一个文件路径**，也可以是**有序路径数组**（如 `["./base.patch.yml", "./web.patch.yml"]`），按序作为同一层应用。

`cordis.patch.yml` 的内容是 patch 条目数组，插件行**按包名**引用（不是相对路径）：

```yaml
- insert:
    - id: foldercast
      name: foldercast
```

**没有 `dsh.bundle` 声明的包仍可安装，但只作为普通依赖** —— `dsh plugin` 会打印警告且不激活任何层。这种情况下插件不会被加载。

**所以 `dsh.bundle` 不是可选项，是必需的。** 漏掉它，插件装上了但不生效，且失败方式是"静默不激活"而非报错。

### 2.3 版本约束：靠 `peerDependencies`，**不是** `engines.dsh`

这是最容易搞错的一条。DSH 的兼容性检查：

> profile 导入插件前，DSH 会检查其 `peerDependencies` 中对 `@deepseek-ai/dsh` 和 `@deepseek-ai/dsh-*` 的依赖，与 `getDshRuntimeVersion()` 返回的唯一运行时版本比较。每个声明的版本范围都必须匹配；预发布版本参与范围匹配。……这些检查使用 peer 声明，**而不是 `engines.dsh`**。

规则细则：

| 情形 | 结果 |
|---|---|
| 声明了 DSH peer，范围匹配 | 加载 |
| 声明了 DSH peer，范围不匹配 | **拒绝加载** |
| 声明了 DSH peer，范围无效（写错了） | **视为不兼容，拒绝加载** |
| 未声明任何 DSH peer | 不施加版本约束（**不推荐** —— 等于放弃保护） |

**foldercast 的策略**：声明 `@deepseek-ai/dsh` 与所有 `@deepseek-ai/dsh-*` 依赖的 peer 范围，且**只声明实际 import 的包**。

DSH 生态的版本发布节奏快（`@deepseek-ai/dsh` 从 8 月到 10 月已发 30 个版本），所以：

- 用 `^0.2.0-rc.2` 这类允许同 minor 的保守范围，**不要用 `*`**
- 每次升级 DSH 适配时，同步更新 peer 范围与本文档顶部的核实日期
- `peerDependencies` 与 `devDependencies` **必须同时声明且范围一致**（官方包的不变量）

### 2.4 展示元信息：`locale/en.json` + `locale/zh.json`

插件的标题与描述在插件管理页面显示，来源是 locale 文件：

```jsonc
// locale/en.json
{ "meta": { "title": "FolderCast", "description": "Turn any folder into an explainer video." } }

// locale/zh.json
{ "meta": { "title": "目录放映", "description": "把任意目录变成讲解视频。" } }
```

回退链（字段独立回退）：

| 字段 | 回退顺序 |
|---|---|
| 标题 | locale `meta.title` → `package.json` 的 `name`（包根插件）→ 完整 Cordis 插件名 |
| 描述 | locale `meta.description` → `package.json` 的 `description` → 无描述 |

**必须 export `./locale/*.json` 与 `./package.json`**，否则读取器找不到。

### 2.5 图标（可选）

在导出的 manifest 里声明 `"icon": "./icon.svg"`，或 export `./icon`。

- 支持 SVG / PNG / JPEG / WebP，**上限 256 KiB**
- 必须是**自包含**的；SVG 按图片渲染，不当内联 HTML 处理
- 图片必须留在包内，禁止绝对路径、URL、符号链接逃逸
- 声明无效时保留有效文本并给出诊断，不激活插件

### 2.6 版本豁免机制（仅应急）

不兼容的插件会**加载失败**。用户可以走豁免：

```
# profile 的 compatibility.json 记录，键是精确的 package-name@version
dsh plugin --profile <name> allow-version foldercast@0.1.0 \
  --dsh-version 0.2.0-rc.2 --accept-risk
```

要点：
- 豁免是**精确版本对精确运行时版本**，插件升级与 DSH 升级**都不继承**
- 需要 `acceptRisk: true`，且只能在明确告知用户风险后传入
- 豁免**不授权依赖的构建脚本**（那是另一个开关）

foldercast 不应鼓励用户走这条路 —— 正确做法是及时更新 peer 范围。

---

## 三、插件实现规范

### 3.1 Cordis 插件形状

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'foldercast'
export const inject = ['tools']          // 等待工具注册表就绪

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({ /* ... */ }))
}
```

三种插件形态（函数 / 对象 / Service 子类）中，**foldercast 用函数形态** —— 它不对外提供 Cordis 服务，只注册工具。

### 3.2 注册是 effect 式的

> Registration is effect-based: disposing the plugin fiber unregisters the tool.

**这意味着不需要手写清理逻辑。** fiber 卸载时工具自动注销。不要在自己的代码里维护注册表。

另外：**注册借用你的只读定义**。注册后不要修改 schema 或替换回调。要热替换工具，得先 dispose 所属 effect 再注册新的。

### 3.3 工具契约（`defineTool`）

```ts
ctx.tools.register(defineTool({
  name: 'foldercast_cast',
  description: 'Cast a folder into an explainer video.',   // 模型看到的描述，主动语态 5–10 词
  parameters: {
    path: { type: 'string', required: true, description: 'Absolute path of the folder to cast' },
  },
  output: {
    schema: { type: 'object', properties: { /* ... */ }, required: [/* ... */] },
    render: (_args, value) => [{ type: 'text', text: /* ... */ }],
  },
  async execute(args, exec) {
    // args 已按 schema 校验并推导出类型
    // exec.signal 是取消信号，必须响应
  },
}))
```

**参数按第一版判据收窄到一个。** `style` / `targetSec` / `exclude` 是设计里已有的维度，但第一版不暴露成参数（见 [ROADMAP.md](ROADMAP.md#第一版的规模判据无可配置空间)）。

**已删除的旧参数**：`style`（多预设押后）、`targetSec`（时长软约束押后）、`exclude`（用户自定义筛选押后）。等第一版跑通、看到真实成片之后再逐个放开。

### 3.4 `execute()` 的硬性规则

这些是官方明确列出的契约，逐条对照：

| 规则 | foldercast 的落实 |
|---|---|
| **参数已替你校验**。DSH 在 `execute` 前校验类型、必填、字面量约束、嵌套值 | 直接用 `args`。但**非空字符串、正数、跨字段规则仍要自己查** —— 例如 `targetSec` 必须为正 |
| **只声明并返回一个规范值**。`output.schema` 用 `ValueSchemaSpec`，`execute` 只返回该值 | 返回结构化对象（`{ videoPath, scenes, durationSec, warnings }`），**不要在 body 里返回内容块**，也不要让调用方解析散文拿字段 |
| **抛出或返回非法值 = `isError`** | 见下方 3.5，这是 foldercast 最需要注意的一条 |
| **必须响应 `exec.signal`** | 收到取消要**杀掉子进程树**，不只是置标志位 |
| **用 `exec.agent` 做异步通知**（可选） | `agent.inject({ content, source: { kind: 'foldercast' } })` 追加**下一次**模型请求可见的上下文。注意：**它不是唤醒** —— 空闲 agent 保持空闲。需通过 `MessageSourceMap` 声明该 `kind` |
| **用 `presentationMeta` 投影可回放数据**（可选） | 若要做结果卡片（如视频缩略图 + 时长），在这里派生可回放的 JSON |

### 3.5 失败语义：渲染失败**不应该**抛出

官方在 `dsh-tool-bash` 里确立的范式值得直接照搬：

> 非零退出以 `[exit code: N]` 报告给 agent 解读，**而不是作为工具错误抛出**。

对照到 foldercast：

| 情况 | 处理 |
|---|---|
| 渲染失败、TTS 配额耗尽、目录分析出错 | **返回规范值**，内含失败事实与诊断，让模型自己决策重试或换策略 |
| 子进程无法启动（CLI 未安装） | 可以抛出 —— 这是基础设施故障 |
| 参数越界（`targetSec` 为负） | 抛出 —— 调用方错误 |

理由：模型看到「渲染失败，因为 ffmpeg 缺少 x264 编码器」比看到一个异常堆栈更有用。

### 3.6 启动失败策略：**必须让 foldercast 是 optional**

这是决定插件要不要做重的关键约束。DSH 的启动失败策略（官方表格）：

| 失败模式 | Optional 条目 | Required 条目 |
|---|---|---|
| 模块 import 失败 | 警告；继续 | **终止启动** |
| 同步 `apply()` 抛出 | 警告；继续 | **终止启动** |
| 注入的服务不可用 | 警告；继续，条目等待依赖 | **终止启动** |

**foldercast 插件绝不能成为 required 条目。**

原因：它的作用是「多一个工具」。如果它崩了导致整个 harness 起不来，用户会立刻卸载它 —— 这是最严重的可用性缺陷。

具体做法：
- 插件在 `apply()` 里**不做任何可能失败的重活** —— 不检测 CLI、不读配置、不起进程
- CLI 可用性检测放在**首次工具调用时**，失败就返回一个说明清楚的领域结果
- 不把 foldercast 放进任何 required 的系统提示装配路径

### 3.7 未处理的 rejection 是致命的

官方表格里有一条对 foldercast 尤其相关：

> 脱离 `apply()` 返回 Promise 的异步任务产生未处理 rejection → **致命错误：释放应用并以非零码退出**，与条目 id 无关。

**这条直接支持了 ADR 0005「渲染必须出进程」的决策。** 在 harness 进程内跑 Remotion（要起无头浏览器、有大量异步 I/O）意味着任何一个漏 catch 的 rejection 都可能杀掉整个 harness。

因此插件内的所有子进程调用必须：
- 完整 `try/catch`，包括 `spawn` 的 `'error'` 事件
- 监听并处理子进程的 `'exit'` 与 `'close'`
- 不留下悬空的 Promise

---

## 四、工具设计建议

### 命名

生态惯例是 `dsh-tool-<动作>`。模型可见的 `name` 用下划线：

```
foldercast_analyze    分析目录，产出 stats/manifest
foldercast_script     生成分镜（文案）
foldercast_render     渲染静音视频
foldercast_voice      配音（换音色重跑）
foldercast_cast       一条龙：分析 → 文案 → 渲染 → 配音
```

**拆成多个细粒度工具**而非一个巨型工具，理由是管线本来就是分阶段的、可重跑的（见 [SPEC-pipeline.md](specs/SPEC-pipeline.md)）。模型可以只渲染不配音、或换个音色重配音，不必整条重跑。

### `description` 的写法

官方要求主动语态、5–10 词。它显示在 UI 里标注该次调用。写清**副作用**：

```
foldercast_render — "Render a storyboard into a silent mp4"
foldercast_voice  — "Synthesize narration audio and burn subtitles"
```

### 长任务的进度

渲染可能跑几分钟。参考 `dsh-tool-bash` 的做法：增量输出、必要时 spill 到文件并报告路径。

**用结构化输出（JSON lines）回传进度，不要靠解析自然语言的 stdout。**

---

## 五、分发与发现

| 环节 | 做法 |
|---|---|
| 发布 | npm。包名 `foldercast` 或 `dsh-foldercast`，均已确认可注册 |
| 发现 | GitHub 仓库加 **`dsh-plugin` 话题** —— 这是官方指定的发现机制 |
| 安装 | `dsh plugin --profile web add foldercast` |
| 市场 | 会被 `dsh-plugin.org`、`dsh-market`、`dsh-find-plugin` 等自动索引（它们抓 `dsh-plugin` 话题） |
| 精选列表 | 向 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提 PR（社区唯一开放的外部 PR 通道） |

**注意**：官方仓库 `deepseek-ai/deepseek-harness` **不接受外部 PR**（Issues 也是关闭的，反馈走 Discussions）。所以不存在「贡献进官方仓库」这条路 —— 生态贡献就是发布自己的包。

---

## 六、插件配置项（第一版不暴露字段，但 schema 先立）

**机制**：声明 `Config` schema，**宿主据此生成设置页**（[ADR 0009](decisions/0009-settings-via-config-schema.md)）。规则：

- 标了 `.volatile()` 的字段才进表单、才可写；写入走 live path，**不重载插件行**
- 没标的字段只作默认值与校验，用户改不了
- `min` / `max` / 默认值直接变成表单控件的范围与初值

```ts
import z from '@deepseek-ai/schemastery'

export const Config = z.object({
  ttsProvider: z.union(['say', 'edge', 'mimo']).default('say').volatile(),
  ttsVoice: z.string().volatile(),
  depth: z.union(['overview', 'normal', 'detailed']).default('normal').volatile(),
  stylePreset: z.string().default('swiss').volatile(),
})
```

**第一版不暴露任何字段**（[ROADMAP.md](ROADMAP.md#第一版的规模判据无可配置空间)），理由是「没看到真实成片之前无法判断哪些值得暴露」。但 schema 先立起来，字段空着，机制先通。

计划暴露的字段（见 [11.5](#115-计划暴露给用户的配置日后)）：

| 字段 | 类型 | 默认 | 何时放开 |
|---|---|---|---|
| `ttsProvider` / `ttsVoice` / `ttsStyle` | enum + string | `say` | M5 之后 |
| `depth` | enum | `normal` | 见 11.5 —— **控制成本，最早该暴露** |
| `stylePreset` | enum | `swiss` | M4 出片之后 |
| `cliPath` | string | 自动探测 | **不`volatile()`**：探测失败该走报错，不该让用户填 |
| `outputDir` | string | `<源目录>/.foldercast` | 等有人要改产物位置 |

**凭据不进配置项**：只放环境变量名（`apiKeyEnv` 引用），与 `dsh-usage` 一致——「API key 经宿主凭据缝解析……**永不进入浏览器**」。

**`@deepseek-ai/schemastery` 放在 `dependencies`**（不是 `peerDependencies`），与 `dsh-agent-loop`、`dsh-usage` 的做法一致。

**与自建设置页的分工**：`Config` 管「配置表单」，`settings.section` 管「自定义内容」（数据面板、可视化）。两者可并存，见 [第十五节](#十五两种-ui-扩展机制)。

---

## 七、安装、启用与权限

### 7.1 三条安装路径

| 路径 | 谁用 | 权限要求 | 验证状态 |
|---|---|---|---|
| Web 侧边栏「插件」页 | 人 | 无（界面操作） | 文档记载 |
| `dsh plugin --profile <name> add <pkg>` | 人（终端） | 无（就是 pnpm） | 已实测（命令存在、行为如文档） |
| 对话里让 agent 调 `plugin_manager` | 模型 | `danger-full-access` 或本次调用的批准 | 文档记载；**本机该工具默认关闭**，见 7.3 |

**foldercast 的安装说明应该写前两条**，不要依赖第三条。

启用/停用同样走前两条：Web 插件页管理组合包与「能唯一定位的行」，或直接改 profile 的 `cordis.patch.yml`。改动**影响该 profile 的所有会话**。开 HMR 时立即生效，否则等重启。

### 7.2 权限是三层的，不是一层

| 操作 | 门槛 | 为什么 |
|---|---|---|
| 读写文件 | 会话的沙箱档位（`read-only` / `workspace-write` / `danger-full-access`） | 高频，影响限于文件 |
| 装 / 启用插件 | 基础默认**关闭**，要显式开 | 低频，影响是往 harness 进程注入代码 |
| 运行依赖的构建脚本 | 再单独批准一次 | 以宿主用户权限执行命令 |

**装插件等于在 harness 进程内跑宿主代码，不受工作区沙箱限制**（官方原话：「已安装的 Host 代码在宿主进程内运行，不受工作区沙箱限制」）。这是第二层单独设门槛的原因。

沙箱模式与审批是**两档独立设置**，由 `dsh-permission-presets` 成对给出：

```yaml
presets:
  read-only:          { sandbox: read-only,          approval: ask }
  workspace-write:    { sandbox: workspace-write,    approval: ask }
  danger-full-access: { sandbox: danger-full-access, approval: never }
```

沙箱模式来自 `DSH_PERMISSION_MODE`，默认 `workspace-write`。**`danger-full-access` 的字面意思是「绕过文件系统隔离」**，不是「最高权限」——官方明确网络与进程可见性不在这个词汇的定义范围内。

### 7.3 `plugin_manager` 在本机默认关闭（**已实测**）

从 `dsh --profile web --dump-config` 的根部（`@deepseek-ai/dsh-base` 层）：

```yaml
- id: tool-plugin-manager
  name: '@deepseek-ai/dsh-plugin-manager/tools'
  disabled: true
```

**基础默认关，不随预设选择而变。** 实测证据：本机一个 `agentPreset: standard` 的会话（从会话日志头读出），标准预设内部确实声明了 `tool-plugin-manager`（缩进 6 层，属 preset 的插件列表），但该会话的工具列表里没有 `plugin_manager`。

「创造模式（`cordis` 预设）提供 `plugin_manager` 与两个 `cordis_inspect_*` 工具」是官方说法。**但这个部署根部的 `disabled: true` 是否被预设覆盖，未验证。** 要确认就切到 `cordis` 预设开一个新会话，看工具列表。

### 7.4 注册依赖平台与客户端

**Desktop profile 由 Electron 独占管理**，`dsh --profile desktop --dump-config` 直接报错 `profile "desktop" is managed exclusively by the Electron application`。当前桌面 App 用的就是它（`DSH_PROFILE=desktop`）。

**CLI 里没有 UI 插槽。** `dsh web` / `dsh tui` / `dsh headless` 从同一 profile 加载同一套插件，工具都能用，但插槽是 Web 客户端机制，TUI 与 headless 不渲染。

### 7.5 网络

`plugin-manager` 的 `fallbackRegistries` **默认已含 `https://registry.npmmirror.com/`**，国内装包不用自己配镜像。注册表探测与 GitHub 连通性检查都在下载前完成（`inspectTimeoutMs` 20s、`githubConnectionTimeoutMs` 5s）。

---

## 八、UI 扩展点（第一版不用，记录备查）

Slots 是 Web / Desktop 客户端的类型化 React 组合系统。插件用 `ctx.slots.register()` 把组件注册进父级已声明的插槽，**绝不 import 其他插件的组件**。

**四种基数**：`single`（单个占位者）、`list`（有序条目，按 `order` 排）、`keyed`（owner 传 `entryKey` 分派）、`chain`（各条目提供 `select()`，第一个非 null 获选）。

**与 foldercast 相关的插槽**（从 `docs/subsystems/slots.zh.md` 与包 README 提取，**未实测注册**）：

| 插槽 | 位置 | 对 foldercast 的用途 |
|---|---|---|
| `settings.section` | 设置面板的功能页 | **自定义内容**（配置表单不用它，见 [第十五节](#十五两种-ui-扩展机制)） |
| `tool.call.toolview` | 工具调用的自定义渲染 | 渲染进度、结果卡片、视频缩略图 |
| `sidebar.right.pane.tab` / `sidebar.right.tab.menu` | 右侧栏标签页 | 播成片 / 展示目录解读 |
| `conversation.session.header.actions` | 会话头部操作按钮 | 「把这个目录讲一遍」 |
| `conversation.chat.node` | 会话流中的自定义节点 | 把成片作为消息插入对话 |

### 8.1 三个易错点

**一、设置里的「插件」分区不是我们的配置页。** `settings.plugins.tab` 承载的是**只读**的插件清单与页面。

**二、设置页 ≠ 要写客户端包。** 配置表单由宿主从 `Config` schema 生成（[ADR 0009](decisions/0009-settings-via-config-schema.md)）。只有当你要展示**自定义内容**（数据面板、可视化、按钮）时才需要 `settings.section` + 客户端包。

**三、`settings.section` 是插槽，`Config` 是 schema，两者不是一回事。**

| | `Config` schema | `settings.section` |
|---|---|---|
| 写什么 | schemastery 声明 | React 组件 |
| 在哪 | 插件主包 | 客户端包（`dsh.client`） |
| 出什么 | 配置表单（宿主渲染） | 你想要的任何内容 |
| 成本 | 几十行 | 一个包 + 构建 + 发布 |

### 8.2 无关插槽（说明覆盖面）

`sidebar.workspaces.*`、`sidebar.brand.mark` / `.name`、`sidebar.footer.action`、`settings.models.provider-card`、`conversation.input.activity`（模型选择器旁的位置）、`plugins.add.actions`、`plugins.bundle.config`、`tool.call.images`、`tool.view.cordis`。

---

## 九、待办

- [ ] 确认 `cordis` 预设能否覆盖 `dsh-base` 根部的 `tool-plugin-manager.disabled: true`（见 7.3）
- [ ] 确认 `@deepseek-ai/dsh-tools` 的 `defineTool` 是否支持数组类型参数的完整推导
- [ ] 确定 CLI 可用性检测的具体方式（`which foldercast` vs `npx` vs 打包内相对路径）
- [ ] 核实 `exec.agent.inject` 的 `MessageSourceMap` 声明方式（会话格式 V4 拒绝了旧的 `{ kind: 'plugin', plugin: '<name>' }` 包装）
- [ ] 决定要不要做结果卡片（`presentationMeta`）—— 视频缩略图 + 时长
- [ ] 插件与 CLI 的版本对齐策略：插件是否需要检查 CLI 版本
- [ ] 若第一版之后要做 UI：确认 `tool.call.toolview` 的注册方式与客户端包结构

---

## 十、第一阶段的能力边界

**做**：

- 一个工具（`foldercast_cast`），一个参数（目录路径）
- CLI 探测、起子进程、结构化进度输出、`exec.signal` 取消
- `locale/zh.json` + `locale/en.json` 的标题与描述（插件管理页要显示）

**不做**：

- 设置页与任何配置项（第一版没有可配置的东西）
- UI 插槽（要另发客户端包，等有人真的要在对话旁边看视频）
- Cordis 服务与 Service Definition（[ADR 0005](decisions/0005-dsh-plugin-shape.md) 已否决三件套；只有一种执行方式，没有可替换的实现方）
- 中台化（没有下游消费者）

---

## 十一、用户怎么触发插件（入口）

插件能获得的入口有三类，成本差别很大。

### 11.1 自动获得的（零成本）

| 入口 | 机制 | 效果 |
|---|---|---|
| **模型自动调用** | 工具的 `description` 进模型上下文 | 用户说「把这个目录讲一遍」，模型自己判断该不该调 |
| **`/foldercast`** | skill 出现在会话 skill 目录 | 用户在输入框打 `/foldercast`，把 skill 正文注入这一步 |
| **插件管理页** | `locale/*.json` 的标题与描述 | 安装/启停时能看到这个插件是什么 |

**注意**：`settings.plugins.tab` 里的插件分区是**只读清单**，不是我们的入口。

### 11.2 可以注册的斜杠命令（**已实测机制**）

`@deepseek-ai/dsh-commands` 让插件注册 `/command [input]`：

```ts
ctx.commands.register({
  name: 'foldercast',                    // 必须小写
  description: 'Cast a folder into a video',
  input: { hint: '<folder>' },
  handler: ({ agent, rawInput }) => {
    // 直接对 agent 执行，不产生模型消息
    return { kind: 'success', text: '…' }
  },
})
```

**三条限制，决定它适合做什么**：

1. **handler 是插件里的 TypeScript，不能调模型**。所以它适合「跑脚本、出解读」这类确定性动作，不适合「写讲稿」。
2. **只在有交互式 UI 时可用**。无 UI 的演示主干与 ACP 自动化**不提供命令适配器**。
3. 每次执行记进会话日志，但 UI 在模型历史之外渲染结果。

### 11.3 自建 UI（要客户端包）

`sidebar.right.pane.tab`（右侧栏）、`conversation.session.header.actions`（会话头按钮）、`tool.call.toolview`（工具卡片）等，见 [第八节](#八ui-扩展点第一版不用记录备查)。**要另发客户端包，第一版不做。**

**但设置页不在这一列** —— 它由宿主从 `Config` schema 自动生成，不用写 React。见 [第十五节](#十五两种-ui-扩展机制)。

### 11.4 foldercast 的选择

| 入口 | 第一版 |
|---|---|
| 模型自动调用 | ✅ **主入口** |
| `/foldercast`（skill） | ✅ 显式入口。但注意与 11.2 的斜杠命令**不是一回事**——skill 的 `/name` 是注入指令给模型，命令是直接执行插件代码 |
| **设置页** | ✅ **可行且便宜**：声明 `Config` schema 即可（[ADR 0009](decisions/0009-settings-via-config-schema.md)）。第一版不暴露字段，但 schema 先立 |
| 斜杠命令（`ctx.commands`） | ⏸ 暂不做。它不给模型消息，而「对目录出解读」需要模型参与（选材料、写讲稿） |
| 自建 UI（侧边栏 / 工具卡片） | ❌ 第一版不做 |

**结论**：第一版**不做单独入口**，靠自然对话 + skill 的 `/foldercast`。设置走 schema 生成，不做客户端包。

### 11.5 计划暴露给用户的配置（日后）

按「第一版无可配置空间」判据，这些都押后。记录在此是为了**先定 `Config` schema 的形状**，避免日后加字段时破坏兼容。

| 配置 | 类型 | 落点 | 何时做 |
|---|---|---|---|
| `tts.provider` / `voice` / `style` / `format` | enum + string | `foldercast.config.json` | M5 之后 |
| `style.preset` | enum | 同上 | M4 出片之后 |
| `depth` | enum：`overview` / `normal` / `detailed` | 同上 | 见下 |

**`depth` 是新维度，尚未进契约。** 它同时影响三件事：

| 档 | 扫描 | 叙事 | 用途 |
|---|---|---|---|
| `overview` | 只读结构，不读内容 | 3–5 个场景，只讲骨架 | 快速看一个陌生目录 |
| `normal` | 读入口与枢纽文件 | 8–15 个场景 | 默认 |
| `detailed` | 读全部非排除文件，subagent 分工 | 20+ 场景 | 给别人看 |

它控制的是**成本与深度**，不是纯风格——所以它比风格更早暴露（风格是审美，这个是钱）。

---

## 十二、DSH 有哪些形态（插件在哪里生效）

插件随 profile 加载，所以**同一个插件在所有 profile 里都可用**，但每个形态给的「面」不同。

| 形态 | 启动 | 有会话 | 有工具 | 有斜杠命令 | 有 UI 插槽 |
|---|---|---|---|---|---|
| **Web** | `dsh web` | ✅ | ✅ | ✅ | ✅ |
| **Desktop** | Electron App | ✅ | ✅ | ✅ | ✅ |
| **TUI** | `dsh tui` | ✅ | ✅ | ✅ | ❌ |
| **Headless** | `dsh headless "任务"` | 一次性 | ✅ | ❌ | ❌ |
| **SDK / ACP** | 程序驱动 | ✅（可持久） | ✅ | ❌ | ❌ |
| **Rescue** | `dsh rescue --from-default-profile <name>` | 排障用 | ✅ | 视模板 | 视模板 |

**依据**：[`dsh --help`](https://github.com/deepseek-ai/DeepSeek-Harness) 的用法说明（**已实测**）；`dsh-commands` 文档明写「无 UI 的演示与 ACP 自动化不提供此命令面」（**文档记载**）。

**SDK 与 ACP 的区别**（**文档记载**）：

- **ACP**（Agent Client Protocol）：JSON-RPC stdio 服务器，让程序创建/恢复会话、挂载 MCP、发提示词、接收语义更新、响应权限提示。面向编辑器与自动化。
- **SDK**：按换行分帧的 JSON-RPC，从另一进程驱动完整运行时。有 TypeScript 客户端与 [Python SDK](https://github.com/deepseek-ai/DeepSeek-Harness/tree/master/python)。

**对 foldercast 的意义**：这五条里，**SDK / ACP 是要不要脱离 DSH 那个问题的另一种答案**（ADR 0008 把它列为押后项）。如果将来要在别的程序里用 foldercast，SDK 是一条现成的路，未必需要自建独立 CLI。

---

---

## 十三、两种 UI 扩展机制

**别把这两件事混起来**——它们的成本和用途完全不同。

| | `Config` schema | `settings.section` 插槽 |
|---|---|---|
| 你要写什么 | schemastery 声明（几十行） | React 组件（一个包） |
| 写在哪 | 插件主包 `src/index.ts` | 客户端半区，由 `dsh.client` 声明 |
| 出什么 | **宿主生成的配置表单** | 你想要的任何内容 |
| 落在哪 | 设置页里属于这个插件条目的一页 | 设置页里一个新的一级分区 |
| 第一版 | ✅ 声明，先不暴露字段 | ❌ 不做 |

### 15.1 机制（实测来源见 ADR 0009）

- 宿主从 `Config` **为每个 profile 条目生成一份表单**
- **只有标了 `.volatile()` 的字段进表单、才可写**
- 写入走 live path：Loader 把新值提交进字段的引用并发 `loader/volatile-update`，**不重载插件行**，所以运行中的状态与路由注册都能幸存
- 表单写入的持久化由设置外壳负责（`ctx.configForms`），不用自己写

### 15.2 什么时候才需要写客户端包

- 要展示**数据可视化**（图表、余额、进度）
- 要**非表单类交互**（按钮、批量操作、向导）
- 要**自定义版式**（宿主生成的表单长什么样不由你定）
- 要**非 `volatile()` 的配置**（生成表单的写入只走 live path，需要重启才生效的配置表达不了）

### 15.3 foldercast 的判断

第一版只声明 `Config`，**不写客户端包**。日后若要展示「这个目录的解读概要图表」之类的内容，再考虑 `settings.section`——但那更可能落在 `sidebar.right.pane.tab`（对话旁边看解读）而不是设置页。

---

## 十四、官方文档索引

| 主题 | 链接 |
|---|---|
| 第一个插件 | [docs/user/develop/basic/index.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.zh.md) |
| 开发一个工具 | [docs/user/develop/basic/tool.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/tool.zh.md) |
| 插件配置 | `docs/user/develop/basic/config.zh.md` |
| 打包与安装 | [docs/user/develop/basic/publish.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.zh.md) |
| 工具编写参考（完整契约） | [docs/cookbook/adding-a-tool.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-tool.md) |
| 软件包清单 | [docs/cookbook/adding-a-package.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-package.md) |
| 能力分层（Service/Provider/Consumer） | [docs/user/develop/practice/index.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/practice/index.zh.md) |
| **UI 插槽子系统** | [docs/subsystems/slots.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/slots.zh.md) |
| **插件管理（安装/启用/权限）** | [packages/boot/plugin-manager/README.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/boot/plugin-manager/README.zh.md) |
| **沙箱模式定义** | [docs/subsystems/sandbox.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/sandbox.zh.md) |
| **Agent 预设注册表** | [packages/preset/agent-preset-registry/README.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/preset/agent-preset-registry/README.zh.md) |
| **滑块命令注册表** | [packages/interaction/commands/README.zh.md](https://github.com/deepseek-ai/DeepSeek-Harness/blob/master/packages/interaction/commands/README.zh.md) |
| **ACP 自动化（JSON-RPC）** | [packages/acp/README.zh.md](https://github.com/deepseek-ai/DeepSeek-Harness/blob/master/packages/acp/README.zh.md) |
| **SDK（从另一进程驱动）** | [packages/sdk/README.zh.md](https://github.com/deepseek-ai/DeepSeek-Harness/blob/master/packages/sdk/README.zh.md) |
| Cordis 教程（7 章） | [docs/cordis-tutorial/](https://github.com/deepseek-ai/deepseek-harness/tree/master/docs/cordis-tutorial) |
| 官方文档站 | https://deepseek-harness.github.io/deepseek-harness/ |

参考实现：`dsh-tool-bash`（命令执行工具，含超时、输出截断、spill 文件的完整处理）是生产级范本。

**本机可拆的第三方范本**（装在本机，可直接读源码）：

| 插件 | 位置 | 可学什么 |
|---|---|---|
| `@linxin666/dsh-usage` | `~/.dsh/profiles/desktop/node_modules/@linxin666/dsh-usage/` | **`Config` schema 生成设置页**（本项目的直接参照）、bundle patch、`dsh.client` 客户端半区、`settings.section` 内容页、凭据不进浏览器 |
