import { describe, expect, it } from 'vitest';
import { buildGraph } from '../graph.ts';

const nodes = [
  { path: 'README.md', kind: 'text' as const },
  { path: 'src/index.ts', kind: 'code' as const },
  { path: 'src/util.ts', kind: 'code' as const },
  { path: 'src/app.ts', kind: 'code' as const },
  { path: 'assets/logo.png', kind: 'image' as const },
  { path: 'docs/guide.md', kind: 'text' as const },
];

const edges = [
  { from: 'README.md', to: 'src/index.ts' },
  { from: 'README.md', to: 'src/util.ts' },
  { from: 'src/app.ts', to: 'src/util.ts' },
  { from: 'src/index.ts', to: 'src/util.ts' },
  { from: 'docs/guide.md', to: 'src/index.ts' },
];

describe('依赖图结论', () => {
  const result = buildGraph(nodes, edges, ['src/missing.ts']);

  it('节点与边的计数就是入参规模', () => {
    expect(result.graph.nodes).toBe(6);
    expect(result.graph.edges).toBe(5);
  });

  it('hubs 按入度排序，入度与出度都给出', () => {
    expect(result.graph.hubs[0]).toEqual({ path: 'src/util.ts', in: 3, out: 0 });
    expect(result.graph.hubs.map((hub) => hub.path)).toContain('src/index.ts');
  });

  it('roots 只含能携带引用、且无入边的文件', () => {
    // 媒体文件没有入边是常态，不算入口
    expect(result.graph.roots).not.toContain('assets/logo.png');
    expect(result.graph.roots).toContain('README.md');
    expect(result.graph.roots).not.toContain('src/util.ts'); // 有入边
  });

  it('孤立的配置/测试文件不是入口（回归）', () => {
    const isolated = buildGraph(
      [
        { path: 'tsconfig.json', kind: 'data' as const, role: 'config' as const },
        { path: '.gitignore', kind: 'text' as const },
        { path: 'README.md', kind: 'text' as const, role: 'readme' as const },
        { path: 'package.json', kind: 'data' as const, role: 'entry' as const },
        { path: 'src/index.ts', kind: 'code' as const },
      ],
      [{ from: 'src/index.ts', to: 'src/index.ts' }].slice(0, 0),
      [],
    );
    // tsconfig / .gitignore 既没有入边也没有出边，不该出现在入口列表里
    expect(isolated.graph.roots).not.toContain('tsconfig.json');
    expect(isolated.graph.roots).not.toContain('.gitignore');
    // README 与入口文件即使没有引用别人，也仍然是起点
    expect(isolated.graph.roots).toContain('README.md');
    expect(isolated.graph.roots).toContain('package.json');
  });

  it('leaves 是有入边、无出边的文件', () => {
    expect(result.graph.leaves).toEqual(['src/util.ts']);
    expect(result.graph.leaves).not.toContain('README.md'); // 有出边
  });

  it('坏引用原样带出并排序', () => {
    const two = buildGraph(nodes, edges, ['src/z.ts', 'src/a.ts']);
    expect(two.graph.dangling).toEqual(['src/a.ts', 'src/z.ts']);
  });

  it('每侧的边都有上限，并给出真实度数', () => {
    const many = Array.from({ length: 60 }, (_, index) => `src/f${index}.ts`);
    const star = many.map((path) => ({ from: 'src/index.ts', to: path }));
    const graph = buildGraph(
      [{ path: 'src/index.ts', kind: 'code' as const }, ...many.map((path) => ({ path, kind: 'code' as const }))],
      star,
      [],
    );
    const index = graph.imports.get('src/index.ts') ?? [];
    expect(index.length).toBe(40);
    expect(graph.outDegree.get('src/index.ts')).toBe(60);
    expect(graph.graph.edges).toBe(60);
  });

  it('importedBy 取前 5，按引用方出度排序', () => {
    const importers = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => `src/${name}.ts`);
    const edges = importers.map((path) => ({ from: path, to: 'src/util.ts' }));
    // 让 a、b 两个引用方自己也有出边，排序时应当靠前
    edges.push({ from: 'src/a.ts', to: 'src/b.ts' }, { from: 'src/b.ts', to: 'src/c.ts' });
    const graph = buildGraph(
      [{ path: 'src/util.ts', kind: 'code' as const }, ...importers.map((path) => ({ path, kind: 'code' as const }))],
      edges,
      [],
    );
    expect(graph.importedBy.get('src/util.ts')).toHaveLength(5);
    expect(graph.inDegree.get('src/util.ts')).toBe(6);
    expect(graph.importedBy.get('src/util.ts')?.[0]).toBe('src/a.ts');
  });
});
