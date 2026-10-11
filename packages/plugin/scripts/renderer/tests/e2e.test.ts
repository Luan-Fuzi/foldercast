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
 *
 * **一条实测经验，值得写下来**：机器被占满时（上一次渲染留下的 Chrome 进程、或者
 * 另一个正在渲整片的任务），这条用例会失败 —— 它比的是**字节**，而 SwiftShader 的软件
 * 光栅在 CPU 被抢的时候不再逐位可复现。同一个文件单独跑、或者机器空着的时候跑，几十次都过。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { hasCommand } from '../../assets/run.ts';
import { checkScript } from '../check.ts';
import { resolveBrowser } from '../browser.ts';
import { DEFAULT_VIDEO } from '../plan.ts';
import type { ScriptDocument } from '../../contracts/script.ts';

const MAIN = resolve(import.meta.dirname, '../main.ts');
const browser = resolveBrowser();
/**
 * ffmpeg / ffprobe 是**系统工具**，不是 npm 依赖：本机有、CI runner 上没有。
 * 所以「能不能出片」（要浏览器）与「能不能核对容器」（要 ffprobe）分成两层判据 ——
 * 缺 ffprobe 时仍然跑两次渲染比 sha256，只是不核对 h264 与帧数。
 */
const hasFfprobe = hasCommand('ffprobe');

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

/** 三个场景的讲稿：封面、结构、结尾。旁白短，总长约 22 秒。自足式 —— 数字都是写死的。 */
function fixtureScript(): ScriptDocument {
  return {
    foldercast: 2,
    source: { root: source, label: '夹具目录' },
    title: '夹具目录',
    video: { width: DEFAULT_VIDEO.width, height: DEFAULT_VIDEO.height, fps: DEFAULT_VIDEO.fps, targetDurationSec: null },
    scenes: [
      { id: 'cover', type: 'cover', title: '夹具目录', subtitle: '三个文件', narration: '这是一个很小的目录，只有三个文件。' },
      {
        id: 'layout',
        type: 'tree',
        title: '结构',
        entries: [
          { path: 'src', files: 1, bytes: 1024, highlight: true },
          { path: '.', files: 2, bytes: 1024 },
        ],
        narration: '结构很简单，源码在 src 下。',
        beats: [{ points: ['src 一个源码文件', '根目录两个散文件', '数字写死，夹具自足'], enter: 'reveal' }],
      },
      { id: 'outro', type: 'outro', title: '小结', lines: ['三个文件，一个小目录。'], narration: '就这些，谢谢观看。' },
    ],
  };
}

beforeAll(() => {
  source = mkdtempSync(join(tmpdir(), 'foldercast-render-'));
  workRoot = join(source, '.foldercast');
  mkdirSync(join(source, 'src'), { recursive: true });
  writeFileSync(join(source, 'README.md'), '# 夹具\n\n用来测渲染的目录。\n');
  writeFileSync(join(source, 'src/index.ts'), 'export const value = 1;\n');
  writeFileSync(join(source, 'package.json'), '{ "name": "fixture" }\n');
  mkdirSync(join(workRoot, 'out'), { recursive: true });
  writeFileSync(join(workRoot, 'script.json'), `${JSON.stringify(fixtureScript(), null, 2)}\n`);
});

afterAll(() => {
  if (source !== '') rmSync(source, { recursive: true, force: true });
});

describe('夹具', () => {
  it('夹具讲稿必须过契约校验（否则验的不是「讲稿真能过校验」）', async () => {
    const report = await checkScript(fixtureScript(), source);
    expect(report.issues, JSON.stringify(report.issues, null, 2)).toEqual([]);
  });
});

describe('CLI 端到端', () => {
  it('--check 不需要浏览器：报规格、时长与分镜', () => {
    const result = run([source, '--check']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('1920×1080 @ 30fps');
    expect(result.stdout).toContain('3 个场景');
    expect(result.stdout).toContain('cover');
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

  it('讲稿引用的文件不存在时是 blocker，退出 2 并指名道姓', () => {
    const broken = join(source, 'broken.json');
    const script = fixtureScript();
    script.scenes[1] = { id: 'layout', type: 'file', file: 'src/nope.ts', narration: '讲一个不存在的文件。' };
    writeFileSync(broken, `${JSON.stringify(script, null, 2)}\n`);
    const result = run([source, '--script', broken, '--check', '--json']);
    expect(result.status).toBe(2);
    expect(result.stdout).toContain('path-missing');
    expect(result.stdout).toContain('src/nope.ts');
    rmSync(broken, { force: true });
  });

  it('没有场景的讲稿被拦下', () => {
    const broken = join(source, 'broken.json');
    writeFileSync(broken, `${JSON.stringify({ foldercast: 2, source: { root: source }, scenes: [] }, null, 2)}\n`);
    const result = run([source, '--script', broken, '--check']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('没有场景');
    rmSync(broken, { force: true });
  });

  it('不认识的选项与坏参数都返回 2 并说明用法', () => {
    expect(run([source, '--nope']).status).toBe(2);
    expect(run([source, '--frames', 'abc']).status).toBe(2);
    expect(run(['--help']).status).toBe(0);
  });
});

describe.skipIf(browser.kind === 'missing')('出片', () => {
  it(
    '同一份讲稿渲染两次，画面逐帧视觉一致（一致性判据）',
    { timeout: 900_000 },
    () => {
      const first = join(workRoot, 'out', 'first.mp4');
      const second = join(workRoot, 'out', 'second.mp4');

      const runA = run([source, '--out', first]);
      expect(runA.status).toBe(0);
      const runB = run([source, '--out', second]);
      expect(runB.status).toBe(0);

      // 先确认两次都不是空文件，再比画面 —— 否则「两个空文件相同」也会绿
      expect(readFileSync(first).length).toBeGreaterThan(20_000);
      // 判据（0006 起改）：字节相等直接过；不相等时要求**每一帧** PSNR ≥ 45dB。
      // 原判据是整片 sha256 相等——浅色视觉基下实测不可达：Chrome 字形光栅化的亚像素
      // 噪声过 JPEG 量化后字节必差（实测噪声下限 78dB；深色主题时被量化抹平，历史绿）。
      // 真·画面回归（错帧/字幕错位/图形缺失）会远低于 45dB。
      if (sha256(first) !== sha256(second)) {
        if (hasFfprobe) {
          const stats = join(workRoot, 'out', 'psnr.log');
          execFileSync(
            'ffmpeg',
            // 相对文件名避免 Windows 路径被当成 filter 语法。
            ['-v', 'error', '-i', first, '-i', second, '-lavfi', 'psnr=stats_file=psnr.log', '-f', 'null', '-'],
            { encoding: 'utf8', cwd: join(workRoot, 'out') },
          );
          let floor = Number.POSITIVE_INFINITY;
          for (const line of readFileSync(stats, 'utf8').split('\n')) {
            const match = /psnr_avg:([0-9.]+|inf)/.exec(line);
            if (match === null) continue;
            floor = match[1] === 'inf' ? floor : Math.min(floor, Number(match[1]));
          }
          expect(floor, `逐帧 PSNR 下限（45dB=视觉一致；实测噪声在 78dB 以上）`).toBeGreaterThanOrEqual(45);
        } else {
          // 没有 ffmpeg 时退回字节判据：本地总有 ffmpeg，这条只影响极简环境
          expect(sha256(first)).toBe(sha256(second));
        }
      }

      // 用 ffprobe 核对容器：规格来自 plan，编码是 h264，没有音轨（这条夹具没配音）
      if (!hasFfprobe) return;
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

  it.skipIf(!hasFfprobe)(
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
