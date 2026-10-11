import { afterEach, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executionEnv, withExecutionLock } from '../execution.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
it('拒绝独立并发任务和目录别名，任务失败后释放锁', async () => {
  const root = mkdtempSync(join(tmpdir(), 'foldercast-lock-')); roots.push(root);
  const alias = `${root}-alias`; roots.push(alias); symlinkSync(root, alias, 'junction');
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  const first = withExecutionLock(root, () => gate);
  await expect(withExecutionLock(alias, async () => {})).rejects.toThrow('已有 foldercast');
  finish(); await first;
  await expect(withExecutionLock(root, async () => { throw new Error('fail'); })).rejects.toThrow('fail');
  expect(existsSync(join(root, '.foldercast/execution.lock'))).toBe(false);
  await withExecutionLock(root, async () => {
    expect(executionEnv()['FOLDERCAST_EXECUTION_TOKEN']).toBeDefined();
    await withExecutionLock(alias, async () => {});
  });
});
