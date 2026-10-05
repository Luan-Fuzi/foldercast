/**
 * 浏览器获取与检查（C4）。**渲染前才要浏览器，装插件时不要** —— 缺浏览器的机器上
 * 分析、素材、校验、HTML 视图都能跑，只有出片不能（见 ROADMAP 已识别的坑 3）。
 *
 * 顺序（与 ROADMAP 的表一致）：
 *
 * | 顺序 | 来源 | 代价 |
 * |---|---|---|
 * | ① | 系统已有的 Chrome / Chromium / Edge | 零下载，首选 |
 * | ② | Remotion 已经下过的 Chrome Headless Shell | 零下载 |
 * | ③ | 都没有 → **返回结构化引导，不下载、不崩溃** | 用户自己决定要不要下 150–300 MB |
 *
 * 第 ③ 条是这一阶段的判据：**不静默下载**。渲染是唯一需要浏览器的一步，让它在第一次
 * 出片时才提出这个几百 MB 的请求，比在插件安装时提出合理得多。
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type BrowserOrigin = 'env' | 'system' | 'headless-shell' | 'flag';

export type BrowserResolution =
  | { kind: 'found'; path: string; origin: BrowserOrigin; name: string }
  | { kind: 'missing'; searched: string[]; guidance: string };

/** 系统浏览器的候选路径。macOS 用不着 `which`，路径是固定的。 */
const SYSTEM_CANDIDATES: Record<string, { name: string; paths: string[] }[]> = {
  darwin: [
    {
      name: 'Google Chrome',
      paths: [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        `${homedir()}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
      ],
    },
    {
      name: 'Chromium',
      paths: ['/Applications/Chromium.app/Contents/MacOS/Chromium'],
    },
    {
      name: 'Microsoft Edge',
      paths: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
    },
    {
      name: 'Brave',
      paths: ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'],
    },
  ],
  linux: [
    {
      name: 'Google Chrome',
      paths: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome'],
    },
    { name: 'Chromium', paths: ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'] },
    { name: 'Microsoft Edge', paths: ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable'] },
  ],
  win32: [
    {
      name: 'Google Chrome',
      paths: [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      ],
    },
    {
      name: 'Microsoft Edge',
      paths: [
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      ],
    },
  ],
};

/** Remotion 下载 Headless Shell 的落点（各平台不同）。 */
export function headlessShellRoots(): string[] {
  if (process.platform === 'darwin') {
    return [join(homedir(), 'Library', 'Caches', 'remotion')];
  }
  if (process.platform === 'win32') {
    const local = process.env['LOCALAPPDATA'];
    return local === undefined ? [] : [join(local, 'remotion')];
  }
  const xdg = process.env['XDG_CACHE_HOME'];
  return [join(xdg === undefined || xdg === '' ? join(homedir(), '.cache') : xdg, 'remotion')];
}

/** 已经下过的 Headless Shell 可执行文件路径，找不到返回 undefined。按版本号倒序，取最新的。 */
export function findHeadlessShell(): string | undefined {
  const suffix =
    process.platform === 'darwin'
      ? 'chrome-headless-shell-mac-arm64/chrome-headless-shell'
      : process.platform === 'win32'
        ? 'chrome-headless-shell-win64/chrome-headless-shell.exe'
        : process.arch === 'arm64'
          ? 'chrome-headless-shell-linux-arm64/chrome-headless-shell'
          : 'chrome-headless-shell-linux64/chrome-headless-shell';

  for (const root of headlessShellRoots()) {
    if (!existsSync(root)) continue;
    let names: string[];
    try {
      names = readdirSync(root);
    } catch {
      continue;
    }
    const versions = names
      .filter((name) => /^\d+\.\d+\.\d+\.\d+$/.test(name))
      .sort((a, b) => compareVersions(b, a));
    for (const version of versions) {
      const candidate = join(root, version, suffix);
      if (isExecutable(candidate)) return candidate;
    }
  }
  return undefined;
}

function compareVersions(a: string, b: string): number {
  const left = a.split('.').map((part) => Number(part));
  const right = b.split('.').map((part) => Number(part));
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function isExecutable(path: string): boolean {
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return false;
    if (process.platform !== 'win32') {
      // 可执行位：没有它 Chrome 起不来，提前挡住比渲染到一半失败好。
      return (stat.mode & 0o111) !== 0;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 挑一个能用的浏览器。`explicit`（`--browser` 或 `FOLDERCAST_BROWSER`）与
 * `REMOTION_BROWSER_EXECUTABLE` 都优先，其次系统浏览器，最后已下载的 Headless Shell。
 *
 * `FOLDERCAST_IGNORE_SYSTEM_BROWSER=1` 时跳过系统浏览器那一步 —— **为了能测「没有浏览器」
 * 这条路径**：本机装了 Chrome，`missing` 分支（结构化引导 + 退出码 3）平时根本走不到，
 * 而它恰恰是 CI 上唯一的路径。
 */
export function resolveBrowser(
  explicit?: string,
  env: Record<string, string | undefined> = process.env,
): BrowserResolution {
  const searched: string[] = [];
  const fromEnv = explicit ?? env['FOLDERCAST_BROWSER'] ?? env['REMOTION_BROWSER_EXECUTABLE'];
  if (fromEnv !== undefined && fromEnv !== '') {
    searched.push(fromEnv);
    if (isExecutable(fromEnv)) {
      return { kind: 'found', path: fromEnv, origin: explicit === undefined ? 'env' : 'flag', name: 'env' };
    }
    return {
      kind: 'missing',
      searched,
      guidance: `指定的浏览器路径不存在或不可执行：${fromEnv}\n改掉 FOLDERCAST_BROWSER，或去掉它让本阶段自己找。`,
    };
  }

  const skipSystem = env['FOLDERCAST_IGNORE_SYSTEM_BROWSER'] === '1';
  for (const candidate of skipSystem ? [] : (SYSTEM_CANDIDATES[process.platform] ?? [])) {
    for (const path of candidate.paths) {
      searched.push(path);
      if (isExecutable(path)) {
        return { kind: 'found', path, origin: 'system', name: candidate.name };
      }
    }
  }

  const shell = findHeadlessShell();
  if (shell !== undefined) {
    return { kind: 'found', path: shell, origin: 'headless-shell', name: 'Chrome Headless Shell' };
  }
  for (const root of headlessShellRoots()) searched.push(root);

  return { kind: 'missing', searched, guidance: guidanceFor(searched) };
}

/** 缺浏览器时的结构化引导：说清「怎么修」而不是「出错了」。 */
export function guidanceFor(searched: readonly string[]): string {
  return [
    '渲染需要浏览器（Remotion 用它排版：它 ≈ 无头浏览器 + 帧驱动 + 编码）。',
    '',
    '任选一种：',
    '  1. 装 Google Chrome / Chromium / Edge（本机装了就用系统的，零下载）；',
    '  2. 让 Remotion 下载 Chrome Headless Shell（约 150–300 MB）：',
    '       npx remotion browser ensure',
    '  3. 自己指定一个：--browser <可执行文件路径> 或 FOLDERCAST_BROWSER=<路径>。',
    '',
    `已找过：${searched.length === 0 ? '（没有候选路径）' : searched.join('、')}`,
    '',
    '注意：只影响出片。分析、素材、校验、HTML 视图都不需要浏览器。',
  ].join('\n');
}
