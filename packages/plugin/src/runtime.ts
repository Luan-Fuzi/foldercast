/**
 * 运行环境：定位脚本、探测外部依赖、执行子进程。
 *
 * **三条硬规则**（都在这里落实）：
 * 1. `apply()` 里不做任何可能失败的重活 —— 探测推迟到首次工具调用。
 * 2. **必须响应 `exec.signal`**：收到取消就杀掉子进程，不只是置标志位。
 * 3. 子进程调用**完整 try/catch**，不留悬空 Promise —— 未处理的 rejection 会杀掉 harness
 *    进程（INTEGRATION §3.7）。
 *
 * 分析、素材、校验都以子进程跑，不在 harness 进程内 import：遍历几万个文件、起
 * LibreOffice 引擎都不该占宿主进程（INTEGRATION §一）。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 包根：本文件在 `src/` 下。脚本与随包 schema 都相对它定位。 */
export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export type StageName = 'analyze' | 'assets' | 'validate';

const STAGE_ENTRY: Readonly<Record<StageName, string>> = {
  analyze: 'scripts/analyzer/main.ts',
  assets: 'scripts/assets/main.ts',
  validate: 'scripts/validate/main.ts',
};

export function stageEntryPath(stage: StageName): string {
  return resolve(PACKAGE_ROOT, STAGE_ENTRY[stage]);
}

/** 工作根：所有产物都在 `<源目录>/.foldercast/` 下（SPEC-data-format.md 工作目录）。 */
export function workRootFor(target: string): string {
  return resolve(target, '.foldercast');
}

export function readingPathFor(target: string): string {
  return resolve(workRootFor(target), 'foldercast.json');
}

export function scriptPathFor(target: string): string {
  return resolve(workRootFor(target), 'script.json');
}

export type DependencyName = 'node' | 'dsoffice' | 'ffmpeg' | 'sips';

export type Dependency = {
  name: DependencyName;
  ok: boolean;
  /** 不 ok 时：缺什么、怎么装。缺依赖不该只是报错，要给出下一步。 */
  hint: string;
  required: boolean;
};

/** 随包的脚本入口是否都在。缺了说明包装坏了，不是用户环境问题。 */
export function scriptsInstalled(): { ok: boolean; missing: string[] } {
  const missing = (Object.keys(STAGE_ENTRY) as StageName[])
    .map((stage) => STAGE_ENTRY[stage])
    .filter((relative) => !existsSync(resolve(PACKAGE_ROOT, relative)));

  return { ok: missing.length === 0, missing };
}

/**
 * `dsoffice` 来自 `@deepseek-ai/libreoffice-kit`，是 optionalDependency：
 * 装不上时 office/pdf 的转图与文本提取不可用，其他类型照常。
 */
function dsofficePath(): string | undefined {
  const candidate = resolve(PACKAGE_ROOT, 'node_modules/.bin/dsoffice');
  return existsSync(candidate) ? candidate : undefined;
}

/**
 * 可执行文件在不在。
 *
 * 判据是 spawn 有没有报 `ENOENT`，**不看退出码**：`sips -h` 之类会以非零码退出，
 * 但那说明命令是存在的。所以 `close` 事件一律算「有」。
 */
function hasExecutable(command: string, versionFlag: string): Promise<boolean> {
  return new Promise<boolean>((resolvePromise) => {
    try {
      const child = spawn(command, [versionFlag], { stdio: 'ignore' });
      child.on('error', () => resolvePromise(false));
      child.on('close', () => resolvePromise(true));
    } catch {
      resolvePromise(false);
    }
  });
}

/**
 * 首次调用时探测环境。
 *
 * **只有 Node 与随包脚本是硬条件**：其余缺失都降级（office/pdf 素材、视频关键帧），
 * 不影响解读本身。所以这里返回的是「各自能不能用」，不是一句「环境不满足」。
 */
