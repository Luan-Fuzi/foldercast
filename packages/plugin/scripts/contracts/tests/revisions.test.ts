import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acceptReview, artifactStates, beginOutput, captureRevision, finishOutput, requireReview } from '../revisions.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'foldercast-revisions-'));
  roots.push(root);
  mkdirSync(join(root, '.foldercast'), { recursive: true });
  writeFileSync(join(root, 'README.md'), '# 原文\n');
  writeFileSync(join(root, '.foldercast', 'script.json'), JSON.stringify({ foldercast: 2, source: { root },
    scenes: [{ id: 'entry', type: 'file', file: 'README.md', narration: '说明。' }] }));
  return root;
}
function approve(root: string): string {
  const { revision } = captureRevision(root);
  writeFileSync(join(root, '.foldercast', 'review.md'), `第 1 轮：通过\nrevision: ${revision}\n证据：README.md L1。\n`);
  acceptReview(root, revision);
  return revision;
}

describe('评审绑定当前输入', () => {
  it('没有报告或回执不能正式产出；草稿仍能开始', () => {
    const root = fixture();
    const { revision } = captureRevision(root);
    expect(() => acceptReview(root, revision)).toThrow(/review.md/);
    expect(() => beginOutput(root, { approved: true })).toThrow(/回执/);
    expect(beginOutput(root).mode).toBe('draft');
    approve(root);
    expect(beginOutput(root, { approved: true }).mode).toBe('approved');
  });

  it('改讲稿或证据后旧回执不能放行，JSON 排版不影响版本', () => {
    const root = fixture();
    const revision = approve(root);
    const scriptPath = join(root, '.foldercast', 'script.json');
    const doc = JSON.parse(readFileSync(scriptPath, 'utf8'));
    writeFileSync(scriptPath, JSON.stringify(doc, null, 2));
    expect(captureRevision(root).revision).toBe(revision);
    writeFileSync(join(root, 'README.md'), '# 新原文\n');
    expect(() => acceptReview(root, revision)).toThrow(/过期/);
    expect(() => requireReview(root, captureRevision(root).revision)).toThrow(/回执/);
    approve(root);
    doc.scenes[0].narration = '改了旁白。';
    writeFileSync(scriptPath, JSON.stringify(doc));
    expect(() => beginOutput(root, { approved: true })).toThrow(/回执/);
  });

  it('digest、目录新增文件或报告修改会使回执失效；产物不会污染输入版本', () => {
    const root = fixture();
    writeFileSync(join(root, '.foldercast', 'digest.json'), JSON.stringify({ digest: 2, source: { root },
      scale: { totalFiles: 1 }, modules: [], excerpts: [], notes: [] }));
    const revision = approve(root);
    writeFileSync(join(root, '.foldercast', 'out.tmp'), '产物');
    expect(captureRevision(root).revision).toBe(revision);
    writeFileSync(join(root, 'new.md'), '新增');
    expect(() => beginOutput(root, { approved: true })).toThrow(/回执/);
    approve(root);
    writeFileSync(join(root, '.foldercast', 'review.md'), '不同的评审报告');
    expect(() => beginOutput(root, { approved: true })).toThrow(/回执/);
  });
});

describe('产物记录', () => {
  it('记录参数、输出和依赖；输出修改、缺失与输入变化可区分', () => {
    const root = fixture();
    approve(root);
    const dependency = join(root, '.foldercast', 'poster.jpg');
    const output = join(root, '.foldercast', 'page.html');
    writeFileSync(dependency, '封面');
    const context = beginOutput(root, { approved: true, settings: { style: '素稿' }, dependencies: [dependency] });
    writeFileSync(output, '页面');
    finishOutput(context, 'page', [output]);
    expect(artifactStates(root)).toEqual([{ kind: 'page', state: 'current', mode: 'approved' }]);
    writeFileSync(dependency, '换封面');
    expect(artifactStates(root)[0]?.state).toBe('stale');
    rmSync(output);
    expect(artifactStates(root)[0]?.state).toBe('missing');
  });

  it('生成过程中改稿不会登记成功；草稿覆盖正式结果后记录为草稿', () => {
    const root = fixture();
    approve(root);
    const output = join(root, '.foldercast', 'page.html');
    const context = beginOutput(root, { approved: true });
    writeFileSync(output, '页面');
    writeFileSync(join(root, 'README.md'), '输入改变');
    expect(() => finishOutput(context, 'page', [output])).toThrow(/输入发生变化/);
    const draft = beginOutput(root);
    finishOutput(draft, 'page', [output]);
    expect(artifactStates(root)).toEqual([{ kind: 'page', state: 'current', mode: 'draft' }]);
    writeFileSync(output, '页面被修改');
    expect(artifactStates(root)[0]?.state).toBe('stale');
  });
});


it('输出不能污染源目录，删除旧自定义讲稿不会阻断状态查询', () => {
  const root = fixture();
  expect(() => beginOutput(root, { outputPaths: [join(root, 'README.md')] })).toThrow(/输出路径/);
  const scriptPath = join(root, '.foldercast', 'custom.json');
  writeFileSync(scriptPath, readFileSync(join(root, '.foldercast', 'script.json')));
  const output = join(root, '.foldercast', 'page.html');
  const context = beginOutput(root, { scriptPath, outputPaths: [output] });
  writeFileSync(output, '页面');
  finishOutput(context, 'page', [output]);
  rmSync(scriptPath);
  expect(artifactStates(root)).toEqual([{ kind: 'page', state: 'stale', mode: 'draft' }]);
});


it('自定义输出可以放在未引用区域，但不能改变 digest 文件数或引用目录', () => {
  const root = fixture();
  const output = join(root, 'page.html');
  expect(beginOutput(root, { outputPaths: [output] }).mode).toBe('draft');
  writeFileSync(join(root, '.foldercast', 'digest.json'), JSON.stringify({ digest: 2, modules: [], excerpts: [] }));
  expect(() => beginOutput(root, { outputPaths: [output] })).toThrow(/输出路径/);
  rmSync(join(root, '.foldercast', 'digest.json'));
  const path = join(root, '.foldercast', 'script.json');
  const script = JSON.parse(readFileSync(path, 'utf8'));
  script.scenes[0].file = '.';
  writeFileSync(path, JSON.stringify(script));
  expect(beginOutput(root, { outputPaths: [join(root, '.foldercast', 'out', 'page.html')] }).mode).toBe('draft');
  expect(() => beginOutput(root, { outputPaths: [output] })).toThrow(/输出路径/);
});
