# 文档规范

本项目文档量大于代码量（设计阶段），文档纪律与代码纪律同等重要。

---

## 一、目录职责

```
docs/
  PRODUCT.md          产品定义。为什么做、做什么、不做什么
  REQUIREMENTS.md     需求追溯。每条需求 → 设计 → 里程碑
  SYSTEM-DESIGN.md    系统设计。技术选型、架构、模块边界
  ROADMAP.md          里程碑与验收标准
  PRIOR-ART.md        竞品调研
  SPEC-*.md           人读的规格（specs/ 下）
  *.schema.json       机器读的契约
  decisions/          架构决策记录（ADR）
  conventions/        工程规范
  rd/                 研究性材料，结论未定或需持续更新
```

**一句话判据**：

| 内容 | 去处 |
|---|---|
| 「做什么、为什么」 | `PRODUCT.md` |
| 「谁要求的、验收标准」 | `REQUIREMENTS.md` |
| 「怎么实现、为什么这样选」 | `SYSTEM-DESIGN.md` + `decisions/` |
| 「精确的格式与流程定义」 | `specs/` |
| 「什么时候做完」 | `ROADMAP.md` |
| 「别人做得怎么样」 | `PRIOR-ART.md` |
| 「调研中，结论未定」 | `rd/` |
| 「怎么写代码/提交」 | `conventions/` |

---

## 二、单一事实来源

**同一个事实只能在一处定义，其他地方链接过去。**

已有的单一来源：

| 事实 | 唯一来源 |
|---|---|
| `foldercast.json`（目录解读）的字段与语义 | `../specs/SPEC-data-format.md` 第一节 + `specs/foldercast.schema.json` |
| `script.json`（讲稿）的字段与语义 | `../specs/SPEC-data-format.md` 第二节 |
| 三步管线的顺序与职责 | `../specs/SPEC-pipeline.md` |
| 风格 token 清单 | `rd/风格预设系统.md` + `styles/*.json` |
| TTS 供应商能力 | `rd/TTS-适配调研.md` |
| 密钥文件的判据 | `decisions/0007-secret-file-exclusion.md` |
| 技术选型 | `SYSTEM-DESIGN.md`（理由在 `decisions/`） |
| 里程碑与验收 | `ROADMAP.md` |

**反面例子**（禁止）：在 `README.md` 里复制一份场景类型清单。应写「支持 8 种场景类型，见 [SPEC](../specs/SPEC-data-format.md)」。

---

## 三、写作风格

### 语言

- **中文为主**，技术术语保留英文原词（`Remotion`、`ffprobe`、`glob`）
- 代码标识符、文件名、命令一律用反引号包裹
- 不造词。中文名只有「目录放映」是自定的，其余用通行说法

### 语气

- **直接陈述，不营销。** 写「这做不到，因为 X」而非「这是一个强大的功能」
- **给判据，不给形容词。** 写「分类无错判」而非「分类非常准确」
- **承认不确定。** 未验证的写「待验证」，推测的写「预计」

### 结构

- 用表格对比多个方案，用列表陈述步骤
- 每个规格文档开头一句说明它定义什么
- 长文档加目录（超过约 150 行时）

### 禁止

- ❌ 「简单来说」「众所周知」「显然」
- ❌ 「强大的」「优雅的」「完美的」这类无信息量的修饰
- ❌ 只写「已支持 X」而不说怎么验收
- ❌ 复制粘贴产生的重复内容

---

## 四、链接与引用

- 文档间引用用**相对路径**：`[SPEC](../specs/SPEC-data-format.md)`
- 引用章节用锚点：`[多个视频](../specs/SPEC-pipeline.md#多个视频)`
- 引用外部资料**必须给可点击的链接**，并注明访问日期（研究性文档）
- 引用外部实现时说明**借鉴了什么**，不只是「参考了 X」

---

## 五、契约与文档的同步

`foldercast.json`（解读）与 `script.json`（讲稿）各有三处表示，**必须同时更新**：

1. `specs/foldercast.schema.json` + `script.schema.json` —— 机器可读的 JSON Schema
2. `../specs/SPEC-data-format.md` —— 人读的字段说明
3. `packages/plugin/scripts/contracts/` 里的 TypeScript 类型（有代码后）

**同一个提交里改完三处**，否则算未完成。

自查命令：

```bash
pnpm run check:json       # JSON 合法性 + 重复键（顺带覆盖 schema 与示例）
pnpm run check:links      # 相对链接是否指向存在的文件
pnpm run check:examples   # 示例是否符合 schema
pnpm run check            # 上面三项 + 风格预设 token 一致性
```

四个脚本在 `scripts/` 下，实现见 [../../scripts/check-links.ts](../../scripts/check-links.ts) 等文件；仓库根另有 `pnpm run typecheck` 检查这些脚本自身的类型。

---

## 六、ADR 的触发条件

见 [git.md](git.md#七需要-adr-的变更) 与 [decisions/README.md](../decisions/README.md)。

简言之：**改变已定型的决策**才写 ADR。补充细节、修错别字、加例子不需要。

---

## 七、文档的生命周期

| 状态 | 含义 | 处理 |
|---|---|---|
| 现行 | 描述当前设计 | 保持准确 |
| 已废弃 | 被新决策取代 | **不删除**，在开头标注「已被 ADR-XXXX 取代」并链接 |
| 研究性 | 结论未定 | 放 `rd/`，结论定了就迁出 |

**不删除历史决策。** 为什么当初那样选，和现在选什么同样有价值 —— 它防止同样的弯路走第二遍。

---

## 参见

- [git.md](git.md) —— 提交规范
- [coding.md](coding.md) —— 代码规范
- [decisions/README.md](../decisions/README.md) —— ADR 流程
