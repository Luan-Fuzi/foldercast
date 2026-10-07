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
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, parse, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBrowser } from '../scripts/renderer/browser.ts';

/** 本文件所在目录：开发时是 `<包根>/src`，发布版编译后在 `<包根>/lib/src`。 */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * 从起点往上找第一个含 `package.json` 的目录，作为包根。
 *
 * **不能写成 `resolve(MODULE_DIR, '..')`**：源码与编译产物深度不同（`src` vs `lib/src`），
 * 那样在发布版里会把包根算成 `<包根>/lib`，随包脚本与 `node_modules/.bin` 全部找不到 ——
 * 而且**只在装上去之后才暴露**，仓库内测试用的是源码布局，永远是对的（M4 装进 desktop
 * profile 时踩到）。校验器的 schema 定位（`scripts/validate/schema.ts`）用同一套上溯法。
 */
export function findPackageRoot(start: string): string | undefined {
  let current = resolve(start);
  const { root } = parse(current);

  for (;;) {
    if (existsSync(join(current, 'package.json'))) return current;
    if (current === root) return undefined;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/** 包根：脚本、随包 schema、依赖的 bin 都相对它定位。 */
export const PACKAGE_ROOT = findPackageRoot(MODULE_DIR) ?? resolve(MODULE_DIR, '..');

export type StageName = 'render' | 'voice' | 'page';

/** 阶段脚本所在子目录，两套布局下同名。 */
const STAGE_DIR: Readonly<Record<StageName, string>> = {
  // 渲染：讲稿 →（按需转换素材）→ mp4。需要浏览器，缺浏览器只影响这一步
  render: 'renderer',
  // 配音：讲稿 → 逐场景音频 + durations.json + 整条音轨。云端 provider（edge / mimo）+ ffmpeg
  voice: 'voice',
  // 页面：讲稿 → 自包含 HTML（零 JS、图片内联）。纯字符串模板，秒级，不依赖浏览器
  page: 'page',
};

/** 这份 Node 能不能直接跑 TypeScript（类型剥离，22.19 起默认开）。 */
function canStripTypes(): boolean {
  const features = process.features as { typescript?: string | boolean } | undefined;
  const value = features?.typescript;
  return value === 'strip' || value === 'transform';
}

function isInsideNodeModules(path: string): boolean {
  return path.split(sep).includes('node_modules');
}

export type StageEntry = {
  /** 相对包根的路径，用于报错信息。 */
  relative: string;
  absolute: string;
};

/**
 * 阶段脚本入口。两套布局都认：
 *
 * | 位置 | 什么时候用 |
 * |---|---|
 * | `<包根>/scripts/<阶段>/main.ts` | 仓库内直跑，靠 Node 的类型剥离 |
 * | `<包根>/lib/scripts/<阶段>/main.js` | 装进 `node_modules` 时（那里**禁止**类型剥离） |
 *
 * 判据是「要跑的那个 `.ts` 是否落在 `node_modules` 里」，与 Node 自己的规则一致：
 * `link:` 装法会把软链解析回仓库真实路径，于是照旧跑源码——改完不用重新构建。
 */
export function resolveStageEntry(packageRoot: string, stage: StageName): StageEntry {
  const tsRelative = join('scripts', STAGE_DIR[stage], 'main.ts');
  const jsRelative = join('lib', 'scripts', STAGE_DIR[stage], 'main.js');
  const tsAbsolute = resolve(packageRoot, tsRelative);
  const useSource = !isInsideNodeModules(tsAbsolute) && canStripTypes() && existsSync(tsAbsolute);
  const relative = useSource ? tsRelative : jsRelative;

  return { relative, absolute: resolve(packageRoot, relative) };
}

export function stageEntry(stage: StageName): StageEntry {
  return resolveStageEntry(PACKAGE_ROOT, stage);
}

export function stageEntryPath(stage: StageName): string {
  return stageEntry(stage).absolute;
}

/** 工作根：所有产物都在 `<源目录>/.foldercast/` 下。 */
export function workRootFor(target: string): string {
  return resolve(target, '.foldercast');
}

export function scriptPathFor(target: string): string {
  return resolve(workRootFor(target), 'script.json');
}

/**
 * 评审结论。它由 agent 产出、没有 schema，所以这里只定位、不校验：
 * 校验器管机器能判的，评审管语义。
 */
export function reviewPathFor(target: string): string {
  return resolve(workRootFor(target), 'review.md');
}

/** 成片的落点。渲染阶段不传 `--out` 时就是它。 */
export function videoPathFor(target: string): string {
  return resolve(workRootFor(target), 'out', 'video.mp4');
}

/** 导览页的落点。页面阶段不传 `--out` 时就是它。 */
export function pagePathFor(target: string): string {
  return resolve(workRootFor(target), 'out', 'page.html');
}

/** 配音产物的落点（M8）：逐场景音频、整条音轨与实测时长表都在工作根下。 */
export function durationsPathFor(target: string): string {
  return resolve(workRootFor(target), 'durations.json');
}

/** 整条旁白音轨（配音阶段拼好的，长度等于场景时长之和）。 */
export function narrationPathFor(target: string): string {
  return resolve(workRootFor(target), 'audio', 'narration.wav');
}

export type DependencyName = 'node' | 'dsoffice' | 'ffmpeg' | 'ffprobe' | 'sips' | 'browser';

export type Dependency = {
  name: DependencyName;
  ok: boolean;
  /** 不 ok 时：缺什么、怎么装。缺依赖不该只是报错，要给出下一步。 */
  hint: string;
  required: boolean;
};

/** 随包的脚本入口是否都在。缺了说明包装坏了，不是用户环境问题。 */
export function scriptsInstalled(): { ok: boolean; missing: string[] } {
  const missing = (Object.keys(STAGE_DIR) as StageName[])
    .map((stage) => stageEntry(stage))
    .filter((entry) => !existsSync(entry.absolute))
    .map((entry) => entry.relative);

  return { ok: missing.length === 0, missing };
}

/**
 * `dsoffice` 来自 `@deepseek-ai/libreoffice-kit`，是 optionalDependency：
 * 装不上时 office/pdf 的转图与文本提取不可用，其他类型照常。
 *
 * 两个位置都找：包自己的 `node_modules/.bin`（npm 平铺、仓库内），以及按包名解析出的
 * 清单里的 `bin`（pnpm 把依赖的 bin 放在虚拟store下，不在包目录里）。
 */
function dsofficePath(): string | undefined {
  const direct = resolve(PACKAGE_ROOT, 'node_modules/.bin/dsoffice');
  if (existsSync(direct)) return direct;

  try {
    const manifestPath = createRequire(import.meta.url).resolve('@deepseek-ai/libreoffice-kit/package.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { bin?: string | Record<string, string> };
    const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.dsoffice;
    if (bin === undefined) return undefined;
    const candidate = resolve(dirname(manifestPath), bin);
    return existsSync(candidate) ? candidate : undefined;
  } catch {
    return undefined;
  }
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
 * 安装指引按 `process.platform` 分支：macOS 的文案保持历史原样（不惊动已有用户），
 * 其余平台给各自的包管理器命令。**只分支文案，探测判据与行为不变。**
 */

/** ffmpeg 的安装命令（ffprobe 随它一起装，不单独立项）。 */
function ffmpegInstallHint(): string {
  const consequence = '缺它时配音不可用，渲染仍能出静音片。';
  switch (process.platform) {
    case 'win32':
      return `视频封面、音频拼接与配音都要 ffmpeg（Windows：winget install --id Gyan.FFmpeg，或 choco install ffmpeg）。${consequence}`;
    case 'linux':
      return `视频封面、音频拼接与配音都要 ffmpeg（Linux：apt install ffmpeg，或所用发行版的等价命令）。${consequence}`;
    default:
      return `视频封面、音频拼接与配音都要 ffmpeg（macOS：brew install ffmpeg）。${consequence}`;
  }
}

/** 浏览器的安装指引：三个平台认的浏览器一样（Chrome / Chromium / Edge），装法不同。 */
function browserInstallHint(): string {
  const fallback = '或跑 npx remotion browser ensure 让 Remotion 下载，或用 FOLDERCAST_BROWSER 指定路径。只影响出片。';
  switch (process.platform) {
    case 'win32':
      return `出片需要浏览器（Remotion 用它排版）。装一个系统浏览器（如 winget install Google.Chrome；Chromium / Edge 也认），${fallback}`;
    case 'linux':
      return `出片需要浏览器（Remotion 用它排版）。装一个系统浏览器（发行版包管理器装 chromium，如 apt install chromium；Chrome / Edge 也认），${fallback}`;
    default:
      return `出片需要浏览器（Remotion 用它排版）。装 Google Chrome / Chromium / Edge，${fallback}`;
  }
}

/**
 * 找浏览器：系统 Chrome / Chromium / Edge，或 Remotion 已经下过的 Headless Shell。
 *
 * 与渲染脚本共用同一份判据（`scripts/renderer/browser.ts`），所以「插件说可用」与
 * 「渲染真能跑」不会打架。**这里不下载**：探测只做文件存在性检查。
 */
function findBrowser(): { name: string; path: string } | undefined {
  try {
    const found = resolveBrowser(process.env['FOLDERCAST_BROWSER']);
    return found.kind === 'found' ? { name: found.name, path: found.path } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 首次调用时探测环境。
 *
 * **只有 Node 与随包脚本是硬条件**：其余缺失都降级（office/pdf 素材、视频关键帧），
 * 不影响讲稿本身。所以这里返回的是「各自能不能用」，不是一句「环境不满足」。
 */
export async function detectDependencies(): Promise<Dependency[]> {
  // 判据取运行时能力本身，而不是版本号：22.0–22.18 要显式加 `--experimental-strip-types`
  // 才能跑 `.ts`，那种情况 `process.features.typescript` 同样是 `strip`，算能跑。
  const nodeOk = canStripTypes();

  const dsoffice = dsofficePath();
  const browser = findBrowser();
  const deps: Dependency[] = [
    {
      name: 'node',
      ok: nodeOk,
      required: true,
      hint: nodeOk
        ? `Node ${process.versions.node}`
        : `需要 Node 22.19 以上（当前 ${process.versions.node}）：阶段脚本用 TypeScript 写，靠 Node 的类型剥离直接运行。`,
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
      hint: ffmpegInstallHint(),
    },
    {
      name: 'ffprobe',
      ok: await hasExecutable('ffprobe', '-version'),
      required: false,
      // 与 ffmpeg 分开报：它随 ffmpeg 一起装，但**用途不同** —— 「时长以实测为准」这条
      // 设计靠它，缺了就只能按字数估
      hint: '实测音频与视频时长需要 ffprobe（随 ffmpeg 一起装）。缺它时配音无法记录实测时长。',
    },
    {
      name: 'sips',
      ok: await hasExecutable('sips', '-h'),
      required: false,
      hint: 'sips 是 macOS 自带的图片工具；其他平台会把图片缩放回退到 ffmpeg。',
    },
    {
      name: 'browser',
      ok: browser !== undefined,
      required: false,
      // **不是硬条件**：缺浏览器时只有出片不能，讲稿校验（--check）照常。
      // 所以这里只如实报告，不触发下载（下载由用户决定，150–300 MB）。
      hint: browser === undefined ? browserInstallHint() : `出片可用（${browser.name}）。`,
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
  /**
   * 这一步的输出是机器可读的 JSON（要交回去解析）。**是就不要按人的阅读长度截断** ——
   * 截掉尾巴的 JSON 解析不了，会被误读成「没有输出」。
   */
  json?: boolean;
  args: readonly string[];
  timeoutMs: number;
  signal?: AbortSignal;
  /** 工作目录，默认包根。 */
  cwd?: string;
  /**
   * 追加给子进程的环境变量。**只用来传凭据**（配音阶段的 TTS 密钥）：值不进命令行
   * （命令行会进日志与进程列表），也不进报告 —— 报告里只有引用名（C6）。
   */
  env?: Record<string, string>;
};

/** 输出留多少字符给模型看：够定位问题，又不会把上下文塞满。 */
const OUTPUT_TAIL = 4000;

/**
 * `--json` 阶段的输出上限。**不能按人的阅读长度截**：工具要解析它，截掉尾巴就是一个坏 JSON，
 * 表现得像「校验器没输出」。实测踩过：解读一重新分析，校验报告就超过 4000 字符，
 * 于是校验结果整段丢失，只有一句「讲稿有 0 个必须修的问题」。所以给 JSON 一个宽松的上限。
 */
const OUTPUT_JSON_LIMIT = 2_000_000;

function tail(text: string, limit: number): string {
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
  const outputLimit = options.json === true ? OUTPUT_JSON_LIMIT : OUTPUT_TAIL;

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
        ...(options.env === undefined ? {} : { env: { ...process.env, ...options.env } }),
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
        stdout: tail(stdout, outputLimit),
        stderr: tail(stderr, OUTPUT_TAIL),
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
