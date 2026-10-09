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

/** src/index.ts 夹具的前 6 行原文（摘录检查要求原文 + 够行数）。 */
const EXCERPT6 = Array.from({ length: 6 }, (_, i) => `export const value${String(i)} = ${String(i)};`);

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'foldercast-check-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  // 摘录检查（0005）要求摘录是原文且够行数：夹具给 8 行原文，各用例从中挑
  writeFileSync(
    join(root, 'src/index.ts'),
    `${Array.from({ length: 8 }, (_, i) => `export const value${String(i)} = ${String(i)};`).join('\n')}\n`,
  );
  // 短文件：全文摘录合法，用来钉「下限取 min(6, 文件行数)」
  writeFileSync(join(root, 'src/tiny.ts'), 'export const tiny = 1;\nexport const mini = 2;\nexport const small = 3;\n');
  writeFileSync(join(root, 'logo.png'), Buffer.from('fake'));
});

afterAll(() => {
  if (root !== '') rmSync(root, { recursive: true, force: true });
});

function issueScript(scenes: unknown[]): ScriptDocument {
  return { foldercast: 2, source: { root }, scenes: scenes as ScriptDocument['scenes'] };
}

async function codesOf(script: ScriptDocument): Promise<{ code: string; severity: string; sceneId?: string; path?: string }[]> {
  const report = await checkScript(script, root);
  return report.issues.map((issue) => ({ code: issue.code, severity: issue.severity, sceneId: issue.sceneId, path: issue.path }));
}

