/**
 * `edge` provider：音色解析、preflight、合成调度（临时文件 → ffmpeg 规格化）。
 *
 * **不发真请求**（CI 只测 runner 能证明的，教训见 commit `4af655d`）：`msedge-tts` 整个
 * mock 掉，ffmpeg 用假的 `exec` 拦下来。真实合成与听感在本地验收，结论记回
 * docs/decisions/0002。
 */
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExecResult, VoiceEnv } from '../../contracts/durations.ts';
import { makeVoiceEnv } from '../env.ts';

/** mock 的可变状态：每个用例告诉假 MsEdgeTTS 这次吐什么。 */
const state = vi.hoisted(() => ({
  chunks: [Buffer.from('fake-mp3-bytes')],
  failWith: undefined as Error | undefined,
  metadata: { voice: '', format: '' },
}));

vi.mock('msedge-tts', () => ({
  OUTPUT_FORMAT: { AUDIO_24KHZ_96KBITRATE_MONO_MP3: 'audio-24khz-96kbitrate-mono-mp3' },
  MsEdgeTTS: class {
    async setMetadata(voice: string, outputFormat: string) {
      state.metadata = { voice, format: outputFormat };
    }
    toStream() {
      if (state.failWith !== undefined) {
        const stream = new Readable({ read() {} });
        queueMicrotask(() => stream.destroy(state.failWith));
        return { audioStream: stream };
      }
      return { audioStream: Readable.from(state.chunks) };
    }
    close() {}
  },
}));

const { DEFAULT_VOICE, edgeProvider } = await import('../providers/edge.ts');

/** 拦下 ffmpeg 调用并记录参数（不真转码，这里测的是调度与参数，不是 ffmpeg 本身）。 */
function fakeExec(log: { command: string; args: string[] }[] = []): VoiceEnv['exec'] {
  return async (command, args): Promise<ExecResult> => {
    log.push({ command, args: [...args] });
    return { ok: true, stdout: '', stderr: '' };
  };
}

afterEach(() => {
  state.failWith = undefined;
  state.chunks = [Buffer.from('fake-mp3-bytes')];
});

describe('音色', () => {
  it('显式指定就用它；没指定用默认中文音色', async () => {
    const env = makeVoiceEnv();
    await expect(edgeProvider.resolveVoice?.({ voice: 'zh-CN-YunjianNeural' }, env)).resolves.toBe('zh-CN-YunjianNeural');
    await expect(edgeProvider.resolveVoice?.({}, env)).resolves.toBe(DEFAULT_VOICE);
    await expect(edgeProvider.resolveVoice?.({ voice: '' }, env)).resolves.toBe(DEFAULT_VOICE);
  });

  it('默认音色在预置列表里', () => {
    expect(edgeProvider.listVoices?.()).toContain(DEFAULT_VOICE);
  });
});

describe('preflight', () => {
  it('免密钥：只查 ffmpeg', () => {
    const env = makeVoiceEnv({ has: () => false });
    const missing = edgeProvider.preflight(env);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.reason).toBe('command-missing');
      expect(missing.hint).toContain('ffmpeg');
    }
    expect(edgeProvider.preflight(makeVoiceEnv({ has: () => true }))).toEqual({ ok: true });
  });
});

describe('synth（mock 掉 msedge-tts 与 ffmpeg）', () => {
  it('音频先落到临时 mp3，再让 ffmpeg 规格化成 mono 44100 wav', async () => {
    const calls: { command: string; args: string[] }[] = [];
    const env = makeVoiceEnv({ has: () => true, exec: fakeExec(calls) });
    const outPath = '/tmp/foldercast-edge-test/scene.wav';

    const result = await edgeProvider.synth({ text: '你好。', outPath, format: 'wav' }, env);

    expect(result.format).toBe('wav');
    expect(state.metadata).toEqual({ voice: DEFAULT_VOICE, format: 'audio-24khz-96kbitrate-mono-mp3' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe('ffmpeg');
    expect(calls[0]?.args).toEqual(['-y', '-loglevel', 'error', '-i', expect.any(String), '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le', outPath]);
    // 输入是临时目录里的 mp3（不认后缀的是 ffmpeg 的事，这里保证传给它的确实是它）
    expect(calls[0]?.args[4]).toMatch(/speech\.mp3$/);
  });

  it('没指定音色时在 note 里说明用了默认（报告要如实记）', async () => {
    const env = makeVoiceEnv({ has: () => true, exec: fakeExec() });
    const withDefault = await edgeProvider.synth({ text: '你好。', outPath: '/tmp/x.wav', format: 'wav' }, env);
    expect(withDefault.note).toContain(DEFAULT_VOICE);

    const explicit = await edgeProvider.synth({ text: '你好。', outPath: '/tmp/x.wav', voice: 'zh-CN-YunjianNeural', format: 'wav' }, env);
    expect(explicit.note).toBeUndefined();
    expect(state.metadata.voice).toBe('zh-CN-YunjianNeural');
  });

  it('空音频按失败处理，不把 0 字节当好产物', async () => {
    state.chunks = [];
    const env = makeVoiceEnv({ has: () => true, exec: fakeExec() });
    await expect(edgeProvider.synth({ text: '你好。', outPath: '/tmp/x.wav', format: 'wav' }, env)).rejects.toThrow(/空音频/);
  });

  it('端点错误补上「先确认联网」的引导', async () => {
    state.failWith = new Error('Edge TTS WebSocket error: unexpectedly disconnected');
    const env = makeVoiceEnv({ has: () => true, exec: fakeExec() });
    await expect(edgeProvider.synth({ text: '你好。', outPath: '/tmp/x.wav', format: 'wav' }, env)).rejects.toThrow(/联网/);
  });

  it('ffmpeg 失败时错误里带 stderr', async () => {
    const env = makeVoiceEnv({
      has: () => true,
      exec: async () => ({ ok: false, stdout: '', stderr: 'Invalid data found when processing input' }),
    });
    await expect(edgeProvider.synth({ text: '你好。', outPath: '/tmp/x.wav', format: 'wav' }, env)).rejects.toThrow(/ffmpeg 转 wav 失败.*Invalid data/s);
  });
});
