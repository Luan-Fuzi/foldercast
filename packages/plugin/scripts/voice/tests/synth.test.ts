/**
 * 配音阶段的调度：跳过已存在的音频、实测时长、`durations.json` 的内容。
 *
 * **完全离线**：用一个假的 provider（拿到文本就写一个固定长度的 wav），所以这里测的是
 * 「调度与算术」，不是 TTS 本身。真实 provider 由人手工听一遍。
 *
 * 三条判据：
 *
 * 1. 已存在的音频**不重新合成**（TTS 有配额与费用），`--force` 才重合成；
 * 2. 时长来自**实测**（这里是假 provider 写的真实音频，真的用 ffprobe 量）；
 * 3. `durations.json` 自洽：`duration = audioSec + pause`，字幕块之和等于 `duration`，
 *    音轨长度等于各场景之和。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DurationsDocument } from '../../contracts/durations.ts';
import type { TtsProvider, VoiceEnv } from '../../contracts/durations.ts';
import { makeVoiceEnv, parseEnvFile } from '../env.ts';
import { listProviders, findProvider, providerNames } from '../providers/index.ts';
import { audioFileName, subtitlesFor, synthesize, SynthError } from '../synth.ts';

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

let root = '';
let workRoot = '';

/** 假 provider：按文本长度决定音频时长，文件真的写出来（后面要 ffprobe 量）。 */
function fakeProvider(): TtsProvider {
  return {
    name: 'fake',
    requiresKey: false,
    capabilities: [],
    describe: () => '测试用假 provider',
    preflight: () => ({ ok: true }),
    async synth(request) {
      // 时长按字数算：4 字/秒 —— 这正是「预估」，用它造出可测量的音频
      const seconds = Math.max(0.6, [...request.text].length / 4);
      execFileSync(
        'ffmpeg',
        ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `anullsrc=r=44100:cl=mono`, '-t', seconds.toFixed(3), '-c:a', 'pcm_s16le', request.outPath],
        { stdio: 'ignore' },
      );
      return { format: 'wav' };
    },
  };
}

function writeFixture(narrationParts: string[]): void {
  const script = {
    foldercast: 1,
    source: { root },
    title: '配音夹具',
    voice: { provider: 'say' },
    scenes: narrationParts.map((narration, index) => ({
      id: `scene-${String(index)}`,
      type: 'outro',
      title: `第 ${String(index)} 段`,
      narration,
    })),
  };
  writeFileSync(join(workRoot, 'script.json'), `${JSON.stringify(script, null, 2)}\n`);
}

/** 完全离线的环境：命令都在、没有密钥。 */
function offlineEnv(): VoiceEnv {
  return makeVoiceEnv({ env: {}, has: () => true, exec: async () => ({ ok: true, stdout: '', stderr: '' }) });
}

const fake = fakeProvider();

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'foldercast-voice-'));
  workRoot = join(root, '.foldercast');
  mkdirSync(workRoot, { recursive: true });
});

