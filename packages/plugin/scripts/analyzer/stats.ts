/**
 * 统计：totalFiles / totalBytes / kindCounts / languages / topDirs / roles / secrets。
 *
 * 与 manifest **必须自洽**：kindCounts 是 manifest 的投影，M3 会核对这一点
 * （ROADMAP M3「结构树与 stats 的一致性（计数与清单对得上）」）。
 */
import { KIND_VALUES, ROLE_VALUES, type Kind, type ManifestEntry, type Role, type Stats } from '../contracts/foldercast.ts';
import type { SecretHit } from '../contracts/foldercast.ts';

export const TOP_DIRS_LIMIT = 8;
export const LANGUAGES_LIMIT = 10;

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** 每个目录**直接**包含的文件数，取前 8。 */
export function countTopDirs(entries: readonly ManifestEntry[], limit = TOP_DIRS_LIMIT): Stats['topDirs'] {
  const counts = new Map<string, number>();

  for (const entry of entries) {
    const segments = entry.path.split('/');
    if (segments.length < 2) continue;
    const directory = segments.slice(0, -1).join('/');
    counts.set(directory, (counts.get(directory) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([path, files]) => ({ path, files }))
    .sort((left, right) => (right.files - left.files !== 0 ? right.files - left.files : comparePaths(left.path, right.path)))
    .slice(0, limit);
}

/** 语言 → 行数，按行数降序取前 10。没有识别出语言的文件不参与。 */
export function countLanguages(entries: readonly ManifestEntry[], limit = LANGUAGES_LIMIT): Stats['languages'] {
  const lines = new Map<string, number>();

  for (const entry of entries) {
    if (entry.language === undefined || entry.lines === undefined) continue;
    lines.set(entry.language, (lines.get(entry.language) ?? 0) + entry.lines);
  }

  const sorted = [...lines.entries()].sort((left, right) =>
    right[1] - left[1] !== 0 ? right[1] - left[1] : comparePaths(left[0], right[0]),
  );

  return Object.fromEntries(sorted.slice(0, limit));
}

/** 角色 → 路径列表。没有文件的角色不出现（SPEC-data-format.md）。 */
export function groupRoles(entries: readonly ManifestEntry[]): Stats['roles'] {
  const grouped: Partial<Record<Role, string[]>> = {};

  for (const role of ROLE_VALUES) {
    const paths = entries.filter((entry) => entry.role === role).map((entry) => entry.path).sort(comparePaths);
    if (paths.length > 0) grouped[role] = paths;
  }

  return grouped;
}

/** kind 计数。12 类都出现，计数为 0 的也在 —— 「这里没有视频」本身有信息量。 */
export function countKinds(entries: readonly ManifestEntry[]): Stats['kindCounts'] {
  const counts: Partial<Record<Kind, number>> = {};
  for (const kind of KIND_VALUES) counts[kind] = 0;
  for (const entry of entries) counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
  return counts;
}

export type StatsExtras = {
  /** 观察到的最大深度。 */
  maxDepth: number;
  secrets: {
    excluded: SecretHit[];
    rescanned: string[];
  };
};

export function buildStats(entries: readonly ManifestEntry[], extras: StatsExtras): Stats {
  return {
    totalFiles: entries.length,
    totalBytes: entries.reduce((sum, entry) => sum + (entry.bytes ?? 0), 0),
    maxDepth: extras.maxDepth,
    kindCounts: countKinds(entries),
    languages: countLanguages(entries),
    topDirs: countTopDirs(entries),
    roles: groupRoles(entries),
    secrets: extras.secrets,
  };
}
