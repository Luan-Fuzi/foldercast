/**
 * 配音阶段的外部世界：**密钥从哪来、命令在不在、怎么跑命令**。
 *
 * 密钥只有一个读取口（`secret`），优先级按 [INTEGRATION §7.2](../../../docs/INTEGRATION-dsh-plugin.md)
 * 与 rd 文档固定：
 *
 * | 顺序 | 位置 | 说明 |
 * |---|---|---|
 * | 1 | 进程环境（`MIMO_API_KEY=… pnpm voice`） | 唯一「这一次运行」的表达，最优先 |
 * | 2 | 项目根的 `.env` | 项目级隔离靠它；这是**替代**旧设计里 `lecture-videos/.mimo_api_key` 的位置 |
 * | 3 | `$DSH_HOME/.env` | DSH 自己的环境文件 |
 *
 * `$DSH_HOME/.credentials.yaml`（凭据存储）**这一版不读**：它是 YAML、权限 600、只放凭据，
 * 解析它等于我们自己实现一遍凭据 seam。插件那一侧可以把值取出来、经环境变量传进来，
 * 所以「配置里只放引用名」这条设计仍然成立 —— 读取口在宿主，不在这里。
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

/** 可执行文件在不在。与素材阶段同一套判据（`which`）。 */
export function hasCommand(command: string): boolean {
  try {
    execFileSync('which', [command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** 跑一个命令，stdout 与 stderr 都留下（`say -v '?'` 的输出在 stderr 上）。 */
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
  /** 覆盖命令执行（测试用）。 */
  exec?: VoiceEnv['exec'];
  /** 覆盖命令探测（测试用）。 */
  has?: VoiceEnv['has'];
};

/** 组装 `VoiceEnv`。CLI 用它；测试传 `exec` / `has` / `env` 就能完全离线。 */
export function makeVoiceEnv(options: MakeEnvOptions = {}): VoiceEnv {
  return {
    secret: makeSecretReader(options),
    has: options.has ?? hasCommand,
    exec: options.exec ?? execCommand,
  };
}
