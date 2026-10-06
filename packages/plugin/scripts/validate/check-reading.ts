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
  const { stats } = document;

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

  const deepest = entries.reduce((max, entry) => Math.max(max, entry.path.split('/').length), 0);
  if (stats.maxDepth !== deepest) {
    add('/stats/maxDepth', `stats.maxDepth 是 ${String(stats.maxDepth)}，manifest 里最深的路径有 ${String(deepest)} 段。`, '重新跑分析器。', 'warning');
  }
}

/**
 * 审计里的路径必须真实存在于清单里。
 *
 * 密钥审计是隐私边界，它报出来的东西必须能在解读里对上号 —— 「这里有个 .env」本身有信息量
 * （SPEC-data-format.md），所以被排除的文件仍进结构树与计数。
 */
function checkSecretAudit(
  document: FoldercastDocument,
  byPath: ReadonlyMap<string, ManifestEntry>,
  collector: IssueCollector,
  locator: Locator,
  path: string,
): void {
  const add = (pointer: string, message: string, fix: string): void => {
    const at = locator.at(pointer);
    collector.add({ path, pointer, severity: 'blocker', code: 'stats-path-missing', message, fix, ...(at === undefined ? {} : { at }) });
  };

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
  checkSecretAudit(document, byPath, collector, locator, path);

  return collector;
}
