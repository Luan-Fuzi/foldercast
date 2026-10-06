/**
 * `assets/manifest.json`（素材清单）的 TypeScript 类型。
 *
 * 它是**素材阶段**的产物契约：源文件 → 产物路径 + 尺寸 + 提取出的结构。字段语义见
 * docs/specs/SPEC-data-format.md 第三节。它是可重算的缓存，不是创作产物，所以
 * 与 `foldercast.json` 一样由程序产出、可以随时删掉重建。
 */
import type { Kind } from './foldercast.ts';

/** 清单格式版本。破坏性变更时递增。 */
export const ASSET_MANIFEST_VERSION = 1 as const;

/** 产物角色。讲稿按角色挑选素材（`gallery` 用 thumb，`document` 用 page…）。 */
export const ASSET_ROLES = ['thumb', 'page', 'poster', 'frame'] as const;
export type AssetRole = (typeof ASSET_ROLES)[number];

export type AssetProduct = {
  role: AssetRole;
  /** 相对**工作根**（`.foldercast/`）的路径，与讲稿里素材字段的基准一致。 */
  path: string;
  width?: number;
  height?: number;
};

export type OutlineEntry = {
  /** 1 起。 */
  level: number;
  text: string;
};

/** 从文档里提取出的结构。office / pdf 才有。 */
export type AssetText = {
  /** 全文 Markdown（相对工作根），供叙事层通读。 */
  markdown?: string;
  outline?: OutlineEntry[];
  /** xlsx 的工作表名。 */
  sheetNames?: string[];
  /** pptx 的幻灯片标题。 */
  slideTitles?: string[];
  tableCount?: number;
};

/** 媒体元数据。video 与 image 才有。 */
export type AssetMeta = {
  durationSec?: number;
  width?: number;
  height?: number;
  codec?: string;
  /** Office / PDF 的页数。 */
  pageCount?: number;
};

export type AssetEntry = {
  /** 相对 source.root。 */
  path: string;
  kind: Kind;
  /** 源文件 mtime（毫秒）。 */
  mtimeMs: number;
  /** 源文件字节数。 */
  size: number;
  /** `sha256:<hex>`。mtime 变了才重算，用于确认内容真的变了。 */
  hash: string;
  products: AssetProduct[];
  text?: AssetText;
  meta?: AssetMeta;
  /** 单个文件失败的原因（可操作），不影响其他文件。 */
  error?: string;
};

export type AssetManifest = {
  assets: typeof ASSET_MANIFEST_VERSION;
  generatedAt: string;
  source: { root: string };
  entries: AssetEntry[];
};

/** 主素材：讲稿的 `file` 场景默认引用它。 */
export const PRIMARY_ROLE_ORDER: readonly AssetRole[] = ['thumb', 'poster', 'page', 'frame'];

/** 从产物列表里挑主素材。 */
export function primaryProduct(products: readonly AssetProduct[]): AssetProduct | undefined {
  for (const role of PRIMARY_ROLE_ORDER) {
    const found = products.find((product) => product.role === role);
    if (found !== undefined) return found;
  }
  return undefined;
}
