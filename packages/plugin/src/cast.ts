/**
 * `foldercast_cast` 的编排：校验讲稿，并在**显式要求**时配音与出片。
 *
 * ## 边界
 *
 * - 工具不替模型探目录、不替模型写稿 —— 那是 agent 自己的事（它有 bash 与眼睛）。
 *   这里只做 agent 干不了的事：跑确定性程序（校验、TTS 合成、逐帧渲染）。
 * - 渲染与配音都不默认跑：渲染要浏览器、动辄几分钟；配音要跑 TTS。
 *   两者都要显式要求（`render: true` / `voice: true`），否则只做校验。
 * - 编排层是模型，不是这个工具。
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import type { FoldercastSettings } from './config.ts';
import {
  detectDependencies,
  durationsPathFor,
  runStage,
  scriptPathFor,
  scriptsInstalled,
  videoPathFor,
  workRootFor,
  type Dependency,
  type RunResult,
} from './runtime.ts';

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
  /** 这次调用跑了哪些步骤，按执行顺序。 */
  ran: string[];
  /** 要求的步骤失败、或环境不满足时的一句话说明。 */
  error?: string;
  dependencies: Dependency[];
  stages: {
    check?: StageReport;
    voice?: StageReport;
    render?: StageReport;
  };
  validation?: { blocker: number; warning: number; issues: ValidationIssue[] };
  /** 实际使用的音色（从 `durations.json` 读，不是配置里写的）。 */
  voiceName?: string;
  /** 成片落点（渲染成功时才有意义）。 */
  videoPath?: string;
  /** 给模型看的一句话说明（比如「配置选了未实现的 provider」）。 */
  notes?: string[];
};

/** 各步骤的预算。渲染最久：本机实测 13–15 帧/秒，预算按更慢的机器留足余量。 */
const TIMEOUT_MS: Readonly<Record<'check' | 'render' | 'voice', number>> = {
  check: 120_000,
  render: 2_400_000,
  // 配音逐场景调 TTS，大目录按每场景十几秒算
  voice: 2_400_000,
};

export type CastOptions = {
  target: string;
  signal?: AbortSignal;
  /** 出片。**默认不出**：渲染要浏览器、本机几分钟到几十分钟，必须是显式要求。 */
  render?: boolean;
  /** 配音。**默认不配**：要跑云端 TTS 与 ffmpeg。 */
  voice?: boolean;
  /** 音色名（provider 各自的叫法）。缺省用默认中文音色。 */
  voiceName?: string;
  /** 已存在的音频重新合成。 */
  forceVoice?: boolean;
  /**
   * 设置页解析出来的值（`config.ts`）。全部可选：没配就是默认行为。
   * 优先级：**工具调用显式给的 > 讲稿里的 > 这里**。
   */
  settings?: FoldercastSettings;
};

type ValidationReportIssue = {
  code?: string;
  severity?: string;
  message?: string;
  path?: string;
  sceneId?: string;
  fix?: string;
};

/** 渲染脚本的报告（`--check` 与真渲染同一形状，校验摘要在 `check` 字段里）。 */
type ReportShape = {
  check?: { blocker?: number; warning?: number; issues?: ValidationReportIssue[] };
  blocker?: number;
  warning?: number;
  issues?: ValidationReportIssue[];
};

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
    ...(result.exitCode === null ? {} : { exitCode: result.exitCode }),
    ...(result.error === undefined ? {} : { error: result.error }),
    ...(summaryOf(result) === undefined ? {} : { detail: summaryOf(result) as string }),
  };
}

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

/** 脚本的 stdout 前面可能有别的东西（pnpm 前言、进度行），取最后一个 JSON 对象。 */
function parseReport(stdout: string): ReportShape | undefined {
  const matches = [...stdout.matchAll(/^\{.*^\}$/gms)];
  if (matches.length === 0) return undefined;
  for (const match of matches.reverse()) {
    try {
      return JSON.parse(match[0]) as ReportShape;
    } catch {
      continue;
    }
  }
  return undefined;
}

