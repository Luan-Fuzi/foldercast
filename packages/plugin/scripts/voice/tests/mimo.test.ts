/**
 * MiMo provider：请求体形状、响应解析、缺密钥的行为。
 *
 * **不联网**：这里只测「本地怎么算」的部分 —— 请求体对不对（user = 风格、assistant = 正文，
 * 传错位置会得到空结果）、响应里音频取不取得到、缺密钥时是不是**在发起请求之前**就返回引导。
 *
 * 真的合成一次属于外部依赖（要密钥、要配额），由人手工验，不进 CI。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRequestBody, extractAudio, mimoProvider, MIMO_VOICES } from '../providers/mimo.ts';
import { makeVoiceEnv } from '../env.ts';
import type { VoiceEnv } from '../../contracts/durations.ts';

/** 一个完全离线的环境：命令都在、密钥由测试给。 */
function envWith(secret: string | undefined): VoiceEnv {
  return makeVoiceEnv({
    env: secret === undefined ? {} : { MIMO_API_KEY: secret },
    has: () => true,
    exec: async () => ({ ok: true, stdout: '', stderr: '' }),
  });
}

describe('请求体', () => {
  it('user 是风格、assistant 是要读的正文（最容易踩的坑）', () => {
    const body = buildRequestBody({ text: '这是正文。', voice: '白桦', style: '请用播报语气', format: 'wav' }) as {
      messages: { role: string; content: string }[];
    };
    expect(body.messages[0]).toEqual({ role: 'user', content: '请用播报语气' });
    expect(body.messages[1]).toEqual({ role: 'assistant', content: '这是正文。' });
  });

  it('没给风格时用默认指令，正文仍然在 assistant', () => {
    const body = buildRequestBody({ text: '正文', format: 'wav' }) as { messages: { role: string }[] };
    expect(body.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
  });

  it('格式与音色按参数进 audio 字段；不给音色就不出现这个键', () => {
    const withVoice = buildRequestBody({ text: 'x', voice: '冰糖', format: 'mp3' }) as { audio: Record<string, string> };
    expect(withVoice.audio).toEqual({ format: 'mp3', voice: '冰糖' });
    const without = buildRequestBody({ text: 'x', format: 'wav' }) as { audio: Record<string, string> };
    expect(Object.keys(without.audio)).toEqual(['format']);
  });
});

describe('响应解析', () => {
  it('从 choices[0].message.audio.data 取 base64', () => {
    const payload = { choices: [{ message: { audio: { data: 'QUJD' } } }] };
    expect(extractAudio(payload)).toEqual({ ok: true, base64: 'QUJD' });
  });

  it('取不到时说清是哪里不对，而不是返回 undefined', () => {
    expect(extractAudio(null)).toEqual({ ok: false, reason: '响应不是对象' });
    expect(extractAudio({})).toEqual({ ok: false, reason: '响应里没有 choices' });
    expect(extractAudio({ choices: [] })).toEqual({ ok: false, reason: '响应里没有 choices' });
    expect(extractAudio({ choices: [{}] })).toEqual({ ok: false, reason: 'choices[0] 里没有 message' });
    expect(extractAudio({ choices: [{ message: {} }] })).toEqual({ ok: false, reason: 'message 里没有 audio 字段' });
    expect(extractAudio({ choices: [{ message: { audio: { data: '' } } }] })).toEqual({
      ok: false,
      reason: 'audio.data 是空的',
    });
  });
});

describe('缺密钥', () => {
  it('preflight 在发起合成之前就返回结构化引导', () => {
    const result = mimoProvider.preflight(envWith(undefined));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('credential-missing');
    expect(result.hint).toContain('MIMO_API_KEY');
    expect(result.hint).toContain('.env');
    expect(result.hint).toContain('--provider say');
  });

  it('空字符串等于没配（凭据 seam 的硬约束）', () => {
    expect(mimoProvider.preflight(envWith('')).ok).toBe(false);
  });

  it('配好了就通过', () => {
    expect(mimoProvider.preflight(envWith('sk-test')).ok).toBe(true);
  });

  it('synth 里再查一次：调用方忘了 preflight 也不会发出无密钥请求', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'foldercast-mimo-'));
    writeFileSync(join(dir, 'x'), '');
    await expect(
      mimoProvider.synth({ text: 'x', outPath: join(dir, 'out.wav') }, envWith(undefined)),
    ).rejects.toThrow(/缺少凭据 MIMO_API_KEY/);
    expect(existsSync(join(dir, 'out.wav'))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('能力声明', () => {
  it('预置音色与能力都声明出来，调用方按能力分支', () => {
    expect([...MIMO_VOICES]).toContain('白桦');
    expect(mimoProvider.capabilities).toContain('instruct');
    expect(mimoProvider.requiresKey).toBe(true);
    expect(mimoProvider.describe()).toContain('MIMO_API_KEY');
  });
});
