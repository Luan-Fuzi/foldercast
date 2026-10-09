/**
 * `script.json`（讲稿）的 TypeScript 类型。
 *
 * 讲稿是**唯一的创作产物**：agent 写、渲染器消费。它是**自足的** —— 画面上要画的一切
 * （结构、盘点、摘录的原文）都写在讲稿里，渲染器不读任何别的中间产物；讲稿引用的
 * 图片 / 视频 / Office / PDF 用**相对源目录的路径**，转换由渲染前的 prep 按需完成。
 *
 * 所以只有一种路径基准（源目录），没有「素材相对工作根」那第二套基准。
 *
 * 判据（字段齐不齐、引用的文件在不在、字幕切不切得开）在 `renderer/check.ts`；
 * 机器可读的 schema 在 `docs/specs/script.schema.json`。
 */

/** 出片规格。缺省 1920×1080 @ 30fps。 */
export type VideoSpec = {
  width?: number;
  height?: number;
  fps?: number;
  /** 软约束：没配音时按比例缩放各场景时长；配过音以实测为准、忽略它。 */
  targetDurationSec?: number | null;
};

/** 配音配置（provider 由设置页定、经 `--provider` 透传，讲稿里只剩音色与语态描述）。 */
export type VoiceSpec = {
  /** 音色，provider 各自的叫法（edge 如 zh-CN-XiaoxiaoNeural）。缺省自动挑中文音色。 */
  voice?: string;
  /** 「怎么读」的自然语描述；mimo 用作风格指令，edge 表达不了。 */
  style?: string;
};

/** 场景类型。开放枚举：渲染器遇到不认识的类型跳过并警告，而不是崩溃。 */
export const SCENE_TYPES = [
  'cover',
  'tree',
  'inventory',
  'file',
  'gallery',
  'clip',
  'document',
  'outro',
  'concept',
  'compare',
  'flow',
] as const;

export type SceneType = (typeof SCENE_TYPES)[number];

const SCENE_TYPE_SET: ReadonlySet<string> = new Set(SCENE_TYPES);

export function isSceneType(value: unknown): value is SceneType {
  return typeof value === 'string' && SCENE_TYPE_SET.has(value);
}

/**
 * 每种场景**除 `id` / `type` / `narration` 之外**还要哪些字段。
 * schema 里用 `allOf` 表达同一件事，`renderer/check.ts` 用这张表生成可操作的报错。
 */
export const SCENE_REQUIRED_FIELDS: Readonly<Record<SceneType, readonly string[]>> = {
  cover: ['title'],
  tree: ['entries'],
  inventory: ['groups'],
  file: ['file'],
  gallery: ['items'],
  clip: ['source'],
  document: ['source'],
  outro: ['title'],
  concept: ['statement'],
  compare: ['left', 'right'],
  flow: ['steps'],
};

/** 每种场景**允许**出现的字段。未列出的字段出现在该场景里就是错误（多半是笔误）。 */
export const SCENE_ALLOWED_FIELDS: Readonly<Record<SceneType, readonly string[]>> = {
  cover: ['id', 'type', 'title', 'subtitle', 'narration', 'durationSec', 'beats'],
  tree: ['id', 'type', 'title', 'narration', 'durationSec', 'entries', 'beats'],
  inventory: ['id', 'type', 'title', 'narration', 'durationSec', 'groups', 'total', 'beats'],
  file: ['id', 'type', 'title', 'narration', 'durationSec', 'file', 'note', 'excerpt', 'excerptStart', 'beats'],
  gallery: ['id', 'type', 'title', 'narration', 'durationSec', 'items', 'beats'],
  clip: ['id', 'type', 'title', 'narration', 'durationSec', 'source', 'clipRange', 'beats'],
  document: ['id', 'type', 'title', 'narration', 'durationSec', 'source', 'pages', 'beats'],
  outro: ['id', 'type', 'title', 'subtitle', 'narration', 'durationSec', 'lines', 'beats'],
  concept: ['id', 'type', 'title', 'narration', 'durationSec', 'statement', 'points', 'beats'],
  compare: ['id', 'type', 'title', 'narration', 'durationSec', 'left', 'right', 'beats'],
  flow: ['id', 'type', 'title', 'narration', 'durationSec', 'steps', 'beats'],
};

/** tree 的一行：agent 自己数好写进来的目录摘要。 */
export type TreeEntry = {
  /** 相对源目录的子路径（通常是顶层目录，也允许关键文件）。 */
  path: string;
  /** 这个子路径下的文件数。条形图按它画宽度。 */
  files: number;
  /** 字节数，可选。写了他就显示（KB / MB）。 */
  bytes?: number;
  /** 要强调（用强调色画）。 */
  highlight?: boolean;
};

/** compare 的一侧：标签 + 几行内容（0005 WP3）。 */
export type CompareSide = {
  label: string;
  lines: string[];
};

