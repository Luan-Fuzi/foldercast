/**
 * 把素材结果**回填进解读**。
 *
 * 为什么要回填：`foldercast.json` 里本来就留了 `manifest[].asset`（"若已生成素材"），而
 * office / pdf / video 的 `preview` M1 读不出来（那三种格式要额外工具）。两处都在本阶段
 * 补齐，写稿阶段就只需读一个文件。
 *
 * 回填不破坏「解读可重算」：两个阶段都是确定性程序，重跑顺序固定为「分析 → 素材」。
 */
import type { AssetEntry, AssetManifest } from '../contracts/assets.ts';
import { primaryProduct } from '../contracts/assets.ts';
import type { FoldercastDocument, ManifestEntry } from '../contracts/foldercast.ts';

/** 预览长度上限，与 schema 的 maxLength: 200 一致。 */
const PREVIEW_MAX = 200;

function condense(text: string, limit = PREVIEW_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/** 按 kind 生成预览（SPEC-data-format.md 的 `manifest` 一节）。 */
export function previewFor(entry: AssetEntry, markdownBody = ''): string | undefined {
  const meta = entry.meta ?? {};
  const text = entry.text ?? {};

  switch (entry.kind) {
    case 'video': {
      const parts: string[] = [];
      if (meta.durationSec !== undefined) parts.push(formatDuration(meta.durationSec));
      if (meta.width !== undefined && meta.height !== undefined) parts.push(`${meta.width}×${meta.height}`);
      if (meta.codec !== undefined) parts.push(meta.codec);
      return parts.length > 0 ? parts.join(' · ') : undefined;
    }
    case 'office':
    case 'pdf': {
      const parts: string[] = [];
      if (meta.pageCount !== undefined) parts.push(`${meta.pageCount} 页`);
      if (text.outline !== undefined && text.outline.length > 0) {
        parts.push(text.outline.slice(0, 4).map((item) => item.text).join(' / '));
      }
      if (text.sheetNames !== undefined && text.sheetNames.length > 0) parts.push(`工作表 ${text.sheetNames.join('、')}`);
      if (text.slideTitles !== undefined && text.slideTitles.length > 0) {
        parts.push(text.slideTitles.slice(0, 3).join(' / '));
      }
      if (text.tableCount !== undefined && text.tableCount > 0) parts.push(`${text.tableCount} 个表格`);
      if (parts.length > 0) return condense(parts.join(' · '));

      // 没有结构信息（例如扫描版 PDF）：退回正文开头
      return markdownBody === '' ? undefined : condense(markdownBody);
    }
    case 'image': {
      return meta.width !== undefined && meta.height !== undefined ? `${meta.width}×${meta.height}` : undefined;
    }
    default:
      return undefined;
  }
}

/** 回填的统计，供 CLI 打印。 */
export type EnrichReport = {
  assetsSet: number;
  previewsSet: number;
};

/**
 * 就地回填。`readMarkdown` 用来读取提取出的正文 —— 只在**确实需要**（office/pdf 没有结构
 * 信息，要拿正文兜底）时才调用，避免把所有正文读进内存。
 */
export function applyAssetsToReading(
  reading: FoldercastDocument,
  manifest: AssetManifest,
  readMarkdown: (relativePath: string) => string,
): EnrichReport {
  const byPath = new Map(manifest.entries.map((entry) => [entry.path, entry]));
  let assetsSet = 0;
  let previewsSet = 0;

  for (const entry of reading.manifest) {
    const asset = byPath.get(entry.path);
    if (asset === undefined || asset.error !== undefined) continue;

    const primary = primaryProduct(asset.products);
    if (primary !== undefined) {
      entry.asset = primary.path;
      assetsSet += 1;
    }

    // 预览只补「M1 给不出」的那几类；代码/文本的预览 M1 已经写好了
    if (asset.kind === 'office' || asset.kind === 'pdf' || asset.kind === 'video') {
      const needsBody = asset.kind !== 'video' && (asset.text?.outline?.length ?? 0) === 0;
      const markdownPath = asset.text?.markdown;
      const body = needsBody && markdownPath !== undefined ? readMarkdown(markdownPath) : '';
      const preview = previewFor(asset, body);
      if (preview !== undefined && preview !== '') {
        entry.preview = preview;
        previewsSet += 1;
      }
    } else if (asset.kind === 'image' && entry.preview === undefined) {
      const preview = previewFor(asset);
      if (preview !== undefined) {
        entry.preview = preview;
        previewsSet += 1;
      }
    }
  }

  return { assetsSet, previewsSet };
}
