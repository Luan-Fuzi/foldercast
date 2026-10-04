/**
 * 内容筛选：默认排除、三级筛选与规模保护的取值与匹配。
 *
 * 第一版**不可配置**（ROADMAP「除了指向哪个目录，不需要任何其他输入」），所以这里
 * 提供的是默认值；写进解读的 `sources` 是**实际生效**的那一份，用户看得到用了什么。
 *
 * 匹配走 `ignore` 包 —— .gitignore 语义是现成的，手写 glob 更容易在
 * 「build/** 不该误伤 build.gradle」这类细节上出错（REQUIREMENTS R7 的已知陷阱）。
 */
import ignore, { type Ignore } from 'ignore';
import { KIND_VALUES, type Kind, type SourcesSpec } from '../contracts/foldercast.ts';

/** 默认排除：生成物、依赖、以及 foldercast 自己的工作根。与 SPEC-data-format.md 逐条对应。 */
export const DEFAULT_EXCLUDE: readonly string[] = [
  // 生成物与依赖 —— 讲它们没有信息量，且会把文件数撑爆
  '.git/**',
  'node_modules/**',
  '.venv/**',
  'venv/**',
  '__pycache__/**',
  'dist/**',
  'build/**',
  'out/**',
  'target/**',
  '*.min.js',
  '*.min.css',
  '*.map',
  '*.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
  '.DS_Store',
  'Thumbs.db',
  // foldercast 自己的工作根：不排除掉的话，第二次分析会把自己上次的产物讲一遍
  '.foldercast/**',
];

export const DEFAULT_MAX_FILES = 200;
export const DEFAULT_MAX_FILE_SIZE_MB = 5;
export const DEFAULT_MAX_DEPTH = 6;

/** 实际生效的筛选与规模参数。 */
export type EffectiveSources = {
  include: string[];
  exclude: string[];
  kinds: Partial<Record<Kind, boolean>>;
  maxFiles: number;
  maxFileSizeMb: number;
  maxDepth: number;
  rescan: string[];
};

/** 合并默认值与用户输入。第一版没有用户输入，保留参数是为了 M3/M4 的复用。 */
export function resolveSources(input: Partial<SourcesSpec> = {}): EffectiveSources {
  return {
    include: input.include ?? [],
    exclude: [...DEFAULT_EXCLUDE, ...(input.exclude ?? [])],
    kinds: input.kinds ?? {},
    maxFiles: input.maxFiles ?? DEFAULT_MAX_FILES,
    maxFileSizeMb: input.maxFileSizeMb ?? DEFAULT_MAX_FILE_SIZE_MB,
    maxDepth: input.maxDepth ?? DEFAULT_MAX_DEPTH,
    rescan: input.rescan ?? [],
  };
}

/**
 * 目录剪枝需要目录形式。
 *
 * `ignore` 按 gitignore 语义工作：`node_modules/**` 匹配的是**目录里的东西**，
 * 目录本身不算命中（实测 `ignores('node_modules')` 为 false）。遍历时必须能判断
 * 「这个目录要不要进去」，所以给每个 `foo/**` 补一条 `foo`。
 */
function expandForPruning(patterns: readonly string[]): string[] {
  const expanded: string[] = [];
  for (const pattern of patterns) {
    expanded.push(pattern);
    if (pattern.endsWith('/**')) expanded.push(pattern.slice(0, -'/**'.length));
  }
  return expanded;
}

export type PathFilter = {
  /** 是否被排除（生成物、依赖、自己的工作根）。被排除的**完全不算**。 */
  isExcluded(relativePath: string): boolean;
  /** 是否落在白名单内。白名单为空表示全要。 */
  isIncluded(relativePath: string): boolean;
  isKindEnabled(kind: Kind): boolean;
};

export function createPathFilter(sources: EffectiveSources): PathFilter {
  const exclude: Ignore = ignore().add(expandForPruning(sources.exclude));
  const include: Ignore | null = sources.include.length > 0 ? ignore().add(sources.include) : null;

  const disabledKinds = new Set<Kind>(
    KIND_VALUES.filter((kind) => sources.kinds[kind] === false),
  );

  return {
    isExcluded(relativePath: string): boolean {
      return relativePath !== '' && exclude.ignores(relativePath);
    },
    isIncluded(relativePath: string): boolean {
      return include === null || include.ignores(relativePath);
    },
    isKindEnabled(kind: Kind): boolean {
      return !disabledKinds.has(kind);
    },
  };
}
