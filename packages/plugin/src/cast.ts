/**
 * `foldercast_cast` 的编排：目录 → 解读 → 素材 → 校验，一次调用把**事实层**做完。
 *
 * 边界（ADR 0008）：**编排层是模型，不是这个工具**。工具只做确定性的部分，并把
 * 「接下来该做什么」作为结构化结果返回 —— 写稿要判断，它做不了，所以它停在
 * `needsScript` 上，把 `script.json` 的路径与要求交回给 agent。
 *
 * 渲染（M7）与配音（M8）还没实现，所以工具不声称做完了整条管线，只报告自己做到哪。
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import {
  detectDependencies,
  readingPathFor,
  runStage,
  scriptPathFor,
  scriptsInstalled,
  workRootFor,
  type Dependency,
  type RunResult,
} from './runtime.ts';

/** 各阶段的预算。素材阶段最慢（要起 LibreOffice 引擎），其余都很快。 */
const TIMEOUT_MS: Readonly<Record<'analyze' | 'assets' | 'validate', number>> = {
  analyze: 300_000,
  assets: 600_000,
  validate: 120_000,
};

export type StageReport = {
  ok: boolean;
  /** 跑了多少毫秒。 */
  ms: number;
  /** 退出码。被取消或超时时**不出现**（宿主支持的 JSON Schema 子集没有可空类型）。 */
  exitCode?: number;
  /** 失败时的可操作说明。 */
  error?: string;
  /** 脚本摘要的最后几行，给模型看的证据。 */
  detail?: string;
};

export type ValidationIssue = {
  code: string;
  severity: 'blocker' | 'warning';
  message: string;
  path?: string;
  line?: number;
  sceneId?: string;
  fix?: string;
};

export type CastResult = {
  ok: boolean;
  target: string;
  label: string;
  /** 接下来该做什么：写稿（needsScript）还是校验已通过（validated）。 */
  next: 'needsScript' | 'validated' | 'fixScript' | 'blocked';
  /** 给模型看的一句话下一步。 */
  nextHint: string;
  readingPath: string;
  scriptPath: string;
  stages: { analyze: StageReport; assets?: StageReport; validate?: StageReport };
  dependencies: Dependency[];
  reading?: {
    files: number;
    bytes: number;
    kinds: Record<string, number>;
    languages: Record<string, number>;
    topDirs: { path: string; files: number }[];
    roots: string[];
    hubs: { path: string; in: number; out?: number }[];
    secretsSkipped: { path: string; match: string }[];
    assets: number;
  };
  validation?: { blocker: number; warning: number; issues: ValidationIssue[] };
};

type ReadingDocument = {
  source?: { root?: string; label?: string };
  stats?: {
    totalFiles?: number;
    totalBytes?: number;
    kindCounts?: Record<string, number>;
    languages?: Record<string, number>;
    topDirs?: { path: string; files: number }[];
    secrets?: { excluded?: { path: string; match: string }[] };
  };
  graph?: { roots?: string[]; hubs?: { path: string; in: number; out?: number }[] };
  manifest?: { asset?: string }[];
};

type ValidationReport = {
  counts?: { blocker?: number; warning?: number };
  issues?: {
    code?: string;
    severity?: string;
    message?: string;
    path?: string;
    line?: number;
    sceneId?: string;
    fix?: string;
  }[];
};

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

/** 脚本摘要：取最后几行非空输出，作为「到底发生了什么」的证据。 */
function summaryOf(result: RunResult): string | undefined {
  const lines = `${result.stdout}\n${result.stderr}`
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '');
  if (lines.length === 0) return undefined;
  return lines.slice(-6).join('\n');
}

function reportOf(result: RunResult): StageReport {
  return {
    ok: result.ok,
    ms: result.ms,
    // 被取消或超时时退出码没有意义，直接不出现（schema 里它是 integer，不是可空类型）
    ...(result.exitCode === null ? {} : { exitCode: result.exitCode }),
    ...(result.error === undefined ? {} : { error: result.error }),
    ...(summaryOf(result) === undefined ? {} : { detail: summaryOf(result) as string }),
  };
}

