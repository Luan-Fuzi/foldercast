/**
 * 端到端：真跑一遍 CLI（分析器 → HTML 视图）。
 *
 * 用临时目录而不是仓库内目录：解读里的 `source.root` 是绝对路径，临时目录天然满足，
 * 也不会因为仓库自身的产物变化而让期望失效。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const MAIN = resolve(import.meta.dirname, '../main.ts');
const ANALYZER = resolve(import.meta.dirname, '../../analyzer/main.ts');
const SAMPLE = resolve(import.meta.dirname, '../../analyzer/tests/fixtures/sample');

let source = '';
let output = '';

type Run = { status: number; stdout: string; stderr: string };

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
  source = mkdtempSync(join(tmpdir(), 'foldercast-html-'));
  cpSync(SAMPLE, source, { recursive: true });
  execFileSync('node', [ANALYZER, source], { stdio: 'ignore' });
  output = join(source, '.foldercast', 'out', 'index.html');
});

afterAll(() => {
  if (source !== '') rmSync(source, { recursive: true, force: true });
});

describe('CLI 端到端', () => {
  it('解读 → 默认路径下的单文件页面', () => {
    const result = run([source]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('用浏览器打开即可');
    expect(existsSync(output)).toBe(true);
    expect(statSync(output).size).toBeGreaterThan(2000);

    const html = readFileSync(output, 'utf8');
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).toContain('这份解读的边界');
  });

  it('--json 给出机器可读的报告', () => {
    const result = run([source, '--json']);
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as {
      ok: boolean;
      outputPath: string;
      files: number;
      cards: number;
      bytes: number;
    };
    expect(report.ok).toBe(true);
    expect(report.outputPath).toBe(output);
    expect(report.files).toBeGreaterThan(0);
    expect(report.cards).toBeGreaterThan(0);
    expect(report.bytes).toBeGreaterThan(2000);
  });

  it('--out 可以换输出位置', () => {
    const custom = join(source, 'view.html');
    const result = run([source, '--out', custom]);
    expect(result.status).toBe(0);
    expect(existsSync(custom)).toBe(true);
  });

  it('--no-images 不内联图片', () => {
    const plain = join(source, 'plain.html');
    const result = run([source, '--out', plain, '--no-images', '--json']);
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as { imagesInlined: number };
    expect(report.imagesInlined).toBe(0);
    expect(readFileSync(plain, 'utf8')).not.toContain('data:image');
  });

  it('缺解读时退出码 2，并说清先跑什么', () => {
    const empty = mkdtempSync(join(tmpdir(), 'foldercast-html-empty-'));
    try {
      const result = run([empty]);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('找不到解读');
      expect(result.stderr).toContain('pnpm analyze');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('参数有误时退出码 2，并打出用法', () => {
    const result = run(['--limit', '0', source]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--limit 需要一个正整数');
    expect(result.stderr).toContain('用法：');
  });
});
