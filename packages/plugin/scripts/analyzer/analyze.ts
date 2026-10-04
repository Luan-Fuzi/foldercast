/**
 * 分析器编排：目录 → `foldercast.json`。
 *
 * **纯确定性，不调用模型**（SYSTEM-DESIGN 4.4）。同一目录跑两次，除了 `generatedAt`
 * 应当完全一致；文件顺序全部显式排序，不依赖文件系统返回顺序。
 *
 * 流程：遍历 → 分类/角色/密钥（只看路径，不读内容）→ 按重要性截断 → 读内容与预览
 * → 依赖图 → 统计。**先截断再读内容**，大目录下省掉的是真正的 I/O。
 */
import { statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import {
  FORMAT_VERSION,
  type FoldercastDocument,
  type Kind,
  type ManifestEntry,
  type Role,
  type SecretHit,
  type SourcesSpec,
} from '../contracts/foldercast.ts';
import { classify, type Classification } from './classify.ts';
import { inspectFile } from './content.ts';
import { createPathFilter, resolveSources, type EffectiveSources } from './filter.ts';
import { buildGraph, type GraphResult } from './graph.ts';
import { analyzeImports, type ImportsInput } from './imports.ts';
import { detectRole } from './roles.ts';
import { matchSecretFilename } from './secrets.ts';
import { buildStats } from './stats.ts';
import { walk, type WalkedFile } from './walk.ts';

export type AnalyzeOptions = {
  /** 被讲解的目录。 */
  root: string;
  /** 展示用名称，默认取目录名。 */
  label?: string;
  /** 筛选与规模参数。第一版不暴露给用户，保留参数供 M3/M4 复用。 */
  sources?: Partial<SourcesSpec>;
  /** 覆盖生成时间，测试用。 */
  now?: Date;
};

export type AnalyzeReport = {
  /** stat 过的条目数（含被排除的）。 */
  scanned: number;
  /** 通过排除规则的文件数。 */
  discovered: number;
  /** 进 manifest 的文件数。 */
  analyzed: number;
  /** 因为 maxFiles 被截断掉的文件数。 */
  droppedByMaxFiles: number;
  /** 因为超过 maxFileSizeMb 没读内容的文件数。 */
  skippedForSize: number;
  /** 因为深度上限没有进去的目录数。 */
  prunedByDepth: number;
  /** 扫描条目触到内部上限，结果不完整。 */
  scanTruncated: boolean;
  secrets: SecretHit[];
  rescanned: string[];
};

export type AnalyzeResult = {
  document: FoldercastDocument;
  report: AnalyzeReport;
  /** 供 CLI 打印的图结论。 */
  graphDetail: GraphResult;
  sources: EffectiveSources;
};

/** 截断时的取舍顺序：角色 → 类型 → 深度 → 路径。 */
const ROLE_RANK: Record<Role, number> = {
  readme: 0,
  license: 1,
  entry: 2,
  config: 3,
  doc: 4,
  test: 6,
  build: 7,
  asset: 8,
};

const KIND_RANK: Record<Kind, number> = {
  code: 0,
  text: 0,
  markup: 1,
  data: 2,
  office: 3,
  pdf: 3,
  image: 4,
  video: 5,
  audio: 5,
  archive: 6,
  binary: 7,
  other: 5,
};

const NO_ROLE_RANK = 5;

type Candidate = {
  file: WalkedFile;
  classification: Classification;
  role?: Role;
  /** 命中密钥判据且没有被 rescan 放回：不读内容。 */
  secret?: string;
  /** 被 rescan 放回：读内容，但要记进审计。 */
  rescanned: boolean;
};

function importanceOf(candidate: Candidate): [number, number, number, string] {
  const role = candidate.role === undefined ? NO_ROLE_RANK : ROLE_RANK[candidate.role];
  const kind = KIND_RANK[candidate.classification.kind];
  return [role, kind, candidate.file.depth, candidate.file.path];
}

function compareImportance(left: Candidate, right: Candidate): number {
  const a = importanceOf(left);
  const b = importanceOf(right);
  for (let index = 0; index < a.length; index += 1) {
    const x = a[index];
    const y = b[index];
    if (x === undefined || y === undefined) continue;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/** 本地时区的 ISO 8601，带偏移量 —— 与 SPEC 的示例一致，人读更直接。 */
export function localIsoString(date: Date): string {
  const pad = (value: number): string => String(Math.abs(value)).padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const offset = `${sign}${pad(Math.trunc(Math.abs(offsetMinutes) / 60))}:${pad(Math.abs(offsetMinutes) % 60)}`;
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${offset}`
  );
}

export function analyzeDirectory(options: AnalyzeOptions): AnalyzeResult {
  const root = resolve(options.root);
  const rootStats = statSync(root, { throwIfNoEntry: false });
  if (rootStats === undefined) throw new Error(`目录不存在：${root}`);
  if (!rootStats.isDirectory()) throw new Error(`不是目录：${root}`);

  const sources = resolveSources(options.sources);
  const filter = createPathFilter(sources);
  const walked = walk({ root, filter, maxDepth: sources.maxDepth });

  // ── 1. 只看路径就能定的部分 ───────────────────────────
  const candidates: Candidate[] = [];
  for (const file of walked.files) {
    const name = basename(file.path);
    const classification = classify(name);
    if (!filter.isKindEnabled(classification.kind)) continue;

    const verdict = matchSecretFilename(name);
    const rescanned = verdict.secret && sources.rescan.includes(file.path);
    const candidate: Candidate = {
      file,
      classification,
      role: detectRole(file.path, classification.kind),
      rescanned,
    };
    if (verdict.secret && !rescanned) candidate.secret = verdict.match;
    candidates.push(candidate);
  }

  // ── 2. 规模保护：按重要性截断，再读内容 ─────────────────
  const ranked = [...candidates].sort(compareImportance);
  const kept = sources.maxFiles > 0 ? ranked.slice(0, sources.maxFiles) : ranked;
  const droppedByMaxFiles = ranked.length - kept.length;

  // ── 3. 读内容（密钥文件跳过） ──────────────────────────
  const maxBytes = sources.maxFileSizeMb * 1024 * 1024;
  const manifest: ManifestEntry[] = [];
  const importInputs: ImportsInput[] = [];
  const secretHits: SecretHit[] = [];
  const rescannedPaths: string[] = [];
  let skippedForSize = 0;

  for (const candidate of kept) {
    const { file, classification, role } = candidate;
    const entry: ManifestEntry = { path: file.path, kind: classification.kind, bytes: file.bytes };
    if (role !== undefined) entry.role = role;

    if (candidate.secret !== undefined) {
      secretHits.push({ path: file.path, match: candidate.secret });
      manifest.push(entry);
      continue;
    }
    if (candidate.rescanned) rescannedPaths.push(file.path);

    const insight = inspectFile(file.absolute, classification, maxBytes);
    if (insight.skippedForSize) skippedForSize += 1;
    if (insight.lines !== undefined) entry.lines = insight.lines;
    if (classification.language !== undefined) entry.language = classification.language;
    if (insight.title !== undefined && insight.title !== '') entry.title = insight.title;
    if (insight.preview !== undefined && insight.preview !== '') entry.preview = insight.preview;

    if (insight.text !== undefined) {
      importInputs.push({
        path: file.path,
        kind: classification.kind,
        language: classification.language,
        text: insight.text,
      });
    }

    manifest.push(entry);
  }

  // ── 4. 依赖图 ────────────────────────────────────────
  const analyzedPaths = new Set(manifest.map((entry) => entry.path));
  const importAnalysis = analyzeImports(importInputs, root, analyzedPaths);
  const graphDetail = buildGraph(
    manifest.map((entry) => ({ path: entry.path, kind: entry.kind, role: entry.role })),
    importAnalysis.edges,
    importAnalysis.dangling,
  );

  for (const entry of manifest) {
    const imports = graphDetail.imports.get(entry.path);
    if (imports !== undefined) {
      entry.imports = imports;
      entry.importsCount = graphDetail.outDegree.get(entry.path) ?? imports.length;
    }
    const importedBy = graphDetail.importedBy.get(entry.path);
    if (importedBy !== undefined) {
      entry.importedBy = importedBy;
      entry.importedByCount = graphDetail.inDegree.get(entry.path) ?? importedBy.length;
    }
  }

  // ── 5. 统计与文档 ────────────────────────────────────
  const maxDepth = manifest.reduce((deepest, entry) => {
    const depth = entry.path.split('/').length;
    return depth > deepest ? depth : deepest;
  }, 0);

  const stats = buildStats(manifest, {
    maxDepth,
    secrets: { excluded: secretHits, rescanned: rescannedPaths.sort() },
  });

  const document: FoldercastDocument = {
    foldercast: FORMAT_VERSION,
    generatedAt: localIsoString(options.now ?? new Date()),
    source: {
      root,
      label: options.label ?? basename(root),
    },
    sources: {
      include: sources.include,
      exclude: sources.exclude,
      kinds: sources.kinds,
      maxFiles: sources.maxFiles,
      maxFileSizeMb: sources.maxFileSizeMb,
      maxDepth: sources.maxDepth,
      rescan: sources.rescan,
    },
    stats,
    manifest,
    graph: graphDetail.graph,
  };

  return {
    document,
    graphDetail,
    sources,
    report: {
      scanned: walked.scanned,
      discovered: candidates.length,
      analyzed: manifest.length,
      droppedByMaxFiles,
      skippedForSize,
      prunedByDepth: walked.prunedByDepth,
      scanTruncated: walked.truncated,
      secrets: secretHits,
      rescanned: rescannedPaths.sort(),
    },
  };
}