export async function detectDependencies(): Promise<Dependency[]> {
  const nodeMajor = Number(process.versions.node.split('.')[0] ?? '0');
  const nodeOk = nodeMajor >= 22;

  const dsoffice = dsofficePath();
  const deps: Dependency[] = [
    {
      name: 'node',
      ok: nodeOk,
      required: true,
      hint: nodeOk
        ? `Node ${process.versions.node}`
        : `需要 Node 22.19 以上（当前 ${process.versions.node}）：脚本直接用 TypeScript，靠 Node 的类型剥离运行。`,
    },
    {
      name: 'dsoffice',
      ok: dsoffice !== undefined,
      required: false,
      hint:
        dsoffice === undefined
          ? 'Office / PDF 的逐页图与文本提取需要它。它来自 @deepseek-ai/libreoffice-kit，是可选依赖；装上后重试：pnpm add @deepseek-ai/libreoffice-kit'
          : 'Office / PDF 转图可用。',
    },
    {
      name: 'ffmpeg',
      ok: await hasExecutable('ffmpeg', '-version'),
      required: false,
      hint: '视频抽帧与实测时长需要 ffmpeg（macOS：brew install ffmpeg）。缺它时视频仍进解读，只是没有关键帧。',
    },
    {
      name: 'sips',
      ok: await hasExecutable('sips', '-h'),
      required: false,
      hint: 'sips 是 macOS 自带的图片工具；其他平台会把图片缩放回退到 ffmpeg。',
    },
  ];

  return deps;
}

export type RunResult = {
  ok: boolean;
  exitCode: number | null;
  /** 被杀掉时的信号名（如 SIGTERM）。 */
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  ms: number;
  /** 执行失败的原因（可操作）。 */
  error?: string;
  /** 被调用方取消。 */
  cancelled?: boolean;
};

export type RunOptions = {
  args: readonly string[];
  timeoutMs: number;
  signal?: AbortSignal;
  /** 工作目录，默认包根。 */
  cwd?: string;
};

/** 输出留多少字符给模型看：够定位问题，又不会把上下文塞满。 */
const OUTPUT_TAIL = 4000;

function tail(text: string, limit = OUTPUT_TAIL): string {
  const trimmed = text.trimEnd();
  return trimmed.length <= limit ? trimmed : `…（前文省略）\n${trimmed.slice(-limit)}`;
}

/**
 * 跑一个随包脚本。
 *
 * **非零退出不是异常**：它是要交给模型解读的事实（分析器有失败项、校验有 blocker、
 * 目录不存在），所以照常返回结构化的 `RunResult`。只有「子进程根本起不来」才是基础设施
 * 故障，那种情况让 Promise 拒绝，由工具层抛出。
 */
export function runStage(stage: StageName, options: RunOptions): Promise<RunResult> {
  const entry = stageEntryPath(stage);
  const started = Date.now();

  // 信号可能**在调用之前就已取消**（模型点了停止、上一阶段刚被取消）。不先查这一下，
  // 监听器永远等不到事件，子进程白跑一趟。
  if (options.signal?.aborted === true) {
    return Promise.resolve({
      ok: false,
      exitCode: null,
      signal: null,
      stdout: '',
      stderr: '',
      ms: 0,
      cancelled: true,
      error: `${stage} 阶段被取消。`,
    });
  }

  return new Promise<RunResult>((resolvePromise, rejectPromise) => {
    let child;
    try {
      child = spawn(process.execPath, [entry, ...options.args], {
        cwd: options.cwd ?? PACKAGE_ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      rejectPromise(new Error(`无法启动 ${stage} 阶段：${(error as Error).message}`));
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let cancelled = false;
    let timedOut = false;

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const kill = (): void => {
      if (!child.killed) child.kill('SIGTERM');
    };

    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, options.timeoutMs);

    const onAbort = (): void => {
      cancelled = true;
      kill();
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    // 注册监听与 spawn 之间还可能有窗口：再查一次，避免漏掉刚发生的取消
    if (options.signal?.aborted === true) onAbort();

    const cleanup = (): void => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    };

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectPromise(
        new Error(
          `无法启动 ${stage} 阶段（${entry}）：${error.message}。检查 Node 是否可用（需要 22.19 以上）。`,
        ),
      );
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();

      const ms = Date.now() - started;
      const base: RunResult = {
        ok: code === 0 && !cancelled && !timedOut,
        exitCode: code,
        signal,
        stdout: tail(stdout),
        stderr: tail(stderr),
        ms,
      };

      if (cancelled) {
        resolvePromise({ ...base, cancelled: true, error: `${stage} 阶段被取消。` });
        return;
      }
      if (timedOut) {
        resolvePromise({
          ...base,
          error: `${stage} 阶段超过 ${String(Math.round(options.timeoutMs / 1000))} 秒仍未结束，已终止。大目录可以先用 --limit 分次跑素材阶段。`,
        });
        return;
      }
      if (!base.ok) {
        const detail = stderr.trim() !== '' ? stderr.trim().split('\n').slice(-3).join(' / ') : `退出码 ${String(code)}`;
        resolvePromise({ ...base, error: `${stage} 阶段失败：${detail.slice(0, 400)}` });
        return;
      }

      resolvePromise(base);
    });
  });
}
