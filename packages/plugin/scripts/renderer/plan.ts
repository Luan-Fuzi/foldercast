/**
 * 渲染计划：讲稿 + 解读 + 素材 → **一份可以喂给浏览器的纯数据**。
 *
 * 这一步是 M7 的核心边界，理由来自 ADR 0003 附注与 ROADMAP 的坑 1：
 *
 * 1. **讲稿在运行时加载，不静态 import**。CLI 按传入的目录读 `script.json`，算成计划再交给
 *    渲染进程。加一个目录不需要改任何 TypeScript 源码 —— 浏览器那一侧根本不知道有文件系统。
 * 2. **浏览器里没有文件系统访问**。图片/视频路径在这里就解析成 `file://` URI（或 `assets/`
 *    基准下的相对路径），组件只认 URI。解不开的素材变成一条 `warning`，不是崩溃。
 * 3. **一半是纯的**。`buildPlan` 只吃三个 JSON 对象，不碰文件系统，所以「这份讲稿会渲染成什么」
 *    可以用夹具直接断言（`--check` 与单测都走这条路）。
 *
 * 样式 token 的合成放在 `styles.ts`，时长放在 `estimate.ts`；这里只负责「讲稿里写了什么、
 * 对应到画面上是哪个组件、引用了哪张图」。
 */
import { primaryProduct, type AssetEntry, type AssetManifest, type AssetProduct, type AssetRole } from '../contracts/assets.ts';
import type { FoldercastDocument, Kind, ManifestEntry, Role } from '../contracts/foldercast.ts';
import type { Scene, SceneType, ScriptDocument } from '../contracts/script.ts';
import {
  captionWindows,
  estimateSceneSec,
  scaleToTarget,
  secToFrames,
} from './estimate.ts';
import { EMBED_WIDTH, type EmbedFn } from './embed.ts';
import { applyOverrides, cssVariables, FALLBACK_TOKENS, tokensFromPreset, type Tokens } from './styles.ts';

export type { Tokens };

/**
 * 画面里的一件素材。
 *
 * `src` 是**组件真正放进 `img`/`video` 的东西**：图片是 `data:` URI（浏览器里读不了
 * `file://`，见 `embed.ts` 的说明），视频是 `file://` URL（`<video>` 不受那条限制）。
 * `path` 始终保留工作根下的相对路径 —— 报错、日志与测试都靠它认素材。
 */
export type Media = {
  path: string;
  /** 可直接放进 `src` 的地址；拼不出来的素材（缺文件）没有它，画面给占位。 */
  src?: string;
  /** 源文件路径（相对源目录），有就带上，画面角落用它说明「这是哪个文件」。 */
  file?: string;
  width?: number;
  height?: number;
  /** 内联后的字节数，`--check` 报计划规模时用。 */
  inlineBytes?: number;
};

/** 场景共同的部分。`parts` 是字幕块在**本场景内**的帧区间（`from` 含、`to` 不含）。 */
export type SceneCommon = {
  id: string;
  type: SceneType;
  narration: string;
  /** 画面上的场景标题；讲稿没写时按类型给一个（见 `defaultTitle`）。 */
  title: string;
  durationInFrames: number;
  parts: { text: string; from: number; to: number }[];
};

export type Fact = { label: string; value: string };

export type CoverScene = SceneCommon & {
  type: 'cover';
  subtitle?: string;
  eyebrow: string;
  facts: Fact[];
};

export type TreeRow = { path: string; depth: number; files: number; bytes: number; highlight: boolean };

export type TreeScene = SceneCommon & {
  type: 'tree';
  rows: TreeRow[];
  /** 被强调但不在 `rows` 里的子路径（讲稿点了名、树里没画到）。 */
  missingHighlights: string[];
};

export type InventoryGroup = { kind: Kind; count: number; share: number; note?: string };

export type InventoryScene = SceneCommon & {
  type: 'inventory';
  groups: InventoryGroup[];
  totalFiles: number;
};

/** 展示用的尺寸/行数摘要。数字都来自解读或素材清单，页面不自己估。 */
export type FileMeta = {
  kind: Kind;
  role?: Role;
  bytes?: number;
  lines?: number;
  language?: string;
};

export type FileCode = {
  /** 高亮行区间（`focusLines`）。代码素材图只画文件开头若干行，所以它在图上未必可见。 */
  focusLines?: [number, number];
};

