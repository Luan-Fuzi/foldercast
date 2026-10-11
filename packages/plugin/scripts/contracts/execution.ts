/** 协作式目录锁：拒绝同目录并发写入，不提供排队或跨目录调度。 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { realPath, withinPath } from './paths.ts';

const context = new AsyncLocalStorage<string>();
export function executionEnv(): Record<string, string> {
  const token = context.getStore();
  return token === undefined ? {} : { FOLDERCAST_EXECUTION_TOKEN: token };
}

export async function withExecutionLock<T>(target: string, work: () => Promise<T>): Promise<T> {
  if (!existsSync(target) || !statSync(target).isDirectory()) return work(); // 原入口负责目录问题的引导。
  const workRoot = join(realPath(target), '.foldercast');
  if (!withinPath(realPath(target), realPath(workRoot))) throw new Error('.foldercast 工作目录不能指向源目录外。');
  mkdirSync(workRoot, { recursive: true });
  const lock = join(workRoot, 'execution.lock');
  const inherited = context.getStore() ?? process.env['FOLDERCAST_EXECUTION_TOKEN'];
  let owner: { pid: number; token: string } | undefined;
  try { owner = JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8')) as typeof owner; } catch { /* 尚未写完也视为占用。 */ }
  if (inherited !== undefined && owner?.token === inherited) {
    try { process.kill(owner.pid, 0); return await context.run(inherited, work); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }
  try { mkdirSync(lock); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    throw new Error('该目录已有 foldercast 任务正在执行。等待任务结束后重试；若上次异常退出，确认进程已结束后删除 .foldercast/execution.lock。');
  }
  const token = randomUUID();
  const release = (): void => { rmSync(lock, { recursive: true, force: true }); };
  const terminate = (): void => { release(); process.exit(143); };
  try {
    writeFileSync(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, token }));
    process.once('exit', release);
    // CLI 可独立运行；插件宿主已有信号处理时不替换其退出策略。
    const handlesTerm = process.listenerCount('SIGTERM') === 0;
    if (handlesTerm) process.once('SIGTERM', terminate);
    try { return await context.run(token, work); }
    finally { if (handlesTerm) process.removeListener('SIGTERM', terminate); }
  } finally { process.removeListener('exit', release); release(); }
}
