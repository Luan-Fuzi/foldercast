/**
 * 分析器编排：目录 → `foldercast.json`。
 *
 * **纯确定性，不调用模型**（SYSTEM-DESIGN 4.4）。同一目录跑两次，除了 `generatedAt`
 * 应当完全一致；文件顺序全部显式排序，不依赖文件系统返回顺序。
 *
 * 流程：遍历 → 分类与密钥判据（只看路径）→ 按规模截断 → 读内容与预览 → 统计。
 * **先截断再读内容**，大目录下省掉的是真正的 I/O。
 *
 * **只产出机械事实**：路径、类别、字节、行数、截断预览、密钥审计。不猜角色、不排枢纽、
 * 不判语言 —— 那些要读内容才知道，是模型的事（MVP 判据：程序只给模型自己得不到的东西）。
 */
import { statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import {
  FORMAT_VERSION,
  type FoldercastDocument,
  type Kind,
  type ManifestEntry,
  type SecretHit,
  type SourcesSpec,
} from '../contracts/foldercast.ts';
import { classify } from './classify.ts';
import { inspectFile } from './content.ts';
import { createPathFilter, resolveSources, type EffectiveSources } from './filter.ts';
import { matchSecretFilename } from './secrets.ts';
import { buildStats } from './stats.ts';
import { walk, type WalkedFile } from './walk.ts';

export type AnalyzeOptions = {
  /** 被讲解的目录。 */
  root: string;
  /** 展示用名称，默认取目录名。 */
  label?: string;
  /** 筛选与规模参数。第一版不暴露给用户，保留参数供校验器与工具复用。 */
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
  sources: EffectiveSources;
};

/**
 * 截断时的取舍顺序：**类型 → 深度 → 路径**。
 *
 * 只看机械属性，不做「重要性」判断：代码与文本优先于二进制，浅的优先于深的，
 * 同层按路径字典序（保证结果可复现）。谁真的重要要读内容才知道，留给模型。
 */
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
  other: 5,
  archive: 6,
  binary: 7,
};

type Candidate = {
  file: WalkedFile;
  kind: Kind;
  /** 命中密钥判据且没有被 rescan 放回：不读内容。 */
  secret?: string;
  /** 被 rescan 放回：读内容，但要记进审计。 */
  rescanned: boolean;
};

function compareImportance(left: Candidate, right: Candidate): number {
  const kind = KIND_RANK[left.kind] - KIND_RANK[right.kind];
  if (kind !== 0) return kind;
  if (left.file.depth !== right.file.depth) return left.file.depth - right.file.depth;
  return left.file.path < right.file.path ? -1 : left.file.path > right.file.path ? 1 : 0;
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
    const kind = classify(name);
    if (!filter.isKindEnabled(kind)) continue;

    const verdict = matchSecretFilename(name);
    const rescanned = verdict.secret && sources.rescan.includes(file.path);
    const candidate: Candidate = { file, kind, rescanned };
    if (verdict.secret && !rescanned) candidate.secret = verdict.match;
    candidates.push(candidate);
  }

  // ── 2. 规模保护：按机械属性截断，再读内容 ───────────────
  const ranked = [...candidates].sort(compareImportance);
  // **密钥文件不占 maxFiles 的配额，也不会被截掉**：它们本来就不读内容（零成本），
  // 而审计必须完整 —— 被截掉的密钥等于没报出来，用户在 stats.secrets.excluded 里看不到它。
  // 实测踩过：200 文件的目录里 `lecture-videos/.mimo_api_key` 既不在清单、也不在审计里。
  const isSecret = new Set(ranked.filter((candidate) => candidate.secret !== undefined));
  const quota = sources.maxFiles > 0 ? sources.maxFiles : ranked.length;
  const fillsQuota = new Set(ranked.filter((candidate) => candidate.secret === undefined).slice(0, quota));
  const kept = ranked.filter((candidate) => isSecret.has(candidate) || fillsQuota.has(candidate));
  const droppedByMaxFiles = ranked.length - kept.length;

  // ── 3. 读内容（密钥文件跳过） ──────────────────────────
  const maxBytes = sources.maxFileSizeMb * 1024 * 1024;
  const manifest: ManifestEntry[] = [];
  const secretHits: SecretHit[] = [];
  const rescannedPaths: string[] = [];
  let skippedForSize = 0;

  for (const candidate of kept) {
    const { file, kind } = candidate;
    const entry: ManifestEntry = { path: file.path, kind, bytes: file.bytes };

    if (candidate.secret !== undefined) {
      secretHits.push({ path: file.path, match: candidate.secret });
      manifest.push(entry);
      continue;
    }
    if (candidate.rescanned) rescannedPaths.push(file.path);

    const insight = inspectFile(file.absolute, kind, maxBytes);
    if (insight.skippedForSize) skippedForSize += 1;
    if (insight.lines !== undefined) entry.lines = insight.lines;
    if (insight.preview !== undefined && insight.preview !== '') entry.preview = insight.preview;

    manifest.push(entry);
  }

  // ── 4. 统计与文档 ────────────────────────────────────
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
  };

  return {
    document,
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
