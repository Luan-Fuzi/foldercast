# 0009 · 设置页用 Config schema 生成，不写客户端 UI

- 状态：已接受
- 日期：2026-10-04
- 决策者：项目作者
- 相关：[ADR 0008](0008-plugin-first.md)

## 背景

[ADR 0008](0008-plugin-first.md) 把「UI 插槽」列为不做，理由是「要另发客户端包，第一版不做」。作者随后提出：

> 「我们可能会想要在设置页面里单开一栏作为我们的设置。比如日后我们可能会把一些配置文件交给用户去处理：1. 他想用什么 TTS；2. 他选择的默认风格是什么样的；3. 他希望中间产物的细致程度。」

并指向一个现成参照：本机已安装的第三方插件 `@linxin666/dsh-usage`，它在设置页里有一级分区。

**核实该参照后，前一个判断被推翻。** 该插件的 README 与源码都说明：**设置页由宿主从插件自己的 `Config` schema 生成**，不需要写客户端 UI。

## 决策

**设置项通过 `Config` schema 暴露。不写客户端包，不注册 `settings.section`。**

```ts
import z from '@deepseek-ai/schemastery'

export const Config = z.object({
  ttsProvider: z.union(['say', 'edge', 'mimo']).default('say').volatile(),
  ttsVoice: z.string().volatile(),
  depth: z.union(['overview', 'normal', 'detailed']).default('normal').volatile(),
  stylePreset: z.string().default('swiss').volatile(),
})
```

宿主据此生成表单一页，出现在设置页里。

**凭据不进配置项**，只放环境变量名（`apiKeyEnv` 引用），与 `dsh-usage` 的做法一致。原话：「API key 经宿主凭据缝解析……**永不进入浏览器**」。

**自定义 UI 仍然不做**（侧边栏、工具卡片、会话头按钮），那是另一回事。

## 理由

### 1. 机制是实测的，不是推断

`@linxin666/dsh-usage@0.4.4` 的 README 原文：

> 「要求 DSH 0.2.0-rc.1 或更高：插件基于 0.2.0-rc.1 DSH cohort 开发（**其设置页即宿主根据插件自身 Config schema 生成的页面**）」

其源码注释进一步说明规则：

> 「Under the 0.1.7 settings model this schema **IS** the entry's settings page: the Host derives one form per profile entry from it and **serves it only when at least one field is `volatile()`**. The marker is also what admits a write and what keeps the edit on the live path — the Loader commits the new value into the field's reference and announces `loader/volatile-update` on this fiber instead of remounting the row, so the probe cycle, its ledger and its route registrations survive a settings save.」

### 2. 那条 `volatile()` 规则对 foldercast 反而有利

**不标 `volatile()` 的字段不进表单，也不能写。** 这不是限制，是正好合我们的需要：

- 用户级偏好（TTS、风格、depth）→ 标 `volatile()`，可改，改了不重载插件
- 不该让用户碰的（CLI 路径探测、内部阈值）→ 不标，只作为 schema 的默认值与校验

### 3. 约束与默认值直接变成表单控件

`z.number().min(30).max(3600).default(60)` 这种声明，宿主会渲染成带范围的输入控件。**校验规则不用自己写第二遍**——UI、写入校验、配置目录文档来自同一处声明。

### 4. 那个参照插件确实写了一个客户端组件，但用途不同

`dsh-usage` 注册了 `settings.section`，但那**不是配置表单**，而是它自己的三个数据页签（用量、个人套餐、Token 银行）。它同页里还有一个「紧凑设置行」编辑 `enabled` / `pollIntervalSec`。

**所以两条路是并存的、用途不同**：

| 要展示的东西 | 走哪条 |
|---|---|
| 配置项的表单 | `Config` schema（宿主生成） |
| 自定义内容（数据面板、按钮、可视化） | `settings.section`（自己写 React） |

foldercast 现在只需要前者。

## 后果

**正面**：

- 第一版就能有设置页，成本是几十行 schema 声明
- 不需要第二个包、不需要构建客户端代码、不需要跟 `ui-renderer` 配合
- 校验、默认值、配置目录文档自动一致
- 改动立即生效，不重载插件行（`volatile()` 的语义）

**负面**：

- **表单长相不由我们决定。** 宿主怎么渲染就是什么样，没有自定义版式。
- **只有 `volatile()` 字段可写。** 需要"重启才生效"的配置项无法通过表单表达（它的写入必然走 live path），只能靠 profile patch 手改。
- **依赖 0.1.7 及以上的设置模型。** DSH 版本下限随之提高（`dsh-usage` 要求 `>=0.2.0-rc.1`，本机是 `0.2.0-rc.2`）。
- 无法做「配置项 + 说明图文」这类富内容。要的话就得写客户端包。

**缓解**：

- 第一版**一个配置项都不暴露**（[ROADMAP.md](../ROADMAP.md#第一版的规模判据无可配置空间)），schema 先只声明，验证机制可用后再逐个放开
- 若日后确需富内容或非 `volatile()` 的配置，再补客户端包，两条路可以并存

## 备选方案

| 方案 | 否决理由 |
|---|---|
| 不声明 `Config`，让用户手改 YAML | 用户要查文档才知道字段名；没有校验；改错没有提示 |
| 写客户端包做设置页 | 第一版不需要自定义版式；一个 React 包的成本远高于 schema 声明 |
| 不做设置，全靠对话里说 | 凭据类配置不适合在对话里说（[C6](../REQUIREMENTS.md) 明确禁止）；且用户偏好需要持久化 |
| 只做斜杠命令改配置 | 命令面在 headless 与 ACP 下不可用；且配置是"设一次"的动作，不该每次都敲命令 |

## 参见

- [ADR 0008 · 先做 DSH 插件](0008-plugin-first.md) —— 本决策修正了它关于 UI 成本的判断
- [INTEGRATION-dsh-plugin.md](../INTEGRATION-dsh-plugin.md#十五两种-ui-扩展机制) —— 两种机制的分工
- [INTEGRATION-dsh-plugin.md](../INTEGRATION-dsh-plugin.md#115-计划暴露给用户的配置日后) —— 计划暴露的配置项
