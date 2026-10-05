/**
 * 端到端：真跑一遍 CLI（分析器 → 校验器），验退出码与默认路径发现。
 *
 * 用临时目录而不是仓库内目录：解读里的 `source.root` 必须是绝对路径，临时目录天然满足，
 * 也不会因为仓库自身的产物变化而让期望失效。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const MAIN = resolve(import.meta.dirname, '../main.ts');
const SAMPLE = resolve(import.meta.dirname, '../../analyzer/tests/fixtures/sample');
const BAD_SCRIPT = resolve(import.meta.dirname, 'fixtures/bad-script.json');
const GOOD_SCRIPT = resolve(import.meta.dirname, 'fixtures/good-script.json');

/** 夹具里的 source.root 是仓库内路径；临时目录里要换成实际路径，否则会报 root 不一致。 */
const PLACEHOLDER_ROOT = SAMPLE;

let source = '';
let workRoot = '';

function scriptWithRealRoot(file: string, root: string): string {
  return readFileSync(file, 'utf8').replaceAll(PLACEHOLDER_ROOT, root);
}

type Run = { status: number; stdout: string; stderr: string };

/**
 * 跑 CLI 并拿到退出码（非零退出不当成异常）。
 *
 * stderr 用管道收：用法提示走 stderr，**不重定向到 null** 否则会被继承到测试输出里，
 * 把 `pnpm test` 的日志搞脏。
 */
function run(args: readonly string[]): Run {
  try {
    const stdout = execFileSync('node', [MAIN, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const failed = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failed.status ?? -1, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
  }
}

beforeAll(() => {
  // 源目录 = 分析器的夹具目录的副本（真跑分析器，不是手写解读）
  source = mkdtempSync(join(tmpdir(), 'foldercast-e2e-'));
  cpSync(SAMPLE, source, { recursive: true });

  try {
    execFileSync('node', [resolve(import.meta.dirname, '../../analyzer/main.ts'), source], { encoding: 'utf8' });
  } catch (error) {
    // 分析器对密钥文件会打印审计，但仍应成功；失败时把输出带出来便于定位
    throw new Error(`分析器跑失败：${(error as { stdout?: string }).stdout ?? String(error)}`);
  }

  workRoot = join(source, '.foldercast');
});

afterAll(() => {
  if (source !== '') rmSync(source, { recursive: true, force: true });
});

describe('CLI 端到端', () => {
  it('解读干净、还没有讲稿时：退出码 0，并提示没有讲稿', () => {
    const { status, stdout } = run([source]);
    expect(stdout).toContain('还没有讲稿');
    expect(status).toBe(0);
  });

  it('讲解稿写得对：退出码 0，报「通过」', () => {
    writeFileSync(join(workRoot, 'script.json'), scriptWithRealRoot(GOOD_SCRIPT, source));
    const { status, stdout } = run([source]);
    expect(stdout).toContain('契约校验通过');
    expect(status).toBe(0);
  });

  it('讲稿写得坏：退出码 1，问题带文件行号', () => {
    writeFileSync(join(workRoot, 'script.json'), scriptWithRealRoot(BAD_SCRIPT, source));
    const { status, stdout } = run([source]);
    expect(status).toBe(1);
    // 行号形如 :31:15，能直接跳到出问题的那一行
    expect(stdout).toMatch(/script\.json:\d+:\d+/);
    expect(stdout).toContain('有必须修的问题，退出码 1');
  });

  it('--json 输出机器可读的报告', () => {
    writeFileSync(join(workRoot, 'script.json'), scriptWithRealRoot(BAD_SCRIPT, source));
    const { status, stdout } = run([source, '--json']);
    expect(status).toBe(1);

    const report = JSON.parse(stdout) as {
      ok: boolean;
      counts: { blocker: number; warning: number };
      checked: { reading?: string; script?: string };
      issues: { code: string; pointer: string; sceneId?: string; line?: number }[];
    };
    expect(report.ok).toBe(false);
    expect(report.counts.blocker).toBeGreaterThan(0);
    expect(report.checked.script).toBe(join(workRoot, 'script.json'));
    expect(report.issues.map((issue) => issue.code)).toContain('path-hallucinated');
    expect(report.issues.some((issue) => issue.sceneId === 'entry' && issue.line !== undefined)).toBe(true);
  });

  it('缺解读：退出码 1，并说清先跑什么', () => {
    const empty = mkdtempSync(join(tmpdir(), 'foldercast-empty-'));
    try {
      const { status, stdout } = run([empty]);
      expect(status).toBe(1);
      expect(stdout).toContain('解读文件不存在');
      expect(stdout).toContain('pnpm analyze');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('参数有误：退出码 2', () => {
    const { status, stderr } = run(['--nope']);
    expect(status).toBe(2);
    expect(stderr).toContain('未知选项');
  });

  it('可以只校验解读，不依赖讲稿', () => {
    rmSync(join(workRoot, 'script.json'), { force: true });
    const { status, stdout } = run(['--reading', join(workRoot, 'foldercast.json'), '--json']);
    expect(status).toBe(0);
    const report = JSON.parse(stdout) as { counts: { blocker: number } };
    expect(report.counts.blocker).toBe(0);
    mkdirSync(workRoot, { recursive: true });
  });

  it('schema 找不到时报出可操作的错误，而不是裸 ENOENT', () => {
    const { status, stderr } = run([source, '--specs', join(tmpdir(), 'foldercast-no-such-specs')]);
    expect(status).toBe(2);
    expect(stderr).toContain('schema 不存在');
  });

  it('目录与 --reading 同时给时明确拒绝，不静默忽略其中一个', () => {
    const { status, stderr } = run([source, '--reading', join(workRoot, 'foldercast.json')]);
    expect(status).toBe(2);
    expect(stderr).toContain('只能给一个');
  });
});
