/**
 * 渲染计划：讲稿（+ prep 产物）→ **一份可以喂给浏览器的纯数据**。
 *
 * 1. **讲稿在运行时加载，不静态 import**。CLI 按传入的目录读 `script.json`，算成计划再交给
 *    渲染进程。加一个目录不需要改任何 TypeScript 源码 —— 浏览器那一侧根本不知道有文件系统。
 * 2. **浏览器里没有文件系统访问**。素材路径在这里解析成 `data:` URI，组件只认 URI。
 *    解不开的素材变成一条 `warning`，不是崩溃。
 * 3. **讲稿是自足的**：结构、盘点、摘录都来自讲稿本身；这里只做映射与算术，不做统计 ——
 *    数字（文件数、构成）都是写稿的 agent 数好写进讲稿的。
 * 4. **一半是纯的**。`buildPlan` 只吃数据对象，不碰文件系统，所以「这份讲稿会渲染成什么」
 *    可以用夹具直接断言。
 */
import type { Prepared, PrepProduct } from '../contracts/prep.ts';
import { primaryOf } from '../contracts/prep.ts';
import type { DurationsDocument, SceneDuration } from '../contracts/durations.ts';
import type { Scene, SceneType, ScriptDocument } from '../contracts/script.ts';
import { allocateByWidth } from '../contracts/spans.ts';
import {
  captionWindows,
  estimateSceneSec,
  scaleToTarget,
  secToFrames,
  secToFramesUp,
} from './estimate.ts';
import { EMBED_WIDTH, type EmbedFn } from './embed.ts';
import { cssVariables, tokensFor, type Tokens } from './styles.ts';

export type { Tokens };

/**
 * 画面里的一件素材。
 *
 * `src` 是**组件真正放进 `img` 的东西**：`data:` URI（浏览器里读不了 `file://`，
 * 见 `embed.ts` 的说明）。`path` 始终保留工作根下的相对路径 —— 报错、日志与测试都靠它认素材。
 */
