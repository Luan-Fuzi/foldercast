# 0004 · 两阶段创作：digest（知识压缩）→ script v2（分镜与讲稿）

日期：2026-10-08　状态：设计定稿（待实现）　关联：0001（判据不变：程序不替模型干活）、0003（总-分-总与时长）

## 背景

0.1 样片（20 场、4 分 53 秒）看片反馈四条：画面信息少（文字两行）、缺图形（数字与
组织关系没有可视化）、动效少（无转场、无场景内渐进披露）、以及一个判断——「知识的
压缩和稿子不能同时生成」。诊断：写稿时同时干两件创作活动（提炼事实 + 编排讲述），
两头都做了最低配置。**这不是 0001 分析器的复活**：分析器是程序替模型干活；这里是
模型分两步干活，程序仍然只做校验与渲染。

## 决定

两个产物，组织原则**故意不同**：

1. **`digest.json`（知识压缩）**：按**知识结构**组织的事实库（结构、盘点、模块、
   摘录、值得讲的数字），宁多勿缺——第二步的「合适密度」是从富集里**选**出来的。
   只给模型消费（写稿 + 评审），**渲染器不读它**。
2. **`script.json` v2（分镜）**：按**讲述结构**（总-分-总）组织。`foldercast: 2`
   直接切换，不并存 v1（0.x 阶段讲稿现写现弃，无存量）。

script v2 把场景拆成两层，**显式解耦**：

- **画面层（beats）**：场景的原子是「节拍」——一组同时出现的画面元素 + 声明式入场
  意图。镜头调度 = 节拍顺序；动效 = `enter` 枚举（`fade` / `reveal` / `grow` /
  `slide`），**模型只写意图，渲染器实现曲线**（模型写不了 interpolate，也不该写）。
- **演讲层（narration）**：旁白是给耳朵的，画面是给眼睛的；子集或超集都合法。

类型化事实字段（`tree.entries` / `inventory.groups` 等）**保留在场景上**——图形
（占比条、结构条、代码高亮）由类型化字段确定性生成，这是 JSON 相对 Markdown 的
本钱；beats 只负责「何时出现」与开放文本（`points` 要点槽）。

## 形状草案

digest（轻 schema，`notes`/`facts` 是开放槽）：

```json
{
  "digest": 1,
  "source": { "root": "/abs/path", "label": "foldercast" },
  "scale": { "totalFiles": 104, "codeLines": 9037, "testFiles": 26 },
  "modules": [{ "path": "packages/plugin/src", "role": "编排与注册", "files": 12 }],
  "inventory": { "groups": [{ "label": "TypeScript", "count": 79 }], "total": 104 },
  "excerpts": [{ "file": "docs/decisions/0001-*.md", "text": "> 程序只做 agent 干不了的事…" }],
  "notes": ["M1–M8 曾有 1.7 万行，0001 收缩"]
}
```

script v2 的场景（`narration` 仍是场景级——配音管线不动）：

```json
{
  "id": "kinds", "type": "inventory", "title": "构成",
  "groups": [{ "label": "TypeScript（含测试）", "count": 79 }],
  "total": 104,
  "narration": "按类型看，四分之三是 TypeScript，其中三分之一是测试。",
  "beats": [
    { "points": ["四分之三：TypeScript", "三分之一：测试"], "enter": "reveal" },
    { "graphic": "proportion", "enter": "grow" }
  ]
}
```

## 四条机械检查（程序侧新增，都进 `--check`）

1. **密度比**：场景画面字符数（标题+要点+摘录）/ 旁白字符数，落在 **1.5×–3×**；
   出界报 warning。上下界可调，先按此起。
2. **节拍时间 = 字幕分配器**：场景内节拍按第 i 条字幕的起始时刻揭示（节拍多于字幕
   时按宽度比例摊开），时间来自实测音频——渐进披露确定性成立，逐帧一致不破。
3. **digest 数字抽查**：`totalFiles`、`modules[].files` 等程序能确定性重数的字段，
   校验时对目录真数一遍——「数字亲手数过」从荣誉制变成机器可查。
4. **beats 上限**：一场节拍数超过字幕块数两倍报 warning（写稿没对齐节拍与旁白）。

## 评审两段化（白赚的收益）

digest 先审（事实 vs 目录，一次性核完）→ script 再审（讲稿 ⊆ digest + 叙事质量）。
事实基准从「评审员自己重数一遍」变成「一份被审过的事实库」。

## 实现范围（P1 密度与图形 + P2 动效，一次切换）

- `contracts/script.ts` + `docs/specs/script.schema.json`：v2（beats / points /
  enter；v1 字段除 beats 外大体保留）
- `renderer/scenes/*`：节拍渲染、声明式入场、inventory 占比条、tree 结构条、
  file 场景 shiki 高亮（依赖已在）
- `renderer/check.ts`：密度比、beats 对齐、（digest 校验独立成 `--check-digest`）
- `src/skill.ts`：六步工作流（探目录 → **写 digest** → 定分镜 → 写 script v2 →
  校验 → 两段评审）+ 画面自足判据 + 节拍与旁白句对齐
- `page`：消费 `points`/beats，页面密度同步涨
- 配音、素材、CI 不动；自举片按 v2 重做验收
