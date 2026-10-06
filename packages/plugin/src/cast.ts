/**
 * `foldercast_cast` 的编排：目录 → 解读 →（可选）素材，并**如实报告磁盘上现在有什么**。
 *
 * ## 边界（MVP 判据）
 *
 * 工具只做两件事：**跑确定性程序**、**报告事实**。
 *
 * - 它不判断「接下来该做什么」：结果里给的是产物清单与各自的机械状态（在不在、比讲稿新不新），
 *   该走哪一步由 skill 与模型决定。所以这里没有 `next` 枚举。
 * - 它不自动串昂贵的步骤：渲染要浏览器、动辄几分钟，配音要跑 TTS。两者都要**显式要求**
 *   （`render: true` / `voice: true`），否则只跑分析（与素材）。
 * - 编排层是模型，不是这个工具（ADR 0008）。
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { KEY_REFS } from '../scripts/contracts/durations.ts';
import {
  detectDependencies,
  durationsPathFor,
  narrationPathFor,
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

/** 产物在磁盘上的机械状态。`stale` 只在能比较时出现（见 `freshness`）。 */
export type ArtifactState = 'missing' | 'stale' | 'fresh';

/** 一件产物：在哪、在不在、多少字节、比它的上游新不新。 */
export type Artifact = {
  name: string;
  path: string;
  state: ArtifactState;
  bytes?: number;
  note?: string;
};

/**
 * 产物是否比它的上游新。两边都用 mtime —— 与「评审是否作废」同一套判据。
 * 上游不存在时无法比较，报 `fresh`（「文件在」这一事实本身是对的）。
 */
function freshness(productPath: string, sourcePath: string): ArtifactState {
  const product = statSync(productPath, { throwIfNoEntry: false });
  if (product === undefined) return 'missing';
  const source = statSync(sourcePath, { throwIfNoEntry: false });
  if (source === undefined) return 'fresh';
  return product.mtimeMs >= source.mtimeMs ? 'fresh' : 'stale';
}

function artifactOf(name: string, path: string, upstream?: string, note?: string): Artifact {
  const stats = statSync(path, { throwIfNoEntry: false });
  const state = upstream === undefined ? (stats === undefined ? 'missing' : 'fresh') : freshness(path, upstream);
  return {
    name,
    path,
    state,
    ...(stats === undefined ? {} : { bytes: stats.size }),
    ...(note === undefined ? {} : { note }),
  };
}

/**
 * 各阶段的预算。素材阶段最慢（要起 LibreOffice 引擎），**渲染阶段最久**：本机实测
 * 1920×1080 大约 7 帧/秒，5 分钟的片子（9000 帧）要 20 分钟出头，所以给足 40 分钟。
 */
const TIMEOUT_MS: Readonly<Record<'analyze' | 'assets' | 'validate' | 'render' | 'voice', number>> = {
  analyze: 300_000,
  assets: 600_000,
  validate: 120_000,
  render: 2_400_000,
  // 配音要逐场景调 TTS（云端有网络往返），大目录按每场景十几秒算，也给足 40 分钟
  voice: 2_400_000,
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
  /** 环境与目标可用、要求的阶段都成功。 */
  ok: boolean;
  target: string;
  label: string;
  /** 工作根：所有产物都在它下面。 */
  workRoot: string;
  /** 这次调用跑了哪些阶段，按执行顺序。 */
  ran: string[];
  /** 要求的阶段失败、或环境不满足时的一句话说明。 */
  error?: string;
  /** 磁盘上现在有什么，逐个报。这是模型决定下一步的全部依据。 */
  artifacts: Artifact[];
  stages: {
    analyze: StageReport;
    assets?: StageReport;
    validate?: StageReport;
    render?: StageReport;
    voice?: StageReport;
  };
  dependencies: Dependency[];
  reading?: {
    files: number;
    bytes: number;
    kinds: Record<string, number>;
    secretsSkipped: { path: string; match: string }[];
    /** 因为超量/超限没有进清单的文件数（0 表示这份解读覆盖了全部通过筛选的文件）。 */
    droppedByMaxFiles: number;
    skippedForSize: number;
    assets: number;
  };
  validation?: { blocker: number; warning: number; issues: ValidationIssue[] };
  /** 实际使用的 provider 与音色（从 `durations.json` 读，不是配置里写的）。 */
  voiceProvider?: string;
  voiceName?: string;
  /** 配音这一步的说明：为什么没配（缺 ffmpeg / say 等）。缺命令时出的是静音片。 */
  voiceNote?: string;
};

