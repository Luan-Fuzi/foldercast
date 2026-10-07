/**
 * `mimo` provider：请求体形状、坏响应路径、密钥引导。
 *
 * **不发真请求**（CI 只测 runner 能证明的；真请求有费用且需要密钥）：`fetch` 整个
 * stub 掉，钉住的是三件事 ——
 *
 * 1. **user/assistant 的位置**（这个 API 最容易传错的坑：风格在 user，正文在 assistant）；
 * 2. **坏响应的报错**：401 与「响应里没有音频」要说得清是哪一种；
 * 3. **缺密钥不发起请求**，引导给三种配置办法。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { makeVoiceEnv, type MakeEnvOptions } from '../env.ts';
import { DEFAULT_STYLE, MIMO_VOICES, buildRequestBody, extractAudio, mimoProvider } from '../providers/mimo.ts';

/** 拦下来的请求（断言形状用）。 */
type Captured = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

let root = '';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'foldercast-mimo-'));
});

afterAll(() => {
  if (root !== '') rmSync(root, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 造环境：密钥可配（缺省就是没配），命令都在、ffmpeg 恒成功。 */
function envWith(key?: string): MakeEnvOptions {
  return {
    secret: () => key,
    has: () => true,
    exec: async () => ({ ok: true, stdout: '', stderr: '' }),
  };
}

/** stub 掉全局 fetch，把请求记进 captured。 */
function stubFetch(respond: (captured: Captured) => Response | Promise<Response>): Captured[] {
  const captured: Captured[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { headers: Record<string, string>; body: string }) => {
      const record: Captured = { url, headers: init.headers, body: JSON.parse(init.body) as Record<string, unknown> };
      captured.push(record);
      return respond(record);
    }),
  );
  return captured;
}

describe('buildRequestBody（user/assistant 的位置）', () => {
  it('风格在 user，正文在 assistant —— 这个 API 最容易传错的坑', () => {
    const body = buildRequestBody({ text: '要读的正文。', voice: '茉莉', style: '慢一点读', format: 'wav' });
    expect(body).toEqual({
      model: 'mimo-v2.5-tts',
      messages: [
        { role: 'user', content: '慢一点读' },
        { role: 'assistant', content: '要读的正文。' },
      ],
      audio: { format: 'wav', voice: '茉莉' },
      stream: false,
    });
  });

  it('没给风格时用默认的讲解语气；空串风格则不占一条消息', () => {
    expect(buildRequestBody({ text: '正文。', format: 'mp3' }).messages).toEqual([
      { role: 'user', content: DEFAULT_STYLE },
      { role: 'assistant', content: '正文。' },
    ]);
    expect(buildRequestBody({ text: '正文。', style: '  ', format: 'mp3' }).messages).toEqual([
      { role: 'assistant', content: '正文。' },
    ]);
  });

  it('没给音色就不传 voice 字段（服务端用它自己的默认）', () => {
    const audio = buildRequestBody({ text: '正文。', format: 'wav' }).audio;
    expect(audio).not.toHaveProperty('voice');
  });
});

describe('extractAudio（坏响应要说清缺什么）', () => {
  it('正常路径：choices[0].message.audio.data 的 base64', () => {
    expect(extractAudio({ choices: [{ message: { audio: { data: 'QUJD' } } }] })).toEqual({ ok: true, base64: 'QUJD' });
  });

  it('每一层缺失都有对应的一句话', () => {
    expect(extractAudio('nope')).toEqual({ ok: false, reason: '响应不是对象' });
    expect(extractAudio({})).toEqual({ ok: false, reason: '响应里没有 choices' });
    expect(extractAudio({ choices: [] })).toEqual({ ok: false, reason: '响应里没有 choices' });
    expect(extractAudio({ choices: [{}] })).toEqual({ ok: false, reason: 'choices[0] 里没有 message' });
    expect(extractAudio({ choices: [{ message: {} }] })).toEqual({ ok: false, reason: 'message 里没有 audio 字段' });
    expect(extractAudio({ choices: [{ message: { audio: { data: '' } } }] })).toEqual({ ok: false, reason: 'audio.data 是空的' });
  });
});

describe('preflight（缺密钥不发起请求）', () => {
  it('没有 MIMO_API_KEY：credential-missing，引导给三种配置办法', () => {
    const env = makeVoiceEnv(envWith());
    const result = mimoProvider.preflight(env);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('credential-missing');
      expect(result.hint).toContain('MIMO_API_KEY');
      expect(result.hint).toContain('.env');
      expect(result.hint).toContain('edge');
      // 三种办法都数得出来（1./2./3.）
      expect(result.hint.match(/^\s+\d\./gm)?.length).toBe(3);
    }
  });

  it('配了密钥就放行', () => {
    const env = makeVoiceEnv(envWith('sk-test'));
    expect(mimoProvider.preflight(env)).toEqual({ ok: true });
  });
});

