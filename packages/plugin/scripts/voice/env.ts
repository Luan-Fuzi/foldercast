/**
 * 配音阶段的外部世界：命令在不在、怎么跑命令。
 *
 * provider 是 macOS 自带的 `say`，本地、免密钥 —— 所以这里没有（也不需要）密钥读取。
 */
import { execFile, execFileSync } from 'node:child_process';
import type { ExecResult, VoiceEnv } from '../contracts/durations.ts';

/** 可执行文件在不在（`which`）。 */
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

export type MakeEnvOptions = {
  /** 覆盖命令执行（测试用）。 */
  exec?: VoiceEnv['exec'];
  /** 覆盖命令探测（测试用）。 */
  has?: VoiceEnv['has'];
};

/** 组装 `VoiceEnv`。CLI 用它；测试传 `exec` / `has` 就能完全离线。 */
export function makeVoiceEnv(options: MakeEnvOptions = {}): VoiceEnv {
  return {
    has: options.has ?? hasCommand,
    exec: options.exec ?? execCommand,
  };
}