type ReadingDocument = {
  source?: { root?: string; label?: string };
  stats?: {
    totalFiles?: number;
    totalBytes?: number;
    kindCounts?: Record<string, number>;
    secrets?: { excluded?: { path: string; match: string }[] };
  };
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
  reading?: {
    droppedByMaxFiles?: number;
    skippedForSize?: number;
  };
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
  if (text.includes('dsoffice')) {
    return `Office / PDF 转图需要 dsoffice（@deepseek-ai/libreoffice-kit）。装上后重试：pnpm add @deepseek-ai/libreoffice-kit；也可以先只分析目录（传 skipAssets: true）。`;
  }
  if (text.includes('解读文件不存在')) return '解读还没生成，先跑分析阶段。';
  return result.error ?? `${stage} 阶段失败（退出码 ${String(result.exitCode)}）。`;
}

/**
 * 宿主凭据 seam 的一小块（结构类型，不 import `@deepseek-ai/dsh-*`）。
 *
 * **先 `describe` 再 `resolve`**：缺密钥时要在发起合成之前就能给引导 —— 等 401 的话
 * 错误措辞是外部给的，用户看不出该怎么办（rd 文档「key 未配置时的行为」）。
 */
export type CredentialsSeam = {
  describe: (ref: string) => Promise<{ configured: boolean; source?: string; writable: boolean }>;
  resolve: (ref: string) => Promise<{ value: string; source: string } | undefined>;
};

/** 缺密钥时的引导。与配音脚本里那份保持一致（两边都可能先碰到这个问题）。 */
function CREDENTIAL_HINT(ref: string): string {
  return [
    `没有找到凭据 ${ref}。三种办法：`,
    `  1. 在 DSH 里保存（设置 → 凭据）；`,
    `  2. 启动时给环境变量：${ref}=… dsh；`,
    `  3. 放到被讲解目录的 .env 里（项目级隔离靠它）。`,
    `也可以改用免密钥的默认 provider：再调一次时传 ttsProvider: "say"。`,
  ].join('\n');
}

export type CastOptions = {
  target: string;
  signal?: AbortSignal;
  /** 材料阶段最多处理多少个文件（透传给 `assets --limit`）。 */
  assetLimit?: number;
  /** 跳过素材阶段，只做分析。 */
  skipAssets?: boolean;
  /**
   * 出片。**默认不出**：渲染要浏览器、本机几分钟到几十分钟，必须是显式要求。
   * 渲染阶段自己会认 `durations.json` 与音轨，所以出片之前要不要配音由 `voice` 决定。
   */
  render?: boolean;
  /**
   * 配音。**默认不配**：要跑 TTS（云端有配额成本）。显式要求时，缺 ffmpeg / say / 密钥
   * 都只影响这一步，不影响已经产出的解读。
   */
  voice?: boolean;
  /** 覆盖 provider / 音色（透传给 `voice` 阶段）。 */
  ttsProvider?: string;
  ttsVoice?: string;
  /** 已存在的音频重新合成（会重新消耗配额）。 */
  forceVoice?: boolean;
  /** 宿主的凭据 seam。不给就只能靠环境变量与 `.env`（配音脚本自己也会找）。 */
  credentials?: CredentialsSeam;
  /** 讲稿里的配音配置（`voice.provider`）。工具从讲稿读一次，用来决定要不要查凭据。 */
  scriptVoice?: { provider?: string; voice?: string };
};

/** 产物清单：跑之前、跑之后都用同一个函数算，避免「跑完忘了更新」。 */
function collectArtifacts(target: string, options: { ranRender: boolean; ranVoice: boolean }): Artifact[] {
  const workRoot = workRootFor(target);
  const script = scriptPathFor(target);
  return [
    artifactOf('解读', readingPathFor(target)),
    artifactOf('素材清单', resolve(workRoot, 'assets', 'manifest.json')),
    artifactOf('讲稿', script),
    artifactOf('评审', reviewPathFor(target), script, '比讲稿旧就作废'),
    artifactOf('时长表', durationsPathFor(target), script, '比讲稿旧就要重配'),
    artifactOf('旁白音轨', narrationPathFor(target), script),
    artifactOf('成片', videoPathFor(target), script, options.ranRender ? '本次生成' : '比讲稿旧就要重出'),
  ];
}

