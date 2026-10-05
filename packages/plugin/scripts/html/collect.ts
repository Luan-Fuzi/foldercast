/**
 * 视图模型：把解读（+ 素材清单）整理成页面要用的形状。
 *
 * **与渲染分开**（`render.ts` 只吃这里的结构，不碰文件系统）：视图模型可以拿夹具直接断言，
 * 而 HTML 的生成是纯字符串操作 —— 页面的正确性不必靠「跑一遍看看」来判断。
 *
 * 三条判据写在类型里：
 *
 * 1. **页面只讲解读里有的事实**。`stats`、`manifest`、`graph` 原样搬运，不在这里做推断。
 * 2. **每个数字都能回到出处**。分组的 `share`、目录的 `files`、节点的度数都从解读算出来，
 *    不四舍五入成「约」。
 * 3. **顺序确定**。所有列表都显式排序，同一份解读渲染两次得到同一个页面。
 */
import type { FoldercastDocument, GraphHub, Kind, ManifestEntry, Role, SecretHit } from '../contracts/foldercast.ts';
import type { AssetEntry, AssetManifest } from '../contracts/assets.ts';

/** 树上的一个节点：目录或文件。 */
export type TreeNode = {
  name: string;
  /** 相对源目录的路径；根是空串。 */
  path: string;
  kind: 'dir' | 'file';
  /** 这个子树里的文件数（目录自带）与字节数。 */
  files: number;
  bytes: number;
  children: TreeNode[];
};

/** 文件卡片。字段与解读的 `manifest[]` 一一对应，多的都是素材清单里的东西。 */
export type FileCard = {
  path: string;
  /** 供页内锚点用（路径里的 `/` 与空白换成 `-`）。 */
  anchor: string;
  kind: Kind;
  role?: Role;
  bytes?: number;
  lines?: number;
  language?: string;
  title?: string;
  preview?: string;
  imports: string[];
  importedBy: string[];
  /** 素材清单里登记的主产物（相对工作根），以及它的类型。 */
  asset?: { path: string; role: string; width?: number; height?: number };
  /** Office / PDF 的页数（素材清单的 `meta.pageCount`）。 */
  pageCount?: number;
  /** 素材阶段失败的原因。 */
  assetError?: string;
  /** 源文件的修改时间（来自素材清单；解读里没有这个字段）。 */
  mtimeMs?: number;
  /** 内容与另一个文件完全相同（同一个 sha256）时，指向那个文件的路径。 */
  duplicateOf?: string;
  /** Office / PDF 提取出的正文开头（素材阶段写的 `assets/text/*.md`）。 */
  textPreview?: string;
  /** 在依赖图里的位置：入口 / 枢纽 / 都不是。 */
  mark: 'root' | 'hub' | 'none';
  /** 枢纽的入度（`mark === 'hub'` 时有值）。 */
  inDegree?: number;
  /** 是不是密钥类文件（内容未读）。 */
  secret?: string;
};

export type KindCount = { kind: Kind; count: number; share: number };
export type RoleGroup = { role: Role; count: number; paths: string[] };
export type DirCount = { path: string; files: number; share: number };
export type LanguageCount = { language: string; lines: number; share: number };

export type GraphNode = {
  /** 图上的编号，与图例一一对应。 */
  index: number;
  path: string;
  /** 分层布局的层号（0 是最靠左的一层）。 */
  layer: number;
  /** 同层内的序号。 */
  row: number;
  inDegree: number;
  outDegree: number;
  mark: 'root' | 'hub' | 'none';
};
export type GraphEdge = { from: number; to: number };

/** 图相关的几个数：画出来的、参与引用关系的总数、解读里的边总数。三个数不一样，页面要分开说。 */
export type GraphSummary = {
  /** 画出来的点。 */
  drawn: number;
  /** 参与引用关系的文件总数（按 manifest 的 imports 与 importedBy 两边并集算）。 */
  involved: number;
  /** 解读记录的引用边总数（`graph.edges`），与画出来的边数是两回事。 */
  totalEdges: number;
};

