/**
 * 配音阶段的外部世界：**密钥从哪来、命令在不在、怎么跑命令**。
 *
 * 密钥只有一个读取口（`VoiceEnv.secret`），来源按固定优先级叠加：
 *
 * | 顺序 | 位置 | 说明 |
 * |---|---|---|
 * | 1 | 进程环境（`MIMO_API_KEY=… pnpm voice`） | 唯一「这一次运行」的表达，最优先 |
 * | 2 | 被讲解目录的 `.env` | 项目级隔离靠它 |
 * | 3 | `$DSH_HOME/.env`（默认 `~/.dsh`） | DSH 自己的环境文件 |
 *
 * 宿主的凭据存储（`~/.dsh/.credentials.yaml`）**这一版不读**：插件那一侧可以把值取出来、
 * 经环境变量传进来，读取口在宿主，不在这里。
 *
 * **密钥不进日志、不进报告、不进 `durations.json`。** 报告里只有引用名。
 */
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ExecResult, VoiceEnv } from '../contracts/durations.ts';

/** 极简 `.env` 解析：`KEY=value`、`#` 注释、可选的单双引号。**不展开变量**（不做 shell）。 */
export function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key !== '' && value !== '') values[key] = value;
  }
  return values;
}

export type SecretSources = {
  /** 进程环境。 */
  env?: Record<string, string | undefined>;
  /** 项目根（被讲解目录），会读它下面的 `.env`。 */
  projectRoot?: string;
  /** DSH home，会读 `<home>/.env`。默认 `$DSH_HOME` 或 `~/.dsh`。 */
  dshHome?: string;
};

/**
 * 造一个「取密钥」的函数。来源按优先级叠加，先命中的赢。
 *
 * 返回的函数**不做缓存**：`.env` 可能刚被改过，而配音一次只调几次，读文件的开销无所谓。
 */
export function makeSecretReader(sources: SecretSources = {}): (ref: string) => string | undefined {
  const env = sources.env ?? process.env;
  const dshHome = sources.dshHome ?? env['DSH_HOME'] ?? join(homedir(), '.dsh');

  return (ref: string) => {
    const fromEnv = env[ref];
    if (fromEnv !== undefined && fromEnv.trim() !== '') return fromEnv.trim();

    if (sources.projectRoot !== undefined) {
      const path = resolve(sources.projectRoot, '.env');
      if (existsSync(path)) {
        const value = parseEnvFile(readFileSync(path, 'utf8'))[ref];
        if (value !== undefined) return value;
      }
    }

    const dshEnv = join(dshHome, '.env');
    if (existsSync(dshEnv)) {
      const value = parseEnvFile(readFileSync(dshEnv, 'utf8'))[ref];
      if (value !== undefined) return value;
    }

    return undefined;
  };
}

/**
 * 可执行文件在不在。跨平台：Windows 没有 `which`，用它的对应物 `where`
 * （认 PATH 与 PATHEXT，所以 `ffmpeg` 也能找到 `ffmpeg.exe`）。
 */
export function hasCommand(command: string): boolean {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  try {
    execFileSync(probe, [command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** 跑一个命令，stdout 与 stderr 都留下（有些工具把人话写在 stderr 上，别只看一边）。 */
export function execCommand(command: string, args: readonly string[]): Promise<ExecResult> {
  return new Promise((resolvePromise) => {
    execFile(command, [...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolvePromise({
        ok: error === null,
        stdout: stdout ?? '',
        stderr: stderr === undefined || stderr === '' ? (error?.message ?? '') : stderr,
      });
    });
  });
}

export type MakeEnvOptions = SecretSources & {
  /** 覆盖取密钥（测试用）。 */
  secret?: VoiceEnv['secret'];
  /** 覆盖命令执行（测试用）。 */
  exec?: VoiceEnv['exec'];
  /** 覆盖命令探测（测试用）。 */
  has?: VoiceEnv['has'];
};

/** 组装 `VoiceEnv`。CLI 用它；测试传 `secret` / `exec` / `has` 就能完全离线。 */
export function makeVoiceEnv(options: MakeEnvOptions = {}): VoiceEnv {
  return {
    secret: options.secret ?? makeSecretReader(options),
    has: options.has ?? hasCommand,
    exec: options.exec ?? execCommand,
  };
}