describe('合法讲稿', () => {
  it('没有问题就是没有问题（不是「没有跑）', async () => {
    const script = issueScript([
      { id: 'cover', type: 'cover', title: '目录', narration: '这是封面。' },
      {
        id: 'entry',
        type: 'file',
        file: 'src/index.ts',
        excerpt: EXCERPT6,
        excerptStart: 1,
        narration: '入口文件一共八行，导出八个常量，每一个都能在画面上对着行号找到。',
        beats: [{ points: ['常量都在模块顶层，导出名一眼可读', '行号区间标在右上角，来源可查'], enter: 'reveal' }],
      },
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

describe('契约 v2：beats 与密度', () => {
  // 画面宽 ≈ 标题 2 + 摘录 6 行 + 要点；旁白短句 → 带内
  const dense = {
    id: 'entry',
    type: 'file',
    title: '入口',
    file: 'src/index.ts',
    excerpt: EXCERPT6,
    excerptStart: 1,
    narration: '入口很短。旁白两句。',
    beats: [{ points: ['一个要点', '第二个要点'], enter: 'reveal' }],
  };

  it('空节拍（没 points 也没 graphic）是 blocker', async () => {
    const issues = await codesOf(issueScript([{ ...dense, beats: [{ enter: 'fade' }] }]));
    expect(issues).toContainEqual(expect.objectContaining({ code: 'beat-empty', severity: 'blocker', sceneId: 'entry' }));
  });

  it('不认识的入场意图与图形是 blocker；proportion 配错场景类型是 warning', async () => {
    const issues = await codesOf(
      issueScript([{ ...dense, beats: [{ points: ['x'], enter: 'zoom' }, { graphic: 'donut' }, { graphic: 'proportion' }] }]),
    );
    expect(issues).toContainEqual(expect.objectContaining({ code: 'beat-enter-unknown', severity: 'blocker' }));
    expect(issues).toContainEqual(expect.objectContaining({ code: 'beat-graphic-unknown', severity: 'blocker' }));
    expect(issues).toContainEqual(expect.objectContaining({ code: 'beat-graphic-unfit', severity: 'warning' }));
  });

  it('节拍多于字幕两倍报 warning（没和旁白对齐）', async () => {
    const issues = await codesOf(
      issueScript([{ ...dense, narration: '一句话。', beats: [1, 2, 3, 4].map(() => ({ points: ['要点'] })) }]),
    );
    expect(issues).toContainEqual(expect.objectContaining({ code: 'beats-unaligned', severity: 'warning' }));
  });

  it('画面太空（密度比低于 1.5）报 warning', async () => {
    const issues = await codesOf(
      issueScript([{ ...dense, beats: undefined, excerpt: undefined, narration: '这一段的旁白比较长，足足有二十多个字，而画面只有标题。' }]),
    );
    expect(issues).toContainEqual(expect.objectContaining({ code: 'density-out-of-band', severity: 'warning', sceneId: 'entry' }));
  });

  it('画面过载（密度比高于 3）也报，fix 指向删要点', async () => {
    const report = await checkScript(
      issueScript([{ ...dense, excerpt: undefined, narration: '短句。', beats: [{ points: ['要点一', '要点二', '要点三', '要点四'] }] }]),
      root,
    );
    const density = report.issues.find((issue) => issue.code === 'density-out-of-band');
    expect(density).toMatchObject({ severity: 'warning', sceneId: 'entry' });
    expect(density?.fix ?? '').toContain('过载');
  });

  it('整块摘录按扫读打折计宽：8–12 行的标准画面落在带内，两行旧摘录落带下', async () => {
    // 8 行原文摘录（raw ≈ 100 宽，打折后 25）+ 要点，对短旁白应当在带内
    const eightLines = EXCERPT6.concat(['export const value6 = 6;', 'export const value7 = 7;']);
    const ok = await codesOf(
      issueScript([
        {
          id: 'a',
          type: 'file',
          file: 'src/index.ts',
          excerpt: eightLines,
          excerptStart: 1,
          title: '入口',
          narration: '入口文件八行，每个常量都对着行号。',
          beats: [{ points: ['常量都在模块顶层，导出名一眼可读'], enter: 'reveal' }],
        },
      ]),
    );
    expect(ok.find((issue) => issue.code === 'density-out-of-band')).toBeUndefined();
    // 两行旧摘录：打折后几乎不占宽，密度必然落带下——正是「画面太空」要抓的形状
    const sparse = await codesOf(
      issueScript([{ id: 'b', type: 'file', file: 'src/index.ts', excerpt: [EXCERPT6[0] ?? ''], narration: '这一段的旁白比较长，足足有二十多个字，而画面只有两行字。' }]),
    );
    expect(sparse).toContainEqual(expect.objectContaining({ code: 'density-out-of-band', severity: 'warning' }));
  });

  it('cover 不查密度（标题场景天然留白）', async () => {
    const issues = await codesOf(
      issueScript([{ id: 'c', type: 'cover', title: '片', narration: '很长的开场白，超过画面信息量的两倍还多，看看会不会报警。' }]),
    );
    expect(issues.find((issue) => issue.code === 'density-out-of-band')).toBeUndefined();
  });

  it('旧版讲稿（foldercast: 1）是 blocker，fix 告诉怎么迁', async () => {
    const old = { ...issueScript([{ ...dense }]), foldercast: 1 } as unknown as ScriptDocument;
    const issues = await codesOf(old);
    expect(issues).toContainEqual(expect.objectContaining({ code: 'script-version', severity: 'blocker', path: '/foldercast' }));
  });
});

describe('摘录层（0005 WP1，warning）', () => {
  it('无素材的 file 场景摘录少于六行报 warning', async () => {
    const issues = await codesOf(
      issueScript([{ id: 'a', type: 'file', file: 'src/index.ts', excerpt: [EXCERPT6[0] ?? ''], narration: '讲它。' }]),
    );
    expect(issues).toContainEqual(expect.objectContaining({ code: 'excerpt-too-short', severity: 'warning', sceneId: 'a' }));
  });

  it('没有摘录也没有素材同样报（画面会是空的）', async () => {
    const issues = await codesOf(issueScript([{ id: 'a', type: 'file', file: 'src/index.ts', narration: '讲它。' }]));
    expect(issues).toContainEqual(expect.objectContaining({ code: 'excerpt-too-short', severity: 'warning', sceneId: 'a' }));
  });

  it('摘录行不是源文件原文报 warning（真实性判据）', async () => {
    const issues = await codesOf(
      issueScript([
        {
          id: 'a',
          type: 'file',
          file: 'src/index.ts',
          excerpt: Array.from({ length: 6 }, (_, i) => `编造的第 ${String(i)} 行，源文件里没有这句话`),
          narration: '讲它。',
        },
      ]),
    );
    expect(issues).toContainEqual(expect.objectContaining({ code: 'excerpt-unverifiable', severity: 'warning', sceneId: 'a' }));
  });

  it('excerptStart 与摘录首行对不上报 warning', async () => {
    const issues = await codesOf(
      issueScript([
        { id: 'a', type: 'file', file: 'src/index.ts', excerpt: EXCERPT6, excerptStart: 3, narration: '讲它。' },
      ]),
    );
    expect(issues).toContainEqual(expect.objectContaining({ code: 'excerpt-start-mismatch', severity: 'warning', sceneId: 'a' }));
  });

  it('短文件全文摘录不报行数下限（下限取 min(6, 文件行数)）', async () => {
    const issues = await codesOf(
      issueScript([
        {
          id: 'a',
          type: 'file',
          file: 'src/tiny.ts',
          excerpt: ['export const tiny = 1;', 'export const mini = 2;', 'export const small = 3;'],
          narration: '很短，但是全文。',
        },
      ]),
    );
    expect(issues.find((issue) => issue.code === 'excerpt-too-short')).toBeUndefined();
  });

  it('有素材的 file 场景不查摘录（画面走素材，不靠文字）', async () => {
    const issues = await codesOf(issueScript([{ id: 'a', type: 'file', file: 'logo.png', narration: '讲这张图。' }]));
    expect(issues.find((issue) => issue.code === 'excerpt-too-short')).toBeUndefined();
  });
});

describe('digest（在场就顺带校验）', () => {
  it('引用不存在的文件是 blocker；计数对得上就不报', async () => {
    mkdirSync(join(root, '.foldercast'), { recursive: true });
    // 夹具根目录下有三个文件（src/index.ts、src/tiny.ts、logo.png），.foldercast 被口径排除
    writeFileSync(
      join(root, '.foldercast', 'digest.json'),
      `${JSON.stringify({
        digest: 2,
        source: { root },
        scale: { totalFiles: 3 },
        modules: [{ path: 'src', role: '源码', files: 2 }],
        excerpts: [{ file: 'nope.md', lines: ['编造的引用'] }],
      })}\n`,
    );
    const script = issueScript([{ id: 'cover', type: 'cover', title: '目录', narration: '封面。' }]);
    const issues = await codesOf(script);
    expect(issues).toContainEqual(expect.objectContaining({ code: 'digest-path-missing', severity: 'blocker', path: '/digest/excerpts/0/file' }));
    expect(issues.find((issue) => issue.code === 'digest-count-mismatch')).toBeUndefined();
  });

  it('totalFiles 与程序数出来的差太远报 warning', async () => {
    writeFileSync(
      join(root, '.foldercast', 'digest.json'),
      `${JSON.stringify({
        digest: 2,
        source: { root },
        scale: { totalFiles: 50 },
        modules: [],
        excerpts: [],
      })}\n`,
    );
    const script = issueScript([{ id: 'cover', type: 'cover', title: '目录', narration: '封面。' }]);
    const issues = await codesOf(script);
    expect(issues).toContainEqual(expect.objectContaining({ code: 'digest-count-mismatch', severity: 'warning' }));
  });

  it('v1 digest（单句 excerpts 的旧形状）是 blocker，带迁移提示', async () => {
    writeFileSync(
      join(root, '.foldercast', 'digest.json'),
      `${JSON.stringify({
        digest: 1,
        source: { root },
        scale: { totalFiles: 3 },
        modules: [],
        excerpts: [{ file: 'src/index.ts', text: '旧形状的单句摘录' }],
      })}\n`,
    );
    const script = issueScript([{ id: 'cover', type: 'cover', title: '目录', narration: '封面。' }]);
    const issues = await codesOf(script);
    expect(issues).toContainEqual(expect.objectContaining({ code: 'digest-version', severity: 'blocker', path: '/digest' }));
  });

  it('v2 摘录行不是原文、start 对不上，各报一条 warning', async () => {
    writeFileSync(
      join(root, '.foldercast', 'digest.json'),
      `${JSON.stringify({
        digest: 2,
        source: { root },
        scale: { totalFiles: 3 },
        modules: [],
        excerpts: [{ file: 'src/index.ts', lines: ['编造的一行，源文件里没有', 'export const value0 = 0;'], start: 99 }],
      })}\n`,
    );
    const script = issueScript([{ id: 'cover', type: 'cover', title: '目录', narration: '封面。' }]);
    const issues = await codesOf(script);
    expect(issues).toContainEqual(expect.objectContaining({ code: 'digest-excerpt-unverifiable', severity: 'warning' }));
    expect(issues).toContainEqual(expect.objectContaining({ code: 'digest-start-mismatch', severity: 'warning' }));
  });
});

describe('文本原生场景（0005 WP3）', () => {
  it('concept 缺 statement、compare 缺一侧、flow 缺 steps 都是 blocker，带 JSON 指针', async () => {
    const issues = await codesOf(
      issueScript([
        { id: 'c1', type: 'concept', narration: '缺论断。' },
        { id: 'c2', type: 'compare', left: { label: '一', lines: ['第一行'] }, narration: '缺右侧。' },
        { id: 'c3', type: 'flow', narration: '缺步骤。' },
      ]),
    );
    expect(issues).toContainEqual(expect.objectContaining({ code: 'scene-field-missing', severity: 'blocker', sceneId: 'c1', path: '/scenes/0/statement' }));
    expect(issues).toContainEqual(expect.objectContaining({ code: 'scene-field-missing', severity: 'blocker', sceneId: 'c2', path: '/scenes/1/right' }));
    expect(issues).toContainEqual(expect.objectContaining({ code: 'scene-field-missing', severity: 'blocker', sceneId: 'c3', path: '/scenes/2/steps' }));
  });

  it('形状齐的三个新类型不报字段错（schema 与字段表一致）', async () => {
    const issues = await codesOf(
      issueScript([
        { id: 'c1', type: 'concept', statement: '程序只做 agent 干不了的事。', points: ['模型探目录', '程序管渲染'], narration: '一条判据，讲全片。' },
        { id: 'c2', type: 'compare', left: { label: '模型', lines: ['探目录', '读文件'] }, right: { label: '程序', lines: ['校验', '渲染'] }, narration: '分工一比就清楚。' },
        { id: 'c3', type: 'flow', steps: [{ label: 'digest' }, { label: '讲稿' }, { label: '渲染', note: '逐帧一致' }], narration: '三步一条线。' },
      ]),
    );
    expect(issues.filter((issue) => issue.code === 'scene-field-missing' || issue.code === 'scene-field-unused')).toEqual([]);
  });
});

describe('版式多样性（0005 WP3，warning）', () => {
  const fileScene = (index: number) => ({
    id: `f${String(index)}`,
    type: 'file',
    file: 'src/index.ts',
    excerpt: EXCERPT6,
    narration: `第${String(index)}场，讲一个文件的职责。`,
  });

  it('内容场景里 file 占比超六成报 warning', async () => {
    const issues = await codesOf(
      issueScript([
        { id: 'c', type: 'cover', title: '封面', narration: '开场。' },
        ...Array.from({ length: 8 }, (_, i) => fileScene(i)),
        { id: 'o', type: 'outro', title: '完', narration: '收尾。' },
      ]),
    );
    expect(issues).toContainEqual(expect.objectContaining({ code: 'layout-monotony', severity: 'warning', path: '/scenes' }));
  });

  it('类型混着用（或内容场景太少）不报', async () => {
    const issues = await codesOf(
      issueScript([
        { id: 'c', type: 'cover', title: '封面', narration: '开场。' },
        fileScene(0),
        { id: 'd1', type: 'concept', statement: '一个论断。', narration: '论点。' },
        { id: 'd2', type: 'compare', left: { label: '一', lines: ['1'] }, right: { label: '二', lines: ['2'] }, narration: '对比。' },
        { id: 'd3', type: 'flow', steps: [{ label: '甲' }, { label: '乙' }], narration: '流程。' },
        { id: 'd4', type: 'inventory', groups: [{ label: '代码', count: 9 }], narration: '盘点。' },
        { id: 'd5', type: 'tree', entries: [{ path: 'src', files: 2 }], narration: '结构。' },
        { id: 'o', type: 'outro', title: '完', narration: '收尾。' },
      ]),
    );
    expect(issues.find((issue) => issue.code === 'layout-monotony')).toBeUndefined();
  });
});