export type FileScene = SceneCommon & {
  type: 'file';
  path: string;
  meta: FileMeta;
  preview?: string;
  media?: Media;
  code?: FileCode;
  /** 素材缺失的原因（讲稿引用了没生成的素材时写在这里，画面照样出）。 */
  note?: string;
};

export type GalleryScene = SceneCommon & {
  type: 'gallery';
  items: Media[];
  columns: number;
};

export type ClipScene = SceneCommon & {
  type: 'clip';
  video: Media;
  poster?: Media;
  range?: [number, number];
};

export type DocumentScene = SceneCommon & {
  type: 'document';
  pages: Media[];
  footer: string;
};

export type OutroScene = SceneCommon & {
  type: 'outro';
  subtitle?: string;
  facts: Fact[];
  lines: string[];
};

export type PlanScene =
  | CoverScene
  | TreeScene
  | InventoryScene
  | FileScene
  | GalleryScene
  | ClipScene
  | DocumentScene
  | OutroScene;

export type Composition = {
  id: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
};

export type Plan = {
  composition: Composition;
  /** 整片标题（讲稿的 `title`，缺省用目录名）。 */
  title: string;
  /** 目录名，画面角标用。 */
  label: string;
  root: string;
  tokens: Tokens;
  css: Record<string, string>;
  scenes: PlanScene[];
  /** 渲染前的提醒（素材缺失、未知场景类型、跳过的场景…）。有内容照样渲染。 */
  warnings: string[];
};

/** 出片规格的兜底值。讲稿没写 `video` 时用它 —— 与 SPEC-data-format.md 的示例一致。 */
export const DEFAULT_VIDEO = { width: 1920, height: 1080, fps: 30 } as const;

/** 第一版的硬编码预设（ROADMAP：风格预设押后，先一套）。 */
export const DEFAULT_PRESET = 'deck';

/** 每个场景至少显示这么久的字幕块。 */
export const MIN_SUB_SEC = 1.1;

const KIND_LABELS: Record<Kind, string> = {
  code: '代码',
  text: '文本',
  markup: '标记',
  data: '数据',
  office: '办公文档',
  pdf: 'PDF',
  image: '图片',
  video: '视频',
  audio: '音频',
  archive: '压缩包',
  binary: '二进制',
  other: '其他',
};

/** 内容类别的中文名。画面上不出现英文枚举值 —— 观众不认 `office`。 */
export function kindLabel(kind: Kind): string {
  return KIND_LABELS[kind] ?? kind;
}

/** 字节数 → 人读的尺寸。与 HTML 视图同一套口径（KB 一位小数，MB 两位）。 */
export function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** 用 ` · ` 串起若干片段，空片段直接消失（画面上不出现 `undefined`）。 */
export function metaLine(parts: (string | undefined)[]): string {
  return parts.filter((part) => part !== undefined && part !== '').join(' · ');
}

/** 文件的一行摘要：`代码 · 4.1 KB · 137 行 · TypeScript`。每一项都来自解读。 */
export function fileMetaText(meta: { kind: Kind; bytes?: number; lines?: number; language?: string }): string {
  return metaLine([
    kindLabel(meta.kind),
    meta.bytes === undefined ? undefined : humanBytes(meta.bytes),
    meta.lines === undefined ? undefined : `${meta.lines} 行`,
    meta.language,
  ]);
}

/**
 * 正文自适应：字符多就小一号。**按文本长度估**，因为画面里没有布局引擎可以回读。
 * 这不是精修版式，是把「一定放不下」压到「勉强放得下」，剩下的交给换行。
 */
export function fitSize(text: string, base: number, min: number): number {
  const length = [...text].length;
  if (length <= 26) return base;
  return Math.max(min, Math.round((base * 26) / length));
}


/** 场景没写标题时给一个，避免画面上出现空标题栏。 */export function defaultTitle(scene: Scene, label: string): string {
  if (scene.title !== undefined && scene.title.trim() !== '') return scene.title;
  switch (scene.type) {
    case 'cover':
      return label;
    case 'outro':
      return '小结';
    case 'gallery':
      return '图片';
    case 'document':
      return basename(scene.source ?? '');
    case 'file':
      return basename(scene.file ?? '');
    case 'clip':
      return basename(scene.source ?? '');
    default:
      return label;
  }
}

function basename(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] ?? path;
}