describe('synth（fetch 全部 stub，不发真请求）', () => {
  const outDir = () => {
    const dir = join(root, 'audio');
    mkdirSync(dir, { recursive: true });
    return join(dir, 'scene.wav');
  };

  it('密钥走 api-key 头；base64 解码后写盘；请求体形状正确', async () => {
    const wav = Buffer.from('RIFF....WAVE-fake').toString('base64');
    const respond = () => Response.json({ choices: [{ message: { audio: { data: wav } } }] });
    const captured = stubFetch(respond);
    const outPath = outDir();

    const env = makeVoiceEnv(envWith('sk-test-value'));
    const result = await mimoProvider.synth({ text: '正文。', outPath, style: '自然一点', format: 'wav' }, env);

    expect(result.format).toBe('wav');
    expect(existsSync(outPath)).toBe(true);
    expect(readFileSync(outPath).toString('latin1')).toBe('RIFF....WAVE-fake');
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe('https://api.xiaomimimo.com/v1/chat/completions');
    expect(captured[0]?.headers['api-key']).toBe('sk-test-value');
    expect(captured[0]?.body.model).toBe('mimo-v2.5-tts');
    expect(captured[0]?.body.messages).toEqual([
      { role: 'user', content: '自然一点' },
      { role: 'assistant', content: '正文。' },
    ]);
  });

  it('密钥值不进错误信息（项目铁律：只报引用名）', async () => {
    stubFetch(() => new Response('{"error":"bad key"}', { status: 401 }));
    const env = makeVoiceEnv(envWith('sk-secret-value'));
    let error: Error | undefined;
    try {
      await mimoProvider.synth({ text: '正文。', outPath: outDir(), format: 'wav' }, env);
    } catch (caught) {
      error = caught as Error;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toContain('401');
    expect(error?.message).not.toContain('sk-secret-value');
  });

  it('响应里没有音频时报清缺哪一层', async () => {
    stubFetch(() => new Response('{}'));
    const env = makeVoiceEnv(envWith('sk-test'));
    await expect(mimoProvider.synth({ text: '正文。', outPath: outDir(), format: 'wav' }, env)).rejects.toThrow(
      /没有音频（响应里没有 choices）/,
    );
  });

  it('调用方忘了 preflight 时，synth 也不会发出无密钥请求', async () => {
    const captured = stubFetch(() => Response.json({}));
    const env = makeVoiceEnv(envWith());
    await expect(mimoProvider.synth({ text: '正文。', outPath: outDir(), format: 'wav' }, env)).rejects.toThrow(/缺少凭据 MIMO_API_KEY/);
    expect(captured).toHaveLength(0);
  });
});

describe('能力声明', () => {
  it('预置九个音色，默认风格是非空的', () => {
    expect(mimoProvider.listVoices?.()).toHaveLength(9);
    expect(MIMO_VOICES).toContain('mimo_default');
    expect(DEFAULT_STYLE.trim()).not.toBe('');
  });

  it('resolveVoice：给了就用，没给不瞎猜', async () => {
    const env = makeVoiceEnv(envWith('sk-test'));
    await expect(mimoProvider.resolveVoice?.({ voice: '茉莉' }, env)).resolves.toBe('茉莉');
    await expect(mimoProvider.resolveVoice?.({}, env)).resolves.toBeUndefined();
  });
});
