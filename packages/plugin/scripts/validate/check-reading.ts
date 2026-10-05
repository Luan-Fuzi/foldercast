/**
 * 解读（`foldercast.json`）的校验：schema + **内部自洽**。
 *
 * 自洽这一层是 ROADMAP M3 的「结构树与 `stats` 的一致性（计数与清单对得上）」：解读由程序
 * 产出，所以它的统计必须是 manifest 的投影，图必须是 manifest 里边的投影。分析器有 bug 时
 * 这一层会报出来 —— 它同时也是分析器自己的回归防线。
 */
import { isAbsolute, basename } from 'node:path';
import {
  KIND_VALUES,
  ROLE_VALUES,
  type FoldercastDocument,
  type ManifestEntry,
} from '../contracts/foldercast.ts';
import { createLocator, type Locator } from './locate.ts';
import { IssueCollector, type IssueSeverity } from './issue.ts';
import { validateAgainstSchema, type SchemaValidator } from './ajv.ts';

export type ReadingInput = {
  /** 解读文档（已解析）。 */
  document: FoldercastDocument;
  /** 报告里显示的文件路径。 */
  path: string;
  /** 读取的文件原文，用于把 JSON 指针换成行列。 */
  text: string;
  /** schema 校验器。schema 由调用方载入，避免这里依赖仓库布局。 */
  validateSchema: SchemaValidator;
};

/** manifest 的路径 → 条目，顺便查重。 */
function indexManifest(entries: readonly ManifestEntry[], collector: IssueCollector, locator: Locator, path: string): Map<string, ManifestEntry> {
  const byPath = new Map<string, ManifestEntry>();

  entries.forEach((entry, index) => {
    const pointer = `/manifest/${String(index)}/path`;
    const at = locator.at(pointer);

    if (byPath.has(entry.path)) {
      collector.add({
        path,
        pointer,
        severity: 'blocker',
        code: 'stats-mismatch',
        message: `manifest 里 ${entry.path} 出现了两次，计数会重复。`,
        fix: '同一个路径只能有一条；分析器应当每文件一条。',
        ...(at === undefined ? {} : { at }),
      });
      return;
    }
    byPath.set(entry.path, entry);

    if (isAbsolute(entry.path) || entry.path.includes('\\') || entry.path.startsWith('./')) {
      collector.add({
        path,
        pointer,
        severity: 'blocker',
        code: 'stats-mismatch',
        message: `manifest 的路径不是规范形式：${entry.path}。`,
        fix: '路径须相对 source.root、用正斜杠、不带 ./ 前缀。',
        ...(at === undefined ? {} : { at }),
      });
    }
  });

  return byPath;
}

