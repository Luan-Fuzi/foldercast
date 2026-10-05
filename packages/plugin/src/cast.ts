/**
 * `foldercast_cast` 的编排：目录 → 解读 → 素材 → （有讲稿就）校验 → 评审通过后出片，
 * 一次调用把**确定性部分**做完。
 *
 * 边界（ADR 0008）：**编排层是模型，不是这个工具**。工具只做确定性的部分，并把
 * 「接下来该做什么」作为结构化结果返回 —— 写稿与评审要判断，它做不了，所以它停在
 * `needsScript` / `needsReview` 上，把路径与要求交回给 agent。
 *
 * 渲染（M7）需要浏览器，是唯一可能因环境而不可用的一步：缺浏览器时**不静默下载**，
 * 返回结构化引导（`next: blocked`），其余阶段照常。配音（M8）尚未实现。
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import {
  detectDependencies,
  htmlPathFor,
  readingPathFor,
  reviewPathFor,
  runStage,
  scriptPathFor,
  scriptsInstalled,
  videoPathFor,
  workRootFor,
  type Dependency,
  type RunResult,
} from './runtime.ts';

/**
 * 评审结论的状态（M5）。
 *
 * 评审是 agent 干的（skill 第六步），工具不跑它，但要如实报告「有没有、是不是比讲稿旧」——
 * 改过讲稿之后旧评审就作废了，这一点不查就会被当成「审过了」。
 */
function reviewState(reviewPath: string, scriptPath: string): 'missing' | 'stale' | 'fresh' {
  return freshness(reviewPath, scriptPath);
}

/**
 * 成片的状态（M7）。**渲染是最贵的一步**（本机 5 分钟的片子要 20 分钟），所以「已经出过片
 * 且讲稿没再改」时直接报状态、**不重渲**。判据与评审相同：产物 mtime ≥ 讲稿 mtime 即 fresh。
 *
 * 这一条不做，agent 每次调工具都会重渲一遍整片 —— 那既费时间，也让「出片」变成不可预期的重活。
 */
function videoState(videoPath: string, scriptPath: string): 'missing' | 'stale' | 'fresh' {
  return freshness(videoPath, scriptPath);
}

/** 产物是否比源新。两边都用 mtime，与评审那一套保持一致。 */
function freshness(productPath: string, sourcePath: string): 'missing' | 'stale' | 'fresh' {
  const product = statSync(productPath, { throwIfNoEntry: false });
  if (product === undefined) return 'missing';
  const source = statSync(sourcePath, { throwIfNoEntry: false });
  if (source === undefined) return 'stale';
  return product.mtimeMs >= source.mtimeMs ? 'fresh' : 'stale';
}

/**
 * 各阶段的预算。素材阶段最慢（要起 LibreOffice 引擎），**渲染阶段最久**：本机实测
 * 1920×1080 大约 7 帧/秒，5 分钟的片子（9000 帧）要 20 分钟出头，所以给足 40 分钟。
 */
