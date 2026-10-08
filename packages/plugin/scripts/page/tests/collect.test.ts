/**
 * 视图模型（`collect.ts`）的纯函数断言：场景 → 区块的映射、比例计算、去重顺序。
 *
 * 这一层不碰文件系统，所以全部用内存夹具；「映射对不对」在这里钉住之后，渲染测试
 * 只需要关心 HTML 的约束（自包含、转义、折叠）。
 */
import { describe, expect, it } from 'vitest';
import type { Scene, ScriptDocument } from '../../contracts/script.ts';
import { collectViewModel, countSections, describePages, formatBytes } from '../collect.ts';
import { fullScript } from './fixture.ts';

describe('场景 → 区块映射', () => {
  const model = collectViewModel(fullScript('/tmp/fixture'));

  it('第一个 cover 提升为 hero，不再出现在区块里', () => {
    expect(model.hero?.kind).toBe('hero');
    expect(model.hero?.title).toBe('示例目录');
    expect(model.hero?.subtitle).toBe('一份夹具');
    expect(model.sections.filter((section) => section.kind === 'hero')).toHaveLength(0);
  });

  it('tree → 结构清单：share 按 files / 最大值算，bytes 格式化，highlight 保留', () => {
    const structure = model.sections.find((section) => section.kind === 'structure');
    expect(structure).toBeDefined();
    if (structure?.kind !== 'structure') return;
    expect(structure.rows).toHaveLength(3);
    expect(structure.rows[0]).toMatchObject({ path: 'src', files: 9, share: 1, highlight: true });
    expect(structure.rows[1]?.share).toBeCloseTo(3 / 9);
    expect(structure.rows[0]?.bytesLabel).toBe(formatBytes(40000));
    expect(structure.rows[2]?.bytesLabel).toBeUndefined();
  });

  it('inventory → 分组盘点：缺省 total 用各组之和，share 按 total 算，note 保留', () => {
    const inventory = model.sections.find((section) => section.kind === 'inventory');
    if (inventory?.kind !== 'inventory') throw new Error('缺 inventory 区块');
    expect(inventory.total).toBe(14);
    expect(inventory.rows[0]).toMatchObject({ label: '代码', count: 9, note: 'TypeScript 为主' });
    expect(inventory.rows[0]?.share).toBeCloseTo(9 / 14);
  });

  it('file → 文件卡片：路径、note、excerpt 原样搬运；标题缺省取文件名', () => {
    const files = model.sections.filter((section) => section.kind === 'file');
    expect(files).toHaveLength(2);
    const entry = files[0];
    if (entry?.kind !== 'file') throw new Error('缺 file 区块');
    expect(entry.file).toBe('src/main.ts');
    expect(entry.note).toBe('TypeScript · 约 40 行');
    expect(entry.excerpt).toEqual(['export const main = () => {', '  const plan = buildPlan(root);', '  const page = renderPage(plan);', '  writeFileSync(out, page);', '  return 0;', '}']);
    const shot = files[1];
    if (shot?.kind !== 'file') throw new Error('缺第二个 file 区块');
    expect(shot.title).toBe('架构图');
  });

  it('gallery → 图片网格：图片/视频按扩展名标注，非图片项不出画面标记', () => {
    const gallery = model.sections.find((section) => section.kind === 'gallery');
    if (gallery?.kind !== 'gallery') throw new Error('缺 gallery 区块');
    expect(gallery.items.map((item) => [item.path, item.kindLabel, item.isImage])).toEqual([
      ['assets/architecture.png', '图片', true],
      ['assets/ui.png', '图片', true],
      ['assets/demo.mp4', '视频', false],
    ]);
  });

  it('clip / document → 卡片：区间与页数各有展示写法', () => {
    const clip = model.sections.find((section) => section.kind === 'clip');
    if (clip?.kind !== 'clip') throw new Error('缺 clip 区块');
    expect(clip.rangeLabel).toBe('12–18.5 秒');
    const document = model.sections.find((section) => section.kind === 'document');
    if (document?.kind !== 'document') throw new Error('缺 document 区块');
    expect(document.pagesLabel).toBe('翻第 2、4 页');
  });

  it('outro → 结尾小结：lines 原样保留，narration 一律保留', () => {
    const outro = model.sections.at(-1);
    if (outro?.kind !== 'outro') throw new Error('缺 outro 区块');
    expect(outro.lines).toEqual(['结构：src + docs', '构成：代码 · 文档 · 图片']);
    expect(outro.narration).toBe('就这些，谢谢观看。');
  });

  it('引用清单按首次出现去重（同一张图进 file 与 gallery 只算一次）', () => {
    expect(model.references).toEqual([
      'src/main.ts',
      'assets/architecture.png',
      'assets/ui.png',
      'assets/demo.mp4',
      'docs/spec.pdf',
    ]);
  });

  it('区块数 = hero + sections（页脚统计用）', () => {
    expect(countSections(model)).toBe(model.sections.length + 1);
  });
});

describe('边界情况', () => {
  it('不认识的场景类型跳过并记录，不崩（开放枚举）', () => {
    const script = fullScript('/tmp/fixture');
    script.scenes.push({ id: 'weird', type: 'hologram', narration: '…' } as unknown as Scene);
    const model = collectViewModel(script);
    expect(model.skipped).toEqual([{ id: 'weird', type: 'hologram' }]);
    expect(model.sections.filter((section) => section.kind !== 'hero')).toHaveLength(8);
  });

  it('第二个 cover 不再当页头，画进正文', () => {
    const script = fullScript('/tmp/fixture');
    script.scenes.push({ id: 'cover-2', type: 'cover', title: '再来一张封面', narration: '…' });
    const model = collectViewModel(script);
    expect(model.hero?.id).toBe('cover');
    expect(model.sections.at(-1)?.kind).toBe('hero');
  });

  it('没有 cover 时页面仍有标题（讲稿 title > label > 目录名）', () => {
    const script: ScriptDocument = {
      foldercast: 2,
      source: { root: '/tmp/some-project' },
      scenes: [{ id: 'outro', type: 'outro', title: '完', narration: '完。' }],
    };
    const model = collectViewModel(script);
    expect(model.hero).toBeUndefined();
    expect(model.title).toBe('some-project');
    expect(model.label).toBe('some-project');
  });

  it('tree 全是 0 个文件时 share 不产生 NaN', () => {
    const script: ScriptDocument = {
      foldercast: 2,
      source: { root: '/tmp/x' },
      scenes: [
        {
          id: 'layout',
          type: 'tree',
          entries: [
            { path: 'a', files: 0 },
            { path: 'b', files: 0 },
          ],
          narration: '空的。',
        },
      ],
    };
    const model = collectViewModel(script);
    const structure = model.sections[0];
    if (structure?.kind !== 'structure') throw new Error('缺 structure 区块');
    expect(structure.rows.every((row) => Number.isFinite(row.share) && row.share === 0)).toBe(true);
  });
});

describe('格式化', () => {
  it('字节数走给人看的写法', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(40_000)).toBe('39.1 KB');
    expect(formatBytes(180_000)).toBe('175.8 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });

  it('页码说明：缺省翻全部，点名了就列出来', () => {
    expect(describePages(undefined)).toBe('翻全部页');
    expect(describePages([])).toBe('翻全部页');
    expect(describePages([1])).toBe('翻第 1 页');
    expect(describePages([2, 4, 7])).toBe('翻第 2、4、7 页');
  });
});
