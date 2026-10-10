/**
 * 外部命令的执行封装。
 *
 * 转图、抽帧、缩放一律走外部命令（coding.md「外部命令优先」）。这里的职责只有三件：
 * 找到命令、跑起来、把失败变成**可操作**的信息 —— 说清缺什么、怎么装，而不是抛裸错误。
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPackageRoot } from '../contracts/package.ts';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = findPackageRoot(MODULE_DIR) ?? resolve(MODULE_DIR, '../..');

export type CommandOutcome =
  | { ok: true; stdout: string }
  | { ok: false; error: string; stdout: string; stderr: string };

export type RunOptions = {
  cwd?: string;
  /** 毫秒。转大文档可能慢，默认给 5 分钟。 */
  timeoutMs?: number;
};

/**
 * 解析可执行文件位置。
 *
 * 优先用本包 `node_modules/.bin/` 里的（`dsoffice` 来自 `@deepseek-ai/libreoffice-kit`，
 * 是 optionalDependency，可能没装上），否则交给 PATH 找。
 */
export function resolveCommand(command: string): string {
  const local = join(PACKAGE_ROOT, 'node_modules/.bin', command);
  return existsSync(local) ? local : command;
}

/** 命令是否可用。用于在动手之前给出「缺什么」的结论。 */
export function hasCommand(command: string): boolean {
  const resolved = resolveCommand(command);
  if (resolved !== command) return true;
  const result = spawnSync(command, ['-version'], { encoding: 'utf8', timeout: 10_000 });
  // ffmpeg 有 -version，sips 没有；ENOENT 才是「没装」的判据
  return !(result.error !== undefined && (result.error as NodeJS.ErrnoException).code === 'ENOENT');
}

export function runCommand(command: string, args: readonly string[], options: RunOptions = {}): CommandOutcome {
  const result = spawnSync(resolveCommand(command), [...args], {
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 300_000,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    maxBuffer: 64 * 1024 * 1024,
  });

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';

  if (result.error !== undefined) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { ok: false, error: `找不到命令 ${command}。${installHint(command)}`, stdout, stderr };
    }
    return { ok: false, error: `${command} 执行失败：${result.error.message}`, stdout, stderr };
  }

  if (result.status !== 0) {
    const detail = (stderr.trim() || stdout.trim()).split('\n').slice(-3).join(' / ').slice(0, 300);
    return { ok: false, error: `${command} 退出码 ${String(result.status)}：${detail}`, stdout, stderr };
  }

  return { ok: true, stdout };
}

function installHint(command: string): string {
  switch (command) {
    case 'dsoffice':
      return 'Office/PDF 转图需要它（npm 包 @deepseek-ai/libreoffice-kit，作为 optionalDependency 安装）。装上后重试，或先跳过 office/pdf 素材。';
    case 'ffmpeg':
    case 'ffprobe':
      return '视频抽帧与实测时长需要 ffmpeg（macOS：brew install ffmpeg）。';
    case 'sips':
      return 'sips 是 macOS 自带的图片工具；其他平台会把图片缩放回退到 ffmpeg。';
    default:
      return '请先安装该命令再重试。';
  }
}

/** 执行并把 stdout 当 JSON 解析（dsoffice 与 ffprobe 都支持机器可读输出）。 */
export function runJson<T>(command: string, args: readonly string[], options: RunOptions = {}): { ok: true; value: T } | { ok: false; error: string } {
  const outcome = runCommand(command, args, options);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  try {
    return { ok: true, value: JSON.parse(outcome.stdout) as T };
  } catch {
    return { ok: false, error: `${command} 的输出不是合法 JSON：${outcome.stdout.slice(0, 200)}` };
  }
}