function checkCounts(
  document: FoldercastDocument,
  entries: readonly ManifestEntry[],
  collector: IssueCollector,
  locator: Locator,
  path: string,
): void {
  const { stats, graph } = document;

  const add = (pointer: string, message: string, fix: string, severity: IssueSeverity = 'blocker'): void => {
    const at = locator.at(pointer);
    collector.add({ path, pointer, severity, code: 'stats-mismatch', message, fix, ...(at === undefined ? {} : { at }) });
  };

  if (stats.totalFiles !== entries.length) {
    add('/stats/totalFiles', `stats.totalFiles 是 ${String(stats.totalFiles)}，manifest 有 ${String(entries.length)} 条。`, '重新跑分析器；两者必须相等。');
  }

  const byteSum = entries.reduce((sum, entry) => sum + (entry.bytes ?? 0), 0);
  if (stats.totalBytes !== byteSum) {
    add('/stats/totalBytes', `stats.totalBytes 是 ${String(stats.totalBytes)}，manifest 的 bytes 合计是 ${String(byteSum)}。`, '重新跑分析器。');
  }

  for (const kind of KIND_VALUES) {
    const declared = stats.kindCounts[kind] ?? 0;
    const actual = entries.filter((entry) => entry.kind === kind).length;
    if (declared !== actual) {
      add(`/stats/kindCounts/${kind}`, `stats.kindCounts.${kind} 是 ${String(declared)}，manifest 里实际有 ${String(actual)} 个。`, '重新跑分析器；kindCounts 必须是 manifest 的投影。');
    }
  }

  // 语言统计只覆盖「识别出语言且读到行数」的文件，所以只能查上限
  for (const [language, lines] of Object.entries(stats.languages)) {
    const actual = entries
      .filter((entry) => entry.language === language)
      .reduce((sum, entry) => sum + (entry.lines ?? 0), 0);
    if (lines > actual) {
      add(`/stats/languages/${language}`, `stats.languages.${language} 是 ${String(lines)} 行，manifest 里同语言的文件合计只有 ${String(actual)} 行。`, '重新跑分析器。');
    }
  }

  const deepest = entries.reduce((max, entry) => Math.max(max, entry.path.split('/').length), 0);
  if (stats.maxDepth !== deepest) {
    add('/stats/maxDepth', `stats.maxDepth 是 ${String(stats.maxDepth)}，manifest 里最深的路径有 ${String(deepest)} 段。`, '重新跑分析器。', 'warning');
  }

  if (graph.nodes !== entries.length) {
    add('/graph/nodes', `graph.nodes 是 ${String(graph.nodes)}，manifest 有 ${String(entries.length)} 条。`, '重新跑分析器；节点数即清单条数。');
  }

  const edgeSum = entries.reduce((sum, entry) => sum + (entry.importsCount ?? entry.imports?.length ?? 0), 0);
  if (graph.edges !== edgeSum) {
    add('/graph/edges', `graph.edges 是 ${String(graph.edges)}，manifest 的出度合计是 ${String(edgeSum)}。`, '重新跑分析器。');
  }
}

function checkPathLists(
  document: FoldercastDocument,
  byPath: ReadonlyMap<string, ManifestEntry>,
  collector: IssueCollector,
  locator: Locator,
  path: string,
): void {
  const add = (pointer: string, message: string, fix: string, code: 'stats-path-missing' | 'graph-mismatch' = 'stats-path-missing'): void => {
    const at = locator.at(pointer);
    collector.add({ path, pointer, severity: 'blocker', code, message, fix, ...(at === undefined ? {} : { at }) });
  };

  for (const role of ROLE_VALUES) {
    const paths = document.stats.roles[role];
    if (paths === undefined) continue;
    paths.forEach((rolePath, index) => {
      const entry = byPath.get(rolePath);
      if (entry === undefined) {
        add(`/stats/roles/${role}/${String(index)}`, `stats.roles.${role} 里的 ${rolePath} 不在 manifest 里。`, '重新跑分析器。');
      } else if (entry.role !== role) {
        add(`/stats/roles/${role}/${String(index)}`, `stats.roles.${role} 里有 ${rolePath}，但 manifest 里它的 role 是 ${entry.role ?? '（无）'}。`, '重新跑分析器；一个文件最多一个角色。');
      }
    });
  }

  // 密钥审计里的路径也必须进结构树（「这里有个 .env」本身有信息量，SPEC-data-format.md）
  document.stats.secrets.excluded.forEach((hit, index) => {
    if (!byPath.has(hit.path)) {
      add(`/stats/secrets/excluded/${String(index)}/path`, `stats.secrets.excluded 里的 ${hit.path} 不在 manifest 里。`, '密钥文件仍应进结构树与计数，只是不读内容。');
    }
  });
  document.stats.secrets.rescanned.forEach((rescanned, index) => {
    if (!byPath.has(rescanned)) {
      add(`/stats/secrets/rescanned/${String(index)}`, `stats.secrets.rescanned 里的 ${rescanned} 不在 manifest 里。`, 'rescan 放回的文件必须进 manifest。');
    }
  });

  for (const [index, rescanned] of (document.sources.rescan ?? []).entries()) {
    if (!byPath.has(rescanned)) {
      add(`/sources/rescan/${String(index)}`, `sources.rescan 里的 ${rescanned} 不在 manifest 里。`, 'rescan 的路径必须是被分析目录里真实存在的文件。');
    }
  }

  // 图上列出的路径都必须是真实节点
  document.graph.roots.forEach((rootPath, index) => {
    if (!byPath.has(rootPath)) add(`/graph/roots/${String(index)}`, `graph.roots 里的 ${rootPath} 不在 manifest 里。`, '重新跑分析器。', 'graph-mismatch');
  });
  document.graph.leaves.forEach((leafPath, index) => {
    if (!byPath.has(leafPath)) add(`/graph/leaves/${String(index)}`, `graph.leaves 里的 ${leafPath} 不在 manifest 里。`, '重新跑分析器。', 'graph-mismatch');
  });
  document.graph.hubs.forEach((hub, index) => {
    const entry = byPath.get(hub.path);
    if (entry === undefined) {
      add(`/graph/hubs/${String(index)}/path`, `graph.hubs 里的 ${hub.path} 不在 manifest 里。`, '重新跑分析器。', 'graph-mismatch');
      return;
    }
    const inDegree = entry.importedByCount ?? entry.importedBy?.length ?? 0;
    if (hub.in !== inDegree) {
      add(`/graph/hubs/${String(index)}/in`, `graph.hubs 里 ${hub.path} 的入度写作 ${String(hub.in)}，manifest 里是 ${String(inDegree)}。`, '重新跑分析器。', 'graph-mismatch');
    }
    if (hub.out !== undefined) {
      const outDegree = entry.importsCount ?? entry.imports?.length ?? 0;
      if (hub.out !== outDegree) {
        add(`/graph/hubs/${String(index)}/out`, `graph.hubs 里 ${hub.path} 的出度写作 ${String(hub.out)}，manifest 里是 ${String(outDegree)}。`, '重新跑分析器。', 'graph-mismatch');
      }
    }
  });

  // dangling 是「指向不存在的路径」，所以它自己不能命中 manifest
  document.graph.dangling.forEach((dangling, index) => {
    if (byPath.has(dangling)) {
      add(`/graph/dangling/${String(index)}`, `graph.dangling 里的 ${dangling} 其实存在于 manifest 里。`, '能解析到的引用不算坏引用。', 'graph-mismatch');
    }
  });
}