export type BuildPlanInput = {
  script: ScriptDocument;
  reading: FoldercastDocument;
  assets?: AssetManifest;
  /** 样式预设 JSON（已读进内存）。缺省用兜底 token。 */
  preset?: unknown;
  /** 显式指定的预设名，覆盖讲稿里的 `style.preset`。 */
  presetName?: string;
  /**
   * 图片内联函数（`embed-node.ts` 的 `embedImage`）。**注入而不是 import**：
   * 实现要 `node:*`，而 `plan.ts` 会进浏览器 bundle。不传就不内联 —— 单测与
   * 「讲稿会渲染成什么」的断言本来也不需要真去读图。
   */
  embed?: EmbedFn;
  /** 内联用的工作根（素材路径的基准）。 */
  workRoot?: string;
};

/**
 * 合成渲染计划。**确定性**：只有排序与算术，没有时钟、没有随机数；同样的三个输入永远得到
 * 同样的计划（`pageGeneratedAt` 那类字段一律不进计划，它们会破坏逐帧一致）。
 */
export function buildPlan(input: BuildPlanInput): Plan {
  const { script, reading } = input;
  const warnings: string[] = [];

  const assetIndex = new Map<string, AssetEntry>();
  const assetByProduct = new Map<string, { entry: AssetEntry; product: AssetProduct }>();
  for (const entry of input.assets?.entries ?? []) {
    assetIndex.set(entry.path, entry);
    for (const product of entry.products) assetByProduct.set(product.path, { entry, product });
  }
  const manifestIndex = new Map<string, ManifestEntry>();
  for (const entry of reading.manifest) manifestIndex.set(entry.path, entry);

  const tokens = resolveTokens(input, warnings);
  const fps = script.video?.fps ?? reading.video?.fps ?? DEFAULT_VIDEO.fps;
  const width = script.video?.width ?? reading.video?.width ?? DEFAULT_VIDEO.width;
  const height = script.video?.height ?? reading.video?.height ?? DEFAULT_VIDEO.height;
  const label = script.source.label ?? basename(script.source.root);

  const kept: Scene[] = [];
  for (const scene of script.scenes) {
    if (!isKnownSceneType(scene.type)) {
      warnings.push(`跳过场景 ${scene.id}：类型 ${String(scene.type)} 不认识（渲染器遇到未知类型跳过而非崩溃）`);
      continue;
    }
    kept.push(scene);
  }
  if (kept.length === 0) {
    throw new Error('讲稿里没有可渲染的场景');
  }

  const estimated = kept.map((scene) =>
    scene.durationSec !== undefined && scene.durationSec !== null && scene.durationSec > 0
      ? secToFrames(scene.durationSec, fps)
      : secToFrames(estimateSceneSec(scene.narration), fps),
  );
  const target = script.video?.targetDurationSec;
  const frames =
    target !== undefined && target !== null && target > 0
      ? scaleToTarget(estimated, secToFrames(target, fps))
      : estimated;
  if (target !== undefined && target !== null && target > 0) {
    warnings.push(
      `讲稿写了 targetDurationSec=${target}，各场景按比例缩放到共 ${frames.reduce((sum, value) => sum + value, 0)} 帧`,
    );
  }

  const context: SceneContext = {
    index: manifestIndex,
    assets: assetIndex,
    assetByProduct,
    embed: input.embed,
    workRoot: input.workRoot,
    media: (path, file, product) => mediaFor(path, file, product, input.embed, input.workRoot),
    root: script.source.root,
    label,
    warnings,
    fps,
  };

  const scenes = kept.map((scene, i) =>
    buildScene(scene, {
      ...context,
      frames: frames[i] ?? 1,
      framesTotal: frames.reduce((sum, value) => sum + value, 0),
      title: defaultTitle(scene, label),
      sequence: i + 1,
      total: kept.length,
      spec: script.video,
    }),
  );

  return {
    composition: {
      id: 'foldercast',
      width,
      height,
      fps,
      durationInFrames: scenes.reduce((sum, scene) => sum + scene.durationInFrames, 0),
    },
    title: script.title ?? label,
    label,
    root: script.source.root,
    tokens,
    css: cssVariables(tokens),
    scenes,
    warnings,
  };
}

