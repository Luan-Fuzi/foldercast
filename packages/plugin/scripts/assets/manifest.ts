/**
 * 素材清单的读写与增量判据。
 *
 * 增量看 **mtime + size**：`stat` 比读全文算哈希便宜得多，绝大多数文件没变，这一步就省下
 * 整个重算。mtime 变了才重算哈希，用来确认内容真的变了（而不是被 touch 过）。
 * 另外**产物文件必须还在**才算命中缓存 —— 用户删掉 `assets/` 却留着清单时，不能当成命中。
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  ASSET_MANIFEST_VERSION,
  type AssetEntry,
  type AssetManifest,
} from '../contracts/assets.ts';

/** 工作根：所有产物都在 `<源目录>/.foldercast/` 下（SPEC-data-format.md 工作目录）。 */
export function workRootFor(root: string): string {
  return join(root, '.foldercast');
}

export function readingPathFor(workRoot: string): string {
  return join(workRoot, 'foldercast.json');
}

export function assetManifestPathFor(workRoot: string): string {
  return join(workRoot, 'assets/manifest.json');
}

export function loadAssetManifest(workRoot: string): AssetManifest | undefined {
  const path = assetManifestPathFor(workRoot);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as AssetManifest;
    return parsed.assets === ASSET_MANIFEST_VERSION ? parsed : undefined;
  } catch {
    // 清单坏了就当作没有：它是可重算的缓存
    return undefined;
  }
}

export function writeAssetManifest(workRoot: string, manifest: AssetManifest): void {
  const path = assetManifestPathFor(workRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

/** `sha256:<hex>`，流式读取，大文件也不吃内存。 */
export async function hashFile(absolute: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(absolute)) hash.update(chunk as Buffer);
  return `sha256:${hash.digest('hex')}`;
}

export type SourceStat = { mtimeMs: number; size: number };

export function statSource(absolute: string): SourceStat | undefined {
  try {
    const stats = statSync(absolute);
    return { mtimeMs: Math.floor(stats.mtimeMs), size: stats.size };
  } catch {
    return undefined;
  }
}

/** 命中缓存的条件：源文件没变、上次没出错、产物都还在。 */
export function isReusable(entry: AssetEntry | undefined, source: SourceStat, workRoot: string, force: boolean): boolean {
  if (force || entry === undefined) return false;
  if (entry.error !== undefined) return false;
  if (Math.floor(entry.mtimeMs) !== source.mtimeMs || entry.size !== source.size) return false;
  if (entry.products.length === 0) return false;
  return entry.products.every((product) => existsSync(join(workRoot, product.path)));
}