export type ViewModel = {
  label: string;
  root: string;
  generatedAt: string;
  stats: {
    totalFiles: number;
    totalBytes: number;
    maxDepth: number;
    /** 解读收录范围（`sources`），页面要如实说明这不是整个磁盘。 */
    maxFiles: number;
    excluded: number;
  };
  kinds: KindCount[];
  roles: RoleGroup[];
  /** 没有识别出角色的文件数（角色统计的分母得说清楚，否则「按角色」看起来加不起来）。 */
  rolesUnclassified: number;
  /** 有行数可统计的文件数：Office / PDF 没有行数，不能混进语言占比的分母。 */
  filesWithLines: number;
  /** 解读的排除规则（原样列出，页面用它解释「为什么看不到 out/ 里的成片」）。 */
  excludedPatterns: string[];
  topDirs: DirCount[];
  languages: LanguageCount[];
  tree: TreeNode;
  roots: string[];
  hubs: GraphHub[];
  graph: { nodes: GraphNode[]; edges: GraphEdge[]; omitted: number; summary: GraphSummary };
  cards: FileCard[];
  /** 路径 → 页内锚点。渲染器给链接用这张表，保证链接一定指得到卡片。 */
  anchors: Map<string, string>;
  secrets: { excluded: SecretHit[]; rescanned: string[] };
  /** 解读自带但页面没画出来的部分（目前只有 dangling）。 */
  dangling: string[];
};

/** 锚点：把路径变成页内可引用的 id。 */
export function anchorFor(path: string): string {
  return `f-${path.replace(/[^A-Za-z0-9._-]+/g, '-')}`;
}

/** 按 `/` 分组的多级树，目录在前、同类按名字排。 */
export function buildTree(entries: readonly ManifestEntry[]): TreeNode {
  const root: TreeNode = { name: '', path: '', kind: 'dir', files: 0, bytes: 0, children: [] };
  const dirs = new Map<string, TreeNode>([['', root]]);

  const dirFor = (path: string): TreeNode => {
    const existing = dirs.get(path);
    if (existing !== undefined) return existing;

    const cut = path.lastIndexOf('/');
    const parent = dirFor(cut === -1 ? '' : path.slice(0, cut));
    const node: TreeNode = {
      name: cut === -1 ? path : path.slice(cut + 1),
      path,
      kind: 'dir',
      files: 0,
      bytes: 0,
      children: [],
    };
    parent.children.push(node);
    dirs.set(path, node);
    return node;
  };

  for (const entry of entries) {
    const cut = entry.path.lastIndexOf('/');
    const parent = dirFor(cut === -1 ? '' : entry.path.slice(0, cut));
    parent.children.push({
      name: cut === -1 ? entry.path : entry.path.slice(cut + 1),
      path: entry.path,
      kind: 'file',
      files: 1,
      bytes: entry.bytes ?? 0,
      children: [],
    });
  }

  // 自下而上累计，再把目录排在文件前面、同类按名字排 —— 顺序固定，页面才可复现
  const rollUp = (node: TreeNode): void => {
    for (const child of node.children) rollUp(child);
    if (node.kind === 'dir') {
      node.files = node.children.reduce((sum, child) => sum + child.files, 0);
      node.bytes = node.children.reduce((sum, child) => sum + child.bytes, 0);
    }
    node.children.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'dir' ? -1 : 1;
      return left.name.localeCompare(right.name, 'en');
    });
  };
  rollUp(root);
  return root;
}

/**
 * 引用依赖图的分层布局。
 *
 * **不在页面里跑布局**（无 JS）：层号在这里算好，渲染器只画。算法是最长路径分层 ——
 * 没有入边的节点在第 0 层，其余取「所有入边起点层号 + 1」的最大值。图里有环时靠迭代上限
 * 收敛（超出的节点留在最后一层），结果仍然确定。
 *
 * 节点多的时候按度数取前 `limit` 个，但**入口与枢纽一定保留**：它们是这张图要回答的问题。
 */
