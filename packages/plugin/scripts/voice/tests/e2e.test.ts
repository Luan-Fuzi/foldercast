/**
 * 端到端：`pnpm voice` → `pnpm render`，并验收 **M8 的判据**：
 *
 * > 换 provider 或音色后重跑本阶段，画面不变、仅音色与时长不同。
 *
 * 「画面不变」在这里是可断言的：两份 `durations.json` 的**时长完全相同**、只有音色不同时，
 * 两次渲染必须产出**字节相同的视频流**。这比「看起来一样」硬得多，也比比整个 mp4 更准 ——
 * 音轨不同，整个 mp4 当然不同，所以要比的是**去掉音频之后的帧**。
 *
 * 做法：两次分别渲染，再用 ffmpeg 把画面抽成无损帧、比 sha256。音轨用 `-an` 丢掉。
 *
 * 不用真 provider：假 provider 按文本长度写一段真实音频（真的用 ffprobe 量），
 * 所以调度、实测、写表、渲染、抽帧这一整条链路都是真的，只有「谁在说话」是假的。
 * 真正的音色差异由人耳验收，不进 CI。
 *
 * **与渲染那条一样，它要在机器空着的时候跑**：比的是帧的字节，而软件光栅在 CPU 被抢时
 * 不再逐位可复现。单独跑几十次全过；整套里同时有别的整片渲染时会失败。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { TtsProvider } from '../../contracts/durations.ts';
import { hasCommand } from '../../assets/run.ts';
import { checkScript } from '../../renderer/check.ts';
import { makeVoiceEnv } from '../env.ts';
import { synthesize } from '../synth.ts';
import { resolveBrowser } from '../../renderer/browser.ts';

const RENDER_MAIN = resolve(import.meta.dirname, '../../renderer/main.ts');
const browser = resolveBrowser();
const hasFfmpeg = hasCommand('ffmpeg');

let root = '';
let workRoot = '';

/**
 * 假 provider：**时长只由文本长度决定**，与音色无关；**样本数完全一致**，只有波形不同。
 *
 * 这两条都是判据的关键：
 *
 * - 时长不变 → 画面不该变（换音色只改声音）；
 * - 波形不同 → 音轨真的换了（否则「画面相同」只证明渲染器确定，什么也没证明）。
 *
 * 写的是一个真正的 RIFF/WAVE：先定样本数，再填波形与头部，所以两次的字节数**完全相同**。
 */
function fakeProvider(name: string): TtsProvider {
  const sampleRate = 44100;
  return {
    name,
    requiresKey: false,
    capabilities: [],
    describe: () => `测试用假 provider（${name}）`,
    preflight: () => ({ ok: true }),
    async synth(request) {
      const samples = Math.max(Math.round(0.8 * sampleRate), Math.round(([...request.text].length / 4) * sampleRate));
      const data = Buffer.alloc(samples * 2);
      for (let i = 0; i < samples; i += 1) {
        // A：440Hz；B：880Hz。响度适中，编解码都稳定
        const frequency = name.endsWith('b') ? 880 : 440;
        data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 8000), i * 2);
      }
      const header = Buffer.alloc(44);
      header.write('RIFF', 0, 'latin1');
      header.writeUInt32LE(36 + data.length, 4);
      header.write('WAVE', 8, 'latin1');
      header.write('fmt ', 12, 'latin1');
      header.writeUInt32LE(16, 16);
      header.writeUInt16LE(1, 20);
      header.writeUInt16LE(1, 22);
      header.writeUInt32LE(sampleRate, 24);
      header.writeUInt32LE(sampleRate * 2, 28);
      header.writeUInt16LE(2, 32);
      header.writeUInt16LE(16, 34);
      header.write('data', 36, 'latin1');
      header.writeUInt32LE(data.length, 40);
      writeFileSync(request.outPath, Buffer.concat([header, data]));
      return { format: 'wav', note: `${name} 合成 ${(samples / sampleRate).toFixed(2)}s` };
    },
  };
}