/** flow 的一步（0005 WP3）。 */
export type FlowStep = {
  label: string;
  note?: string;
};

/** inventory 的一组。`label` 是自由文本（「Markdown 笔记」「简历素材」都行）。 */
export type InventoryGroup = {
  label: string;
  count: number;
  note?: string;
};

/** 讲稿契约版本。v2：加 beats（画面层节拍），见 docs/decisions/0004。 */
export const SCRIPT_VERSION = 2 as const;

/**
 * 场景内的一个**节拍**：一组同时出现的画面元素 + 声明式入场意图（0004）。
 *
 * 节拍时刻由渲染器对齐到字幕：第 i 拍在第 i 条字幕起始时出现（时间来自实测音频，
 * 逐帧一致不破）。模型只写「什么内容、按什么顺序、什么入场意图」；曲线归渲染器。
 */
export type Beat = {
  /** 要点组：一到三行，同拍出现（画面的信息密度主要靠它）。 */
  points?: string[];
  /** 命名图形（由场景的类型化字段确定性生成，模型只点名）：proportion = 占比堆叠条（inventory）。 */
  graphic?: 'proportion';
  /** 入场意图，缺省 reveal。四个够用，渲染器各自实现曲线。 */
  enter?: 'fade' | 'reveal' | 'grow' | 'slide';
};

/** Markdown 系扩展名：摘录走 Markdown 渲染而不是代码高亮（0005）。 */
const MARKDOWN_EXTS: ReadonlySet<string> = new Set(['md', 'markdown', 'mdx']);

/** 这个文件是不是 Markdown。渲染器与校验器都要做同一个判断，所以放在契约层。 */
export function isMarkdownFile(file: string): boolean {
  const ext = file.split('.').pop()?.toLowerCase() ?? '';
  return MARKDOWN_EXTS.has(ext);
}

/** 节拍的入场意图枚举（校验与 schema 用）。 */
export const BEAT_ENTERS = ['fade', 'reveal', 'grow', 'slide'] as const;

/** 节拍可点名的图形枚举（校验与 schema 用）。 */
export const BEAT_GRAPHICS = ['proportion'] as const;

/**
 * 一个分镜。跨字段约束（哪种场景要哪些字段、引用的文件在不在）不在类型里表达，
 * 由 `renderer/check.ts` 查。
 */
export type Scene = {
  /** 场景唯一标识，用于配音产物命名与对齐。 */
  id: string;
  type: SceneType;
  title?: string;
  subtitle?: string;
  /** 配音文本，也是字幕来源。要能切成每块 ≤24 显示宽度的字幕块。 */
  narration: string;
  /** 手写时长（秒）；配音跑过后以实测为准。 */
  durationSec?: number | null;

  /** tree：目录结构摘要（agent 自己数）。 */
  entries?: TreeEntry[];
  /** inventory：内容分组盘点。 */
  groups?: InventoryGroup[];
  /** inventory：分母。缺省用各组 count 之和。 */
  total?: number;
  /** file：相对源目录的路径，必须存在。 */
  file?: string;
  /** file：一行说明（「TypeScript · 约 140 行」这类，agent 写）。 */
  note?: string;
  /** file：摘录的原文行（agent 从文件里挑的），没有素材图时画在画面上。 */
  excerpt?: string[];
  /** file：摘录首行在源文件中的 1 基行号。写了画面就带行号槽与来源区间（L12–L18）。 */
  excerptStart?: number;
  /** gallery：一组源文件路径（图片，或视频 —— 画面用它的封面）。 */
  items?: string[];
  /** clip / document：源文件路径，相对源目录。 */
  source?: string;
  /** clip：片段区间 [起秒, 止秒]，只用来标注，不真的截播。 */
  clipRange?: [number, number];
  /** document：要翻的页码（1 起）。缺省翻全部。 */
  pages?: number[];
  /** outro：结尾的几行小结。 */
  lines?: string[];
  /** concept：大字论断（画面主角是这句话本身）。 */
  statement?: string;
  /** concept：论断下的支撑要点。 */
  points?: string[];
  /** compare：左栏。 */
  left?: CompareSide;
  /** compare：右栏。 */
  right?: CompareSide;
  /** flow：步骤（2–6 步，按顺序画成步骤条）。 */
  steps?: FlowStep[];
  /** 画面层节拍（v2，0004）：没有 beats 的场景按 v1 的静态版式渲染（兼容降级，不报错）。 */
  beats?: Beat[];
};

export type ScriptDocument = {
  foldercast: typeof SCRIPT_VERSION;
  source: {
    /** 被讲解目录的绝对路径。 */
    root: string;
    label?: string;
  };
  /** 整片标题，缺省用目录名。 */
  title?: string;
  video?: VideoSpec;
  voice?: VoiceSpec;
  scenes: Scene[];
};