const TIMEOUT_MS: Readonly<Record<'analyze' | 'assets' | 'validate' | 'html' | 'render', number>> = {
  analyze: 300_000,
  assets: 600_000,
  validate: 120_000,
  html: 120_000,
  render: 2_400_000,
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
  /**
   * 接下来该做什么：写稿（`needsScript`）、评审（`needsReview`）、讲稿要改（`fixScript`）、
   * 讲稿审过但还没出片（`validated`）、出片完成（`rendered`）、环境或目标有问题（`blocked`）。
   */
  next: 'needsScript' | 'needsReview' | 'validated' | 'rendered' | 'fixScript' | 'blocked';
  /** 给模型看的一句话下一步。 */
  nextHint: string;
  readingPath: string;
  scriptPath: string;
  /** HTML 视图的落点（M6）：一个自包含的静态页面，随时可以打开看。 */
  htmlPath: string;
  /** 页面的字节数；没生成成功时不出现在结果里。 */
  htmlBytes?: number;
  /** 成片的落点（M7）：静音 mp4。 */
  videoPath: string;
  /** 成片的字节数；没渲染成功时不出现在结果里。 */
  videoBytes?: number;
  /** 成片的状态：`missing` 还没出片、`stale` 出过但讲稿又改了、`fresh` 对应当前这版讲稿。 */
  video: 'missing' | 'stale' | 'fresh';
  /** 评审结论的落点（M5）。有没有、是否比讲稿旧，看 `review`。 */
  reviewPath: string;
  /** 评审结论的状态：`missing` 还没审、`stale` 审过但讲稿又改了、`fresh` 审的是当前这版。 */
  review: 'missing' | 'stale' | 'fresh';
  stages: {
    analyze: StageReport;
    assets?: StageReport;
    html?: StageReport;
    validate?: StageReport;
    render?: StageReport;
  };
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
  /**
   * 跳过渲染阶段。评审通过后默认就出片；`skipRender` 用于「只要事实层与页面」的场合
   * （快很多：本机 5 分钟的片子要 20 分钟渲染）。
   */
  skipRender?: boolean;
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
    htmlPath: htmlPathFor(target),
    videoPath: videoPathFor(target),
    video: videoState(videoPathFor(target), scriptPathFor(target)),
    reviewPath: reviewPathFor(target),
    review: reviewState(reviewPathFor(target), scriptPathFor(target)),
    dependencies,
  };

  const node = dependencies.find((dependency) => dependency.name === 'node');
  if (node?.ok !== true || !installed.ok) {
    return {
      ok: false,
      ...base,
      next: 'blocked',
      // 先报 Node：Node 不合适时选的脚本入口本来就不一样，这时说「包不完整」是误导
      nextHint:
        node?.ok !== true
          ? (node?.hint ?? '需要 Node 22.19 以上。')
          : `插件包不完整，缺少：${installed.missing.join('、')}。重装 dsh-foldercast。`,
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

  // ── HTML 视图（M6） ─────────────────────────────────
  // 只读解读与素材，**不依赖讲稿**：写完稿之前就该有东西能看。失败不致命，如实报出来即可。
  const htmlRun = await runStage('html', {
    args: [target],
    timeoutMs: TIMEOUT_MS.html,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  const html = reportOf(htmlRun);
  const htmlStat = statSync(base.htmlPath, { throwIfNoEntry: false });

  const readingSummary = summarizeReading(reading);
  const stages = {
    analyze,
    ...(assets === undefined ? {} : { assets }),
    html,
  };
  const withHtml = htmlStat === undefined ? {} : { htmlBytes: htmlStat.size };

  // ── 校验（有讲稿才跑） ───────────────────────────────
  if (!existsSync(base.scriptPath)) {
    return {
      ok: true,
      ...base,
      ...withHtml,
      next: 'needsScript',
      nextHint:
        `解读已生成（${String(readingSummary.files)} 个文件）${htmlRun.ok ? `，页面在 ${base.htmlPath}` : ''}。` +
        `下一步：按 foldercast skill 通读内容并写出 ${base.scriptPath}，再调一次 foldercast_cast 校验；` +
        `视频与配音尚未实现（M7 / M8）。`,
      stages,
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
    return { ok: false, ...base, ...withHtml, next: 'blocked', nextHint: '已取消。', stages: { ...stages, validate } };
  }

  const validation = parseValidation(validateRun.stdout);

  const allStages = { ...stages, validate };
  if (validation.blocker > 0) {
    return {
      ok: false,
      ...base,
      ...withHtml,
      next: 'fixScript',
      nextHint: `讲稿有 ${String(validation.blocker)} 个必须修的问题，见 validation.issues（每条都带文件与行号）。修好后重新调用 foldercast_cast。`,
      stages: allStages,
      reading: readingSummary,
      validation,
    };
  }

  // 讲稿通过了，但评审（skill 第六步）是 agent 干的，工具只能如实报告它的状态：
  // 没审过、或者审过之后讲稿又改了，都还不能算完成。
  if (base.review !== 'fresh') {
    return {
      ok: true,
      ...base,
      ...withHtml,
      next: 'needsReview',
      nextHint:
        `解读与讲稿都通过校验（${String(validation.warning)} 个待确认项）。` +
        `下一步：按 skill 的评审判据起一个独立 subagent 评审，结论写到 ${base.reviewPath}` +
        `${base.review === 'stale' ? '（现有结论早于当前讲稿，已作废）' : ''}。` +
        `页面已经生成（${base.htmlPath}），视频与配音尚未实现（M7 / M8）。`,
      stages: allStages,
      reading: readingSummary,
      validation,
    };
  }

  // ── 渲染（M7，评审通过才跑） ─────────────────────────
  // 出片是「讲稿 + 评审都齐了」之后才有意义的一步，所以放在最后。缺浏览器是**预期内的
  // 环境状态**：不静默下载，把渲染脚本给出的结构化引导原样交回给模型。
  if (options.skipRender === true) {
    return {
      ok: true,
      ...base,
      ...withHtml,
      next: 'validated',
      nextHint:
        `解读、讲稿与评审都齐了（${String(validation.warning)} 个待确认项），按 skipRender 跳过了出片。` +
        `要出片就再调一次 foldercast_cast（不传 skipRender），或用 pnpm render ${target}。`,
      stages: allStages,
      reading: readingSummary,
      validation,
    };
  }

  // 已经出过片、讲稿没再改 → 不重渲，直接报现状。想强制重出就先把成片删掉。
  if (base.video === 'fresh') {
    const existing = statSync(base.videoPath, { throwIfNoEntry: false });
    return {
      ok: true,
      ...base,
      ...withHtml,
      ...(existing === undefined ? {} : { videoBytes: existing.size }),
      next: 'rendered',
      nextHint:
        `成片已经是最新的：${base.videoPath}（静音 mp4）。讲稿没改就不必重渲；` +
        `改了讲稿再调一次即可（旧成片会被覆盖）。`,
      stages: allStages,
      reading: readingSummary,
      validation,
    };
  }

  const renderRun = await runStage('render', {
    args: [target, '--json'],
    timeoutMs: TIMEOUT_MS.render,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  const render = reportOf(renderRun);
  const renderStages = { ...allStages, render };
  const videoStat = statSync(base.videoPath, { throwIfNoEntry: false });
  const withVideo = videoStat === undefined ? {} : { videoBytes: videoStat.size };

  if (renderRun.cancelled === true) {
    return {
      ok: false,
      ...base,
      ...withHtml,
      next: 'blocked',
      nextHint: '已取消（渲染到一半，成片可能不完整；重跑即可覆盖）。',
      stages: renderStages,
      reading: readingSummary,
      validation,
    };
  }

  if (!renderRun.ok || videoStat === undefined) {
    // `browser` 依赖不可用是这一步最常见的失败原因，且退出码 3 就是它的专用信号。
    const guidance = browserGuidance(renderRun) ?? explainRender(renderRun);
    return {
      ok: false,
      ...base,
      ...withHtml,
      ...withVideo,
      next: 'blocked',
      nextHint: guidance,
      stages: renderStages,
      reading: readingSummary,
      validation,
    };
  }

  return {
    ok: true,
    ...base,
    ...withHtml,
    ...withVideo,
    // 刚渲完，成片一定比讲稿新 —— 状态要按**渲染之后**的磁盘情况报，不能用函数开头那份
    // （那里还是 missing/stale，报出去会让调用方以为没出片）
    video: 'fresh',
    next: 'rendered',
    nextHint:
      `成片已生成：${base.videoPath}（${String(Math.round(videoStat.size / 1024))} KB，静音）。` +
      `配音还没做（M8）：要加旁白就装好 TTS provider 后重跑配音阶段。` +
      `讲稿改了要重新出片 —— 再调一次 foldercast_cast 即可。`,
    stages: renderStages,
    reading: readingSummary,
    validation,
  };
}

/** 渲染脚本缺浏览器时会把引导写在 stderr/stdout 里；把它原样交给模型。 */
function browserGuidance(result: RunResult): string | undefined {
  const text = `${result.stdout}\n${result.stderr}`;
  if (!text.includes('渲染需要浏览器')) return undefined;
  const start = text.indexOf('渲染需要浏览器');
  return text.slice(start).trim();
}

/** 渲染失败的兜底说明：把脚本最后几行交回去，别只说一句「失败了」。 */
function explainRender(result: RunResult): string {
  const detail = summaryOf(result);
  return detail === undefined
    ? `渲染阶段失败（退出码 ${String(result.exitCode)}）。`
    : `渲染阶段失败（退出码 ${String(result.exitCode)}）：\n${detail}`;
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
