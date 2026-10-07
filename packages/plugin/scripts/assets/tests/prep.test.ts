/**
 * 素材 prep 的断言：按需（只转讲稿引用的）、增量（mtime 命中缓存）、失败不炸。
 *
 * 图片转换在 macOS 上走 sips（本机可跑）；Office / PDF 转换要 dsoffice（可选依赖），
 * 有才跑。这里不测 Office 的转换质量 —— 那由 officeparser / dsoffice 自己保证。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScriptDocument } from '../../contracts/script.ts';
import { collectReferences, prepare, slugOf } from '../prep.ts';

/** 1×1 红色 PNG（最小合法图，sips 与 ffmpeg 都认）。 */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let root = '';
let workRoot = '';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'foldercast-prep-'));
  workRoot = join(root, '.foldercast');
  mkdirSync(join(root, 'shots'), { recursive: true });
  writeFileSync(join(root, 'shots/a.png'), TINY_PNG);
  writeFileSync(join(root, 'shots/b.png'), TINY_PNG);
  writeFileSync(join(root, 'notes.md'), '# 笔记\n');
});

afterAll(() => {
  if (root !== '') rmSync(root, { recursive: true, force: true });
});

function scriptReferencing(paths: string[]): ScriptDocument {
  return {
    foldercast: 1,
    source: { root },
    scenes: [
      { id: 'g', type: 'gallery', items: paths, narration: '图。' },
    ],
  };
}

describe('collectReferences', () => {
  it('只收需要转换的引用：图片收，文本不收，重复只收一次', () => {
    const refs = collectReferences(scriptReferencing(['shots/a.png', 'shots/a.png', 'notes.md']));
    expect(refs).toEqual([{ source: 'shots/a.png', kind: 'image' }]);
  });

  it('file 与 source 场景的引用也收', () => {
    const script: ScriptDocument = {
      foldercast: 1,
      source: { root },
      scenes: [
        { id: 'a', type: 'file', file: 'shots/b.png', narration: '一。' },
        { id: 'b', type: 'clip', source: 'shots/b.png', narration: '二。' },
      ],
    };
    expect(collectReferences(script)).toEqual([{ source: 'shots/b.png', kind: 'image' }]);
  });
});

describe('slug', () => {
  it('路径映射稳定，路径分隔符不进文件名', () => {
    expect(slugOf('shots/a.png')).toBe('shots__a.png');
    expect(slugOf('报告/最终版.pptx')).toBe('报告__最终版.pptx');
  });
});

describe('prepare', () => {
  it('转换引用的图片，第二次运行命中缓存', async () => {
    const refs = collectReferences(scriptReferencing(['shots/a.png']));
    const first = await prepare(root, workRoot, refs);
    expect(first.converted).toBe(1);
    expect(first.cached).toBe(0);
    const prepared = first.prepared.get('shots/a.png');
    expect(prepared?.products[0]?.role).toBe('thumb');
    expect(existsSync(join(workRoot, prepared?.products[0]?.path ?? ''))).toBe(true);

    const second = await prepare(root, workRoot, refs);
    expect(second.converted).toBe(0);
    expect(second.cached).toBe(1);
    expect(second.prepared.get('shots/a.png')).toEqual(prepared);
  });

  it('源文件不存在时记 error，不抛', async () => {
    const report = await prepare(root, workRoot, [{ source: 'ghost.png', kind: 'image' }]);
    expect(report.prepared.get('ghost.png')?.error).toContain('不存在');
  });

  it('缓存里记的产物被删掉后，重新转换（缓存判据包含「产物还在」）', async () => {
    const refs = collectReferences(scriptReferencing(['shots/b.png']));
    const first = await prepare(root, workRoot, refs);
    const product = first.prepared.get('shots/b.png')?.products[0]?.path;
    expect(product).toBeDefined();
    if (product === undefined) return;
    rmSync(join(workRoot, product));

    const second = await prepare(root, workRoot, refs);
    expect(second.converted).toBe(1);
    expect(existsSync(join(workRoot, product))).toBe(true);
  });

  it('写出的 cache.json 是合法 JSON（人也能看）', async () => {
    await prepare(root, workRoot, collectReferences(scriptReferencing(['shots/a.png'])));
    const cache = JSON.parse(readFileSync(join(workRoot, 'assets/cache.json'), 'utf8')) as Record<string, unknown>;
    expect(Object.keys(cache)).toContain('shots/a.png');
  });
});
