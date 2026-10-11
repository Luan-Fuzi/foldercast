import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkScript } from '../../renderer/check.ts';
import { checkDigest, type DigestDocument } from '../digest.ts';
import { captureRevision } from '../revisions.ts';
import { prepare } from '../../assets/prep.ts';
import type { ScriptDocument } from '../script.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'foldercast-boundary-'));
  roots.push(base);
  const root = join(base, 'source');
  mkdirSync(join(root, '.foldercast'), { recursive: true });
  mkdirSync(join(base, 'outside'));
  writeFileSync(join(root, 'inside.txt'), '目录内原文。\n');
  writeFileSync(join(base, 'outside', 'secret.txt'), '目录外原文。\n');
  symlinkSync(join(base, 'outside'), join(root, 'external'), 'junction');
  symlinkSync(root, join(base, 'source-alias'), 'junction');
  symlinkSync(join(root, '.foldercast'), join(root, 'work-alias'), 'junction');
  return { base, root };
}

function script(root: string, reference: string): ScriptDocument {
  return { foldercast: 2, source: { root }, scenes: [
    { id: 'file', type: 'file', file: reference, excerpt: ['目录外原文。'], excerptStart: 1, narration: '原文。' },
  ] };
}

describe('引用范围在读取与准备前检查', () => {
  it.each(['../outside/secret.txt', 'external/secret.txt', 'C:\\outside\\secret.txt', '\\\\host\\share\\secret.txt'])('讲稿拒绝 %s', async (reference) => {
    const { root } = fixture();
    const report = await checkScript(script(root, reference), root);
    expect(report.issues).toContainEqual(expect.objectContaining({ code: 'path-outside-root', severity: 'blocker' }));
    expect(report.issues.some((issue) => issue.code.startsWith('excerpt-'))).toBe(false);
  });

  it('即使绝对路径位于目录内，也不符合相对引用契约', async () => {
    const { root } = fixture();
    const report = await checkScript(script(root, join(root, 'inside.txt')), root);
    expect(report.issues).toContainEqual(expect.objectContaining({ code: 'path-outside-root', severity: 'blocker' }));
  });

  it('digest 的摘录、模块与关键文件都阻断越界', () => {
    const { root } = fixture();
    const doc: DigestDocument = { digest: 2, source: { root }, scale: { totalFiles: 1 },
      excerpts: [{ file: '../outside/secret.txt', lines: ['目录外原文。'], start: 1 }],
      modules: [{ path: '../outside', role: '目录外', files: 1 }, { path: '.', role: '目录内', files: 1, keyFiles: ['external/secret.txt'] }] };
    expect(checkDigest(doc, root).filter((issue) => issue.code === 'digest-path-outside-root')).toHaveLength(3);
  });

  it.each(['file', 'tree', 'digest'])('revision 不为越界的 %s 引用计算哈希', (kind) => {
    const { root } = fixture();
    const doc = kind === 'tree' ? { foldercast: 2, source: { root }, scenes: [
      { id: 'tree', type: 'tree', entries: [{ path: '../outside', files: 1 }], narration: '目录。' },
    ] } : script(root, kind === 'digest' ? 'inside.txt' : 'external/secret.txt');
    writeFileSync(join(root, '.foldercast', 'script.json'), JSON.stringify(doc));
    if (kind === 'digest') writeFileSync(join(root, '.foldercast', 'digest.json'), JSON.stringify({ digest: 2,
      modules: [{ path: '.', keyFiles: ['../outside/secret.txt'] }], excerpts: [] }));
    expect(() => captureRevision(root)).toThrow(/引用.*目录/);
  });

  it('准备阶段独立拒绝目录外素材，不能转成普通占位图继续', async () => {
    const { root } = fixture();
    await expect(prepare(root, join(root, '.foldercast'), [{ source: '../outside/secret.txt', kind: 'image' }])).rejects.toThrow(/引用.*目录/);
  });

  it('目录根本身是符号链接时仍接受真实目录内引用', async () => {
    const { base } = fixture();
    const root = join(base, 'source-alias');
    const doc = script(root, 'inside.txt');
    doc.scenes[0]!.excerpt = ['目录内原文。'];
    expect((await checkScript(doc, root)).blocker).toBe(0);
  });
});
