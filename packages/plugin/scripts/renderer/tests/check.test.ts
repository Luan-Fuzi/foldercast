/**
 * 讲稿契约校验的断言：每类错误都要被报出来，且带可操作的定位（场景 id + JSON 指针）。
 *
 * 这是「机器能判的那一层」的全部：编造的路径、用错的字段、切不开的字幕在这里拦下，
 * 语义对错交给评审 subagent。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScriptDocument } from '../../contracts/script.ts';
import { checkScript } from '../check.ts';

let root = '';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'foldercast-check-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/index.ts'), 'export const value = 1;\n');
  writeFileSync(join(root, 'logo.png'), Buffer.from('fake'));
});

afterAll(() => {
  if (root !== '') rmSync(root, { recursive: true, force: true });
});

function issueScript(scenes: unknown[]): ScriptDocument {
  return { foldercast: 1, source: { root }, scenes: scenes as ScriptDocument['scenes'] };
}

async function codesOf(script: ScriptDocument): Promise<{ code: string; severity: string; sceneId?: string; path?: string }[]> {
  const report = await checkScript(script, root);
  return report.issues.map((issue) => ({ code: issue.code, severity: issue.severity, sceneId: issue.sceneId, path: issue.path }));
}

describe('合法讲稿', () => {
  it('没有问题就是没有问题（不是「没有跑）', async () => {
    const script = issueScript([
      { id: 'cover', type: 'cover', title: '目录', narration: '这是封面。' },
      { id: 'entry', type: 'file', file: 'src/index.ts', excerpt: ['export const value = 1;'], narration: '入口文件。' },
    ]);
    const report = await checkScript(script, root);
    expect(report.issues, JSON.stringify(report.issues)).toEqual([]);
    expect(report.blocker).toBe(0);
  });
});

describe('字段层', () => {
  it('cover 缺 title 是 blocker，带 JSON 指针', async () => {
    const issues = await codesOf(issueScript([{ id: 'cover', type: 'cover', narration: '缺标题。' }]));
    expect(issues).toContainEqual(expect.objectContaining({ code: 'scene-field-missing', severity: 'blocker', sceneId: 'cover', path: '/scenes/0/title' }));
  });

  it('cover 里出现别的类型的字段（多半是笔误）是 blocker', async () => {
    const issues = await codesOf(
      issueScript([{ id: 'cover', type: 'cover', title: '封面', narration: '封面。', groups: [] }]),
    );
    expect(issues).toContainEqual(expect.objectContaining({ code: 'scene-field-unused', severity: 'blocker', sceneId: 'cover', path: '/scenes/0/groups' }));
  });

  it('场景 id 重复是 blocker', async () => {
    const issues = await codesOf(
      issueScript([
        { id: 'same', type: 'outro', title: '一', narration: '一。' },
        { id: 'same', type: 'outro', title: '二', narration: '二。' },
      ]),
    );
    expect(issues).toContainEqual(expect.objectContaining({ code: 'scene-id-duplicate', severity: 'blocker' }));
  });

  it('不认识的场景类型是 blocker，报出可用类型', async () => {
    const issues = await codesOf(issueScript([{ id: 'x', type: 'hologram', narration: '未知。' }]));
    expect(issues).toContainEqual(expect.objectContaining({ code: 'scene-type-unknown', severity: 'blocker' }));
  });
});

describe('路径层', () => {
  it('file 引用不存在的文件是 blocker（幻觉路径拦截）', async () => {
    const issues = await codesOf(issueScript([{ id: 'a', type: 'file', file: 'src/nope.ts', narration: '讲它。' }]));
    expect(issues).toContainEqual(expect.objectContaining({ code: 'path-missing', severity: 'blocker', sceneId: 'a' }));
  });

  it('gallery 引用一个不存在的图是 blocker', async () => {
    const issues = await codesOf(issueScript([{ id: 'g', type: 'gallery', items: ['logo.png', 'ghost.png'], narration: '两张图。' }]));
    expect(issues).toContainEqual(expect.objectContaining({ code: 'path-missing', severity: 'blocker' }));
  });
});

describe('字幕层', () => {
  it('一句没有任何标点、又超过 24 宽度，切不开，是 blocker', async () => {
    const issues = await codesOf(issueScript([{ id: 'a', type: 'outro', title: '完', narration: '这一整句完全没有标点而且还特别长根本切不开任何一块字幕哦' }]));
    expect(issues).toContainEqual(expect.objectContaining({ code: 'subtitle-too-long', severity: 'blocker', sceneId: 'a' }));
  });

  it('带标点的长句能切，不报', async () => {
    const issues = await codesOf(
      issueScript([{ id: 'a', type: 'outro', title: '完', narration: '这一句虽然很长，但是中间有逗号可以切，所以没有问题，都能放下。' }]),
    );
    expect(issues.filter((issue) => issue.code === 'subtitle-too-long')).toEqual([]);
  });
});

describe('数字自洽（warning）', () => {
  it('inventory 各组之和大于 total 报 warning', async () => {
    const issues = await codesOf(
      issueScript([{ id: 'k', type: 'inventory', groups: [{ label: 'A', count: 60 }, { label: 'B', count: 50 }], total: 100, narration: '构成。' }]),
    );
    expect(issues).toContainEqual(expect.objectContaining({ code: 'inventory-total-mismatch', severity: 'warning' }));
  });
});

describe('时长闭环（warning）', () => {
  // 每场旁白 40–80 字、约 10–20 秒是常态；下面用长旁白构造「预估远超目标」，
  // 用一句话构造「远低于目标」。
  const long = Array.from({ length: 12 }, (_, i) => `第${String(i)}句，讲一个模块的职责与要点。`).join('');
  const script = (target: number): ScriptDocument => ({
    ...issueScript([{ id: 'cover', type: 'cover', title: '目录', narration: long }]),
    video: { targetDurationSec: target },
  });

  it('旁白量撑不起目标时长报 warning，带 fix', async () => {
    const issues = await codesOf(script(600));
    expect(issues).toContainEqual(expect.objectContaining({ code: 'duration-mismatch', severity: 'warning', path: '/video/targetDurationSec' }));
  });

  it('旁白量远超目标也报（方向不重要，脱节才重要）', async () => {
    const issues = await codesOf(script(30));
    expect(issues).toContainEqual(expect.objectContaining({ code: 'duration-mismatch' }));
  });

  it('没写 targetDurationSec 就不比（时长软约束，写稿人没定目标时不越位）', async () => {
    const issues = await codesOf(issueScript([{ id: 'cover', type: 'cover', title: '目录', narration: long }]));
    expect(issues.find((issue) => issue.code === 'duration-mismatch')).toBeUndefined();
  });
});
