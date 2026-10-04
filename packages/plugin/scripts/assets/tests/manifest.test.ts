import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AssetEntry } from '../../contracts/assets.ts';
import { hashFile, isReusable, loadAssetManifest, writeAssetManifest } from '../manifest.ts';

function tempWorkRoot(): string {
  return mkdtempSync(join(tmpdir(), 'foldercast-manifest-'));
}

/** 写一个产物文件（目录要先建好）。 */
function writeProduct(workRoot: string, relativePath: string): void {
  mkdirSync(join(workRoot, relativePath, '..'), { recursive: true });
  writeFileSync(join(workRoot, relativePath), 'x');
}

function entryWith(overrides: Partial<AssetEntry>): AssetEntry {
  return {
    path: 'a.png',
    kind: 'image',
    mtimeMs: 1000,
    size: 10,
    hash: 'sha256:abc',
    products: [{ role: 'thumb', path: 'thumbs/a.png' }],
    ...overrides,
  };
}

describe('素材清单与增量判据', () => {
  it('mtime 与 size 一致、产物还在 → 命中缓存', () => {
    const workRoot = tempWorkRoot();
    writeProduct(workRoot, 'thumbs/a.png');
    const entry = entryWith({});
    expect(isReusable(entry, { mtimeMs: 1000, size: 10 }, workRoot, false)).toBe(true);
  });

  it('mtime 或 size 变了就不命中', () => {
    const workRoot = tempWorkRoot();
    writeProduct(workRoot, 'thumbs/a.png');
    const entry = entryWith({});
    expect(isReusable(entry, { mtimeMs: 1001, size: 10 }, workRoot, false)).toBe(false);
    expect(isReusable(entry, { mtimeMs: 1000, size: 11 }, workRoot, false)).toBe(false);
  });

  it('产物被删掉就不算命中（清单还在也没用）', () => {
    const workRoot = tempWorkRoot();
    expect(isReusable(entryWith({}), { mtimeMs: 1000, size: 10 }, workRoot, false)).toBe(false);
  });

  it('上次失败的条目要重试，不会被当成缓存', () => {
    const workRoot = tempWorkRoot();
    writeProduct(workRoot, 'thumbs/a.png');
    const failed = entryWith({ error: '上次转换失败' });
    expect(isReusable(failed, { mtimeMs: 1000, size: 10 }, workRoot, false)).toBe(false);
  });

  it('--force 时一律不命中', () => {
    const workRoot = tempWorkRoot();
    writeProduct(workRoot, 'thumbs/a.png');
    expect(isReusable(entryWith({}), { mtimeMs: 1000, size: 10 }, workRoot, true)).toBe(false);
  });

  it('清单读写往返；坏掉的清单当作没有（它是可重算缓存）', () => {
    const workRoot = tempWorkRoot();
    expect(loadAssetManifest(workRoot)).toBeUndefined();

    writeAssetManifest(workRoot, {
      assets: 1,
      generatedAt: '2026-10-04T00:00:00+08:00',
      source: { root: '/tmp/x' },
      entries: [entryWith({})],
    });
    expect(loadAssetManifest(workRoot)?.entries).toHaveLength(1);

    mkdirSync(join(workRoot, 'assets'), { recursive: true });
    writeFileSync(join(workRoot, 'assets/manifest.json'), '{ 坏 json');
    expect(loadAssetManifest(workRoot)).toBeUndefined();
  });

  it('哈希带 sha256: 前缀且对内容敏感', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'foldercast-hash-'));
    const a = join(dir, 'a.txt');
    const b = join(dir, 'b.txt');
    writeFileSync(a, 'hello');
    writeFileSync(b, 'hello');
    const c = join(dir, 'c.txt');
    writeFileSync(c, 'hello!');

    const hashA = await hashFile(a);
    expect(hashA.startsWith('sha256:')).toBe(true);
    expect(await hashFile(b)).toBe(hashA);
    expect(await hashFile(c)).not.toBe(hashA);
  });
});
