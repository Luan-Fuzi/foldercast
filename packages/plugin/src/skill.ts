/**
 * foldercast 的 skill：把工作流与判据写给模型。
 *
 * **为什么 skill 是主要交付物**（ROADMAP M5）：写稿是模型在做，脚本管不了。工具只能把事实层
 * 做完并把证据交回来；「讲什么、按什么顺序讲、哪些是重点」要靠这段说明。
 *
 * 它是**运行时注册的内存 skill**（`ctx.skills.register`），跟包走：装到哪台机器上都有效，
 * 不需要往用户的项目目录里放文件。
 */

export const SKILL_NAME = 'foldercast';

export const SKILL_DESCRIPTION = '把任意目录讲成视频：跑分析、写讲稿、校验、出片。';

export const SKILL_WHEN_TO_USE =
  '用户说「把这个目录讲一遍」「给这个文件夹做个介绍视频」「带我看懂这个目录」时。';

export const SKILL_CONTENT = `# 目录放映（foldercast）

把任意**人类可读的目录**变成讲解视频。核心产物不是视频，而是「目录解读」这份结构化事实；
视频、页面都是它的视图。

## 什么时候用

用户要求讲解、导览、介绍某个目录（项目、资料、汇报文件夹都算）。**输入只有目录路径**，
不需要风格、时长之类的参数——第一版没有可配置项。

## 工作流

### 第一步：跑事实层

调 \`foldercast_cast\`，参数是目录的**绝对路径**。它依次做三件事（都是确定性程序）：

1. **分析**：遍历目录 → \`<目录>/.foldercast/foldercast.json\`（分类、角色、引用依赖图、密钥排除审计）
2. **素材**：解读里的图片/视频/Office/PDF/代码 → \`<目录>/.foldercast/assets/\`（逐页图、关键帧、高亮图、提取出的文本）
3. **校验**：有讲稿就校验它，没有就跳过

看返回值里的：

- \`next\`：\`needsScript\` 表示该你写稿了；\`fixScript\` 表示讲稿有问题要改；\`validated\` 表示都通过了
- \`reading\`：文件数、类型分布、入口（\`roots\`）、**枢纽（\`hubs\`）**、被排除的密钥文件名、素材数
- \`validation.issues\`：每条都带文件、行号、场景 id 与怎么改

### 第二步：通读内容（**这一步不能省**）

摘要里没有语义。只看「74 个 TS 文件、最大 2048 字节」，写出来的只能是「这个目录分成三个部分，
第一部分是源码」——对代码项目勉强够用，对混杂资料目录完全失效。

- 先读 \`foldercast.json\`：\`manifest[].preview\` / \`title\` 是每条文件的摘要，\`graph\` 告诉你谁引用谁
- **按重要性读全文**：\`graph.hubs\` 里的文件最该先读（它们是枢纽），\`graph.roots\` 是入口，
  \`stats.roles\` 里的 readme / doc 优先
- Office / PDF 的全文在 \`<目录>/.foldercast/assets/text/*.md\`（素材阶段提取的）
- 大目录用 subagent 分工读：每个 subagent 负责一块，回来汇报「这块是什么、有什么值得讲的」

### 第三步：写讲稿

写到 \`<目录>/.foldercast/script.json\`，形状见 \`docs/specs/script.schema.json\`。要点：

- 顶层：\`foldercast: 1\`、\`source.root\`（**必须等于解读里的 \`source.root\`**）、\`scenes\`
- 每个场景：\`id\`（唯一）、\`type\`、\`narration\`；各类型另有必需字段：
  | type | 用途 | 必需字段 |
  |---|---|---|
  | \`cover\` | 封面 | \`title\` |
  | \`tree\` | 目录结构 | \`highlight\`（子路径，必须真实存在） |
  | \`inventory\` | 内容盘点 | \`groups\`（\`kind\` + \`count\`） |
  | \`file\` | 单文件展示 | \`file\`（相对源目录，必须在解读的 manifest 里） |
  | \`gallery\` | 图片墙 | \`items\`（素材路径，相对工作根） |
  | \`clip\` | 视频片段 | \`source\` |
  | \`document\` | Office/PDF 分页 | \`source\`、\`pages\` |
  | \`outro\` | 结尾 | \`title\` |
- **路径两条基准不能混**：\`file\` / \`source\` 相对**源目录**；\`asset\` / \`items\` / \`poster\` / \`pages\`
  相对**工作根** \`.foldercast/\`，所以它们以 \`assets/\` 开头
- **不能编路径**。引用前先确认它在解读的 \`manifest\` 或素材清单里
- **字幕**：\`narration\` 要能切成每块 ≤24 字的字幕块。先按句末标点（\`。！？；：\`）切，超长的在
  逗号（\`，、\`）处再切。一句里没有任何标点、又超过 24 字，切不开就会报错——加标点或拆句
- 顺序建议：\`cover\` → \`tree\` → \`inventory\` → 若干 \`file\` / \`gallery\` / \`document\` → \`outro\`；
  按 \`roots\` → \`hubs\` → 其余的顺序讲，比按目录树字母顺序更接近真实阅读顺序

### 第四步：校验并修

再调一次 \`foldercast_cast\`。它跑校验器，返回 \`ok\` 与每条问题（带行号）。**有 blocker 就不要
往下走**：那是编造路径、场景字段用错、字幕切不开这类硬错误。warning 是「可能是笔误」，自己判断。

### 第五步：出片

**渲染（视频）与配音还没实现**（ROADMAP M7 / M8）。现在做到「解读 + 素材 + 通过的讲稿」为止，
把这两份 JSON 的路径告诉用户。不要声称已经出片。

## 判据（别糊弄自己）

- **解读是事实**：\`stats\` 与 \`manifest\` 由程序产出，不要凭印象改数字
- **讲稿是创作**：可以有观点，但**不能编事实**。说「这个项目用 Remotion 渲染」之前，先确认
  你在内容里看到了它
- **密钥文件的内容没被读过**：\`reading.secretsSkipped\` 列出的文件名只是文件名命中，
  内容从未读入。可以向用户提一句「这些文件被跳过了」，但不要猜里面是什么
- **漏掉枢纽就是漏**：\`graph.hubs\` 里一个都没讲到，说明讲偏了
`;