function parseValidation(stdout: string): CastResult['validation'] | undefined {
  const report = parseReport(stdout);
  if (report === undefined) return undefined;
  const check = report.check ?? report;
  const issues = (check.issues ?? []).map((issue) => ({
    code: issue.code ?? 'unknown',
    severity: issue.severity === 'warning' ? ('warning' as const) : ('blocker' as const),
    message: issue.message ?? '',
    ...(issue.path === undefined ? {} : { path: issue.path }),
    ...(issue.sceneId === undefined ? {} : { sceneId: issue.sceneId }),
    ...(issue.fix === undefined ? {} : { fix: issue.fix }),
  }));
  return {
    blocker: check.blocker ?? issues.filter((issue) => issue.severity === 'blocker').length,
    warning: check.warning ?? issues.filter((issue) => issue.severity === 'warning').length,
    issues,
  };
}

/** 缺浏览器时的引导：渲染脚本已经给了一句完整的话，从输出里把它捞出来。 */
function browserGuidance(result: RunResult): string | undefined {
  const text = `${result.stdout}\n${result.stderr}`;
  if (!text.includes('浏览器') && !text.includes('browser')) return undefined;
  const lines = text
    .split('\n')
    .filter((line) => line.includes('remotion browser ensure') || line.includes('Chrome') || line.includes('FOLDERCAST'));
  return lines.length === 0 ? undefined : lines.join('\n');
}

