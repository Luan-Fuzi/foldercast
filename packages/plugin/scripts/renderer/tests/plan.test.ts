/**
 * 渲染计划的纯函数断言：讲稿（+ prep 结果）→ 计划。
 *
 * 不碰文件系统（素材用 `Media.path` 原样带过、不内联），所以这里断言的就是
 * 「这份讲稿会渲染成什么」。
 */
import { describe, expect, it } from 'vitest';
import type { Prepared } from '../../contracts/prep.ts';
import type { DurationsDocument } from '../../contracts/durations.ts';
import type { ScriptDocument } from '../../contracts/script.ts';
import { buildPlan, DEFAULT_VIDEO, defaultTitle } from '../plan.ts';

function scriptOf(scenes: ScriptDocument['scenes'], extra: Partial<ScriptDocument> = {}): ScriptDocument {
  return {
    foldercast: 2,
    source: { root: '/tmp/demo', label: '演示目录' },
    scenes,
    ...extra,
  };
}

function preparedOf(source: string, products: Prepared['products'], kind: Prepared['kind'] = 'image'): [string, Prepared] {
  return [source, { kind, source, products }];
}

describe('场景映射（自足式讲稿）', () => {
  it('tree 的行来自讲稿 entries，原样保留 path/files/bytes/highlight', () => {
    const plan = buildPlan({
      script: scriptOf([
        {
          id: 'layout',
          type: 'tree',
          narration: '结构。',
          entries: [
            { path: 'src', files: 12, bytes: 450_000, highlight: true },
            { path: 'docs', files: 3 },
          ],
        },
      ]),
    });
    const tree = plan.scenes[0];
    expect(tree?.type).toBe('tree');
    if (tree?.type !== 'tree') return;
    expect(tree.rows).toEqual([
      { path: 'src', files: 12, bytes: 450_000, highlight: true },
      { path: 'docs', files: 3, highlight: false },
    ]);
  });

  it('inventory 的占比用 total（缺省用各组之和）', () => {
    const plan = buildPlan({
      script: scriptOf([
        {
          id: 'kinds',
          type: 'inventory',
          narration: '构成。',
          groups: [
            { label: 'Markdown 笔记', count: 40 },
            { label: '简历素材', count: 10 },
          ],
          total: 100,
        },
      ]),
    });
    const inventory = plan.scenes[0];
    if (inventory?.type !== 'inventory') throw new Error('不是 inventory');
    expect(inventory.groups.map((group) => [group.label, group.share])).toEqual([
      ['Markdown 笔记', 0.4],
      ['简历素材', 0.1],
    ]);
    expect(inventory.totalFiles).toBe(100);
  });

  it('file 场景：prep 里有图就带 media，没有就落 excerpt 并给 warning', () => {
    const prep = new Map<string, Prepared>([
      preparedOf('docs/logo.png', [{ role: 'thumb', path: 'assets/thumbs/docs__logo.png', width: 640, height: 320 }]),
    ]);
    const plan = buildPlan({
      script: scriptOf([
        { id: 'a', type: 'file', file: 'docs/logo.png', note: 'PNG · 640×320', narration: '有图。' },
        { id: 'b', type: 'file', file: 'README.md', excerpt: ['# 演示', '', '一段说明。'], narration: '没有图。' },
      ]),
      prep,
    });

    const withMedia = plan.scenes[0];
    if (withMedia?.type !== 'file') throw new Error('不是 file');
    expect(withMedia.media?.path).toBe('assets/thumbs/docs__logo.png');
    expect(withMedia.note).toBe('PNG · 640×320');

    const textOnly = plan.scenes[1];
    if (textOnly?.type !== 'file') throw new Error('不是 file');
    expect(textOnly.media).toBeUndefined();
    expect(textOnly.excerpt).toEqual(['# 演示', '', '一段说明。']);
    expect(plan.warnings.join('\n')).toContain('README.md');
  });

  it('gallery：prep 没有的条目跳过并警告，columns 按张数定', () => {
    const prep = new Map<string, Prepared>([
      preparedOf('a.png', [{ role: 'thumb', path: 'assets/thumbs/a.png' }]),
      preparedOf('c.png', [{ role: 'thumb', path: 'assets/thumbs/c.png' }]),
    ]);
    const plan = buildPlan({
      script: scriptOf([
        { id: 'g', type: 'gallery', items: ['a.png', 'b.png', 'c.png'], narration: '图片。' },
      ]),
      prep,
    });
    const gallery = plan.scenes[0];
    if (gallery?.type !== 'gallery') throw new Error('不是 gallery');
    expect(gallery.items.map((item) => item.path)).toEqual(['assets/thumbs/a.png', 'assets/thumbs/c.png']);
    expect(gallery.columns).toBe(2);
    expect(plan.warnings.join('\n')).toContain('b.png');
  });

  it('clip 用视频的封面，document 按讲稿的页码挑页', () => {
    const prep = new Map<string, Prepared>([
      preparedOf('demo.mp4', [{ role: 'poster', path: 'assets/posters/demo.mp4.jpg' }], 'video'),
      preparedOf(
        'report.pdf',
        [
          { role: 'page', path: 'assets/pages/report.pdf_p1.png' },
          { role: 'page', path: 'assets/pages/report.pdf_p2.png' },
          { role: 'page', path: 'assets/pages/report.pdf_p3.png' },
        ],
        'pdf',
      ),
    ]);
    const plan = buildPlan({
      script: scriptOf([
        { id: 'demo', type: 'clip', source: 'demo.mp4', clipRange: [3, 18], narration: '一段视频。' },
        { id: 'report', type: 'document', source: 'report.pdf', pages: [1, 3], narration: '翻两页。' },
      ]),
      prep,
    });

    const clip = plan.scenes[0];
    if (clip?.type !== 'clip') throw new Error('不是 clip');
    expect(clip.poster?.path).toBe('assets/posters/demo.mp4.jpg');
    expect(clip.range).toEqual([3, 18]);

    const document = plan.scenes[1];
    if (document?.type !== 'document') throw new Error('不是 document');
    expect(document.pages.map((page) => page.path)).toEqual([
      'assets/pages/report.pdf_p1.png',
      'assets/pages/report.pdf_p3.png',
    ]);
    expect(document.footer).toBe('3 页');
  });

  it('outro 的 lines 来自讲稿；facts 只有场景数与片长（都是渲染器自己知道的数）', () => {
    const plan = buildPlan({
      script: scriptOf([{ id: 'outro', type: 'outro', title: '小结', lines: ['内容构成：代码 · 文档'], narration: '完。' }]),
    });
    const outro = plan.scenes[0];
    if (outro?.type !== 'outro') throw new Error('不是 outro');
    expect(outro.lines).toEqual(['内容构成：代码 · 文档']);
    expect(outro.facts.map((fact) => fact.label)).toEqual(['场景', '片长']);
  });

  it('不认识的场景类型跳过而不是崩溃，并留 warning', () => {
    const plan = buildPlan({
      script: scriptOf([
        { id: 'a', type: 'outro', title: '完', narration: '好。' },
        { id: 'weird', type: 'hologram' as never, narration: '未知类型。' },
      ]),
    });
    expect(plan.scenes).toHaveLength(1);
    expect(plan.warnings.join('\n')).toContain('weird');
  });

  it('全部场景都不认识时抛错（没有可渲染的东西）', () => {
    expect(() =>
      buildPlan({ script: scriptOf([{ id: 'a', type: 'hologram' as never, narration: '未知。' }]) }),
    ).toThrow('没有可渲染的场景');
  });
});