export function layoutGraph(
  document: FoldercastDocument,
  limit = 60,
): { nodes: GraphNode[]; edges: GraphEdge[]; omitted: number; summary: GraphSummary } {
  const byPath = new Map(document.manifest.map((entry) => [entry.path, entry]));
  const edgesOf = (path: string): string[] =>
    (byPath.get(path)?.imports ?? []).filter((target) => byPath.has(target));

  const degree = new Map<string, number>();
  const bump = (path: string, by: number): void => {
    degree.set(path, (degree.get(path) ?? 0) + by);
  };
  const allEdges: { from: string; to: string }[] = [];
  for (const entry of document.manifest) {
    for (const target of new Set(edgesOf(entry.path))) {
      allEdges.push({ from: entry.path, to: target });
      bump(entry.path, 1);
      bump(target, 1);
    }
  }

  const hubIn = new Map(document.graph.hubs.map((hub) => [hub.path, hub.in]));
  // 「参与了引用关系的文件」要按 **manifest 的 imports 与 importedBy 两边**并集算：
  // imports 每条都有上限，只看它会漏掉那些只出现在别人的 imports 里、又没被画出来的文件
  const involved = [
    ...new Set([
      ...allEdges.flatMap((edge) => [edge.from, edge.to]),
      ...document.manifest.filter((entry) => (entry.importedBy ?? []).length > 0).map((entry) => entry.path),
    ]),
  ].filter((path) => byPath.has(path));
  const mustKeep = new Set([...document.graph.roots, ...document.graph.hubs.map((hub) => hub.path)]);
  const picked = new Set(
    involved
      .sort((left, right) => {
        const byDegree = (degree.get(right) ?? 0) - (degree.get(left) ?? 0);
        if (byDegree !== 0) return byDegree;
        return left.localeCompare(right, 'en');
      })
      .slice(0, Math.max(limit, mustKeep.size))
      .filter((path, index) => index < limit || mustKeep.has(path)),
  );
  for (const path of mustKeep) if (involved.includes(path)) picked.add(path);

  const edges = allEdges.filter((edge) => picked.has(edge.from) && picked.has(edge.to));
  const ordered = [...picked].sort((left, right) => left.localeCompare(right, 'en'));

  // 最长路径分层：反复松弛，直到不再变化或到达迭代上限（有环时）
  const layer = new Map<string, number>(ordered.map((path) => [path, 0]));
  for (let round = 0; round < ordered.length + 1; round += 1) {
    let changed = false;
    for (const edge of edges) {
      const candidate = (layer.get(edge.from) ?? 0) + 1;
      if (candidate > (layer.get(edge.to) ?? 0) && candidate <= ordered.length) {
        layer.set(edge.to, candidate);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  for (const edge of edges) {
    outDegree.set(edge.from, (outDegree.get(edge.from) ?? 0) + 1);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  // 稠密列号：层号是「最长路径长度」，可能只有个别层真的有节点（实测有一张图
  // 60 层里只有 4 层有节点，画布被撑到一万像素宽，中间全是空白）
  const denseColumn = new Map<number, number>();
  for (const value of [...new Set([...layer.values()])].sort((left, right) => left - right)) {
    denseColumn.set(value, denseColumn.size);
  }

  const rows = new Map<number, number>();
  const nodes: GraphNode[] = ordered.map((path, index) => {
    const at = layer.get(path) ?? 0;
    const row = rows.get(at) ?? 0;
    rows.set(at, row + 1);
    const isRoot = document.graph.roots.includes(path);
    const inValue = inDegree.get(path) ?? 0;
    const mark: GraphNode['mark'] = isRoot ? 'root' : inValue > 0 && hubIn.has(path) ? 'hub' : 'none';

    return {
      index: index + 1,
      path,
      layer: denseColumn.get(at) ?? 0,
      row,
      inDegree: inValue,
      outDegree: outDegree.get(path) ?? 0,
      mark,
    };
  });

  const indexOf = new Map(nodes.map((node) => [node.path, node.index]));
  return {
    nodes,
    edges: edges
      .map((edge) => ({ from: indexOf.get(edge.from) ?? 0, to: indexOf.get(edge.to) ?? 0 }))
      .filter((edge) => edge.from > 0 && edge.to > 0)
      .sort((left, right) => left.from - right.from || left.to - right.to),
    omitted: involved.length - nodes.length,
    summary: {
      drawn: nodes.length,
      involved: involved.length,
      totalEdges: document.graph.edges,
    },
  };
}

/** 素材清单 → `路径 → 主产物`。 */
function primaryProducts(
  assets: AssetManifest | undefined,
): Map<string, { path: string; role: string; width?: number; height?: number; pageCount?: number; error?: string }> {
  const map = new Map<
    string,
    { path: string; role: string; width?: number; height?: number; pageCount?: number; error?: string }
  >();
  if (assets === undefined) return map;

  for (const entry of assets.entries) {
    if (entry.error !== undefined) {
      map.set(entry.path, { path: '', role: 'error', error: entry.error });
      continue;
    }
    const primary = pickPrimary(entry);
    if (primary === undefined) continue;
    map.set(entry.path, {
      path: primary.path,
      role: primary.role,
      ...(primary.width === undefined ? {} : { width: primary.width }),
      ...(primary.height === undefined ? {} : { height: primary.height }),
      ...(entry.meta?.pageCount === undefined ? {} : { pageCount: entry.meta.pageCount }),
    });
  }
  return map;
}

/** 主产物：预览用图片优先，其次代码高亮图。与讲稿的默认引用顺序一致。 */
function pickPrimary(entry: AssetEntry): { path: string; role: string; width?: number; height?: number } | undefined {
  const order = ['thumb', 'page', 'poster', 'frame', 'code'];
  for (const role of order) {
    const found = entry.products.find((product) => product.role === role);
    if (found !== undefined) {
      return {
        path: found.path,
        role: found.role,
        ...(found.width === undefined ? {} : { width: found.width }),
        ...(found.height === undefined ? {} : { height: found.height }),
      };
    }
  }
  return undefined;
}

function share(count: number, total: number): number {
  return total === 0 ? 0 : count / total;
}

/** 组装视图模型。解读是唯一的事实来源，素材清单只补「有没有图可看」。 */
export function collectViewModel(
  document: FoldercastDocument,
  assets: AssetManifest | undefined,
  options: { graphLimit?: number; texts?: ReadonlyMap<string, string> } = {},
): ViewModel {
  const products = primaryProducts(assets);

  // 同一个 sha256 出现两次以上 = 内容完全相同的副本。版本归档目录里这很常见，
  // 页面直接点出来，省得人靠文件大小猜
  const byHash = new Map<string, string[]>();
  for (const entry of assets?.entries ?? []) {
    if (entry.hash === '' || entry.hash === undefined) continue;
    const list = byHash.get(entry.hash) ?? [];
    list.push(entry.path);
    byHash.set(entry.hash, list);
  }
  const hashOf = new Map<string, string>();
  for (const entry of assets?.entries ?? []) if (entry.hash !== undefined) hashOf.set(entry.path, entry.hash);
  const namesIn = new Map([...byHash.values()].map((paths) => [paths[0] as string, [...paths].sort()]));
  const secretPaths = new Map(document.stats.secrets.excluded.map((hit) => [hit.path, hit.match]));
  const hubIn = new Map(document.graph.hubs.map((hub) => [hub.path, hub.in]));

  const byAnchor = (left: string, right: string): number => left.localeCompare(right, 'en');

  // 锚点必须唯一且稳定：`a b/c.md` 与 `a-b/c.md` 化简后是同一个 id，所以撞了就加序号。
  // 顺序来自排好序的路径，因此同一份解读每次得到的锚点一致。
  const usedAnchors = new Set<string>();
  const anchors = new Map<string, string>();
  const uniqueAnchor = (path: string): string => {
    const base = anchorFor(path);
    let candidate = base;
    let suffix = 2;
    while (usedAnchors.has(candidate)) {
      candidate = `${base}-${String(suffix)}`;
      suffix += 1;
    }
    usedAnchors.add(candidate);
    anchors.set(path, candidate);
    return candidate;
  };

  const cards: FileCard[] = [...document.manifest]
    .sort((left, right) => byAnchor(left.path, right.path))
    .map((entry) => {
      const product = products.get(entry.path);
      const card: FileCard = {
        path: entry.path,
        anchor: uniqueAnchor(entry.path),
        kind: entry.kind,
        imports: [...(entry.imports ?? [])].sort(byAnchor),
        importedBy: [...(entry.importedBy ?? [])].sort(byAnchor),
        mark: document.graph.roots.includes(entry.path)
          ? 'root'
          : hubIn.has(entry.path)
            ? 'hub'
            : 'none',
      };
      if (entry.role !== undefined) card.role = entry.role;
      if (entry.bytes !== undefined) card.bytes = entry.bytes;
      if (entry.lines !== undefined) card.lines = entry.lines;
      if (entry.language !== undefined) card.language = entry.language;
      if (entry.title !== undefined && entry.title !== '') card.title = entry.title;
      if (entry.preview !== undefined && entry.preview !== '') card.preview = entry.preview;
      if (product !== undefined && product.path !== '') {
        card.asset = {
          path: product.path,
          role: product.role,
          ...(product.width === undefined ? {} : { width: product.width }),
          ...(product.height === undefined ? {} : { height: product.height }),
        };
      }
      if (product?.pageCount !== undefined) card.pageCount = product.pageCount;
      const assetEntry = assets?.entries.find((item) => item.path === entry.path);
      if (assetEntry !== undefined) card.mtimeMs = assetEntry.mtimeMs;
      const hash = hashOf.get(entry.path);
      if (hash !== undefined) {
        const siblings = namesIn.get(hash) ?? [];
        const first = siblings[0];
        if (siblings.length > 1 && first !== undefined && first !== entry.path) card.duplicateOf = first;
      }
      const text = options.texts?.get(entry.path);
      if (text !== undefined && text !== '') card.textPreview = text;
      if (product?.error !== undefined) card.assetError = product.error;
      const secret = secretPaths.get(entry.path);
      if (secret !== undefined) card.secret = secret;
      if (hubIn.has(entry.path)) card.inDegree = hubIn.get(entry.path) ?? 0;
      return card;
    });

  const kindEntries = Object.entries(document.stats.kindCounts).filter(
    (pair): pair is [Kind, number] => (pair[1] ?? 0) > 0,
  );
  const kinds: KindCount[] = kindEntries
    .map(([kind, count]) => ({ kind, count, share: share(count, document.stats.totalFiles) }))
    .sort((left, right) => right.count - left.count || left.kind.localeCompare(right.kind, 'en'));

  const roles: RoleGroup[] = Object.entries(document.stats.roles)
    .filter((pair): pair is [Role, string[]] => Array.isArray(pair[1]) && pair[1].length > 0)
    .map(([role, paths]) => ({ role, count: paths.length, paths: [...paths].sort(byAnchor) }))
    .sort((left, right) => right.count - left.count || left.role.localeCompare(right.role, 'en'));

  const topDirs: DirCount[] = document.stats.topDirs
    .map((dir) => ({ path: dir.path, files: dir.files, share: share(dir.files, document.stats.totalFiles) }))
    .sort((left, right) => right.files - left.files || left.path.localeCompare(right.path, 'en'));

  // 语言统计只覆盖「有行数」的文本（Office / PDF 没有行数），所以占比的分母是已统计行数，
  // 不是全目录 —— 页面必须把这句写出来，否则 100% 会被读成「整个目录都是这种语言」
  const languageTotal = Object.values(document.stats.languages).reduce((sum, value) => sum + value, 0);
  const languages: LanguageCount[] = Object.entries(document.stats.languages)
    .filter(([, lines]) => lines > 0)
    .map(([language, lines]) => ({ language, lines, share: share(lines, languageTotal) }))
    .sort((left, right) => right.lines - left.lines || left.language.localeCompare(right.language, 'en'));

  const graph = layoutGraph(document, options.graphLimit);

  return {
    label: document.source.label ?? document.source.root.split('/').pop() ?? document.source.root,
    root: document.source.root,
    generatedAt: document.generatedAt,
    stats: {
      totalFiles: document.stats.totalFiles,
      totalBytes: document.stats.totalBytes,
      maxDepth: document.stats.maxDepth,
      maxFiles: document.sources.maxFiles ?? 0,
      excluded: (document.sources.exclude ?? []).length,
    },
    kinds,
    roles,
    rolesUnclassified: document.stats.totalFiles - roles.reduce((sum, group) => sum + group.count, 0),
    filesWithLines: document.manifest.filter((entry) => entry.lines !== undefined).length,
    excludedPatterns: [...(document.sources.exclude ?? [])],
    topDirs,
    languages,
    tree: buildTree(document.manifest),
    roots: [...document.graph.roots].sort(byAnchor),
    hubs: [...document.graph.hubs].sort((left, right) => right.in - left.in || left.path.localeCompare(right.path, 'en')),
    graph,
    cards,
    anchors,
    secrets: {
      excluded: [...document.stats.secrets.excluded].sort((left, right) => left.path.localeCompare(right.path, 'en')),
      rescanned: [...document.stats.secrets.rescanned].sort(byAnchor),
    },
    dangling: [...document.graph.dangling].sort(byAnchor),
  };
}