/** 校验一份解读。返回的问题里 blocker 表示解读不能用。 */
export function checkReading(input: ReadingInput): IssueCollector {
  const { document, path, text, validateSchema } = input;
  const collector = new IssueCollector();
  const locator = createLocator(text);

  for (const issue of validateAgainstSchema(validateSchema, document, path, locator)) collector.add(issue);

  if (document.foldercast !== 1) {
    const at = locator.at('/foldercast');
    collector.add({
      path,
      pointer: '/foldercast',
      severity: 'blocker',
      code: 'version-unsupported',
      message: `解读格式版本是 ${String(document.foldercast)}，本工具只认 1。`,
      fix: '用与新版本配套的工具，或重新生成解读。',
      ...(at === undefined ? {} : { at }),
    });
  }

  const root = document.source.root;
  if (!isAbsolute(root)) {
    const at = locator.at('/source/root');
    collector.add({
      path,
      pointer: '/source/root',
      severity: 'blocker',
      code: 'source-root-relative',
      message: `source.root 是相对路径：${root}。`,
      fix: '写被讲解目录的绝对路径。',
      ...(at === undefined ? {} : { at }),
    });
  } else if (document.source.label !== undefined && document.source.label !== basename(root)) {
    const at = locator.at('/source/label');
    collector.add({
      path,
      pointer: '/source/label',
      severity: 'warning',
      code: 'label-mismatch',
      message: `source.label 是 ${document.source.label}，目录名是 ${basename(root)}。`,
      fix: '第一版 label 默认取目录名；不一致说明是手改过的。',
      ...(at === undefined ? {} : { at }),
    });
  }

  const byPath = indexManifest(document.manifest, collector, locator, path);
  checkCounts(document, document.manifest, collector, locator, path);
  checkPathLists(document, byPath, collector, locator, path);

  return collector;
}
