/**
 * 端到端：真跑一遍 CLI 出片，并**验收「同一份讲稿渲染两次逐帧一致」**。
 *
 * 判据怎么定的：实测 Remotion 4.0.532 在按帧范围出图时会画错帧（最小复现见
 * `render.ts` 的说明），所以不能靠「同一次渲染里抽几帧比对」。改成**整片渲染两次比
 * sha256** —— 输入帧完全相同时 ffmpeg 的产物也是确定的，字节相同即逐帧相同。
 *
 * 夹具刻意做小（3 个场景、约 22 秒、1920×1080）：这条用例要跑两次真渲染，
 * 大了在 CI 上就是几分钟。它测的是**确定性**，不是版式细节（版式由 `plan.test.ts` 与
 * 静帧核对）。
 *
 * 没有浏览器的机器上，出片相关的用例**断言另一条路径**：CLI 必须给出结构化引导、
 * 退出码 3，而不是崩掉或静默下载。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { resolveBrowser } from '../browser.ts';
import { DEFAULT_VIDEO } from '../plan.ts';

const MAIN = resolve(import.meta.dirname, '../main.ts');
const browser = resolveBrowser();

let source = '';
let workRoot = '';

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

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** 三个场景的讲稿：封面、结构、结尾。旁白短，总长约 22 秒。 */
function writeFixture(): void {
  const reading = {
    foldercast: 1,
    generatedAt: '2026-10-05T00:00:00.000Z',
    source: { root: source, label: '夹具目录' },
    sources: { maxFiles: 500, maxDepth: 6, exclude: ['node_modules/**'] },
    stats: {
      totalFiles: 3,
      totalBytes: 2048,
      maxDepth: 2,
      kindCounts: { code: 1, text: 1, data: 1 },
      languages: { TypeScript: 40, Markdown: 12 },
      topDirs: [{ path: 'src', files: 2 }],
      roles: { readme: ['README.md'], entry: ['src/index.ts'] },
      secrets: { excluded: [], rescanned: [] },
    },
    manifest: [
      { path: 'README.md', kind: 'text', bytes: 512, lines: 12, language: 'Markdown', title: '说明' },
      { path: 'src/index.ts', kind: 'code', role: 'entry', bytes: 1024, lines: 40, language: 'TypeScript', importsCount: 1, importedByCount: 2 },
      { path: 'package.json', kind: 'data', bytes: 512, lines: 18, language: 'JSON' },
    ],
    graph: { nodes: 3, edges: 1, roots: ['src/index.ts'], hubs: [{ path: 'src/index.ts', in: 2, out: 1 }], leaves: ['README.md'], dangling: [] },
  };

  const script = {
    foldercast: 1,
    generatedAt: '2026-10-05T00:00:00.000Z',
    source: { root: source, label: '夹具目录' },
    title: '夹具目录',
    video: { width: DEFAULT_VIDEO.width, height: DEFAULT_VIDEO.height, fps: DEFAULT_VIDEO.fps, targetDurationSec: null },
    style: { preset: 'deck' },
    scenes: [
      { id: 'cover', type: 'cover', title: '夹具目录', subtitle: '三个文件', narration: '这是一个很小的目录，只有三个文件。' },
      { id: 'layout', type: 'tree', title: '结构', highlight: ['src'], narration: '结构很简单，源码放在 src 下。' },
      { id: 'outro', type: 'outro', title: '小结', narration: '就这些，谢谢观看。' },
    ],
  };

  mkdirSync(join(workRoot, 'out'), { recursive: true });
  writeFileSync(join(workRoot, 'foldercast.json'), `${JSON.stringify(reading, null, 2)}\n`);
  writeFileSync(join(workRoot, 'script.json'), `${JSON.stringify(script, null, 2)}\n`);
}

beforeAll(() => {
  source = mkdtempSync(join(tmpdir(), 'foldercast-render-'));
  workRoot = join(source, '.foldercast');
  mkdirSync(join(source, 'src'), { recursive: true });
  writeFileSync(join(source, 'README.md'), '# 夹具\n\n用来测渲染的目录。\n');
  writeFileSync(join(source, 'src/index.ts'), 'export const value = 1;\n');
  writeFileSync(join(source, 'package.json'), '{ "name": "fixture" }\n');
  writeFixture();
});

afterAll(() => {
  if (source !== '') rmSync(source, { recursive: true, force: true });
});