/**
 * 跑一次 cast。
 *
 * 顺序固定：校验（有讲稿才跑）→（显式要求才）配音 →（显式要求才）渲染。
 * 中间步骤失败不算致命，已经得出的校验结论照常交回去。
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

  const failed = (error: string): CastResult => ({
    ok: false,
    ...base,
    error,
    stages: {},
  });

  const node = dependencies.find((dependency) => dependency.name === 'node');
  if (node?.ok !== true || !installed.ok) {
    const error =
      node?.ok !== true
        ? (node?.hint ?? '需要 Node 22.19 以上。')
        : `插件包不完整，缺少：${installed.missing.join('、')}。先重启 DSH（宿主可能还在跑改动前的旧入口）；重启后仍报此错，再重装 dsh-foldercast。`;
    return failed(error);
  }

  const stats = statSync(target, { throwIfNoEntry: false });
  if (stats === undefined || !stats.isDirectory()) {
    const error =
      stats === undefined
        ? `目录不存在：${target}。传一个存在的目录的绝对路径。`
        : `${target} 不是目录。传被讲解目录的绝对路径。`;
    return failed(error);
  }

  const scriptPath = scriptPathFor(target);
  const stages: CastResult['stages'] = {};
  const ran: string[] = [];
  const notes: string[] = [];

  const finish = (extra: Partial<CastResult> = {}): CastResult => ({
    ok: true,
    ...base,
    ran,
    stages,
    ...(notes.length === 0 ? {} : { notes }),
    ...extra,
  });

  // ── 校验（有讲稿才跑） ───────────────────────────────
  // 结果**无论有没有 blocker 都要交回去**：0 个 blocker 是有意义的结论。
  let validation: CastResult['validation'];
  if (existsSync(scriptPath)) {
    const checkRun = await runStage('render', {
      args: [target, '--check', '--json'],
      json: true,
      timeoutMs: TIMEOUT_MS.check,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    const check = reportOf(checkRun);
    stages.check = check;
    ran.push('check');
    if (checkRun.cancelled === true) {
      return { ...finish(), ok: false, error: '已取消。' };
    }
    validation = parseValidation(checkRun.stdout);
    if (validation !== undefined && validation.blocker > 0) {
      return {
        ...finish(validation === undefined ? {} : { validation }),
        ok: false,
        error: `讲稿有 ${String(validation.blocker)} 个必须修的问题（见 validation.issues）。`,
      };
    }
  }

  // ── 配音（显式要求才跑） ─────────────────────────────
  if (options.voice === true) {
    if (!existsSync(scriptPath)) {
      return { ...finish(validation === undefined ? {} : { validation }), ok: false, error: `还没有讲稿：${scriptPath}。先写稿再配音。` };
    }
    // provider 由设置页定（`--provider` 透传，默认 edge，注册表外的引擎在那里报错）。
    // 这里只预检 ffmpeg / ffprobe；provider 自身的依赖（如 mimo 的密钥）由它的
    // preflight 报（带引导，缺密钥用专用退出码 4）。
    const missing = ['ffmpeg' as const, 'ffprobe' as const].filter(
      (name) => dependencies.find((dependency) => dependency.name === name)?.ok !== true,
    );
    if (missing.length > 0) {
      const note = `配音需要这些命令：${missing.join('、')}（macOS：brew install ffmpeg）。也可以跳过配音（不传 voice，出静音片）。`;
      return { ...finish({ ...(validation === undefined ? {} : { validation }) }), ok: false, error: note };
    }
    const scriptVoice = readScriptVoice(scriptPath);
    const wanted = options.voiceName ?? scriptVoice.voice ?? options.settings?.voiceName;
    const style = scriptVoice.style ?? options.settings?.voiceStyle;
    const voiceRun = await runStage('voice', {
      args: [
        target,
        '--json',
        ...(options.settings?.provider === undefined ? [] : ['--provider', options.settings.provider]),
        ...(wanted === undefined ? [] : ['--voice', wanted]),
        ...(style === undefined ? [] : ['--style', style]),
        ...(options.forceVoice === true ? ['--force'] : []),
      ],
      json: true,
      timeoutMs: TIMEOUT_MS.voice,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    stages.voice = reportOf(voiceRun);
    ran.push('voice');
    if (voiceRun.cancelled === true) {
      return { ...finish(), ok: false, error: '配音已取消。' };
    }
    if (!voiceRun.ok) {
      return { ...finish(), ok: false, error: summaryOf(voiceRun) ?? '配音失败。' };
    }
  }

  const durations = readJson<{ provider?: string; voice?: string }>(durationsPathFor(target));
  const voiceFacts =
    durations === undefined
      ? {}
      : {
          ...(durations.voice === undefined ? {} : { voiceName: durations.voice }),
        };

  // ── 渲染（显式要求才跑） ─────────────────────────────
  if (options.render === true) {
    if (!existsSync(scriptPath)) {
      return { ...finish({ ...voiceFacts, ...(validation === undefined ? {} : { validation }) }), ok: false, error: `还没有讲稿：${scriptPath}。先写稿再出片。` };
    }
    const renderRun = await runStage('render', {
      args: [
        target,
        '--json',
        ...(options.settings?.concurrency === undefined ? [] : ['--concurrency', String(options.settings.concurrency)]),
      ],
      json: true,
      timeoutMs: TIMEOUT_MS.render,
      ...(options.settings?.browserPath === undefined
        ? {}
        : { env: { FOLDERCAST_BROWSER: options.settings.browserPath } }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    stages.render = reportOf(renderRun);
    ran.push('render');
    if (renderRun.cancelled === true) {
      return { ...finish({ ...voiceFacts }), ok: false, error: '渲染已取消（成片可能不完整；重跑即可覆盖）。' };
    }
    if (!renderRun.ok) {
      // `browser` 依赖不可用是这一步最常见的失败原因，退出码 3 是它的专用信号
      const guidance = browserGuidance(renderRun) ?? summaryOf(renderRun) ?? `渲染失败（退出码 ${String(renderRun.exitCode)}）。`;
      return { ...finish({ ...voiceFacts }), ok: false, error: guidance };
    }
  }

  return finish({
    ...voiceFacts,
    ...(validation === undefined ? {} : { validation }),
    videoPath: videoPathFor(target),
    ...(notes.length === 0 ? {} : { notes }),
  });
}

/** 讲稿里的配音配置：音色与「怎么读」。设置页的值只在讲稿没写时兜底。 */
function readScriptVoice(scriptPath: string): { voice?: string; style?: string } {
  return readJson<{ voice?: { voice?: string; style?: string } }>(scriptPath)?.voice ?? {};
}
