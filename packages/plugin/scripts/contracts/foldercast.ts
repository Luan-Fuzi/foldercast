/**
 * `foldercast.json`（目录解读）的 TypeScript 类型。
 *
 * 这是契约的三处表示之一，另外两处是 `docs/specs/foldercast.schema.json`（机器可读）
 * 与 `docs/specs/SPEC-data-format.md`（人读）。**改一处必须同改三处**，见
 * docs/conventions/docs.md 第五节。
 *
 * 分析器与渲染器都依赖本模块，互不依赖对方（SYSTEM-DESIGN 三、模块边界）。
 */

/** 文件内容类别。与 schema 的 `$defs.kind` 一致，顺序也保持一致。 */
export const KIND_VALUES = [
  'code',
  'text',
  'markup',
  'data',
  'office',
  'pdf',
  'image',
  'video',
  'audio',
  'archive',
  'binary',
  'other',
] as const;

export type Kind = (typeof KIND_VALUES)[number];

const KIND_SET: ReadonlySet<string> = new Set(KIND_VALUES);

export function isKind(value: unknown): value is Kind {
  return typeof value === 'string' && KIND_SET.has(value);
}

/** 被讲解目录。 */
export type SourceRef = {
  /** 绝对路径。 */
  root: string;
  /** 展示用名称，默认取目录名。 */
  label?: string;
  /** 只讲这些子路径。第一版不可配置，保留字段。 */
  focus?: string[];
};

/** 内容筛选（需求维度 2）。写进解读的是**实际生效**的取值。 */
export type SourcesSpec = {
  /** 白名单 glob，空数组表示全目录。 */
  include?: string[];
  /** gitignore 风格，后面的规则覆盖前面的。 */
  exclude?: string[];
  /** 类型级开关，false 表示整类内容不参与。 */
  kinds?: Partial<Record<Kind, boolean>>;
  maxFiles?: number;
  maxFileSizeMb?: number;
  maxDepth?: number;
  /** 命中密钥判据但用户判定该读的文件。 */
  rescan?: string[];
};

export type SecretHit = {
  path: string;
  /** 命中的文件名模式。 */
  match: string;
};

export type Stats = {
  totalFiles: number;
  totalBytes: number;
  maxDepth: number;
  /** 与 kinds 枚举对应。 */
  kindCounts: Partial<Record<Kind, number>>;
  /** 密钥文件的排除审计（ADR 0007）。 */
  secrets: {
    excluded: SecretHit[];
    rescanned: string[];
  };
};

/** 文件清单的一条。路径相对 `source.root`。**只放机械事实**：看得见的、数得出来的。 */
export type ManifestEntry = {
  path: string;
  kind: Kind;
  bytes?: number;
  lines?: number;
  /** 截断预览，≤200 字。从标题、首个注释或首段提取，机械截断，不做语义判断。 */
  preview?: string;
  /** 已生成的素材路径（素材阶段填）。 */
  asset?: string;
};

export type VideoSpec = {
  width?: number;
  height?: number;
  fps?: number;
  targetDurationSec?: number | null;
  language?: string;
};

export type VoiceSpec = {
  provider?: string;
  voice?: string;
  style?: string;
  format?: 'wav' | 'mp3';
};

export type StyleSpec = {
  preset: string;
  overrides?: Record<string, string | number | boolean>;
  natural?: string;
  unresolved?: string[];
  resolvedAt?: string;
};

/** 目录解读文档。分析器的产物。 */
export type FoldercastDocument = {
  /** 格式版本。破坏性变更时递增。 */
  foldercast: 1;
  generatedAt: string;
  source: SourceRef;
  sources: SourcesSpec;
  stats: Stats;
  manifest: ManifestEntry[];
  /** 输出规格：由渲染阶段决定，分析器不产出。 */
  video?: VideoSpec;
  /** 配音配置：由叙事/配音阶段决定，分析器不产出。 */
  voice?: VoiceSpec;
  /** 风格：由写稿阶段决定，分析器不产出。 */
  style?: StyleSpec;
};

/** 目前唯一支持的格式版本。 */
export const FORMAT_VERSION = 1 as const;