/** 每场景构建时共享的查表。 */
type SceneContext = {
  index: Map<string, ManifestEntry>;
  assets: Map<string, AssetEntry>;
  /** 产物路径 → （它的来源文件，产物本身）。讲稿引用的是产物路径时靠它反查。 */
  assetByProduct: Map<string, { entry: AssetEntry; product: AssetProduct }>;
  /** 图片内联函数；给了就把图片变成 data URI。 */
  embed?: EmbedFn;
  /** 内联用的工作根。 */
  workRoot?: string;
  /** 素材 → `Media`（内联在这里发生，只做一次；组件不再碰文件系统）。 */
  media: (path: string, file: string | undefined, product?: AssetProduct) => Media;
  root: string;
  label: string;
  warnings: string[];
  fps: number;
};

type SceneBuild = SceneContext & {
  frames: number;
  /** 整片帧数（outro 报片长用，各场景构建时都能拿到）。 */
  framesTotal: number;
  title: string;
  sequence: number;
  total: number;
  spec?: ScriptDocument['video'];
};

function buildScene(scene: Scene, build: SceneBuild): PlanScene {
  const common: SceneCommon = {
    id: scene.id,
    type: scene.type,
    narration: scene.narration,
    title: build.title,
    durationInFrames: build.frames,
    parts: captionWindows(scene.narration, build.frames, secToFrames(MIN_SUB_SEC, build.fps)),
  };

  switch (scene.type) {
    case 'cover':
      return { ...common, type: 'cover', subtitle: scene.subtitle, eyebrow: scene.id, facts: coverFacts(build) };
    case 'tree':
      return treeScene(scene, common, build);
    case 'inventory':
      return inventoryScene(scene, common, build);
    case 'file':
      return fileScene(scene, common, build);
    case 'gallery':
      return galleryScene(scene, common, build);
    case 'clip':
      return clipScene(scene, common, build);
    case 'document':
      return documentScene(scene, common, build);
    case 'outro':
      return { ...common, type: 'outro', subtitle: scene.subtitle, facts: outroFacts(build), lines: outroLines(build) };
  }
}

function coverFacts(build: SceneBuild): Fact[] {
  const spec = build.spec;
  const facts: Fact[] = [];
  facts.push({ label: '分辨率', value: `${spec?.width ?? DEFAULT_VIDEO.width}×${spec?.height ?? DEFAULT_VIDEO.height}` });
  facts.push({ label: '帧率', value: `${build.fps} fps` });
  if (spec?.targetDurationSec !== undefined && spec?.targetDurationSec !== null) {
    facts.push({ label: '目标时长', value: `${Math.round(spec.targetDurationSec / 60)} 分钟` });
  }
  return facts;
}

function outroFacts(build: SceneBuild): Fact[] {
  const seconds = Math.round(build.framesTotal / build.fps);
  const minutes = Math.floor(seconds / 60);
  return [
    { label: '场景', value: `${build.total} 个` },
    { label: '片长', value: minutes > 0 ? `${minutes} 分 ${seconds % 60} 秒` : `${seconds} 秒` },
    { label: '文件', value: `${build.index.size} 个` },
  ];
}

function outroLines(build: SceneBuild): string[] {
  const kinds = new Map<Kind, number>();
  for (const entry of build.index.values()) kinds.set(entry.kind, (kinds.get(entry.kind) ?? 0) + 1);
  const top = [...kinds.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([kind, count]) => `${kindLabel(kind)} ${count}`);
  return top.length === 0 ? [] : [`内容构成：${top.join(' · ')}`];
}

function treeScene(scene: Scene, common: SceneCommon, build: SceneBuild): TreeScene {
  const highlight = new Set(scene.highlight ?? []);
  const rows: TreeRow[] = [];
  const top = new Map<string, { files: number; bytes: number }>();

  for (const entry of build.index.values()) {
    const slash = entry.path.indexOf('/');
    const head = slash === -1 ? '(根目录)' : entry.path.slice(0, slash);
    const current = top.get(head) ?? { files: 0, bytes: 0 };
    current.files += 1;
    current.bytes += entry.bytes ?? 0;
    top.set(head, current);
  }

  const ordered = [...top.entries()].sort(
    (a, b) => b[1].files - a[1].files || a[0].localeCompare(b[0], 'zh'),
  );
  for (const [path, stat] of ordered) {
    rows.push({ path, depth: 0, files: stat.files, bytes: stat.bytes, highlight: highlight.has(path) });
  }

  const missing = [...highlight].filter((path) => !top.has(path));
  if (missing.length > 0) {
    build.warnings.push(`tree 场景 ${scene.id} 强调的路径不在目录顶层：${missing.join('、')}`);
  }
  return { ...common, type: 'tree', rows, missingHighlights: missing };
}