/**
 * 把一条流水线阶段的失败变成可操作的说明。
 *
 * 常见失败都有明确成因，这里逐个说清「谁的问题、怎么解」，而不是把脚本输出原样丢回去。
 */
function explainStage(stage: 'analyze' | 'assets' | 'validate', target: string, result: RunResult): string {
  const text = `${result.stdout}\n${result.stderr}`;
  if (text.includes('不是目录')) return `${target} 不是一个目录。传被讲解目录的绝对路径。`;
  if (text.includes('目录不存在')) return `目录不存在：${target}。`;
  if (text.includes('找不到命令 dsoffice') || text.includes('dsoffice')) {
    return `Office / PDF 转图需要 dsoffice（@deepseek-ai/libreoffice-kit）。装上后重试：pnpm add @deepseek-ai/libreoffice-kit；也可以先只分析目录（不加素材）。`;
  }
  if (text.includes('解读文件不存在')) {
    return '解读还没生成，先跑分析阶段。';
  }
  return result.error ?? `${stage} 阶段失败（退出码 ${String(result.exitCode)}）。`;
}

export type CastOptions = {
  target: string;
  signal?: AbortSignal;
  /** 材料阶段最多处理多少个文件（透传给 `assets --limit`）。 */
  assetLimit?: number;
  /** 跳过素材阶段，只做分析与校验。 */
  skipAssets?: boolean;
};

/**
 * 跑一次 cast 的事实层。
 *
 * 顺序固定：分析 → 素材 → 校验。**分析失败就不往下走**：后面两步都以解读为输入。
 * 素材失败不算致命 —— 解读仍然可用，只是讲稿引用不了画面，所以照常继续到校验。
 */
