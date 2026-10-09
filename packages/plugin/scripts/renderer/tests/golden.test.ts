/**
 * 画面基线回归（0005：吸收自 HyperFrames 的 golden 基线范式，本地轻量版）。
 *
 * **只在本机跑，不进 CI**：基线是「本机字体 + 本机 Chrome」的产物，跨机器不可比；
 * CI runner 是一次性容器，写基线也没有回归价值（check.yml 显式排除本文件）。
 *
 * 做法：渲两张静帧（一个代码 file 场景、一个 Markdown file 场景 —— 0005 重排的两个
 * 主战场），与 `golden.local.json`（gitignore）里的 sha256 比；第一次跑生成基线。
 * 画面变了基线就对不上 → 测试红；确认是**有意的**版式改动后，删掉基线文件重跑一次。
 * 它抓的是「没人预期到的画面变化」—— 这类变化靠人工目检兜不住。
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { resolveBrowser } from '../browser.ts';
import { DEFAULT_VIDEO } from '../plan.ts';
import type { ScriptDocument } from '../../contracts/script.ts';

const MAIN = resolve(import.meta.dirname, '../main.ts');
const browser = resolveBrowser();
const BASELINE = resolve(import.meta.dirname, 'golden.local.json');

function run(args: readonly string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('node', [MAIN, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const failed = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failed.status ?? -1, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
  }
}

/** 两个 file 场景的最小讲稿：一个代码（带行号槽），一个 Markdown（渲染成排版）。 */
function fixtureScript(source: string): ScriptDocument {
  return {
    foldercast: 2,
    source: { root: source, label: '画面基线' },
    video: { width: DEFAULT_VIDEO.width, height: DEFAULT_VIDEO.height, fps: DEFAULT_VIDEO.fps, targetDurationSec: null },
    scenes: [
      {
        id: 'code-scene',
        type: 'file',
        title: '代码场景',
        file: 'src/app.ts',
        excerptStart: 1,
        excerpt: [
          'export function greet(name: string): string {',
          '  // 问候语：确定性的输入，确定性的输出',
          '  const message = `Hello, ${name}!`;',
          '  return message;',
          '}',
          '',
          'export const ANSWER = 42;',
          'export default greet;',
        ],
        narration: '代码文件，带行号与高亮。',
        durationSec: 5,
      },
      {
        id: 'md-scene',
        type: 'file',
        title: 'Markdown 场景',
        file: 'notes.md',
        excerpt: [
          '# 计划',
          '',
          '这一段是**重点**，粗体要渲染成粗体，不是星号。',
          '',
          '- 第一条：列表是列表',
          '- 第二条：缩进是缩进',
          '- 第三条：`code` 是行内代码',
          '',
          '> 引用块走左侧强调条。',
        ],
        narration: 'Markdown 文件，渲染成排版。',
        durationSec: 5,
      },
    ],
  };
}

describe.skipIf(browser.kind === 'missing')('画面基线（本地，golden.local.json）', () => {
  it(
    '两张静帧与基线一致；首跑生成基线',
    { timeout: 300_000 },
    () => {
      const source = mkdtempSync(join(tmpdir(), 'foldercast-golden-'));
      try {
        mkdirSync(join(source, 'src'), { recursive: true });
        writeFileSync(join(source, 'src/app.ts'), 'export function app() { return 1; }\n');
        writeFileSync(join(source, 'notes.md'), '# notes\n\n画面基线夹具。\n');
        mkdirSync(join(source, '.foldercast'), { recursive: true });
        writeFileSync(join(source, '.foldercast', 'script.json'), `${JSON.stringify(fixtureScript(source), null, 2)}\n`);

        const hashes: Record<string, string> = {};
        for (const [key, at] of [
          ['code', '2'],
          ['md', '7'],
        ] as const) {
          const out = join(source, '.foldercast', `golden-${key}.png`);
          const result = run([source, '--still', at, '--out', out]);
          expect(result.status, result.stdout + result.stderr).toBe(0);
          hashes[key] = createHash('sha256').update(readFileSync(out)).digest('hex');
        }

        const previous = existsSync(BASELINE)
          ? (JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, string>)
          : undefined;
        if (previous === undefined) {
          writeFileSync(BASELINE, `${JSON.stringify(hashes, null, 2)}\n`);
          console.log(`画面基线第一次生成：${BASELINE}`);
          return;
        }
        expect(
          hashes,
          `画面与基线不一致（code=${hashes.code} md=${hashes.md}）。` +
            `有意的版式改动：删掉 ${BASELINE} 重新生成；无意的：查这次改动为什么动了画面。`,
        ).toEqual(previous);
      } finally {
        rmSync(source, { recursive: true, force: true });
      }
    },
  );
});