/**
 * 跑一次 cast。
 *
 * 顺序固定：分析 →（可选）素材 →（有讲稿才）校验 →（显式要求才）配音 →（显式要求才）渲染。
 * **分析失败就不往下走**：后面每一步都以解读为输入。中间步骤失败不算致命，
 * 已经产出的解读照常交回去 —— 这正是「报告事实」的意思。
 */
export async function cast(options: CastOptions): Promise<CastResult> {
  const target = resolve(options.target);
  const label = basename(target);
  const workRoot = workRootFor(target);
  const dependencies = await detectDependencies();
  const installed = scriptsInstalled();

  const base = {
    target,
    label,
    workRoot,
    dependencies,
    ran: [] as string[],
  };

  const failed = (
    stage: 'analyze' | 'assets' | 'validate' | 'render' | 'voice',
    report: StageReport,
    error: string,
  ): CastResult => ({
    ok: false,
    ...base,
    error,
    artifacts: collectArtifacts(target, { ranRender: false, ranVoice: false }),
    stages: { [stage]: report } as CastResult['stages'],
  });

  const node = dependencies.find((dependency) => dependency.name === 'node');
  if (node?.ok !== true || !installed.ok) {
    const error =
      node?.ok !== true
        ? (node?.hint ?? '需要 Node 22.19 以上。')
        : `插件包不完整，缺少：${installed.missing.join('、')}。重装 dsh-foldercast。`;
    return failed('analyze', { ok: false, ms: 0, error: '环境不满足' }, error);
  }

  const stats = statSync(target, { throwIfNoEntry: false });
  if (stats === undefined || !stats.isDirectory()) {
    const error =
      stats === undefined
        ? `目录不存在：${target}。传一个存在的目录的绝对路径。`
        : `${target} 不是目录。传被讲解目录的绝对路径。`;
    return failed('analyze', { ok: false, ms: 0, error: '目标不是目录' }, error);
  }

  // ── 分析 ────────────────────────────────────────────
  const analyzeRun = await runStage('analyze', {
    args: [target, '--json'],
    json: true,
    timeoutMs: TIMEOUT_MS.analyze,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  const analyze = reportOf(analyzeRun);
  if (!analyzeRun.ok) {
    return failed('analyze', analyze, analyzeRun.cancelled === true ? '已取消。' : explainStage('analyze', target, analyzeRun));
  }

  const stages: CastResult['stages'] = { analyze };
  const ran = ['analyze'];

  // ── 素材（默认跑；失败不致命） ────────────────────────
  let assets: StageReport | undefined;
  if (options.skipAssets !== true) {
    const assetArgs = [target, ...(options.assetLimit === undefined ? [] : ['--limit', String(options.assetLimit)])];
    const assetsRun = await runStage('assets', {
      args: assetArgs,
      timeoutMs: TIMEOUT_MS.assets,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    assets = reportOf(assetsRun);
    stages.assets = assets;
    ran.push('assets');
  }

  const reading = readJson<ReadingDocument>(readingPathFor(target));
  const readingSummary = summarizeReading(reading);
  // 分析脚本的机器可读报告里有规模审计（丢了多少、跳过多少）——那是解读「有没有漏文件」的
  // 唯一凭据，解读本身不含它。拿得到就并进 reading 交回去。
  const analyzeReport = safeParse(analyzeRun.stdout) as
    | { report?: { droppedByMaxFiles?: number; skippedForSize?: number } }
    | undefined;
  if (readingSummary !== undefined && analyzeReport?.report !== undefined) {
    readingSummary.droppedByMaxFiles = analyzeReport.report.droppedByMaxFiles ?? 0;
    readingSummary.skippedForSize = analyzeReport.report.skippedForSize ?? 0;
  }

  const finish = (extra: Partial<CastResult> = {}): CastResult => ({
    ok: true,
    ...base,
    ran,
    artifacts: collectArtifacts(target, {
      ranRender: ran.includes('render'),
      ranVoice: ran.includes('voice'),
    }),
    stages,
    ...(readingSummary === undefined ? {} : { reading: readingSummary }),
    ...extra,
  });

  // ── 校验（有讲稿才跑） ───────────────────────────────
  // 校验结果**无论有没有 blocker 都要交回去**：0 个 blocker 是有意义的结论，
  // 而调用方要靠它判断「这份讲稿现在成立」。踩过一次：只在 blocker 分支挂上，
  // 通过时结果整段丢失，看起来像「校验没跑」。
  let validationReport: { blocker: number; warning: number; issues: ValidationIssue[] } | undefined;
  if (existsSync(scriptPathFor(target))) {
    const validateRun = await runStage('validate', {
      args: [target, '--json'],
      json: true,
      timeoutMs: TIMEOUT_MS.validate,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    const validate = reportOf(validateRun);
    stages.validate = validate;
    ran.push('validate');
    if (validateRun.cancelled === true) {
      return { ...finish(), ok: false, error: '已取消。' };
    }
    const validation = parseValidation(validateRun.stdout);
    validationReport = validation;
    // 有 blocker 就把问题原样交回去（每条都带文件、行号、场景 id），要不要改由模型判断
    if (validation !== undefined && validation.blocker > 0) {
      return {
        ...finish(validation === undefined ? {} : { validation }),
        ok: false,
        error: `讲稿有 ${String(validation.blocker)} 个必须修的问题。`,
      };
    }
  }

  // ── 配音（显式要求才跑） ─────────────────────────────
  if (options.voice === true) {
    if (!existsSync(scriptPathFor(target))) {
      return { ...finish(), ok: false, error: `还没有讲稿：${scriptPathFor(target)}。先写稿再配音。` };
    }

    const scriptVoice = options.scriptVoice ?? readScriptVoice(scriptPathFor(target));
    const wanted = options.ttsProvider ?? scriptVoice.provider ?? 'say';
    const missing = missingForVoice(wanted, dependencies);
    if (missing.length > 0) {
      const refs = KEY_REFS[wanted] ?? [];
      let voiceNote: string | undefined;
      for (const ref of refs) {
        if (options.credentials === undefined) break;
        const info = await options.credentials.describe(ref).catch(() => undefined);
        if (info !== undefined && !info.configured) {
          voiceNote = CREDENTIAL_HINT(ref);
          break;
        }
      }
      const note =
        voiceNote ??
        `配音需要这些命令：${missing.join('、')}。macOS 自带 say 与 ffmpeg 装上即可；也可以跳过配音（不传 voice）。`;
      return {
        ...finish({ voiceNote: note }),
        ok: false,
        error: note,
      };
    }

    const voiceArgs = [
      target,
      '--provider',
      wanted,
      ...(options.ttsVoice === undefined ? [] : ['--voice', options.ttsVoice]),
      ...(options.forceVoice === true ? ['--force'] : []),
    ];
    const voiceEnv = await resolveVoiceEnv(options, wanted);
    const voiceRun = await runStage('voice', {
      args: voiceArgs,
      timeoutMs: TIMEOUT_MS.voice,
      ...(voiceEnv === undefined ? {} : { env: voiceEnv }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    const voiceReport = reportOf(voiceRun);
    stages.voice = voiceReport;
    ran.push('voice');

    if (voiceRun.cancelled === true) {
      return { ...finish(), ok: false, error: '配音已取消。' };
    }
    if (!voiceRun.ok) {
      return { ...finish(), ok: false, error: explainVoice(voiceRun) };
    }
  }

  const withFacts: Partial<CastResult> = {
    ...(validationReport === undefined ? {} : { validation: validationReport }),
  };

  const durations = readDurations(durationsPathFor(target));
  const voiceFacts =
    durations === undefined
      ? { ...withFacts }
      : {
          ...withFacts,
          ...(durations.provider === undefined ? {} : { voiceProvider: durations.provider }),
          ...(durations.voice === undefined ? {} : { voiceName: durations.voice }),
        };

  // ── 渲染（显式要求才跑） ─────────────────────────────
  if (options.render === true) {
    if (!existsSync(scriptPathFor(target))) {
      return { ...finish(voiceFacts), ok: false, error: `还没有讲稿：${scriptPathFor(target)}。先写稿再出片。` };
    }

    const renderRun = await runStage('render', {
      args: [target, '--json'],
      json: true,
      timeoutMs: TIMEOUT_MS.render,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    const render = reportOf(renderRun);
    stages.render = render;
    ran.push('render');

    if (renderRun.cancelled === true) {
      return { ...finish(voiceFacts), ok: false, error: '渲染已取消（成片可能不完整；重跑即可覆盖）。' };
    }
    if (!renderRun.ok) {
      // `browser` 依赖不可用是这一步最常见的失败原因，且退出码 3 就是它的专用信号。
      const guidance = browserGuidance(renderRun) ?? explainRender(renderRun);
      return { ...finish(voiceFacts), ok: false, error: guidance };
    }
  }

  return finish(voiceFacts);
}

/** 配音要的环境变量：从凭据 seam 取到的 key 交给脚本（没有就是 undefined）。 */
async function resolveVoiceEnv(options: CastOptions, provider: string): Promise<Record<string, string> | undefined> {
  const refs = KEY_REFS[provider] ?? [];
  if (refs.length === 0 || options.credentials === undefined) return undefined;
  const env: Record<string, string> = {};
  for (const ref of refs) {
    const resolved = await options.credentials.resolve(ref).catch(() => undefined);
    if (resolved !== undefined) env[ref] = resolved.value;
  }
  return Object.keys(env).length === 0 ? undefined : env;
}

/** 缺浏览器时的引导：不静默下载，把三种办法交回给模型。 */
function browserGuidance(result: RunResult): string | undefined {
  const text = `${result.stdout}\n${result.stderr}`;
  if (!text.includes('浏览器') && !text.includes('browser')) return undefined;
  const lines = text
    .split('\n')
    .filter((line) => line.includes('remotion browser ensure') || line.includes('Chrome') || line.includes('FOLDERCAST'));
  return lines.length === 0 ? undefined : lines.join('\n');
}

function explainRender(result: RunResult): string {
  const summary = summaryOf(result);
  return summary === undefined ? `渲染失败（退出码 ${String(result.exitCode)}）。` : `渲染失败：\n${summary}`;
}

function missingForVoice(provider: string, dependencies: Dependency[]): string[] {
  const needed = provider === 'say' ? ['say', 'ffmpeg', 'ffprobe'] : ['ffmpeg', 'ffprobe'];
  return needed.filter((name) => dependencies.find((dependency) => dependency.name === name)?.ok !== true);
}

function readScriptVoice(scriptPath: string): { provider?: string; voice?: string } {
  const script = readJson<{ voice?: { provider?: string; voice?: string } }>(scriptPath);
  return script?.voice ?? {};
}

function readDurations(path: string): { provider?: string; voice?: string } | undefined {
  return readJson<{ provider?: string; voice?: string }>(path);
}

function credentialGuidance(result: RunResult): string | undefined {
  const text = `${result.stdout}\n${result.stderr}`;
  const ref = text.match(/[A-Z][A-Z0-9_]{3,}/)?.[0];
  return ref === undefined ? undefined : CREDENTIAL_HINT(ref);
}

function explainVoice(result: RunResult): string {
  // 退出码 4 是「缺密钥」的专用信号，给出的措辞比原始输出更可操作
  if (result.exitCode === 4) return credentialGuidance(result) ?? '配音缺少凭据。';
  const summary = summaryOf(result);
  return summary === undefined ? `配音失败（退出码 ${String(result.exitCode)}）。` : `配音失败：\n${summary}`;
}

function parseValidation(stdout: string): { blocker: number; warning: number; issues: ValidationIssue[] } | undefined {
  const report = safeParse(stdout) as ValidationReport | undefined;
  if (report === undefined || typeof report !== 'object') return undefined;
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
    blocker: report.counts?.blocker ?? issues.filter((issue) => issue.severity === 'blocker').length,
    warning: report.counts?.warning ?? issues.filter((issue) => issue.severity === 'warning').length,
    issues,
  };
}

/** 校验器的 stdout 前面可能有别的东西，取最后一个 JSON 对象。 */
function safeParse(text: string): unknown {
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  if (start === -1) return undefined;
  try {
    return JSON.parse(trimmed.slice(start));
  } catch {
    return undefined;
  }
}

function summarizeReading(reading: ReadingDocument | undefined): CastResult['reading'] | undefined {
  if (reading?.stats === undefined) return undefined;
  return {
    files: reading.stats.totalFiles ?? 0,
    bytes: reading.stats.totalBytes ?? 0,
    kinds: reading.stats.kindCounts ?? {},
    secretsSkipped: reading.stats.secrets?.excluded ?? [],
    droppedByMaxFiles: 0,
    skippedForSize: 0,
    assets: (reading.manifest ?? []).filter((entry) => entry.asset !== undefined).length,
  };
}
