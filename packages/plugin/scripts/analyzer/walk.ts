/**
 * 目录遍历：产出待分析的文件清单。
 *
 * 三条边界：
 * - **不跟随符号链接**：既避免环，也避免把目录外的东西算进来。
 * - **目录剪枝**：命中的目录整个不进去（否则 21 万文件的目录跑不动）。
 * - **规模保护**：深度、文件数、单文件大小都在这里或分析阶段生效。
 *
 * 这里只做「有哪些文件」，不做分类、角色、密钥判定 —— 那些在各自模块里，
 * 便于单独测试。
 */
import { readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import type { PathFilter } from './filter.ts';

/** 扫描条目上限：防止病态目录把内存和时间吃光（不是契约字段，是内部保护）。 */
const MAX_SCANNED_ENTRIES = 300_000;

export type WalkedFile = {
  /** 相对 root 的 posix 路径。 */
  path: string;
  /** 绝对路径。 */
  absolute: string;
  bytes: number;
  /** 根下第一层为 1。 */
  depth: number;
};

export type WalkResult = {
  files: WalkedFile[];
  /** 实际 stat 过的条目数（含被排除的目录与文件）。 */
  scanned: number;
  /** 因为深度上限没有进去的目录数。 */
  prunedByDepth: number;
  /** 因为扫描上限提前停止。 */
  truncated: boolean;
};

export type WalkOptions = {
  root: string;
  filter: PathFilter;
  /** 展示与遍历深度上限。 */
  maxDepth: number;
};

function listEntries(directory: string): string[] {
  // 排序保证输出确定：同一目录两次分析得到完全一样的清单
  return readdirSync(directory).sort();
}

export function walk(options: WalkOptions): WalkResult {
  const { root, filter, maxDepth } = options;
  const files: WalkedFile[] = [];
  let scanned = 0;
  let prunedByDepth = 0;
  let truncated = false;

  const visit = (directory: string, depth: number): void => {
    if (truncated) return;

    for (const name of listEntries(directory)) {
      if (scanned >= MAX_SCANNED_ENTRIES) {
        truncated = true;
        return;
      }

      const absolute = join(directory, name);
      let stats;
      try {
        // lstat 而不是 stat：符号链接要看链接本身，不能跟进去
        stats = lstatSync(absolute);
      } catch {
        // 断链符号链接、权限不足等：跳过单个条目，不中断整体（coding.md 错误处理）
        continue;
      }
      scanned += 1;

      const relativePath = absolute.slice(root.length + 1).split('\\').join('/');

      // 不跟随符号链接
      if (stats.isSymbolicLink()) continue;

      if (stats.isDirectory()) {
        if (filter.isExcluded(relativePath)) continue;
        if (depth >= maxDepth) {
          prunedByDepth += 1;
          continue;
        }
        visit(absolute, depth + 1);
        continue;
      }

      if (!stats.isFile()) continue;
      if (filter.isExcluded(relativePath)) continue;
      if (!filter.isIncluded(relativePath)) continue;

      files.push({ path: relativePath, absolute, bytes: stats.size, depth });
    }
  };

  visit(root, 1);
  files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));

  return { files, scanned, prunedByDepth, truncated };
}
