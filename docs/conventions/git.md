# Git 规范

本项目在**设计阶段**，尚无代码。以下规范即刻生效，用于约束后续所有提交。

---

## 一、分支模型

采用**主干开发 + 短生命周期分支**。

| 分支 | 用途 | 生命周期 |
|---|---|---|
| `main` | 唯一长期分支。**始终可运行、文档自洽** | 永久 |
| `<type>/<简短描述>` | 单个需求的开发 | 合并即删，通常 ≤ 3 天 |
| `docs/<简短描述>` | 纯文档改动 | 合并即删 |

### 分支命名

```
feat/analyzer-kind-detection
fix/exclude-glob-matches-build-gradle
docs/adr-0005-style-resolution
refactor/renderer-runtime-loading
chore/add-oxlint
```

规则：
- `<type>` 取自与 commit type 相同的集合（见下）
- 全小写，单词间用 `-`
- 描述用英文，简短，不要编号（编号在 issue/PR 里）

### 禁止

- ❌ 直接在 `main` 上提交（设计阶段单人开发时例外，但合并前必须自审）
- ❌ 长期存在的 `develop`（本项目规模不需要）
- ❌ 以个人名字命名的分支

---

## 二、提交信息：Conventional Commits

采用 [Conventional Commits 1.0.0](https://www.conventionalcommits.org/)。

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### type 白名单

| type | 用途 | 是否进 CHANGELOG |
|---|---|---|
| `feat` | 新功能 | ✅ |
| `fix` | 修复缺陷 | ✅ |
| `docs` | 仅文档 | ❌ |
| `refactor` | 重构，行为不变 | ❌ |
| `perf` | 性能优化 | ✅ |
| `test` | 测试 | ❌ |
| `build` | 构建系统、依赖 | ❌ |
| `ci` | CI 配置 | ❌ |
| `chore` | 杂项，不修改 src 或 test | ❌ |
| `style` | 格式，不影响语义 | ❌ |
| `revert` | 回滚 | ✅ |

### scope 白名单

| scope | 范围 |
|---|---|
| `analyzer` | `packages/analyzer` |
| `renderer` | `packages/renderer` |
| `cli` | `packages/cli` |
| `styles` | `styles/` 预设 |
| `schema` | `foldercast.json` 格式 |
| `docs` | 文档 |
| `repo` | 仓库级配置（`.gitignore`、CI、工具链） |

scope 可省略（用于跨模块改动），但**不可自造**。需要新 scope 时先改本文档。

### description

- 用**英文**，祈使句，全小写开头，句末**不加句号**
- ≤ 72 字符
- 说「做了什么」而非「改了什么文件」

```
feat(analyzer): detect office documents and extract outlines
fix(schema): reject glob patterns that match by substring
docs(decisions): record ADR 0005 on style resolution
```

### body

必要时说明**为什么**，不重复 description 里已说的「做了什么」。每行 ≤ 100 字符。

### footer

- 破坏性变更：`BREAKING CHANGE: <说明>`
- 关联 issue：`Refs: #12` / `Closes: #12`

### 完整示例

```
feat(schema): add sources.kinds toggle for per-type exclusion

Filtering by glob alone cannot express "讲代码但不讲视频" — the user
would have to enumerate every video extension. A per-kind boolean is
both shorter and self-documenting.

BREAKING CHANGE: `sources.exclude` no longer accepts bare extensions
without a glob suffix. `mp4` must now be written `*.mp4`.

Closes: #7
```

### 禁止

- ❌ `update` / `fix bug` / `wip` / `修改` 这类无信息量的描述
- ❌ 一次提交混合多个不相关的改动
- ❌ 提交被注释掉的代码或调试输出

---

## 三、提交粒度

**一次提交 = 一个逻辑变更。**

自查清单：

- [ ] 这个提交能用一句话说清吗？
- [ ] 单独 revert 它，会不会连带破坏别的东西？
- [ ] 里面有没有「顺手改的」无关文件？

若无法通过，说明该拆分。

**例外**：设计阶段的纯文档批量补充可以合并为一次提交，但 description 要说明范围。

---

## 四、合并策略

| 场景 | 策略 |
|---|---|
| 功能分支合入 `main` | **Squash merge**，保持 `main` 线性 |
| 同步上游 | `rebase`，不用 merge commit |
| 回滚 | `git revert`，不重写已推送的历史 |

`main` 的历史应当可以直接当 CHANGELOG 读。

---

## 五、标签与版本

采用 [语义化版本](https://semver.org/lang/zh-CN/)。

| 版本 | 触发条件 |
|---|---|
| `0.x.y` | 设计阶段与 MVP 期间。**任何破坏性变更只递增 `x`** |
| `1.0.0` | 全部里程碑完成（M0–M8）、四套预设与多个 TTS provider 均可用时 |
| 主版本 | `foldercast.json` 的 `foldercast` 字段递增时必须同步递增 |

**`foldercast.json` 格式版本与包版本是两个独立的东西**，不能混为一谈：

- 包 `0.3.0` 可能同时支持格式 `1`
- 格式升到 `2` 时，包必须升主版本

标签格式：`v0.1.0`，附注标签（`git tag -a`），不推轻量标签。

---

## 六、提交前检查

设计阶段（当前）：

- [ ] JSON 文件语法合法
- [ ] 文档内的相对链接指向存在的文件
- [ ] 没有提交密钥（`.gitignore` 已含 `.*_api_key` / `.*_key` / `.env*`）

有代码后追加：

- [ ] 测试通过
- [ ] lint 通过（见 [coding.md](coding.md)）
- [ ] 若改了 `foldercast.json` 格式 → 同步更新 `docs/specs/SPEC-data-format.md` 与 `foldercast.schema.json`

---

## 七、需要 ADR 的变更

以下改动**必须先写 ADR 并合入**，再动代码：

- 改变 [SYSTEM-DESIGN.md](../SYSTEM-DESIGN.md) 里的技术选型
- 改变 [SPEC-pipeline.md](../specs/SPEC-pipeline.md) 的阶段划分或顺序
- 改变 `foldercast.json` 的格式版本
- 推翻 [PRODUCT.md](../PRODUCT.md) 里的任何一条非目标
- 新增顶层目录

ADR 流程见 [decisions/README.md](../decisions/README.md)。

---

## 参见

- [decisions/README.md](../decisions/README.md) —— ADR 流程
- [coding.md](coding.md) —— 代码规范
- [docs.md](docs.md) —— 文档规范
