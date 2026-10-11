import { afterEach, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProcess } from '../runtime.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(code: string): { entry: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'foldercast-process-')); roots.push(root);
  const entry = join(root, 'stage.mjs'); writeFileSync(entry, code); return { entry, root };
}
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

it('取消会终止忽略 SIGTERM 的孙进程，返回后它不再写文件', async () => {
  const { entry, root } = fixture(`
    import { spawn } from 'node:child_process';
    const code = "const fs=require('node:fs');process.on('SIGTERM',()=>{});setInterval(()=>fs.appendFileSync(process.argv[1],'.'),25)";
    spawn(process.execPath, ['-e', code, process.argv[2]], { stdio: 'inherit', detached: process.platform !== 'win32' });
    setInterval(()=>{},1000);
  `);
  const log = join(root, 'heartbeat');
  const controller = new AbortController();
  const run = runProcess(entry, { args: [log], timeoutMs: 10000, signal: controller.signal });
  for (let tries = 0; tries < 100 && !existsSync(log); tries++) await pause(25);
  expect(existsSync(log)).toBe(true);
  controller.abort();
  const result = await run;
  expect(result.cancelled).toBe(true);
  const length = readFileSync(log).length;
  await pause(150);
  expect(readFileSync(log).length).toBe(length);
}, 15000);

it('超时会升级终止忽略 SIGTERM 的进程', async () => {
  const { entry } = fixture("process.on('SIGTERM',()=>{});setInterval(()=>{},1000);");
  const result = await runProcess(entry, { args: [], timeoutMs: 200 });
  expect(result.ok).toBe(false);
  expect(result.error).toContain('已终止');
  expect(result.ms).toBeLessThan(5000);
}, 10000);

it('过量 JSON 输出返回明确失败；普通日志只保留尾部', async () => {
  const { entry } = fixture("process.stdout.write('x'.repeat(2100000));process.stderr.write('y'.repeat(10000));");
  const result = await runProcess(entry, { args: [], timeoutMs: 10000, json: true });
  expect(result.ok).toBe(false);
  expect(result.error).toContain('无法完整解析');
  expect(result.stdout.length).toBeLessThanOrEqual(2000000);
  expect(result.stderr.length).toBeLessThanOrEqual(4000);
});
