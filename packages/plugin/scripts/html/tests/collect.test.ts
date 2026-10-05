/**
 * 视图模型：树、图布局、卡片。
 *
 * 这里断言的是**事实怎么被组织**：目录汇总对不对、分层对不对、坏路径与密钥有没有被如实带上。
 * 页面长什么样不在这里（`render.test.ts`）。
 */
import { describe, expect, it } from 'vitest';
import { anchorFor, buildTree, collectViewModel, layoutGraph } from '../collect.ts';
import type { FoldercastDocument, ManifestEntry } from '../../contracts/foldercast.ts';
import { assets, entry, reading } from './reading.ts';

describe('buildTree', () => {
  it('目录汇总子树的文件数与字节数', () => {
    const manifest = [
      entry('a/one.md', { bytes: 100 }),
      entry('a/b/two.md', { bytes: 200 }),
      entry('c/three.md', { bytes: 300 }),
    ] as ManifestEntry[];
    const tree = buildTree(manifest);

    expect(tree.files).toBe(3);
    expect(tree.bytes).toBe(600);
    const a = tree.children.find((child) => child.name === 'a');
    expect(a?.files).toBe(2);
    expect(a?.bytes).toBe(300);
    expect(a?.children.map((child) => child.name)).toEqual(['b', 'one.md']);
  });

  it('目录排在文件前，同类按名字排 —— 顺序固定', () => {
    const tree = buildTree([entry('z.md'), entry('a.md'), entry('m/x.md')] as ManifestEntry[]);
    expect(tree.children.map((child) => `${child.kind}:${child.name}`)).toEqual(['dir:m', 'file:a.md', 'file:z.md']);
  });
});

describe('layoutGraph', () => {
  const chain = (edges: [string, string][]): FoldercastDocument => {
    const paths = [...new Set(edges.flat())];
    return reading({
      manifest: paths.map((path) => entry(path, { imports: edges.filter(([from]) => from === path).map(([, to]) => to) })),
      graph: { nodes: paths.length, edges: edges.length, roots: [], hubs: [], leaves: [], dangling: [] },
    });
  };

  it('按最长路径分层：链式依赖逐层往右', () => {
    const graph = layoutGraph(chain([['a.ts', 'b.ts'], ['b.ts', 'c.ts']]));
    const layerOf = new Map(graph.nodes.map((node) => [node.path, node.layer]));
    expect(layerOf.get('a.ts')).toBe(0);
    expect(layerOf.get('b.ts')).toBe(1);
    expect(layerOf.get('c.ts')).toBe(2);
  });

  it('列号是稠密的：层号再大也不会撑出空白画布', () => {
    const graph = layoutGraph(chain([['a.ts', 'b.ts'], ['b.ts', 'a.ts'], ['b.ts', 'c.ts']]));
    const columns = [...new Set(graph.nodes.map((node) => node.layer))].sort((left, right) => left - right);
    expect(columns).toEqual(columns.map((_, index) => index));
  });

  it('三个数分开报：画出来的点、参与引用关系的文件、解读里的边总数', () => {
    const document = chain([['a.ts', 'b.ts'], ['b.ts', 'c.ts']]);
    document.graph.edges = 99;
    document.manifest = document.manifest.map((item) =>
      item.path === 'c.ts' ? { ...item, importedBy: ['b.ts'] } : item,
    );
    const graph = layoutGraph(document);
    expect(graph.summary.drawn).toBe(3);
    expect(graph.summary.involved).toBe(3);
    expect(graph.summary.totalEdges).toBe(99);
  });

  it('有环也能收敛（不死循环）', () => {
    const graph = layoutGraph(chain([['a.ts', 'b.ts'], ['b.ts', 'a.ts']]));
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(2);
    for (const node of graph.nodes) expect(node.layer).toBeLessThanOrEqual(2);
  });

  it('超过上限时按连接数取舍，但入口与枢纽一定保留', () => {
    const edges: [string, string][] = [];
    for (let index = 0; index < 40; index += 1) edges.push([`f${String(index)}.ts`, `hot.ts`]);
    const document = chain(edges);
    document.graph.hubs = [{ path: 'hot.ts', in: 40 }];
    document.graph.roots = ['f0.ts'];

    const graph = layoutGraph(document, 10);
    const paths = graph.nodes.map((node) => node.path);
    expect(graph.nodes.length).toBeLessThanOrEqual(10);
    expect(paths).toContain('hot.ts');
    expect(paths).toContain('f0.ts');
    expect(graph.omitted).toBeGreaterThan(0);
    // 边只连画出来的点
    for (const edge of graph.edges) {
      expect(paths).toContain(graph.nodes.find((node) => node.index === edge.from)?.path);
      expect(paths).toContain(graph.nodes.find((node) => node.index === edge.to)?.path);
    }
  });

  it('没有引用关系时给空图，不编节点', () => {
    const graph = layoutGraph(reading({ manifest: [entry('a.md')] }));
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });
});

describe('collectViewModel', () => {
  it('搬运 stats 与 graph，不做推断', () => {
    const model = collectViewModel(reading(), undefined);
    expect(model.stats.totalFiles).toBe(5);
    expect(model.roots).toEqual(['README.md', 'src/index.ts']);
    expect(model.hubs[0]?.path).toBe('src/util.ts');
    expect(model.dangling).toEqual(['src/missing.ts']);
  });

  it('类型按数量降序，占比加起来是 1', () => {
    const model = collectViewModel(reading(), undefined);
    expect(model.kinds.map((item) => item.kind)).toEqual(['code', 'audio', 'other', 'text']);
    const total = model.kinds.reduce((sum, item) => sum + item.share, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it('密钥文件带上命中的判据，卡片里没有摘要', () => {
    const model = collectViewModel(reading(), undefined);
    const secret = model.cards.find((card) => card.path === '.env');
    expect(secret?.secret).toBe('.env');
    expect(secret?.preview).toBeUndefined();
    expect(model.secrets.excluded).toHaveLength(1);
  });

  it('素材清单缺席也能跑，只是没有图', () => {
    const withoutAssets = collectViewModel(reading(), undefined);
    expect(withoutAssets.cards.every((card) => card.asset === undefined)).toBe(true);

    const withAssets = collectViewModel(reading(), assets());
    const card = withAssets.cards.find((item) => item.path === 'src/index.ts');
    expect(card?.asset?.path).toBe('assets/code/src_index.ts.svg');
  });

  it('锚点唯一：名字里带斜杠、空格、中文的文件也不会撞', () => {
    const model = collectViewModel(
      reading({
        manifest: [entry('a b/c.md'), entry('a-b/c.md'), entry('中文/文件.md')],
        stats: { ...reading().stats, totalFiles: 3 },
      }),
      undefined,
    );
    const anchors = model.cards.map((card) => card.anchor);
    expect(new Set(anchors).size).toBe(anchors.length);
    expect(anchorFor('a b/c.md')).toBe('f-a-b-c.md');
  });
});
