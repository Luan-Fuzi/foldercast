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

foldercast 是**工具提供方（Consumer）插件 + 随包的脚本**。脚本由模型用 `bash` 直接调起，不走 CLI 包装层。理由见 [ADR 0008](decisions/0008-plugin-first.md)。

```
DSH 进程
  └── foldercast 插件（TypeScript）
        ├── 工具：ctx.tools.register(defineTool(...))
        ├── Config schema（宿主据此生成设置页）
        ├── skill：工作流说明
        └── scripts/（模型用 bash 调起）
              ├── analyzer/   TypeScript：目录 → 解读
              └── renderer/   TypeScript + Remotion：讲稿 → 视频
```

**全部 TypeScript，没有 Python。** 插件本体、分析器、渲染器同栈：`dsoffice`（Office / PDF 转图）与 `officeparser`（文本提取）都是 npm 包，`pnpm install` 一次装齐。

**插件进程内不做渲染、不做分析。** 分析器与渲染器是子进程（模型用 `bash` 起），不是插件进程里 import 的模块——渲染要起浏览器，分析要遍历几百个文件，都不该占 harness 进程。

### 1.1 插件能提供什么（四件事，不是一件）

原本文档只写了「注册工具」。实际能力面更大：

| 能力 | 机制 | 前置 | 验证状态 |
|---|---|---|---|
| 注册工具 | `ctx.tools.register(defineTool(...))` | 无 | **已实测**（M4；也验证了不用 `defineTool` 的直传写法，见 §3.8） |
| 注册 Cordis 服务 | `ctx.plugin(SomeService)` | 无 | 文档记载 |
| 暴露配置 schema | `Config`（`@deepseek-ai/schemastery`），放在 `dependencies` | 无 | 文档记载 |
| **贡献 Web / Desktop UI** | `ctx.slots.register()` | 需另发客户端包 | 文档记载（本机未注册过插槽） |