describe('CLI 端到端', () => {
  it('--check 不需要浏览器：报规格、时长与分镜', () => {
    const result = run([source, '--check']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('1920×1080 @ 30fps');
    expect(result.stdout).toContain('3 个场景');
    expect(result.stdout).toContain('cover');
    expect(result.stdout).toContain('内联图片');
  });

  it('--check --json 给出机器可读的计划摘要', () => {
    const result = run([source, '--check', '--json']);
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as {
      ok: boolean;
      scenes: number;
      durationInFrames: number;
      estimatedSec: number;
      timings: { id: string; seconds: number }[];
    };
    expect(report.ok).toBe(true);
    expect(report.scenes).toBe(3);
    expect(report.durationInFrames).toBeGreaterThan(0);
    expect(report.timings.map((timing) => timing.id)).toEqual(['cover', 'layout', 'outro']);
  });

  it('讲稿里的路径不存在时明确报错（不渲染一个空片）', () => {
    const broken = join(source, 'broken.json');
    writeFileSync(broken, `${JSON.stringify({ foldercast: 1, source: { root: source }, scenes: [] }, null, 2)}\n`);
    const result = run([source, '--script', broken, '--check']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('没有场景');
    rmSync(broken, { force: true });
  });

  it('讲稿与解读指向不同目录时拦下来', () => {
    const other = join(source, 'other.json');
    writeFileSync(
      other,
      `${JSON.stringify(
        { foldercast: 1, source: { root: '/tmp/elsewhere' }, scenes: [{ id: 'a', type: 'outro', title: '完', narration: '结束。' }] },
        null,
        2,
      )}\n`,
    );
    const result = run([source, '--script', other, '--check']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('不一致');
    rmSync(other, { force: true });
  });

  it('不认识的选项与坏参数都返回 2 并说明用法', () => {
    expect(run([source, '--nope']).status).toBe(2);
    expect(run([source, '--frames', 'abc']).status).toBe(2);
    expect(run(['--help']).status).toBe(0);
  });
});

describe.skipIf(browser.kind === 'missing')('出片', () => {
  it(
    '同一份讲稿渲染两次，输出字节一致（逐帧一致的判据）',
    { timeout: 900_000 },
    () => {
      const first = join(workRoot, 'out', 'first.mp4');
      const second = join(workRoot, 'out', 'second.mp4');

      const runA = run([source, '--out', first]);
      expect(runA.status).toBe(0);
      const runB = run([source, '--out', second]);
      expect(runB.status).toBe(0);

      // 先确认两次都不是空文件，再比字节 —— 否则「两个空文件相同」也会绿
      expect(readFileSync(first).length).toBeGreaterThan(20_000);
      expect(sha256(first)).toBe(sha256(second));

      // 用 ffprobe 核对容器：规格来自 plan，编码是 h264，没有音轨（M8 才配音）
      const probe = execFileSync(
        'ffprobe',
        ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,nb_frames', '-of', 'json', first],
        { encoding: 'utf8' },
      );
      const streams = (JSON.parse(probe) as { streams: { codec_type: string; codec_name: string; width: number; height: number; nb_frames: string }[] }).streams;
      expect(streams).toHaveLength(1);
      expect(streams[0]).toMatchObject({ codec_type: 'video', codec_name: 'h264', width: DEFAULT_VIDEO.width, height: DEFAULT_VIDEO.height });
      expect(Number(streams[0]?.nb_frames)).toBeGreaterThan(300);
    },
  );

  it(
    '--frames 出一小段（调画面用），帧数与容器时长对得上',
    { timeout: 300_000 },
    () => {
      const clip = join(workRoot, 'out', 'clip.mp4');
      const result = run([source, '--frames', '1-45', '--out', clip]);
      expect(result.status).toBe(0);
      const probe = execFileSync(
        'ffprobe',
        ['-v', 'error', '-show_entries', 'format=duration', '-show_entries', 'stream=nb_frames', '-of', 'json', clip],
        { encoding: 'utf8' },
      );
      const parsed = JSON.parse(probe) as { streams: { nb_frames: string }[]; format: { duration: string } };
      expect(Number(parsed.streams[0]?.nb_frames)).toBe(45);
      expect(Number(parsed.format.duration)).toBeCloseTo(45 / DEFAULT_VIDEO.fps, 1);
    },
  );

  it(
    '--still 出一张静帧（PNG）',
    { timeout: 300_000 },
    () => {
      const still = join(workRoot, 'out', 'still.png');
      const result = run([source, '--still', '1', '--out', still]);
      expect(result.status).toBe(0);
      const bytes = readFileSync(still);
      // PNG 魔数（用字节比，不写转义字符串 —— 转义在两层里会数错）
      expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(bytes.length).toBeGreaterThan(5_000);
    },
  );

  it('--json 给出成片路径与字节数', { timeout: 900_000 }, () => {
    const out = join(workRoot, 'out', 'json.mp4');
    const result = run([source, '--out', out, '--json']);
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as { ok: boolean; outputPath: string; renderMs: number };
    expect(report.ok).toBe(true);
    expect(report.outputPath).toBe(out);
    expect(report.renderMs).toBeGreaterThan(0);
  });
});

describe.skipIf(browser.kind !== 'missing')('没有浏览器时', () => {
  it('不下载、不崩溃：给出结构化引导并返回退出码 3', () => {
    const result = run([source]);
    expect(result.status).toBe(3);
    expect(result.stderr).toContain('渲染需要浏览器');
    expect(result.stderr).toContain('remotion browser ensure');
    expect(result.stderr).toContain('只影响出片');
  });

  it('--json 也把引导带出来', () => {
    const result = run([source, '--json']);
    expect(result.status).toBe(3);
    const report = JSON.parse(result.stdout) as { ok: boolean; guidance: string };
    expect(report.ok).toBe(false);
    expect(report.guidance).toContain('渲染需要浏览器');
  });
});
