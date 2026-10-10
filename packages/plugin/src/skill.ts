/** 运行时注册的 skill。主流程随插件加载，详细创作与评审参考按需读取。 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DIGEST_VERSION } from '../scripts/contracts/digest.ts';
import { SCRIPT_VERSION } from '../scripts/contracts/script.ts';
import { SUB_LIMIT } from '../scripts/contracts/subtitles.ts';

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

1. **确定目标**：从用户已有要求确定受众、讲述重点、时长与输出形式。缺少偏好时自行选择并说明；只有缺项影响正确性时才追问。用户只要 HTML 就停在 HTML。
2. **探索与事实库**：用 \`rg --files\` 看目录，读顶层说明和关键文件，核对准备引用的数字、原文与路径。不要打开密钥样的文件（\`.env\`、\`*.pem\`、\`credentials*\`）。Office / PDF 可用插件的 \`scripts/assets/text.ts\` 提取。先写 \`digest.json\`（\`digest: ${DIGEST_VERSION}\`），再写稿。事实库的深度随目标调整，现有字段不变：\`source\`、\`scale\`、\`modules\`、\`inventory\`、\`excerpts\`、\`notes\`。用 notes 区分已确认事实、解释与待确认问题，不必读完大目录。
3. **大纲与讲稿**：先写观众需要理解的几件事，再选择场景。首次写稿或需要查场景字段时，读取 \`${AUTHORING_REFERENCE}\`。写 \`script.json\`（\`foldercast: ${SCRIPT_VERSION}\`）：\`source.root\` 为目录绝对路径，引用文件相对源目录，画面内容自足。旁白要口语、短句，字幕切分后每块 ≤${SUB_LIMIT} 显示宽度。保留真实不确定性，不把推断说成事实。
4. **机器校验**：调用 \`foldercast_cast\`，不传 \`page\` / \`voice\` / \`render\`。修复所有 blocker，逐条判断 warning；保留有依据的创作取舍。校验返回 \`revision\`：讲稿、在场的 digest 和直接引用文件用内容哈希；引用目录用文件名、大小和修改时间，digest 的文件总数抽查也参与。它不覆盖整个源目录的正文或软件版本。校验不代表内容正确。
5. **独立评审与复评**：按下面的评审判据进行两阶段评审。不通过就修正、重新校验、复评；digest 改动要重新做事实层评审。两三轮仍不收敛时，把有证据的分歧交给用户。
6. **记录通过的版本**：末轮通过后，确认文件仍是本轮评审的版本，再调用工具传 \`reviewRevision: revision\`。\`review.md\` 必须存在；工具记录 \`review.json\` 回执。传参代表主 agent 声明评审通过；程序检查版本匹配与报告哈希，不解析报告中的自然语言结论，不证明事实正确或模型确实完成了评审。
7. **显式产出**：正式产出要求当前版本的评审回执。先传 \`page: true\`，需要视频再传 \`render: true\`；需要旁白同时传 \`voice: true\`。一次调用可都传，顺序为 check → page → voice → render。需要检查画面时可传 \`draft: true\` 生成工作草稿，交付前仍须评审。讲稿或引用文件改变后，要重新校验与复评，不可沿用旧回执。

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
