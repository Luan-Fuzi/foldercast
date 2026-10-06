/**
 * 统计：totalFiles / totalBytes / maxDepth / kindCounts / secrets。
 *
 * 与 manifest **必须自洽**：kindCounts 是 manifest 的投影，校验器会核对这一点。
 * **只做机械聚合**：数数、加字节。哪些文件重要、哪些是入口，不在这一层判断。
 */
import { KIND_VALUES, type Kind, type ManifestEntry, type SecretHit, type Stats } from '../contracts/foldercast.ts';

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
    secrets: extras.secrets,
  };
}
