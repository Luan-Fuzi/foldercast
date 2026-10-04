/**
 * 三个列表的判据：
 * - `roots`：无入边、**能携带引用**、且不是配置/测试/构建/素材 —— 还要求它要么引用了
 *   别的东西，要么本身就是 README / 入口。否则 `.gitignore`、`tsconfig.json` 这种
 *   孤立文件会被当成「入口」，对写稿没有价值。
 * - `hubs`：有入边里入度最高的。
 * - `leaves`：无出边**但有入边**的文件 —— 「别人引用它、它不引用别人」才是末端。
 */
import type { Graph, GraphHub, Kind, Role } from '../contracts/foldercast.ts';
import type { ImportEdge } from './imports.ts';

/** imports 列表长度上限（schema 与 SPEC 都写 ≤40）。 */
export const IMPORTS_CAP = 40;
/** importedBy 取前 5。 */
export const IMPORTED_BY_CAP = 5;
/** roots / leaves 的展示上限，避免大目录里几百条。 */
export const ROOTS_CAP = 40;
export const LEAVES_CAP = 40;
/** hubs 的展示上限。 */
export const HUBS_CAP = 20;

export type GraphNode = { path: string; kind: Kind; role?: Role };

export type GraphResult = {
  graph: Graph;
  /** path → 它引用了谁（已排序、已截断）。 */
  imports: Map<string, string[]>;
  /** path → 真实出度。 */
  outDegree: Map<string, number>;
  /** path → 谁引用它（已排序、已截断）。 */
  importedBy: Map<string, string[]>;
  /** path → 真实入度。 */
  inDegree: Map<string, number>;
};

const REFERENCE_CAPABLE: ReadonlySet<Kind> = new Set<Kind>(['code', 'markup', 'text', 'data']);
/** 这些角色即使没有入边也不算入口：它们是配套文件，不是讲述的起点。 */
const NON_ROOT_ROLES: ReadonlySet<Role> = new Set<Role>(['config', 'test', 'build', 'asset']);

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function buildGraph(
  nodes: readonly GraphNode[],
  edges: readonly ImportEdge[],
  dangling: readonly string[],
): GraphResult {
  const outgoing = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();

  for (const edge of edges) {
    const targets = outgoing.get(edge.from) ?? new Set<string>();
    targets.add(edge.to);
    outgoing.set(edge.from, targets);

    const sources = incoming.get(edge.to) ?? new Set<string>();
    sources.add(edge.from);
    incoming.set(edge.to, sources);
  }

  const outDegree = new Map<string, number>();
  const inDegree = new Map<string, number>();
  const imports = new Map<string, string[]>();
  const importedBy = new Map<string, string[]>();

  for (const node of nodes) {
    const targets = [...(outgoing.get(node.path) ?? [])].sort(comparePaths);
    const sources = [...(incoming.get(node.path) ?? [])].sort((left, right) => {
      const byOut = (outDegree.get(right) ?? 0) - (outDegree.get(left) ?? 0);
      return byOut !== 0 ? byOut : comparePaths(left, right);
    });
    outDegree.set(node.path, targets.length);
    inDegree.set(node.path, sources.length);
    if (targets.length > 0) imports.set(node.path, targets.slice(0, IMPORTS_CAP));
    if (sources.length > 0) importedBy.set(node.path, sources.slice(0, IMPORTED_BY_CAP));
  }

  const roots = nodes
    .filter((node) => {
      if (!REFERENCE_CAPABLE.has(node.kind)) return false;
      if (node.role !== undefined && NON_ROOT_ROLES.has(node.role)) return false;
      if ((inDegree.get(node.path) ?? 0) !== 0) return false;
      // 要么引用了别人，要么本身就是说明/入口文件
      return (outDegree.get(node.path) ?? 0) > 0 || node.role === 'readme' || node.role === 'entry';
    })
    .sort((left, right) => {
      const byOut = (outDegree.get(right.path) ?? 0) - (outDegree.get(left.path) ?? 0);
      return byOut !== 0 ? byOut : comparePaths(left.path, right.path);
    })
    .slice(0, ROOTS_CAP)
    .map((node) => node.path);

  const hubs: GraphHub[] = nodes
    .filter((node) => (inDegree.get(node.path) ?? 0) > 0)
    .sort((left, right) => {
      const byIn = (inDegree.get(right.path) ?? 0) - (inDegree.get(left.path) ?? 0);
      return byIn !== 0 ? byIn : comparePaths(left.path, right.path);
    })
    .slice(0, HUBS_CAP)
    .map((node) => ({
      path: node.path,
      in: inDegree.get(node.path) ?? 0,
      out: outDegree.get(node.path) ?? 0,
    }));

  const leaves = nodes
    .filter((node) => (outDegree.get(node.path) ?? 0) === 0 && (inDegree.get(node.path) ?? 0) > 0)
    .sort((left, right) => {
      const byIn = (inDegree.get(right.path) ?? 0) - (inDegree.get(left.path) ?? 0);
      return byIn !== 0 ? byIn : comparePaths(left.path, right.path);
    })
    .slice(0, LEAVES_CAP)
    .map((node) => node.path);

  const graph: Graph = {
    nodes: nodes.length,
    edges: edges.length,
    roots,
    hubs,
    leaves,
    dangling: [...dangling].sort(comparePaths),
  };

  return { graph, imports, outDegree, importedBy, inDegree };
}
