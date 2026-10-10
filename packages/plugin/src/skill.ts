/** 运行时注册的 skill。主流程随插件加载，详细创作与评审参考按需读取。 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DIGEST_VERSION } from '../scripts/contracts/digest.ts';
import { SCRIPT_VERSION } from '../scripts/contracts/script.ts';
import { SUB_LIMIT } from '../scripts/contracts/subtitles.ts';
import { VISUAL_STYLE_NAMES } from '../scripts/contracts/visual.ts';

const referenceRoot = [
  resolve(import.meta.dirname, '../scripts/references'),
  resolve(import.meta.dirname, '../../scripts/references'),
].find((root) => existsSync(resolve(root, 'authoring.md')));

export const AUTHORING_REFERENCE = resolve(referenceRoot ?? resolve(import.meta.dirname, '../scripts/references'), 'authoring.md');
export const REVIEW_REFERENCE = resolve(referenceRoot ?? resolve(import.meta.dirname, '../scripts/references'), 'review.md');
export const SKILL_NAME = 'foldercast';
export const SKILL_DESCRIPTION = '把任意目录讲成视频或导览页：探目录、写 digest 与讲稿、校验、独立评审，按需产出。';
export const SKILL_WHEN_TO_USE = '用户明确要求目录讲解视频、HTML 导览页，或点名「目录放映」/ foldercast 时使用。普通目录浏览、找文件、代码问答不使用。';

export const SKILL_CONTENT = `# 目录放映（foldercast）

模型负责理解、判断与创作；程序负责精确、重复、可复现和可验证的执行。输入是被讲解目录的路径，产物位于该目录的 \`.foldercast/\`。

## 工作流

1. **确定目标与创作偏好**：先调用 \`foldercast_cast\`，仅传目录路径，读取 \`creativePreferences\` 与 \`visualPreferences\`（不产出）。综合本次要求、已有回答和设置页默认值，按下面的沟通指引确定受众、重点、深度、内容预算与输出形式。用户当前要求优先；用户只要 HTML 就停在 HTML，不询问无关的视频配音偏好。
2. **探索与事实库**：用 \`rg --files\` 看目录，读顶层说明和关键文件，核对准备引用的数字、原文与路径。不要打开密钥样的文件（\`.env\`、\`*.pem\`、\`credentials*\`）。Office / PDF 可用插件的 \`scripts/assets/text.ts\` 提取。先写 \`digest.json\`（\`digest: ${DIGEST_VERSION}\`），再写稿。事实库的深度随目标调整，现有字段不变：\`source\`、\`scale\`、\`modules\`、\`inventory\`、\`excerpts\`、\`notes\`。用 notes 区分已确认事实、解释与待确认问题，不必读完大目录。
3. **大纲与讲稿**：先写观众需要理解的几件事，再选择场景。首次写稿或需要查场景字段时，读取 \`${AUTHORING_REFERENCE}\`。写 \`script.json\`（\`foldercast: ${SCRIPT_VERSION}\`）：\`source.root\` 为目录绝对路径，引用文件相对源目录，画面内容自足。旁白要口语、短句，字幕切分后每块 ≤${SUB_LIMIT} 显示宽度。保留真实不确定性，不把推断说成事实。
4. **机器校验**：调用 \`foldercast_cast\`，不传 \`page\` / \`voice\` / \`render\`。修复所有 blocker，逐条判断 warning；保留有依据的创作取舍。校验返回 \`revision\`：讲稿、在场的 digest 和直接引用文件用内容哈希；引用目录用文件名、大小和修改时间，digest 的文件总数抽查也参与。它不覆盖整个源目录的正文或软件版本。校验不代表内容正确。
5. **独立评审与复评**：按下面的评审判据进行两阶段评审。不通过就修正、重新校验、复评；digest 改动要重新做事实层评审。两三轮仍不收敛时，把有证据的分歧交给用户。
6. **记录通过的版本**：末轮通过后，确认文件仍是本轮评审的版本，再调用工具传 \`reviewRevision: revision\`。\`review.md\` 必须存在；工具记录 \`review.json\` 回执。传参代表主 agent 声明评审通过；程序检查版本匹配与报告哈希，不解析报告中的自然语言结论，不证明事实正确或模型确实完成了评审。
7. **显式产出**：正式产出要求当前版本的评审回执。先传 \`page: true\`，需要视频再传 \`render: true\`；需要旁白同时传 \`voice: true\`。一次调用可都传，顺序为 check → page → voice → render。需要检查画面时可传 \`draft: true\` 生成工作草稿，交付前仍须评审。讲稿或引用文件改变后，要重新校验与复评，不可沿用旧回执。

## 创作前沟通与内容预算

\`creativePreferences\` 是参考，不是问卷或硬规则。\`dialogue\` 为「按需询问」（默认）时，只问会改变内容取舍、且上下文尚未回答的问题；为「先沟通目标」时，先介绍目录的初步判断与推荐范围，再讨论未明确的目标；为「直接规划」时，自行选择可合理推断的偏好并简述假设，只有影响正确性的缺项才追问。已有回答、明确的本次要求和设置值要先利用，不反复要求用户确认，也不把直接规划当成忽略用户硬要求的许可。

提问从观众需要作出的选择出发，例如「给谁看，他们已经了解什么？」「最希望理解用途、整体架构，还是某个关键流程？」「更希望快速导览，还是深入解释设计取舍？」「期望视频多长，或导览页读多久？」无需每次全问；通常合并一轮，优先问一到三个最有影响的问题，并给出结合目录内容的推荐答案与取舍。\`audience\`、\`focus\`、\`depth\` 和 \`prompt\` 提供默认受众、重点、深度和沟通指导；结合本次要求采用，不能机械照抄或要求用户填写内部字段。

\`videoMinutes\` 与 \`pageMinutes\` 的单位都是分钟。前者是视频内容预算，后者是预期阅读量，不是网页播放时长，也不保证用户实际阅读速度。留空时结合受众、核心概念、模块关系与讲述重点规划。文件数、有效代码行数、文档量仅提供规模事实，不能机械换算时长；重复内容归类，用代表性证据支撑主线。不要为达到目标填充旁白，也不要为缩短时长删掉支撑结论必需的事实。

写稿前简述要回答的问题、推荐范围和采用的预算；设置页目标可根据内容调整并说明理由。用户明确要求硬上限时，应通过内容取舍满足；配音后按实测核对，超出则改稿、复评并重配，不能截断音轨或擅自放宽上限。将本次采用的受众、重点、预算、估算依据和关键省略记录到 \`digest.notes\`。只有决定采用视频目标后，才换算为秒写入 \`script.video.targetDurationSec\`，并牢记这是现有渲染器的软约束，配音实测优先。当前 HTML 与视频共用场景；若两种预算无法同时满足，应说明取舍、与用户讨论主线的展开程度，不声称已实现独立页面自动摘要或阅读计时。

## 美术风格与自定义提示词

选择内置风格时，\`visualPreferences.style\` 是具有设计含义的风格名称，\`stylePrompt\` 是包含中文名与英文设计术语的内置创作指导，\`prompt\` 是用户补充。把风格名称与指导一起用于本次选材、场景组织和节拍；结合用户当前要求调整，不把名称只当色板编号，也不机械执行每条建议。新讲稿的 \`script.visual.style\` 使用 \`${VISUAL_STYLE_NAMES.join(' / ')}\`（瑞士风格为默认），不写旧的兼容名称。\`script.visual.prompt\` 保存本次采用的美术指导，包含风格名称与需要保留的原则、用户补充和本次取舍。预设由程序控制配色、字体与卡片观感；提示词由模型理解，不直接变成 CSS，也不保证任意自由版式，仍使用现有 11 种场景。优先保留真实内容和可读性，不为美术效果编造证据。设置变化后，已有讲稿不会自动改写；需要新偏好时修改讲稿并重新校验与评审。导览页默认跟随整体风格，单独设置的页面风格可覆盖它。

用户选择「自定义风格」时，\`visualPreferences.name\` 是自定义名称，\`prompt\` 是想要的效果，\`stylePrompt\` 已包含这两项。以用户描述为主要美术指导，不附加基础预设的内置创作指导。\`baseStyle\` 只用于现有模板的配色、字体与卡片观感，不能据此声称任意描述都能精确渲染。新讲稿写 \`visual.style: "自定义风格"\`，保留 \`name\`、\`baseStyle\` 和本次采用的非空 \`prompt\`，不将自定义名称改成基础预设名称。若描述尚未填写，先利用用户当前要求；仍无法判断且影响创作取舍时再询问。用户只选已有风格时，忽略未启用的自定义名称和基础预设设置。

## 评审判据

起独立 subagent，给它目录路径、digest / script 路径、当前 revision，以及 \`${REVIEW_REFERENCE}\` 的完整内容。不要提供写稿人的取舍理由来引导结论。

先对照源目录审 digest 的事实、数字、摘录，再对照事实库审 script 的忠实程度、重点、遗漏、顺序和表达；发现可疑事实时回到源目录核查。结论与证据写入 \`review.md\`，每轮注明 revision 和「通过 / 不通过」。复评必须核对上轮问题并抽查新改动。关键事实无法确认时不能放行，写清缺什么证据。

## 输出与执行边界

- \`page: true\` → \`out/page.html\`。HTML 与视频共享场景内容与素材准备，输出形式不同；不承诺像素相同。图片在预算内内联，超过预算使用相对路径，转发时需附被引用的素材并保留相对位置；Office / PDF 页图和视频封面指向准备产物，不是原文件。
- \`voice: true\` → 场景音频与 \`durations.json\`。默认 edge（免密钥、需联网），mimo 需要密钥。程序在 \`audio/cache.json\` 记录逐场合成请求与音频哈希，自动判断缓存并支持断点续跑；\`forceVoice\` 用于主动重配。时长以 ffprobe 实测为准。只改画面不重合成音频；改讲稿中的 voice 配置要重跑 voice，实际请求相同的场景仍可复用。
- \`render: true\` → \`out/video.mp4\`。默认静音，1920×1080、30fps；有有效配音时使用实测时间轴。过期、缺少新版本记录或整条音轨不完整的 \`durations.json\` 会被拒绝，应先重跑 voice。clip 只展示封面，不播放源视频。
- 程序用 \`artifacts.json\` 记录产物输入版本与输出哈希。输入变化不会自动重做产物，也不要将磁盘上旧文件当成当前交付物。current 仅表示记录中的输入、参数和输出仍匹配，不代表内容正确或符合新设置。
- 直跑 \`pnpm page / voice / render <目录>\` 默认是草稿；\`--approved\` 检查评审回执。调画面可用 \`pnpm render <目录> --still <秒>\`，不必整片渲染。
- 旧项目迁移：旧 \`review.md\` 需重新评审并绑定当前回执；无 \`audio/cache.json\` 的旧音频第一次需重配。讲稿无需迁移 schema。
- 缺浏览器仅影响视频；依赖问题按工具返回的引导处理。退出码 2 表示参数、讲稿或环境问题，3 表示缺浏览器，4 表示缺密钥。
`;
