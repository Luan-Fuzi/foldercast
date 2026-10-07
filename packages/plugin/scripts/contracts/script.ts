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

/** 配音配置。provider 固定是 macOS 自带的 `say`，这里只剩音色与语速描述。 */
export type VoiceSpec = {
  /** `say` 的系统音色名。缺省自动挑一个中文音色。 */
  voice?: string;
  /** 「怎么读」的描述；`say` 只认其中形如「180 字/分」的数字当语速。 */
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
};

/** 每种场景**允许**出现的字段。未列出的字段出现在该场景里就是错误（多半是笔误）。 */
export const SCENE_ALLOWED_FIELDS: Readonly<Record<SceneType, readonly string[]>> = {
  cover: ['id', 'type', 'title', 'subtitle', 'narration', 'durationSec'],
  tree: ['id', 'type', 'title', 'narration', 'durationSec', 'entries'],
  inventory: ['id', 'type', 'title', 'narration', 'durationSec', 'groups', 'total'],
  file: ['id', 'type', 'title', 'narration', 'durationSec', 'file', 'note', 'excerpt'],
  gallery: ['id', 'type', 'title', 'narration', 'durationSec', 'items'],
  clip: ['id', 'type', 'title', 'narration', 'durationSec', 'source', 'clipRange'],
  document: ['id', 'type', 'title', 'narration', 'durationSec', 'source', 'pages'],
  outro: ['id', 'type', 'title', 'subtitle', 'narration', 'durationSec', 'lines'],
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

/** inventory 的一组。`label` 是自由文本（「Markdown 笔记」「简历素材」都行）。 */
export type InventoryGroup = {
  label: string;
  count: number;
  note?: string;
};

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
};

export type ScriptDocument = {
  foldercast: 1;
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
