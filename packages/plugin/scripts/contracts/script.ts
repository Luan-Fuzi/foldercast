/**
 * `script.json`（讲稿）的 TypeScript 类型。
 *
 * 这是契约的三处表示之一，另外两处是 `docs/specs/script.schema.json`（机器可读）
 * 与 `docs/specs/SPEC-data-format.md` 第二节（人读）。**改一处必须同改三处**，见
 * docs/conventions/docs.md 第五节。
 *
 * 讲稿是**创作产物**：重跑会得到不同结果，删了就丢了。所以这里的类型只描述形状，
 * 判据（路径是否存在、字幕是否超长）在 `scripts/validate/` 里查。
 */
import type { Kind, StyleSpec, VideoSpec, VoiceSpec } from './foldercast.ts';

/** 场景类型。开放枚举：渲染器遇到不认识的类型应跳过并警告，而不是崩溃。 */
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
 *
 * 这是 SPEC-data-format.md「场景类型清单（MVP）」那张表的机器可读版本：schema 里用
 * `allOf` 表达同一件事，校验器用这张表生成「缺什么 / 多了什么」的可操作信息。
 */
export const SCENE_REQUIRED_FIELDS: Readonly<Record<SceneType, readonly string[]>> = {
  cover: ['title'],
  tree: ['highlight'],
  inventory: ['groups'],
  file: ['file'],
  gallery: ['items'],
  clip: ['source'],
  document: ['source', 'pages'],
  outro: ['title'],
};

/** 每种场景**允许**出现的字段（含上面的必需字段与通用字段）。未列出的字段出现在该场景里就是错误。 */
export const SCENE_ALLOWED_FIELDS: Readonly<Record<SceneType, readonly string[]>> = {
  cover: ['id', 'type', 'title', 'subtitle', 'narration', 'durationSec'],
  tree: ['id', 'type', 'title', 'narration', 'durationSec', 'highlight'],
  inventory: ['id', 'type', 'title', 'narration', 'durationSec', 'groups'],
  file: ['id', 'type', 'title', 'narration', 'durationSec', 'file', 'asset', 'focusLines'],
  gallery: ['id', 'type', 'title', 'narration', 'durationSec', 'items'],
  clip: ['id', 'type', 'title', 'narration', 'durationSec', 'source', 'poster', 'clipRange'],
  document: ['id', 'type', 'title', 'narration', 'durationSec', 'source', 'pages'],
  outro: ['id', 'type', 'title', 'subtitle', 'narration', 'durationSec'],
};

export type InventoryGroup = {
  kind: Kind;
  count: number;
  note?: string;
};

/**
 * 一个分镜。字段的**跨字段**约束（哪种场景要哪些字段、引用是否存在于解读里）
 * 不在类型里表达，由校验器查。
 */
export type Scene = {
  /** 场景唯一标识，用于配音产物命名与对齐。 */
  id: string;
  type: SceneType;
  title?: string;
  subtitle?: string;
  /** 配音文本，也是字幕来源。字幕块由阶段③按标点与字数切分。 */
  narration: string;
  /** null 表示由阶段③按实测音频回填。 */
  durationSec?: number | null;

  /** tree：需要强调的子路径。 */
  highlight?: string[];
  /** inventory：内容分组盘点。 */
  groups?: InventoryGroup[];
  /** file：相对 source.root 的路径，必须存在于解读的 manifest 里。 */
  file?: string;
  /** file：已生成的素材路径，相对工作根。 */
  asset?: string;
  /** file：高亮行区间 [起, 止]。 */
  focusLines?: [number, number];
  /** gallery：图片素材路径列表，相对工作根。 */
  items?: string[];
  /** clip / document：源文件路径，相对 source.root。 */
  source?: string;
  /** clip：封面图，相对工作根。 */
  poster?: string;
  /** clip：片段区间 [起秒, 止秒]。 */
  clipRange?: [number, number];
  /** document：逐页转图后的素材路径，相对工作根。 */
  pages?: string[];
};

export type ScriptDocument = {
  /** 所引用的解读格式版本。与解读各自独立版本化。 */
  foldercast: 1;
  generatedAt?: string;
  source: {
    /** 被讲解目录的绝对路径，须与解读一致。 */
    root: string;
    label?: string;
  };
  /** 整片标题，可选。 */
  title?: string;
  /**
   * 出片规格。与解读里的 `video` 同形状（`VideoSpec`），**讲稿这一份优先**：同一个目录可以出
   * 不同尺寸的片子，那是讲稿的选择，不是目录的属性。渲染阶段（M7）读它，缺省 1920×1080 / 30fps。
   */
  video?: VideoSpec;
  /** 风格：预设名 + token 覆盖。渲染阶段（M7）读它，见 docs/specs/SPEC-data-format.md 第一节。 */
  style?: StyleSpec;
  /**
   * 配音配置：provider + 音色 + 风格。配音阶段（M8）读它，**讲稿这一份优先于解读里的**。
   * 密钥不放这里（只放引用名），值走凭据 seam（C6）。
   */
  voice?: VoiceSpec;
  scenes: Scene[];
};