describe('时长来源', () => {
  it('durations.json 的实测值优先，且向上取整', () => {
    const durations: DurationsDocument = {
      durations: 1,
      generatedAt: '2026-10-07T00:00:00+08:00',
      provider: 'edge',
      track: 'audio/narration.wav',
      pause: 0.45,
      scenes: [{ id: 'a', audio: 'audio/a.wav', audioSec: 5.32, duration: 5.77, subs: [['好。', 5.77]] }],
    };
    const plan = buildPlan({
      script: scriptOf([
        { id: 'a', type: 'outro', title: '完', narration: '好。', durationSec: 99 },
        { id: 'b', type: 'outro', title: '完二', narration: '第二场没有实测，用字数估。' },
      ]),
      durations,
    });
    // 5.77s @30fps = 173.1 → 174 帧（向上取整，宁可多一帧）
    expect(plan.scenes[0]?.durationInFrames).toBe(174);
    expect(plan.scenes[1]?.durationInFrames).toBeGreaterThan(0);
    expect(plan.warnings.join('\n')).toContain('b');
  });

  it('targetDurationSec 只在没配音时缩放，且总帧数精确等于目标', () => {
    const plan = buildPlan({
      script: scriptOf(
        [
          { id: 'a', type: 'outro', title: '完', narration: '第一场。' },
          { id: 'b', type: 'outro', title: '完二', narration: '第二场。' },
        ],
        { video: { targetDurationSec: 10 } },
      ),
    });
    expect(plan.composition.durationInFrames).toBe(10 * DEFAULT_VIDEO.fps);
  });
});

describe('标题兜底', () => {
  it('file / document / clip 用文件名，cover 用目录名', () => {
    expect(defaultTitle({ id: 'a', type: 'file', file: 'src/index.ts', narration: '' }, '演示目录')).toBe('index.ts');
    expect(defaultTitle({ id: 'a', type: 'document', source: 'docs/report.pdf', narration: '' }, '演示目录')).toBe('report.pdf');
    expect(defaultTitle({ id: 'a', type: 'cover', narration: '' }, '演示目录')).toBe('演示目录');
    expect(defaultTitle({ id: 'a', type: 'file', file: 'a.ts', narration: '', title: '入口' }, '演示目录')).toBe('入口');
  });
});