function inventoryScene(scene: Scene, common: SceneCommon, build: SceneBuild): InventoryScene {
  const totalFiles = build.index.size;
  const groups = (scene.groups ?? []).map((group) => ({
    kind: group.kind,
    count: group.count,
    share: totalFiles > 0 ? group.count / totalFiles : 0,
    note: group.note,
  }));
  return { ...common, type: 'inventory', groups, totalFiles };
}

function fileScene(scene: Scene, common: SceneCommon, build: SceneBuild): FileScene {
  const path = scene.file ?? '';
  const entry = build.index.get(path);
  const resolved = resolveProduct(path, scene.asset, 'file', build);

  const code: FileCode | undefined =
    resolved?.role === 'code' ? { focusLines: scene.focusLines } : undefined;

  return {
    ...common,
    type: 'file',
    path,
    meta: {
      kind: entry?.kind ?? 'other',
      role: entry?.role,
      bytes: entry?.bytes,
      lines: entry?.lines,
      language: entry?.language,
    },
    preview: previewOf(entry),
    media: resolved?.media,
    code,
    note: resolved === undefined || resolved.media === undefined ? resolved?.note : undefined,
  };
}

function galleryScene(scene: Scene, common: SceneCommon, build: SceneBuild): GalleryScene {
  const items: Media[] = [];
  for (const item of scene.items ?? []) {
    const resolved = resolveProduct(item, item, 'gallery', build);
    if (resolved?.media !== undefined) items.push(resolved.media);
  }
  const columns = items.length <= 3 ? items.length || 1 : items.length <= 8 ? 3 : 4;
  return { ...common, type: 'gallery', items, columns };
}

function clipScene(scene: Scene, common: SceneCommon, build: SceneBuild): ClipScene {
  const source = scene.source ?? '';
  // 逐个候选试：视频文件的主产物是**封面图**（素材阶段抽的），它内联进画面；
  // 候选里的视频路径本身内联不了，会被跳过。
  const video = resolveProduct(source, scene.asset, 'clip', build);
  const poster = scene.poster === undefined ? undefined : resolveProduct(source, scene.poster, 'clip', build);
  if (video?.media === undefined) {
    build.warnings.push(`clip 场景 ${scene.id} 没有封面图可用，画面只显示文件名：${source}`);
  }
  return {
    ...common,
    type: 'clip',
    video: video?.media ?? { path: source, file: source },
    poster: poster?.media,
    range: scene.clipRange,
  };
}

function documentScene(scene: Scene, common: SceneCommon, build: SceneBuild): DocumentScene {
  const source = scene.source ?? '';
  const pages: Media[] = [];
  for (const page of scene.pages ?? []) {
    const resolved = resolveProduct(source, page, 'document', build);
    if (resolved?.media !== undefined) pages.push(resolved.media);
  }
  return { ...common, type: 'document', pages, footer: `${pages.length} 页` };
}

/**
 * 素材解析：**讲稿指的是工作根下的路径，素材清单认得它，解读也知道这个文件**。三个来源都有
 * 用处，所以按「讲稿显式指定 → 素材清单里的主产物 → 解读里登记的 asset」的顺序找，找不到
 * 就留一条警告（画面照样出，不因为缺一张图就整片失败）。
 */