export type Media = {
  path: string;
  /** 可直接放进 `src` 的地址；拼不出来的素材（缺文件）没有它，画面给占位。 */
  src?: string;
  /** 源文件路径（相对源目录），画面角落用它说明「这是哪个文件」。 */
  file?: string;
  width?: number;
  height?: number;
  /** 内联后的字节数，报告计划规模时用。 */
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

export type TreeRow = { path: string; files: number; bytes?: number; highlight: boolean };

export type TreeScene = SceneCommon & {
  type: 'tree';
  rows: TreeRow[];
};

export type InventoryGroupView = { label: string; count: number; share: number; note?: string };

export type InventoryScene = SceneCommon & {
  type: 'inventory';
  groups: InventoryGroupView[];
  totalFiles: number;
};

export type FileScene = SceneCommon & {
  type: 'file';
  path: string;
  /** 写稿 agent 给的一行说明（「TypeScript · 约 140 行」）。 */
  note?: string;
  /** 写稿 agent 摘的原文行；没有素材图的文件靠它上画面。 */
  excerpt: string[];
  media?: Media;
  /** 素材缺失的说明（讲稿引用了转不出来的文件时写在这里，画面照样出）。 */
  noteMissing?: string;
};

export type GalleryScene = SceneCommon & {
  type: 'gallery';
  items: Media[];
  columns: number;
};

export type ClipScene = SceneCommon & {
  type: 'clip';
  poster?: Media;
  file: string;
  range?: [number, number];
};

export type DocumentScene = SceneCommon & {
  type: 'document';
  pages: Media[];
  file: string;
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
  /** 渲染前的提醒（素材缺失、未知场景类型…）。有内容照样渲染。 */
  warnings: string[];
};

/** 出片规格的兜底值。讲稿没写 `video` 时用它。 */
export const DEFAULT_VIDEO = { width: 1920, height: 1080, fps: 30 } as const;

/** 每个场景至少显示这么久的字幕块。 */
export const MIN_SUB_SEC = 1.1;

/** 字节数 → 人读的尺寸。 */
export function humanBytes(bytes: number | undefined): string {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** 用 ` · ` 串起若干片段，空片段直接消失（画面上不出现 `undefined`）。 */
export function metaLine(parts: (string | undefined)[]): string {
  return parts.filter((part) => part !== undefined && part !== '').join(' · ');
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

/** 场景没写标题时给一个，避免画面上出现空标题栏。 */
export function defaultTitle(scene: Scene, label: string): string {
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
  /** prep 的结果（源路径 → 产物）。没有就只出文字场景，引用图片的场景落到占位。 */
  prep?: Map<string, Prepared>;
  /**
   * 图片内联函数（`embed-node.ts` 的 `embedImage`）。**注入而不是 import**：
   * 实现要 `node:*`，而 `plan.ts` 会进浏览器 bundle。不传就不内联 —— 单测与
   * 「讲稿会渲染成什么」的断言本来也不需要真去读图。
   */
  embed?: EmbedFn;
  /** 内联用的工作根（素材路径的基准）。 */
  workRoot?: string;
  /**
   * `durations.json`（配音阶段产物）。**给了就以实测时长为准**：场景的帧数、字幕块的
   * 时间轴都换成实测值。缺哪个场景就用那个场景的预估值（配音可以只跑一部分）。
   */
  durations?: DurationsDocument;
};

/**
 * 合成渲染计划。**确定性**：只有排序与算术，没有时钟、没有随机数；同样的输入永远得到
 * 同样的计划（时间戳那类字段一律不进计划，它们会破坏逐帧一致）。
 */
export function buildPlan(input: BuildPlanInput): Plan {
  const { script } = input;
  const warnings: string[] = [];
  const prep = input.prep ?? new Map<string, Prepared>();

  const tokens = tokensFor(script.video);
  const fps = script.video?.fps ?? DEFAULT_VIDEO.fps;
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

  // 时长的三个来源，优先级从高到低：
  //   ① durations.json 的实测值（配音跑过）
  //   ② 讲稿的 durationSec（配音回填、或人手写）
  //   ③ 按字数预估（没有音频时的默认）
  const measured = new Map<string, SceneDuration>();
  for (const scene of input.durations?.scenes ?? []) measured.set(scene.id, scene);

  const estimated = kept.map((scene) => {
    const actual = measured.get(scene.id);
    // 实测时长向上取整：少一帧就是「最后一句话被切掉」，多一帧只是多停 1/30 秒
    if (actual !== undefined) return secToFramesUp(actual.duration, fps);
    return scene.durationSec !== undefined && scene.durationSec !== null && scene.durationSec > 0
      ? secToFrames(scene.durationSec, fps)
      : secToFrames(estimateSceneSec(scene.narration), fps);
  });

  const target = script.video?.targetDurationSec;
  const scaled = measured.size === 0 && target !== undefined && target !== null && target > 0;
  const frames = scaled ? scaleToTarget(estimated, secToFrames(target, fps)) : estimated;
  if (scaled) {
    warnings.push(
      `讲稿写了 targetDurationSec=${target}，各场景按比例缩放到共 ${frames.reduce((sum, value) => sum + value, 0)} 帧`,
    );
  }
  if (measured.size > 0) {
    const missing = kept.filter((scene) => !measured.has(scene.id)).map((scene) => scene.id);
    warnings.push(
      `时长取自实测音频（${measured.size} 个场景）` +
        (missing.length === 0 ? '' : `；这些场景在 durations.json 里没有，仍按字数预估：${missing.join('、')}`),
    );
    if (target !== undefined && target !== null && target > 0) {
      warnings.push(`讲了 targetDurationSec=${target}，但配音已经跑过：以实测时长为准，不缩放`);
    }
  }

  const mediaFor = (product: PrepProduct, source: string): Media => {
    const base: Media = {
      path: product.path,
      file: source,
      width: product.width,
      height: product.height,
    };
    if (input.embed === undefined || input.workRoot === undefined) return base;
    const embedded = input.embed({ path: product.path, workRoot: input.workRoot, width: EMBED_WIDTH });
    return embedded === undefined ? base : { ...base, src: embedded.src, inlineBytes: embedded.bytes };
  };

  const mediaOf = (source: string): { media?: Media; missing?: string } => {
    const prepared = prep.get(source);
    const product = primaryOf(prepared);
    if (prepared !== undefined && product === undefined) {
      return {
        missing: prepared.error ?? `${source} 转不出画面产物`,
      };
    }
    if (product === undefined) return { missing: `${source} 不是能转出画面的文件（图片 / 视频 / Office / PDF）` };
    return { media: mediaFor(product, source) };
  };

  const scenes = kept.map((scene, i) =>
    buildScene(scene, {
      prep,
      mediaFor,
      mediaOf,
      warnings,
      measured,
      fps,
      frames: frames[i] ?? 1,
      framesTotal: frames.reduce((sum, value) => sum + value, 0),
      title: defaultTitle(scene, label),
      total: kept.length,
      spec: script.video,
    }),
  );

  return {
    composition: {
      id: 'foldercast',
      width: tokens.width,
      height: tokens.height,
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
  prep: Map<string, Prepared>;
  /** 页产物（或任意产物）→ `Media`，内联在这里发生，只做一次。 */
  mediaFor: (product: PrepProduct, source: string) => Media;
  /** 源文件 → 主产物（图片缩略图 / 视频封面 / 文档第一页）。 */
  mediaOf: (source: string) => { media?: Media; missing?: string };
  warnings: string[];
  /** 场景 id → 实测时长与字幕块（配音产物）。空表示还没配音。 */
  measured: Map<string, SceneDuration>;
  fps: number;
};

/**
 * 字幕块与它们在本场景里的帧区间。
 *
 * **有实测的 `subs` 就用它**（配音按实测时长分的块），只做秒 → 帧的取整；
 * 没有就按字数预估现算。两条路都不能让字幕跑到场景外面。
 */
function partsFor(scene: Scene, build: SceneBuild): SceneCommon['parts'] {
  const subs = build.measured.get(scene.id)?.subs;
  if (subs === undefined || subs.length === 0) {
    return captionWindows(scene.narration, build.frames, secToFrames(MIN_SUB_SEC, build.fps));
  }
  const spans = allocateByWidth(
    subs.map(([text]) => text),
    Math.round((build.measured.get(scene.id)?.duration ?? 0) * 1000),
    1000,
  );
  let cursor = 0;
  return subs.map(([text], index) => {
    const span = spans[index] ?? { from: cursor, to: cursor + 1000 };
    const from = secToFrames(span.from / 1000, build.fps);
    const to = index === subs.length - 1 ? build.frames : secToFrames(span.to / 1000, build.fps);
    return { text, from: Math.min(from, build.frames - 1), to: Math.max(Math.min(to, build.frames), from + 1) };
  });
}

type SceneBuild = SceneContext & {
  frames: number;
  /** 整片帧数（outro 报片长用）。 */
  framesTotal: number;
  title: string;
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
    parts: partsFor(scene, build),
  };

  switch (scene.type) {
    case 'cover':
      return { ...common, type: 'cover', subtitle: scene.subtitle, eyebrow: scene.id, facts: coverFacts(build) };
    case 'tree':
      return treeScene(scene, common);
    case 'inventory':
      return inventoryScene(scene, common);
    case 'file':
      return fileScene(scene, common, build);
    case 'gallery':
      return galleryScene(scene, common, build);
    case 'clip':
      return clipScene(scene, common, build);
    case 'document':
      return documentScene(scene, common, build);
    case 'outro':
      return {
        ...common,
        type: 'outro',
        subtitle: scene.subtitle,
        facts: outroFacts(build),
        lines: scene.lines ?? [],
      };
  }
}

function coverFacts(build: SceneBuild): Fact[] {
  const spec = build.spec;
  const facts: Fact[] = [];
  facts.push({ label: '分辨率', value: `${spec?.width ?? DEFAULT_VIDEO.width}×${spec?.height ?? DEFAULT_VIDEO.height}` });
  facts.push({ label: '帧率', value: `${build.fps} fps` });
  if (spec?.targetDurationSec !== undefined && spec.targetDurationSec !== null) {
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
  ];
}

function treeScene(scene: Scene, common: SceneCommon): TreeScene {
  const rows: TreeRow[] = (scene.entries ?? []).map((entry) => ({
    path: entry.path,
    files: entry.files,
    ...(entry.bytes === undefined ? {} : { bytes: entry.bytes }),
    highlight: entry.highlight === true,
  }));
  return { ...common, type: 'tree', rows };
}

function inventoryScene(scene: Scene, common: SceneCommon): InventoryScene {
  const groups = scene.groups ?? [];
  const total = scene.total ?? groups.reduce((sum, group) => sum + group.count, 0);
  return {
    ...common,
    type: 'inventory',
    groups: groups.map((group) => ({
      label: group.label,
      count: group.count,
      share: total > 0 ? group.count / total : 0,
      ...(group.note === undefined ? {} : { note: group.note }),
    })),
    totalFiles: total,
  };
}

function fileScene(scene: Scene, common: SceneCommon, build: SceneBuild): FileScene {
  const path = scene.file ?? '';
  const resolved = build.mediaOf(path);
  if (resolved.missing !== undefined) {
    build.warnings.push(`file 场景 ${scene.id}：${resolved.missing}（画面落到摘录文字）`);
  }
  return {
    ...common,
    type: 'file',
    path,
    ...(scene.note === undefined ? {} : { note: scene.note }),
    excerpt: scene.excerpt ?? [],
    ...(resolved.media === undefined ? {} : { media: resolved.media }),
    ...(resolved.media === undefined && resolved.missing !== undefined ? { noteMissing: resolved.missing } : {}),
  };
}

function galleryScene(scene: Scene, common: SceneCommon, build: SceneBuild): GalleryScene {
  const items: Media[] = [];
  for (const item of scene.items ?? []) {
    const resolved = build.mediaOf(item);
    if (resolved.media === undefined) {
      build.warnings.push(`gallery 场景 ${scene.id}：${item} 没有可用画面（${resolved.missing ?? '未知原因'}），跳过`);
      continue;
    }
    items.push(resolved.media);
  }
  const columns = items.length <= 3 ? items.length || 1 : items.length <= 8 ? 3 : 4;
  return { ...common, type: 'gallery', items, columns };
}

function clipScene(scene: Scene, common: SceneCommon, build: SceneBuild): ClipScene {
  const source = scene.source ?? '';
  const resolved = build.mediaOf(source);
  if (resolved.media === undefined) {
    build.warnings.push(`clip 场景 ${scene.id}：没有封面图可用（${resolved.missing ?? '未知原因'}），画面只显示文件名`);
  }
  return {
    ...common,
    type: 'clip',
    ...(resolved.media === undefined ? {} : { poster: resolved.media }),
    file: source,
    ...(scene.clipRange === undefined ? {} : { range: scene.clipRange }),
  };
}

function documentScene(scene: Scene, common: SceneCommon, build: SceneBuild): DocumentScene {
  const source = scene.source ?? '';
  const prepared = build.prep.get(source);
  const allPages =
    prepared?.products
      .filter((product) => product.role === 'page')
      .sort((left, right) => left.path.localeCompare(right.path, 'en')) ?? [];

  const wanted = scene.pages ?? []; // 空 = 全部
  const picked =
    wanted.length === 0
      ? allPages
      : wanted
          .filter((page) => page >= 1 && page <= allPages.length)
          .map((page) => allPages[page - 1]!);

  const pages = picked.map((product) => build.mediaFor(product, source));
  if (prepared === undefined || allPages.length === 0) {
    const reason = prepared?.error ?? '没有页图（转不出来，或它不是 Office / PDF）';
    build.warnings.push(`document 场景 ${scene.id}：${source} ${reason}`);
  }
  return {
    ...common,
    type: 'document',
    pages,
    file: source,
    footer: allPages.length > 0 ? `${allPages.length} 页` : '没有页图',
  };
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