第四项是最重的一块：要写 TypeScript + React、要构建、要跟 `ui-renderer` 配合。**第一版不做**（见 [第十节](#十第一阶段的能力边界)）。

### 1.2 我们第一版只用第一项

理由是「无可配置空间」的判据（[ROADMAP.md](ROADMAP.md#第一版的规模判据无可配置空间)）：一个工具 + 对话触发就够，不需要设置页，也不需要侧边栏。

---

## 二、Manifest 规范

### 2.1 完整 `package.json`

**实际使用的清单是 [packages/plugin/package.json](../packages/plugin/package.json)** —— 它是唯一真源，
下面只列出与通用插件不同、或踩过坑的字段：

```jsonc
{
  "name": "dsh-foldercast",
  "type": "module",

  // 入口。发布版是编译产物：src/ 与 scripts/ 由 tsc 编到 lib/
  // （见 §3.8 第 1 条：Node 不允许在 node_modules 里剥离 TypeScript 类型）
  "main": "lib/src/index.js",

  "exports": {
    ".": "./lib/src/index.js",
    "./package.json": "./package.json",     // 必需：供展示元信息回退读取
    "./locale/en.json": "./locale/en.json", // 必需：供标题/描述读取
    "./locale/zh.json": "./locale/zh.json"
  },
  "files": ["lib", "scripts", "schemas", "locale", "cordis.patch.yml", "README.md"],

  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" }
  },

  // 运行时真的 import 的只有 schemastery（Config）。**没有 dsh-tools、没有 cordis** —— 理由见 §3.8 第 2 条
  "dependencies": {
    "@deepseek-ai/schemastery": "~3.18.4",
    "ajv": "^8.20.0", "ajv-formats": "^3.0.1", "jsonc-parser": "^3.3.1",
    "ignore": "^7.0.5", "officeparser": "^8.1.0", "shiki": "^4.5.0"
  },
  "optionalDependencies": { "@deepseek-ai/libreoffice-kit": "^0.1.5" }
}
```

**`scripts` 里的 `prepack`**：`node scripts/tools/sync-schemas.ts && pnpm run build`。
校验器要读契约 schema，而 `docs/` 不在包里，所以复制进 `schemas/`（构建产物，见 §2.7）；同时把
TypeScript 编成 `lib/`。**这两个都不进版本库**（`.gitignore`）。

### 2.1b 参考形状（官方包的写法）

下面是官方 `@deepseek-ai/dsh-tool-*` 的清单形状，供对照。注意官方包用 `peerDependencies` 声明框架包，
**foldercast 不照抄这一条** —— 原因见 §3.8 第 2 条（实测装进去会让宿主加载器起不来）。

```jsonc
{
  "name": "dsh-foldercast",
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
| 子进程无法启动（Node 缺失、引擎包损坏） | 可以抛出 —— 这是基础设施故障 |
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
- 插件在 `apply()` 里**不做任何可能失败的重活** —— 不探测环境、不读配置、不起进程
- **运行环境检测**（Node 版本、`dsoffice` 引擎是否就位）放在**首次工具调用时**，失败就返回一个说明清楚的领域结果
- 不把 foldercast 放进任何 required 的系统提示装配路径

### 3.7 未处理的 rejection 是致命的

官方表格里有一条对 foldercast 尤其相关：

> 脱离 `apply()` 返回 Promise 的异步任务产生未处理 rejection → **致命错误：释放应用并以非零码退出**，与条目 id 无关。

**这条直接支持了 ADR 0005「渲染必须出进程」的决策。** 在 harness 进程内跑 Remotion（要起无头浏览器、有大量异步 I/O）意味着任何一个漏 catch 的 rejection 都可能杀掉整个 harness。

因此插件内的所有子进程调用必须：
- 完整 `try/catch`，包括 `spawn` 的 `'error'` 事件
- 监听并处理子进程的 `'exit'` 与 `'close'`
- 不留下悬空的 Promise

### 3.8 八条实测结论（M4，本机 DSH `0.2.0-rc.2`）

这些都是「写的时候看不出来、装上去才炸」的坑。每条都给出了证据与做法。

**1. 插件入口可以是 `.ts`，但发布版必须编译成 JS。**
仓库内直跑 `.ts` 没问题（Node 的类型剥离），但 **Node 拒绝在 `node_modules` 里剥离类型**：
实测 `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`（v26.8.1，`node_modules/probe-ts/index.ts`）。
从 npm 装出来的插件正落在 `node_modules` 下，所以：

- 开发：`main` 曾指向 `src/index.ts`，用隔离 profile 实测能加载、能注册工具
- **发布**：`tsc -p tsconfig.build.json` 编到 `lib/`（`rewriteRelativeImportExtensions: true`
  把 `.ts` 后缀重写成 `.js`），`main` 指向 `lib/src/index.js`

**2. 不要依赖 `@deepseek-ai/dsh-tools`。**
把它作为插件依赖装进 profile 后，宿主的加载器起不来：

```
dsh: UNKNOWN: Cannot read properties of undefined (reading 'prepare')
```

连 `dsh --dump-config` 都跑不了（dump-config 也会挂载）。`dsh-tools` 的依赖被装进 profile 的
`node_modules`，与宿主自带的那份冲突。**做法**：用 `ctx.tools.register()` 直传定义对象，
参数与输出用原生 JSON Schema —— 工具侧**零框架依赖**。`dsh-tools` 的 `defineTool` 也只是
「把 DSL 编译成这个定义对象再 register」，直传没有损失能力。

`@deepseek-ai/schemastery` 可以依赖（只带 `@standard-schema/spec` 与 `cosmokit` 两个叶子包，
实测不破坏宿主），`Config` 用它。

**3. 参数与输出 schema 只支持一个子集。**

| 支持 | 不支持 |
|---|---|
| `type`（**单个**字符串）、`oneOf`、`properties`、`required`、`additionalProperties`、`items`、`enum`、`const` | **类型数组**（`type: ['integer','null']`）、`pattern`、`format`、`minimum`… |
| 注解：`description`、`title`、`default`、`examples` | 与 `oneOf` 并列的 `properties` / `required` / `items` / `enum` / `const` |

踩过一次：`exitCode` 写成可空类型，注册时抛
`schema.…exitCode.type must be a single type string (type arrays are not supported)`。
**失败方式是插件不激活**（只有一条启动警告，页面上看不出原因），所以要靠测试钉住白名单
（`packages/plugin/src/tests/schema.test.ts`）。

**4. `ctx.skills.register()` 必须带 `source`。**
注册时不查，**加载时**才用 `validateDefinition` 复查，缺了报
`loaded skill "foldercast" source must be a string`。同样地，`skills` 不放进 `inject`
（缺席时工具仍要能用），用 `ctx.get('skills')` 取，取不到就跳过注册。

**5. `exec.signal` 可能在调用之前就已取消。**
先 `spawn` 再 `addEventListener('abort')` 会漏掉这个情况：监听器永远等不到事件，子进程白跑。
**做法**：入口先查 `signal.aborted`，注册监听后再查一次（两者之间有窗口）。

**6. 依赖漏声明在本机看不出来。**
`ignore`、`ajv`、`ajv-formats`、`jsonc-parser` 都能从仓库根的 `node_modules` 解析到，
所以本机全绿；装到别处才 `ERR_MODULE_NOT_FOUND`。**做法**：守卫测试用 TypeScript 解析器
扫 `scripts/` 与 `src/` 的 import，裸包名必须在 `dependencies` 里（`src/tests/dependencies.test.ts`）。

**7. 包根不能靠「上一级目录」算 —— 编译产物比源码深一层。**
`resolve(MODULE_DIR, '..')` 在源码布局（`<包根>/src`）下是对的，装上去跑编译产物
（`<包根>/lib/src`）时算成 `<包根>/lib`，于是随包脚本「全部找不到」，工具直接报
`插件包不完整，缺少：scripts/analyzer/main.ts …`。仓库内测试都从 `src/` import，**永远看不出这个错**。
（M4 首版就是这么写的，装进 desktop profile 才暴露。）做法两条：

- 包根用**上溯找 `package.json`**（`findPackageRoot()`），与校验器定位 schema 的 `findUp` 同一套
- 阶段入口按布局选：`link:` 装法把软链解析回仓库真实路径，跑 `scripts/<阶段>/main.ts`（改完不用重建）；
  真正落在 `node_modules` 里时跑 `lib/scripts/<阶段>/main.js`（那里不允许类型剥离，见第 1 条）
- 守卫测试**从 `lib/` 加载一次编译产物**再断言包根与入口（`src/tests/runtime.test.ts`），
  CI 里构建排在测试之前，所以这条必定执行

同理，可选依赖 `dsoffice` 的 `bin` 也不能只认 `<包根>/node_modules/.bin`：pnpm 会建在包自己的
`node_modules` 下，**npm 会把它提升到根**。所以再按包名解析一次 `@deepseek-ai/libreoffice-kit`
的 `bin` 字段兜底。

**8. 条目代码不会热加载，改 `src/` 要重启宿主。**
Cordis 加载器是裸 `await import(url)`（`cordis-plugin-loader/lib/index.js` 的 `import(name)`），
没有查询串、也没有缓存失效，`ctx.loader.internal` 在 DSH 里没有实现。实测：改完 `src/` 重新构建、
把插件停用再启用、再调工具 —— 报的还是旧代码的错误。**这与 HMR 无关**（desktop profile 的 `hmr`
行是激活的）。

反过来，**阶段脚本不受影响**：它们每次都是新起的子进程，改 `scripts/` 立即生效。
所以开发期的循环是「改 `scripts/` → 直接试；改 `src/` → 重启」。宿主是 Electron 也没问题：
子进程用 `process.execPath`（Electron 二进制）+ 继承来的 `ELECTRON_RUN_AS_NODE=1`，
实测该运行时是 Node 24.18.1、类型剥离可用，`scripts/*/main.ts` 照常跑。

---

## 四、工具设计建议

### 第一版只注册一个工具（**已实现**）

```
foldercast_cast       事实层一条龙：分析 → 素材 → 校验
```

**一个必需参数**：目录路径。判据是「除了指向哪个目录，不需要任何其他输入」
（[ROADMAP.md](ROADMAP.md#第一版的规模判据无可配置空间)）。另有一个可选的 `skipAssets`
（跳过素材阶段，快一些，但讲稿就引用不了画面）。

**它不写稿。** 写稿要判断，那是模型的事（ADR 0008：编排层是 agent）。工具做的事与交接点：

| 阶段 | 谁做 | 产物 |
|---|---|---|
| 分析 | 工具（子进程跑 `scripts/analyzer`） | `foldercast.json` |
| 素材 | 工具（子进程跑 `scripts/assets`） | `assets/` |
| **写稿** | **模型**（按 skill 的流程） | `script.json` |
| 校验 | 工具（子进程跑 `scripts/validate`） | 带行号的问题清单 |
| **评审** | **另一个 subagent**（按 skill 的评审判据，换一条上下文） | `review.md` |

返回值里的 `next` 就是交接信号：`needsScript`（该写稿了）、`needsReview`（讲稿过了、该评审）、
`validated`（讲稿与评审都齐了）、`fixScript`（讲稿有问题）、`blocked`（环境或目标有问题）。
`review` 与 `reviewPath` 报告评审的状态：`missing` 还没审、`stale` 审过但讲稿又改了、`fresh`。
渲染与配音尚未实现（M7 / M8），工具不声称出片。

**为什么工具要管评审的状态**：校验（M3）只能判机器能判的，「有没有讲错重点」判不了（M5）。
所以讲稿通过校验**不等于**做完 —— 工具不跑评审（那是 agent 的事），但必须如实报告
「有没有审、审的是不是当前这版」，否则改完讲稿会把旧结论当成已审过。

**三条实现约束**：分析、素材、校验都以**子进程**跑（遍历几万个文件、起 LibreOffice 都不该占
宿主进程）；`exec.signal` 取消时杀子进程；单个阶段失败变成结构化结果，而不是抛异常
（INTEGRATION §3.5）。

### 押后：细粒度工具

生态惯例是 `dsh-tool-<动作>`，模型可见的 `name` 用下划线。管线本来就分阶段、可重跑（见 [SPEC-pipeline.md](specs/SPEC-pipeline.md)），拆成细粒度工具能让模型只渲染不配音、或换音色重配音：

```
foldercast_analyze    分析目录，产出 stats/manifest
foldercast_script     生成分镜（文案）
foldercast_render     渲染静音视频
foldercast_voice      配音（换音色重跑）
```

**为什么第一版不做**：M4 的验收就是「对话里说一句话能触发」。脚本本来就能分阶段单独跑（主 agent 用 `bash` 直接调，[ADR 0008](decisions/0008-plugin-first.md)），所以细粒度能力现在就有，缺的只是注册；等真出现「模型需要按阶段调用」的实例再暴露。反过来先注册五个工具，会把「编排层是 agent」变成「编排层是工具描述」。

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
| 发布 | npm。包名 **`dsh-foldercast`**（2026-10-04 定）。两个候选在 registry 上都未被占用（均返回 404），选带前缀的理由见表后 |
| 发现 | GitHub 仓库加 **`dsh-plugin` 话题** —— 这是官方指定的发现机制 |
| 安装 | `dsh plugin --profile web add dsh-foldercast`（本地路径也可以：`… add /path/to/packages/plugin`，pnpm 会 link） |
| **构建** | `pnpm --filter dsh-foldercast prepack`（= `sync-schemas` + `tsc`）。**发布前必须跑** —— 理由见 §3.8 第 1 条；`pnpm pack` / `pnpm publish` 会自动触发 `prepack` |
| 市场 | 会被 `dsh-plugin.org`、`dsh-market`、`dsh-find-plugin` 等自动索引（它们抓 `dsh-plugin` 话题） |
| 精选列表 | 向 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提 PR（社区唯一开放的外部 PR 通道） |

**为什么是 `dsh-foldercast` 而不是 `foldercast`**：

| 理由 | 说明 |
|---|---|
| 与生态一致 | 官方插件用 `dsh-` 前缀（`dsh-plugin-manager`、`dsh-hmr`），本机第三方插件的参照 `@linxin666/dsh-usage` 也是 |
| 把 `foldercast` 留给独立 CLI | [ADR 0008](decisions/0008-plugin-first.md) 推迟了独立 CLI 但没有否决它。真做的那天，`foldercast` 更该属于那个独立工具；现在占用等于给自己留一次改名 |
| 可发现性 | npm 搜索与插件列表里，前缀直接说明它属于 DSH |

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
| `ttsProvider` / `ttsVoice` / `ttsStyle` | enum + string | `say` | M8 之后 |
| `depth` | enum | `normal` | M1 + M5 之后，见 11.5 —— **控制成本，最早该暴露** |
| `stylePreset` | enum | `swiss` | M7 出片之后 |
| `cliPath` | string | 自动探测 | **不`volatile()`**：探测失败该走报错，不该让用户填 |
| `outputDir` | string | 固定 `<源目录>/.foldercast` | **第一版不做成配置**。工作根的唯一性见 [SPEC-data-format.md](specs/SPEC-data-format.md#工作目录所有产物的落点) |

**凭据不进配置项**：只放**引用名**，值走 DSH 的凭据 seam（`@deepseek-ai/dsh-credentials`）。

```ts
ttsKeyRef: z.string().default('MIMO_API_KEY').volatile()   // 引用名，不是值
```

解析优先级由 `dsh-credentials-local` 固定（**已实测：本机 `~/.dsh/.credentials.yaml` 存在**）：

| 顺序 | 位置 | 可写 |
|---|---|---|
| 1 | 启动环境（`MIMO_API_KEY=… dsh`） | ❌ 只读，产品内无法覆盖 |
| 2 | 凭据存储 `$DSH_HOME/.credentials.yaml` | ✅ 界面或 `ctx.credentials.set` |
| 3 | 项目 `.env` | 不在此处 |
| 4 | `$DSH_HOME/.env` | 不在此处 |

**三条硬约束**（来自 `credentials-local` 文档）：

- 凭据文件权限必须是 **600**，否则拒绝加载
- **空值等于"没有密钥"**，存储拒绝空字符串；移除靠删除
- 文件**只放凭据**，任何其他内容都会被明确拒绝——**不能把配置塞进去**

**界面能力标注**：

| 事实 | 状态 |
|---|---|
| 凭据存储能存能读（`set` / `resolve` / `describe`） | **已实测**（文件存在） |
| 界面能保存凭据 | **文档记载**（「你可以通过配置界面保存凭据」） |
| 界面对**任意插件声明的引用名字段**自动渲染凭据控件 | **⚠️ 未确认** |
| 凭据存储不隔离 agent | **文档记载**（「这是审慎，不是边界」） |

第三行未确认，所以第一版的密钥配置途径**不依赖它**——见 [rd/TTS-适配调研.md](rd/TTS-适配调研.md#key-未配置时的行为) 的三层设计。

**`@deepseek-ai/schemastery` 放在 `dependencies`**（不是 `peerDependencies`），与 `dsh-agent-loop`、`dsh-usage` 的做法一致。

**与自建设置页的分工**：`Config` 管「配置表单」，`settings.section` 管「自定义内容」（数据面板、可视化、**以及需要自定义控件的密钥保存**）。两者可并存，见 [第十三节](#十三两种-ui-扩展机制)。

---

## 七、安装、启用与权限

### 7.1 三条安装路径

| 路径 | 谁用 | 权限要求 | 验证状态 |
|---|---|---|---|
| Web 侧边栏「插件」页 | 人 | 无（界面操作） | 文档记载 |
| `dsh plugin --profile <name> add <pkg>` | 人（终端） | 无（就是 pnpm） | 已实测（命令存在、行为如文档） |
| 对话里让 agent 调 `plugin_manager` | 模型 | `danger-full-access` 或本次调用的批准 | ✅ 已实测（2026-10-05 装进 desktop profile：`install_bundle` 传 `link:` spec，装完**当场**工具就出现在会话里）；**该工具默认关闭**，见 7.3 |

**foldercast 的安装说明应该写前两条**，不要依赖第三条。

启用/停用同样走前两条：Web 插件页管理组合包与「能唯一定位的行」，或直接改 profile 的 `cordis.patch.yml`。改动**影响该 profile 的所有会话**。

生效时机要分两件事（见 §3.8 第 8 条）：**增删条目/改配置**是即时的（装了工具当场就能用）；**模块代码**（`src/` 编译产物）不会重新加载，要重启宿主 —— 即使 HMR 是开的。

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

### 7.3 `plugin_manager`：基础默认关闭，`cordis` 预设开启（**已实测**）

从 `dsh --profile web --dump-config` 的根部（`@deepseek-ai/dsh-base` 层）：

```yaml
- id: tool-plugin-manager
  name: '@deepseek-ai/dsh-plugin-manager/tools'
  disabled: true
```

**基础默认关，但 `cordis` 预设会覆盖它。** 两条实测证据：

1. 一个 `agentPreset: standard` 的会话（从会话日志头读出），标准预设内部确实声明了 `tool-plugin-manager`（缩进 6 层，属 preset 的插件列表），但该会话的工具列表里没有 `plugin_manager`。
2. 2026-10-04，`foldercast` 工作区的会话从 `standard` 切到 `cordis`（会话日志 `agent-preset/selected` 事件，seq 3）。同一个会话里 `plugin_manager` 与两个 `cordis_inspect_*` 工具都在工具列表中且可用：`plugin_manager list_plugins` 返回 191 个条目，`cordis_inspect_list` 返回 host 的 `Service` / `Event` / `Config` / `Tool` 与 client 的 `Service` / `Event` / `Builtin` / `Slots` / `Theme` 共九个 provider。**部署根部的 `disabled: true` 会被 `cordis` 预设覆盖。**

**对 foldercast 的含义**：M4 的「装进 DSH 并激活」必须在创造模式（`cordis` 预设）下做，标准模式里模型调不到 `plugin_manager`。

### 7.4 注册依赖平台与客户端

**Desktop profile 由 Electron 独占管理**，`dsh --profile desktop --dump-config` 直接报错 `profile "desktop" is managed exclusively by the Electron application`。当前桌面 App 用的就是它（`DSH_PROFILE=desktop`）。

**所以要改它只能走会话内的 `plugin_manager`**（它操作的就是当前 profile，不是另起一个）：实测 `install_bundle` 把 `link:` 依赖写进 `~/.dsh/profiles/desktop/package.json` 并加入 `dsh.profile.bundles`，当场激活。CLI 那条路走不通。

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
- [ ] 确定运行环境检测的具体方式（Node 版本、`dsoffice` 引擎包、浏览器是否就位）
- [ ] 核实 `exec.agent.inject` 的 `MessageSourceMap` 声明方式（会话格式 V4 拒绝了旧的 `{ kind: 'plugin', plugin: '<name>' }` 包装）
- [ ] 决定要不要做结果卡片（`presentationMeta`）—— 视频缩略图 + 时长
- [ ] 脚本与插件的版本对齐：脚本随包分发，同一包内版本天然一致，无需额外检查
- [ ] 若第一版之后要做 UI：确认 `tool.call.toolview` 的注册方式与客户端包结构

---

## 十、第一阶段的能力边界

**做**：

- 一个工具（`foldercast_cast`），一个参数（目录路径）
- 运行环境探测、起子进程、结构化进度输出、`exec.signal` 取消
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
| `tts.provider` / `voice` / `style` / `format` | enum + string | `foldercast.config.json` | M8 之后 |
| `style.preset` | enum | 同上 | M7 出片之后 |
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