/** 渲染成 mp4，然后用 ffmpeg 抽成无损帧、返回每帧的 sha256（丢掉音轨）。 */
function renderAndHashFrames(outPath: string): string[] {
  execFileSync('node', [RENDER_MAIN, root, '--out', outPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  // `-f framemd5` 给的是每一帧解码后的校验和：只看画面，音轨用 `-an` 丢掉
  const md5 = execFileSync('ffmpeg', ['-v', 'error', '-i', outPath, '-an', '-f', 'framemd5', '-'], { encoding: 'utf8' });
  return md5
    .split('\n')
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => line.split(',').at(-1)?.trim() ?? '');
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'foldercast-m8-'));
  workRoot = join(root, '.foldercast');
  mkdirSync(workRoot, { recursive: true });
  writeFileSync(
    join(workRoot, 'script.json'),
    `${JSON.stringify(
      {
        foldercast: 1,
        source: { root },
        title: '配音端到端夹具',
        scenes: [
          { id: 'cover', type: 'cover', title: '开头', narration: '这是第一段旁白，比较短。' },
          { id: 'outro', type: 'outro', title: '结尾', narration: '这是第二段旁白，稍微长一点点，用来看时长分配。' },
        ],
      },
      null,
      2,
    )}\n`,
  );
});

afterAll(() => {
  if (root !== '') rmSync(root, { recursive: true, force: true });
});

describe('夹具', () => {
  it('夹具讲稿必须过契约校验（否则验的不是真讲稿）', async () => {
    const script = JSON.parse(readFileSync(join(workRoot, 'script.json'), 'utf8')) as Parameters<typeof checkScript>[0];
    const report = await checkScript(script, root);
    expect(report.issues, JSON.stringify(report.issues, null, 2)).toEqual([]);
  });
});

describe.skipIf(!hasFfmpeg)('配音 → 出片', () => {
  it('写出 durations.json 与音轨，两段旁白都有实测时长', { timeout: 120_000 }, async () => {
    const report = await synthesize({
      target: root,
      workRoot,
      provider: fakeProvider('voice-a'),
      env: makeVoiceEnv({ has: () => true }),
    });
    expect(report.scenes).toHaveLength(2);
    expect(report.scenes.every((scene) => scene.audioSec > 0.5)).toBe(true);
    expect(report.trackPath).toBeDefined();
  });

  it(
    '换 provider 重跑：时长不变时**画面逐帧相同**，只有音轨不同（M8 判据）',
    { timeout: 900_000 },
    async () => {
      // 第一遍：A 音色
      await synthesize({
        target: root,
        workRoot,
        provider: fakeProvider('voice-a'),
        env: makeVoiceEnv({ has: () => true }),
        force: true,
      });
      const beforeDoc = JSON.parse(readFileSync(join(workRoot, 'durations.json'), 'utf8')) as {
        scenes: { id: string; duration: number }[];
      };
      const first = join(root, 'a.mp4');
      const framesA = renderAndHashFrames(first);

      // 第二遍：B 音色。时长只由文本决定，所以两遍的时长必须一模一样
      await synthesize({
        target: root,
        workRoot,
        provider: fakeProvider('voice-b'),
        env: makeVoiceEnv({ has: () => true }),
        force: true,
      });
      const afterDoc = JSON.parse(readFileSync(join(workRoot, 'durations.json'), 'utf8')) as {
        scenes: { id: string; duration: number }[];
      };
      expect(afterDoc.scenes.map((scene) => scene.duration)).toEqual(beforeDoc.scenes.map((scene) => scene.duration));

      const second = join(root, 'b.mp4');
      const framesB = renderAndHashFrames(second);

      expect(framesA.length).toBeGreaterThan(50);
      expect(framesB.length).toBe(framesA.length);
      expect(framesB).toEqual(framesA);

      // 音轨确实换了（否则上面那条只是「渲染器是确定性的」）
      const bytesA = readFileSync(first);
      const bytesB = readFileSync(second);
      expect(createHash('sha256').update(bytesA).digest('hex')).not.toBe(createHash('sha256').update(bytesB).digest('hex'));
    },
  );

  it('画面里有配音、字幕由渲染层画（成片带音轨）', { timeout: 120_000 }, () => {
    const probe = execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'json', join(root, 'b.mp4')],
      { encoding: 'utf8' },
    );
    const streams = (JSON.parse(probe) as { streams: { codec_type: string }[] }).streams.map((stream) => stream.codec_type);
    expect(streams).toContain('audio');
    expect(streams).toContain('video');
  });
});

describe.skipIf(browser.kind === 'missing' || !hasFfmpeg)('没有配音时', () => {
  it('删掉 durations.json 后渲染回到「按字数预估」的静音片', { timeout: 600_000 }, () => {
    rmSync(join(workRoot, 'durations.json'), { force: true });
    const out = join(root, 'silent.mp4');
    execFileSync('node', [RENDER_MAIN, root, '--out', out], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', out], {
      encoding: 'utf8',
    });
    const streams = (JSON.parse(probe) as { streams: { codec_type: string }[] }).streams.map((stream) => stream.codec_type);
    expect(streams).toEqual(['video']);
  });
});
