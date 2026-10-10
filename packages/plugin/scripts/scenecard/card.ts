/**
 * 场景卡：**同一份讲稿在页面与视频里的共同视觉单位**（0006）。
 *
 * `from-plan.ts` 将共享计划映射成这里的形状，页面与视频均消费这份数据，
 * `render.ts` 只吃这一种结构出 HTML——一份标记 + 一份 CSS 服务两个出口，
 * 「page 同步」从此不存在，只有「卡片改了，两边一起变」。
 *
 * 约定继承 page 的视图模型：卡片不做统计、不猜内容，比例从讲稿数字算；
 * 同一份输入两次收集得到同一份卡。
 */

/** 节拍（视频侧）：入场意图来自讲稿，曲线由渲染层实现（模型只写意图，0004）。 */
export type CardBeat = {
  enter: string;
  points?: string[];
  graphic?: 'proportion';
};

/** 所有卡共有的字段。`points` 是平铺要点（page 用）；视频用 `beats` 分组驱动。 */
export type CardCommon = {
  id: string;
  title: string;
  narration: string;
  points?: string[];
  beats?: CardBeat[];
};

export type StructureCard = CardCommon & {
  kind: 'structure';
  rows: { path: string; files: number; bytesLabel?: string; share: number; highlight: boolean }[];
};

export type InventoryCard = CardCommon & {
  kind: 'inventory';
  rows: { label: string; count: number; note?: string; share: number }[];
  total: number;
};

export type FileCard = CardCommon & {
  kind: 'file';
  file: string;
  note?: string;
  excerpt: string[];
  /** 摘录首行的 1 基行号；写了画面带行号槽与来源区间。 */
  excerptStart?: number;
  /** Node 侧预算好的高亮/Markdown HTML（shiki / marked）。页面与视频共用；缺失时落纯文本。 */
  highlightHtml?: string;
  /** 是 Markdown 渲染出来的 highlightHtml（行号槽不适用）。 */
  highlightIsMarkdown?: boolean;
  /** 素材图（视频侧是 `data:` URI；page 侧是内联或相对路径）。 */
  shotSrc?: string;
  /** 素材缺失的说明（视频侧照画，不空板块）。 */
  noteMissing?: string;
};

export type ConceptCard = CardCommon & {
  kind: 'concept';
  statement: string;
  points: string[];
};

export type CompareCard = CardCommon & {
  kind: 'compare';
  left: { label: string; lines: string[] };
  right: { label: string; lines: string[] };
};

export type FlowCard = CardCommon & {
  kind: 'flow';
  steps: { label: string; note?: string }[];
};

export type GalleryItem = {
  path: string;
  kindLabel: string;
  isImage: boolean;
  /** 有地址才出图；没有时 page 画说明块，视频侧直接不收这一项。 */
  src?: string;
  /** 无图时的说明（page 的边界自述文案由 page 适配器给）。 */
  fallbackNote?: string;
};

export type GalleryCard = CardCommon & {
  kind: 'gallery';
  items: GalleryItem[];
};

export type ClipCard = CardCommon & {
  kind: 'clip';
  source: string;
  rangeLabel?: string;
  /** 封面图地址（视频侧）。 */
  posterSrc?: string;
};

export type DocumentCard = CardCommon & {
  kind: 'document';
  source: string;
  pagesLabel: string;
  /** 逐页图地址（视频侧），按讲稿页码挑过。 */
  pages?: { src: string }[];
};

export type OutroCard = CardCommon & {
  kind: 'outro';
  subtitle?: string;
  lines: string[];
};

/** 封面卡只有视频出口（page 的页头 hero 由页面自己拼，内容本就不同：lede vs facts）。 */
export type CoverCard = CardCommon & {
  kind: 'cover';
  subtitle?: string;
  /** 眉标（被讲解目录的展示名）。 */
  label: string;
  facts: { label: string; value: string }[];
};

export type SceneCard =
  | StructureCard
  | InventoryCard
  | FileCard
  | ConceptCard
  | CompareCard
  | FlowCard
  | GalleryCard
  | ClipCard
  | DocumentCard
  | OutroCard
  | CoverCard;

/** 卡片种类的中文名（眉标共用）。hero 不在卡片体系里，由页面处理。 */
export const CARD_KIND_LABEL: Record<SceneCard['kind'], string> = {
  structure: '结构',
  inventory: '盘点',
  file: '文件',
  concept: '论点',
  compare: '对比',
  flow: '流程',
  gallery: '图集',
  clip: '视频',
  document: '文档',
  outro: '小结',
  cover: '封面',
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return map[char] ?? char;
  });
}

/** 百分比：整数就写整数，否则一位小数。 */
export function percent(value: number): string {
  const scaled = value * 100;
  const text = Number.isInteger(scaled) ? String(scaled) : scaled.toFixed(1);
  return `${text}%`;
}

function barWidth(share: number): number {
  return Math.max(0, Math.min(1, share)) * 100;
}

/** 条形宽度做成 `calc(var(--grow) * W%)`：page 里 `--grow` 缺省 1（满宽），视频侧逐帧长出来。 */
export function barFillWidth(share: number): string {
  return `calc(var(--grow, 1) * ${barWidth(share).toFixed(1)}%)`;
}