function resolveProduct(
  filePath: string,
  explicit: string | undefined,
  where: string,
  build: SceneBuild,
): { media?: Media; role?: AssetRole; note?: string; known: boolean } {
  const owner = build.assets.get(filePath);
  // 反查「这个路径是哪个文件的产物」：讲稿写的是**产物路径**时靠它认出拥有者
  // （`gallery.items`、`document.pages`、`scene.asset` 都是这个形状），
  // 于是角色（code / page / thumb）与尺寸都能跟着回来。
  const ownerOfProduct = build.assetByProduct.get(explicit ?? '') ?? build.assetByProduct.get(filePath);
  const readingAsset = build.index.get(filePath)?.asset;

  type Candidate = { path: string; product?: AssetProduct; file: string };
  const candidates: Candidate[] = [];
  const push = (path: string, product: AssetProduct | undefined, file: string): void => {
    if (candidates.some((item) => item.path === path)) return;
    candidates.push(product === undefined ? { path, file } : { path, product, file });
  };

  if (explicit !== undefined) {
    push(explicit, ownerOfProduct?.product, ownerOfProduct?.entry.path ?? filePath);
  }
  const primary = owner === undefined ? undefined : primaryProduct(owner.products);
  if (primary !== undefined) push(primary.path, primary, filePath);
  if (readingAsset !== undefined) push(readingAsset, ownerOfProduct?.product, ownerOfProduct?.entry.path ?? filePath);

  if (candidates.length === 0) {
    // 讲稿引用的就是个素材路径（图片墙、逐页图），但素材清单里没有它 —— 照样引用。
    if (explicit !== undefined && isAssetPath(explicit)) {
      return { media: build.media(explicit, filePath), known: false };
    }
    build.warnings.push(`${where} 场景引用的文件没有素材：${filePath === '' ? explicit ?? '(空)' : filePath}`);
    return { note: '解读里没有这个文件的素材', known: false };
  }

  // 逐个候选试内联：主产物可能是「缩略图 + 关键帧」这类组合，第一个内联不了就试下一个。
  let fallback: { media: Media; role?: AssetRole } | undefined;
  for (const candidate of candidates) {
    if (isRemote(candidate.path)) {
      const file = build.index.get(candidate.file) ?? build.index.get(filePath);
      return {
        media: { path: candidate.path, src: candidate.path, file: file?.path ?? filePath },
        role: candidate.product?.role,
        known: true,
      };
    }

    const file = build.index.get(candidate.file) ?? build.index.get(filePath);
    const media = build.media(candidate.path, file?.path ?? filePath, candidate.product);
    if (media.src !== undefined) {
      return { media, role: candidate.product?.role, known: true };
    }
    if (fallback === undefined) {
      fallback = candidate.product === undefined ? { media } : { media, role: candidate.product.role };
    }
  }

  return fallback === undefined ? { known: true } : { ...fallback, known: true };
}

/**
 * 把素材路径变成组件能用的 `Media`：能内联就内联（图片），否则给 `file://` 地址
 * （视频、以及内联失败的图片 —— 后者在浏览器里读不了，画面会落到占位说明上）。
 */
function mediaFor(
  path: string,
  file: string | undefined,
  product: AssetProduct | undefined,
  embed: EmbedFn | undefined,
  workRoot: string | undefined,
): Media {
  const base: Media = {
    path,
    file,
    width: product?.width,
    height: product?.height,
  };
  if (embed === undefined || workRoot === undefined) return base;
  const embedded = embed({ path, workRoot, width: EMBED_WIDTH });
  return embedded === undefined ? base : { ...base, src: embedded.src, inlineBytes: embedded.bytes };
}

/** 工作根下的素材路径（`assets/...`）。用来区分「讲稿引用了素材」与「讲稿引用了文件」。 */
function isAssetPath(path: string): boolean {
  return path.startsWith('assets/');
}

function previewOf(entry: ManifestEntry | undefined): string | undefined {
  if (entry === undefined) return undefined;
  return entry.preview ?? entry.title;
}

function isRemote(path: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(path);
}

function resolveTokens(input: BuildPlanInput, warnings: string[]): Tokens {
  const presetName =
    input.presetName ?? input.script.style?.preset ?? input.reading.style?.preset ?? DEFAULT_PRESET;
  const preset = input.preset;
  if (preset === undefined || preset === null) {
    warnings.push(`没有找到样式预设 ${presetName}，用内置兜底 token（画面仍是这套版式）`);
    return { ...FALLBACK_TOKENS, preset: presetName };
  }
  const { preset: merged, ignored } = applyOverrides(
    preset as Record<string, unknown>,
    input.script.style?.overrides ?? input.reading.style?.overrides,
  );
  if (ignored.length > 0) {
    warnings.push(`样式覆盖里认不出的键被忽略：${ignored.join('、')}`);
  }
  const tokens = tokensFromPreset(merged);
  const size = input.script.video ?? input.reading.video;
  if (size?.width !== undefined || size?.height !== undefined) {
    // 画布尺寸由 `video` 决定，token 里的尺寸跟着走，否则安全边距会按错画布算。
    tokens.width = size.width ?? tokens.width;
    tokens.height = size.height ?? tokens.height;
  }
  return tokens;
}

function isKnownSceneType(type: string): type is SceneType {
  return (
    type === 'cover' ||
    type === 'tree' ||
    type === 'inventory' ||
    type === 'file' ||
    type === 'gallery' ||
    type === 'clip' ||
    type === 'document' ||
    type === 'outro'
  );
}
