# 代码规范

**当前项目处于设计阶段，尚无代码。** 本文预先定下规范，避免代码落地时各写一套。

---

## 一、语言与运行时

| 模块 | 语言 | 运行时 | 理由 |
|---|---|---|---|
| `packages/plugin`（全部） | TypeScript | Node 22.19+ | 插件本体、分析器、渲染器同栈。见下 |

**全 TypeScript，没有 Python**（2026-10-04 定，见 [SYSTEM-DESIGN.md](../SYSTEM-DESIGN.md#二技术选型)）。

**为什么不留 Python**：当初选它是为了办公文档与 PDF 库，而这两块现在都走 Node 的 `dsoffice`；剩下的文本提取由 `officeparser` 覆盖。留 Python 等于为一个功能维护第二套工具链（uv/venv + pytest + ruff + 类型检查），而它的库还只在 DSH 内可用——脚本要能脱离 DSH 直跑（M1 验收 4），本来也得自己管环境。

**连带的收益**：`foldercast.json` 的 TypeScript 类型由分析器、渲染器共用一份定义，不再需要「改一边另一边必须同步」这条纪律兜底。

**Node 版本下限 22** —— DSH 插件生态的普遍要求，且 Remotion 4.x 需要。

### 外部命令优先

转图、抽帧、缩放这类事**不引库，用外部命令**：

| 用途 | 命令 |
|---|---|
| Office / PDF → PNG | `dsoffice render`（`@deepseek-ai/libreoffice-kit`，MPL-2.0） |
| Office → PDF | `dsoffice convert` |
| xlsx 公式重算 | `dsoffice recalculate` |
| 图片缩放 | `sips`（macOS），跨平台回退 ffmpeg |
| 抽帧 / 时长实测 | `ffmpeg` / `ffprobe` |

**新增第三方依赖需要理由。** 能用标准库或外部命令解决的，不引入新依赖。

---

## 二、TypeScript

### 风格

- **缩进 2 空格**，单引号，**必须分号**
- 仅用 ESM（`"type": "module"`）
- `strict: true`，不用 `any`（用 `unknown` + 类型守卫）
- 导出优先**具名导出**，避免 default export

### 命名

| 种类 | 约定 | 例 |
|---|---|---|
| 类型 / 接口 | PascalCase | `SceneSpec` `FoldercastDocument` |
| 变量 / 函数 | camelCase | `loadStoryboard` `sceneIndex` |
| 常量 | SCREAMING_SNAKE | `MAX_SUB_LENGTH` |
| 文件（模块） | kebab-case | `scene-view.tsx` `load-storyboard.ts` |
| React 组件 | PascalCase | `Caption` `TreeScene` |

### 类型定义的位置

`foldercast.json` 的 TypeScript 类型是**契约**，放在 renderer 里但**必须与 `docs/specs/foldercast.schema.json` 一致**。

改任何一边，另一边必须同步，且要在同一个提交里。

### 必须遵守的两条

**1. 分析器不得调用模型。** 它是纯确定性模块（见 [SYSTEM-DESIGN.md](../SYSTEM-DESIGN.md#44-分析器不调用模型叙事层可以通读adr-0006)）。任何模型调用都属于叙事层（主 agent），不在脚本里。

**2. 密钥不得经过命令行参数，也不得写进配置。** 复用 DSH 的凭据 seam，配置里只放引用名；派生优先级为启动环境 → 凭据存储 → 项目 `.env` → `$DSH_HOME/.env`。见 [TTS-适配调研.md](../rd/TTS-适配调研.md#key-的存放)。

### 禁止

- ❌ `enum`（用 union type 或 `as const` 对象）
- ❌ 非空断言 `!`（除非紧邻处有显式检查并注释说明）
- ❌ `@ts-ignore`（用 `@ts-expect-error` 并写明原因）
- ❌ 循环依赖（分析器与渲染器互不依赖，见 [SYSTEM-DESIGN.md](../SYSTEM-DESIGN.md#三模块边界)）

---

## 三、测试

### 分层

| 层 | 范围 | 要求 |
|---|---|---|
| 单元 | 纯函数：分类器、glob 匹配、字幕切分 | 必须有 |
| 集成 | 分析器对固定 fixture 目录的完整输出 | 必须有 |
| 快照 | 分析结果 JSON 的结构稳定性 | 推荐 |
| 渲染 | 同分镜渲染两次逐帧比对 | 必须有（验证确定性） |
| 端到端 | 真实目录全流程 | 手动，不进 CI |

### 关键测试用例

这些是已知的坑，必须有对应用例：

- **glob 匹配必须按目录而非子串** —— `build/**` 不应匹配 `build.gradle`
- **字幕切分**：超长句在逗号处二次切分；相邻短句合并避免孤行；每块 ≤ 24 字
- **时长分配**：按字符数占比分配，各块之和等于实测总时长
- **确定性**：同一输入渲染两次，逐帧一致
- **幻觉拦截**：分镜引用了 `manifest` 里不存在的路径时必须报错

### 测试数据

`packages/analyzer/tests/fixtures/` 下放小型目录样本，**提交进仓库**。不要用真实大目录做单元测试。

---

## 四、Lint 与格式化

| 工具 | 用途 | 状态 |
|---|---|---|
| `oxlint` + `prettier` | TypeScript | 待接入 |
| `vitest` | 测试 | 待接入 |

**提交前必须本地跑过。** 不依赖 CI 兜底。

---

## 五、错误处理

- **分析器**：单个文件读取失败不应中断整体。记录进 `stats.errors` 并继续。
- **渲染器**：遇到不认识的场景 `type` 应**跳过并警告**，不崩溃（见 [SPEC-data-format.md](../specs/SPEC-data-format.md#四版本与兼容)）。
- **脚本**：面向用户的错误信息必须**可操作** —— 说清哪个文件、什么问题、怎么修。不打印裸 stack trace。工具把失败作为结构化结果返回给模型，而不是抛异常（见 [INTEGRATION](../INTEGRATION-dsh-plugin.md#35-失败语义渲染失败不应该抛出)）。

---

## 六、注释

- 只在**为什么**不明显时写注释。不复述代码在做什么。
- 借鉴外部实现时，**注释标注来源**。例如从 `lecture-videos` 复制的字幕切分逻辑：

```ts
// Subtitle chunking follows lecture-videos/scripts/tts.py (same author),
// verified on 7 produced episodes.
export function splitSubs(text: string, maxlen = 24): [string, number][] {
  // ...
}
```

- 不用注释掉的代码。要就留着，不要就删 —— git 记着。

---

## 参见

- [git.md](git.md) —— 提交规范
- [docs.md](docs.md) —— 文档规范
- [SYSTEM-DESIGN.md](../SYSTEM-DESIGN.md) —— 技术选型与模块边界