export async function cast(options: CastOptions): Promise<CastResult> {
  const target = resolve(options.target);
  const label = basename(target);
  const dependencies = await detectDependencies();
  const installed = scriptsInstalled();

  const base = {
    target,
    label,
    readingPath: readingPathFor(target),
    scriptPath: scriptPathFor(target),
    dependencies,
  };

  const node = dependencies.find((dependency) => dependency.name === 'node');
  if (node?.ok !== true || !installed.ok) {
    return {
      ok: false,
      ...base,
      next: 'blocked',
      nextHint: !installed.ok
        ? `插件包不完整，缺少：${installed.missing.join('、')}。重装 dsh-foldercast。`
        : (node?.hint ?? '需要 Node 22.19 以上。'),
      stages: { analyze: { ok: false, ms: 0, error: '环境不满足' } },
    };
  }

  const stats = statSync(target, { throwIfNoEntry: false });
  if (stats === undefined || !stats.isDirectory()) {
    return {
      ok: false,
      ...base,
      next: 'blocked',
      nextHint:
        stats === undefined
          ? `目录不存在：${target}。传一个存在的目录的绝对路径。`
          : `${target} 不是目录。传被讲解目录的绝对路径。`,
      stages: { analyze: { ok: false, ms: 0, error: '目标不是目录' } },
    };
  }

  // ── 分析 ────────────────────────────────────────────
  const analyzeRun = await runStage('analyze', {
    args: [target],
    timeoutMs: TIMEOUT_MS.analyze,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  const analyze = reportOf(analyzeRun);
  if (analyzeRun.cancelled === true) {
    return { ok: false, ...base, next: 'blocked', nextHint: '已取消。', stages: { analyze } };
  }
  if (!analyzeRun.ok) {
    return {
      ok: false,
      ...base,
      next: 'blocked',
      nextHint: explainStage('analyze', target, analyzeRun),
      stages: { analyze },
    };
  }

  const reading = readJson<ReadingDocument>(base.readingPath);

  // ── 素材（可选） ─────────────────────────────────────
  let assets: StageReport | undefined;
  if (options.skipAssets !== true) {
    const assetRun = await runStage('assets', {
      args: options.assetLimit === undefined ? [target] : [target, '--limit', String(options.assetLimit)],
      timeoutMs: TIMEOUT_MS.assets,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    assets = reportOf(assetRun);
    if (assetRun.cancelled === true) {
      return { ok: false, ...base, next: 'blocked', nextHint: '已取消（分析与素材的产物已保留，可以接着跑）。', stages: { analyze, assets } };
    }
    // 素材失败不致命：解读与讲稿仍可用，缺的是画面
  }

  const readingSummary = summarizeReading(reading);

  // ── 校验（有讲稿才跑） ───────────────────────────────
  if (!existsSync(base.scriptPath)) {
    return {
      ok: true,
      ...base,
      next: 'needsScript',
      nextHint:
        `解读已生成（${String(readingSummary.files)} 个文件）。下一步：按 foldercast skill 通读内容并写出 ${base.scriptPath}，` +
        `再调一次 foldercast_cast 校验；校验通过后由渲染阶段出片（渲染尚未实现）。`,
      stages: { analyze, ...(assets === undefined ? {} : { assets }) },
      reading: readingSummary,
    };
  }

  const validateRun = await runStage('validate', {
    args: [target, '--json'],
    timeoutMs: TIMEOUT_MS.validate,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  const validate = reportOf(validateRun);
  if (validateRun.cancelled === true) {
    return { ok: false, ...base, next: 'blocked', nextHint: '已取消。', stages: { analyze, ...(assets === undefined ? {} : { assets }), validate } };
  }

  const validation = parseValidation(validateRun.stdout);

  const stages = { analyze, ...(assets === undefined ? {} : { assets }), validate };
  if (validation.blocker > 0) {
    return {
      ok: false,
      ...base,
      next: 'fixScript',
      nextHint: `讲稿有 ${String(validation.blocker)} 个必须修的问题，见 validation.issues（每条都带文件与行号）。修好后重新调用 foldercast_cast。`,
      stages,
      reading: readingSummary,
      validation,
    };
  }

  return {
    ok: true,
    ...base,
    next: 'validated',
    nextHint:
      `解读与讲稿都通过校验（${String(validation.warning)} 个待确认项）。渲染与配音阶段尚未实现，` +
      `现在可以看 ${base.readingPath} 与 ${base.scriptPath}。`,
    stages,
    reading: readingSummary,
    validation,
  };
}

/**
 * 从校验器的 `--json` 报告里取结构化结论。
 *
 * 校验器把 JSON 打到 stdout，但它**有 blocker 时退出码是 1**（那是「校验没通过」这个
 * 事实，不是执行失败），所以这里不按退出码判断，直接读 stdout。
 */
function parseValidation(stdout: string): { blocker: number; warning: number; issues: ValidationIssue[] } {
  const start = stdout.indexOf('{');
  const parsed = start === -1 ? undefined : safeParse(stdout.slice(start));
  const report =
    typeof parsed === 'object' && parsed !== null ? (parsed as ValidationReport) : undefined;

  if (report === undefined) {
    return { blocker: 0, warning: 0, issues: [] };
  }

  const issues = (report.issues ?? []).map((issue) => ({
    code: issue.code ?? 'unknown',
    severity: issue.severity === 'warning' ? ('warning' as const) : ('blocker' as const),
    message: issue.message ?? '',
    ...(issue.path === undefined ? {} : { path: issue.path }),
    ...(issue.line === undefined ? {} : { line: issue.line }),
    ...(issue.sceneId === undefined ? {} : { sceneId: issue.sceneId }),
    ...(issue.fix === undefined ? {} : { fix: issue.fix }),
  }));

  return {
    blocker: report.counts?.blocker ?? 0,
    warning: report.counts?.warning ?? 0,
    issues: issues.slice(0, 40),
  };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** 解读里写稿阶段最需要的部分，摘成一段。 */
function summarizeReading(reading: ReadingDocument | undefined): NonNullable<CastResult['reading']> {
  const manifest = reading?.manifest ?? [];
  const assets = manifest.filter((entry) => entry.asset !== undefined).length;

  return {
    files: reading?.stats?.totalFiles ?? manifest.length,
    bytes: reading?.stats?.totalBytes ?? 0,
    kinds: reading?.stats?.kindCounts ?? {},
    languages: reading?.stats?.languages ?? {},
    topDirs: reading?.stats?.topDirs ?? [],
    roots: reading?.graph?.roots ?? [],
    hubs: reading?.graph?.hubs ?? [],
    secretsSkipped: reading?.stats?.secrets?.excluded ?? [],
    assets,
  };
}