afterAll(() => {
  if (root !== '') rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!hasFfmpeg)('字幕块分配', () => {
  it('各块之和正好等于场景时长（毫秒级）', () => {
    const subs = subtitlesFor('第一句在这里。第二句稍微长一点，带一个逗号。第三句收尾。', 9.123);
    const sum = subs.reduce((acc, [, seconds]) => acc + seconds, 0);
    expect(sum).toBeCloseTo(9.123, 2);
  });

  it('文本与讲稿切分一致（渲染层用同一份）', () => {
    const narration = '第一句在这里。第二句稍微长一点，带一个逗号。';
    const subs = subtitlesFor(narration, 6);
    expect(subs.map(([text]) => text).join('')).toBe(narration);
  });

  it('空旁白没有块', () => {
    expect(subtitlesFor('', 5)).toEqual([]);
  });
});

describe('音频文件名', () => {
  it('用场景 id，保留 Unicode，不撞名', () => {
    expect(audioFileName('cover')).toBe('audio/cover.wav');
    expect(audioFileName('封面')).toBe('audio/封面.wav');
    expect(audioFileName('小结')).toBe('audio/小结.wav');
  });

  it('路径分隔符不会跑出 audio 目录', () => {
    expect(audioFileName('a/b')).toBe('audio/a_b.wav');
    // `..` 会被换成 `_`：场景 id 不能拼出 audio 目录之外的名字
    expect(audioFileName('..')).toBe('audio/_.wav');
    expect(audioFileName('a/../../etc/passwd')).toBe('audio/a_.._.._etc_passwd.wav');
  });
});

describe('env 文件解析', () => {
  it('认 KEY=value、注释、引号；不展开变量', () => {
    const values = parseEnvFile(
      ['# 注释', 'MIMO_API_KEY=sk-123', 'OTHER="quoted value"', "SINGLE='x'", 'EMPTY=', 'NOVALUE'].join('\n'),
    );
    expect(values).toEqual({ MIMO_API_KEY: 'sk-123', OTHER: 'quoted value', SINGLE: 'x' });
  });
});

describe('provider 注册表', () => {
  it('默认是免密钥的 say；名字对不上时不静默回落', () => {
    expect(findProvider(undefined)?.name).toBe('say');
    expect(findProvider('mimo')?.name).toBe('mimo');
    expect(findProvider('nope')).toBeUndefined();
    expect(providerNames()).toContain('say');
  });

  it('列表里带「要不要密钥」，配置界面与文档都靠它', () => {
    const rows = listProviders();
    expect(rows.find((row) => row.name === 'say')?.requiresKey).toBe(false);
    expect(rows.find((row) => row.name === 'mimo')?.requiresKey).toBe(true);
  });
});

describe.skipIf(!hasFfmpeg)('合成调度', () => {
  it('按场景逐个合成，写出 durations.json 与音轨', async () => {
    writeFixture(['第一段旁白，比较短。', '第二段旁白，稍微长一点点，用来核对时长分配。']);
    const report = await synthesize({
      target: root,
      workRoot,
      env: offlineEnv(),
      provider: fake,
      now: new Date('2026-10-05T12:00:00+08:00'),
    });

    expect(report.ok).toBe(true);
    expect(report.scenes.map((scene) => scene.id)).toEqual(['scene-0', 'scene-1']);
    expect(report.synthesized).toBe(2);

    const document = JSON.parse(readFileSync(report.durationsPath, 'utf8')) as DurationsDocument;
    expect(document.durations).toBe(1);
    expect(document.generatedAt).toBe('2026-10-05T12:00:00+08:00');
    expect(document.pause).toBeGreaterThan(0);
    expect(document.track).toBe('audio/narration.wav');
    for (const scene of document.scenes) {
      expect(scene.duration).toBeCloseTo(scene.audioSec + document.pause, 3);
      const sum = scene.subs.reduce((acc, [, seconds]) => acc + seconds, 0);
      expect(sum).toBeCloseTo(scene.duration, 2);
      expect(existsSync(join(workRoot, scene.audio))).toBe(true);
    }
    expect(existsSync(join(workRoot, document.track))).toBe(true);

    // 音轨长度 = 各场景之和
    const measured = Number(
      execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', join(workRoot, document.track)], {
        encoding: 'utf8',
      }).trim(),
    );
    const total = document.scenes.reduce((acc, scene) => acc + scene.duration, 0);
    expect(measured).toBeCloseTo(total, 1);
  });

  it('音频已存在就不重新合成（省配额）', async () => {
    const report = await synthesize({ target: root, workRoot, env: offlineEnv(), provider: fake });
    expect(report.synthesized).toBe(0);
    expect(report.cached).toBe(2);
  });

  it('全部命中缓存时仍然报出「实际用的音色」（不能因为没合成就不写）', async () => {
    // 这条是实测踩出来的：`say` 会在合成时自动挑中文音色，而全缓存那一次合成根本不跑，
    // 于是 durations.json 里的 voice 变成空 —— 报告与产物都要记「实际用的」。
    const naming: TtsProvider = {
      ...fake,
      async resolveVoice() {
        return '自动挑的音色';
      },
    };
    const report = await synthesize({ target: root, workRoot, env: offlineEnv(), provider: naming });
    expect(report.cached).toBe(2);
    expect(report.voice).toBe('自动挑的音色');
    const document = JSON.parse(readFileSync(report.durationsPath, 'utf8')) as DurationsDocument;
    expect(document.voice).toBe('自动挑的音色');
  });

  it('provider 说不出音色时退回上一次产物里记的那个', async () => {
    const forgetful: TtsProvider = { ...fake, resolveVoice: async () => undefined };
    const report = await synthesize({ target: root, workRoot, env: offlineEnv(), provider: forgetful });
    expect(report.voice).toBe('自动挑的音色');
  });

  it('--force 重新合成', async () => {
    const report = await synthesize({ target: root, workRoot, env: offlineEnv(), provider: fake, force: true });
    expect(report.synthesized).toBe(2);
    expect(report.cached).toBe(0);
  });

  it('--limit 只做前几个场景，其余留给预估', async () => {
    const report = await synthesize({ target: root, workRoot, env: offlineEnv(), provider: fake, limit: 1, force: true });
    expect(report.scenes.map((scene) => scene.id)).toEqual(['scene-0']);
    expect(report.scenes).toHaveLength(1);
  });

  it('--no-track 不拼音轨，track 为空串', async () => {
    const report = await synthesize({ target: root, workRoot, env: offlineEnv(), provider: fake, track: false });
    const document = JSON.parse(readFileSync(report.durationsPath, 'utf8')) as DurationsDocument;
    expect(document.track).toBe('');
    expect(report.trackPath).toBeUndefined();
  });

  it('讲稿不存在时给出可操作的错误', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'foldercast-voice-empty-'));
    await expect(synthesize({ target: empty, env: offlineEnv(), provider: fake })).rejects.toThrow(/找不到讲稿/);
    rmSync(empty, { recursive: true, force: true });
  });

  it('不认识的 provider 明确报错，不静默回落', async () => {
    await expect(synthesize({ target: root, workRoot, env: offlineEnv(), provider: 'nope' })).rejects.toThrow(
      /不认识的 provider：nope/,
    );
  });

  it('缺密钥的 provider：SynthError 带退出码 4（可操作的环境问题）', async () => {
    // mimo 走真实实现：没密钥时 preflight 就拦下，不会发请求
    try {
      await synthesize({ target: root, workRoot, env: makeVoiceEnv({ env: {}, has: () => true }), provider: 'mimo' });
      throw new Error('应当抛错');
    } catch (error) {
      expect(error).toBeInstanceOf(SynthError);
      expect((error as SynthError).exitCode).toBe(4);
      expect((error as SynthError).message).toContain('MIMO_API_KEY');
    }
  });
});
