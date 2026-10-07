/**
 * 小米 MiMo TTS：**高配 provider**（中文自然，有配额与费用）。
 *
 * 两个必须记住的点（一手文档核实过的实现，坑都真实踩过）：
 *
 * 1. **`user` 消息是「怎么读」，`assistant` 消息是「要读的正文」。** 它借用 chat 结构，
 *    传错位置会得到空的或不相关的结果 —— 这是这个 API 最容易踩的坑。
 * 2. **音频是 base64 放在 `choices[0].message.audio.data` 里**，不是二进制流。
 *
 * 缺密钥时**不发起请求**：`preflight` 先查（`env.secret` + `KEY_REFS['mimo']`），返回
 * 结构化引导，由 CLI 映射成专用退出码 4（`EXIT_CREDENTIAL_MISSING`）。等 401 再报错的
 * 话，措辞是外部给的，用户看不出该怎么办。
 *
 * 能力：`instruct`（风格指令）、`voices`（预置音色）。声音克隆与音色设计是另外两个模型
 * （`-voiceclone` / `-voicedesign`），这一版不做 —— 它们要音频样本上传或文本描述，
 * 各有各的输入形态，塞进同一个 `synth` 只会让接口变糊。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { KEY_REFS, type SynthRequest, type SynthResult, type TtsProvider, type VoiceEnv } from '../../contracts/durations.ts';

const ENDPOINT = 'https://api.xiaomimimo.com/v1/chat/completions';
const MODEL = 'mimo-v2.5-tts';

/** 预置音色（官方文档列出的九个）。 */
export const MIMO_VOICES = ['mimo_default', '冰糖', '茉莉', '苏打', '白桦', 'Mia', 'Chloe', 'Milo', 'Dean'] as const;

/** 默认风格指令：写稿阶段可以覆盖（`voice.style`）。 */
export const DEFAULT_STYLE = '请用自然、清晰、适合知识讲解视频的旁白语气朗读。';

/** 密钥引用名集中在 `KEY_REFS`（contracts/durations.ts），这里只取不定义。 */
function keyRef(): string {
  return KEY_REFS['mimo'] ?? 'MIMO_API_KEY';
}

/** 请求体。抽成纯函数，测试可以逐字段断言（尤其是 user/assistant 的位置）。 */
export function buildRequestBody(request: {
  text: string;
  voice?: string;
  style?: string;
  format: 'wav' | 'mp3';
}): Record<string, unknown> {
  const messages: { role: string; content: string }[] = [];
  const style = request.style ?? DEFAULT_STYLE;
  if (style.trim() !== '') messages.push({ role: 'user', content: style });
  messages.push({ role: 'assistant', content: request.text });

  const audio: Record<string, string> = { format: request.format };
  if (request.voice !== undefined) audio['voice'] = request.voice;

  return { model: MODEL, messages, audio, stream: false };
}

/** 从响应里取音频 base64。取不到时把「哪里不对」说清楚，而不是给一个 `undefined`。 */
export function extractAudio(payload: unknown): { ok: true; base64: string } | { ok: false; reason: string } {
  if (typeof payload !== 'object' || payload === null) return { ok: false, reason: '响应不是对象' };
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return { ok: false, reason: '响应里没有 choices' };
  const message = (choices[0] as { message?: unknown }).message;
  if (typeof message !== 'object' || message === null) return { ok: false, reason: 'choices[0] 里没有 message' };
  const audio = (message as { audio?: unknown }).audio;
  if (typeof audio !== 'object' || audio === null) return { ok: false, reason: 'message 里没有 audio 字段' };
  const data = (audio as { data?: unknown }).data;
  if (typeof data !== 'string' || data === '') return { ok: false, reason: 'audio.data 是空的' };
  return { ok: true, base64: data };
}

export const mimoProvider: TtsProvider = {
  name: 'mimo',
  requiresKey: true,
  capabilities: ['instruct', 'voices'],
  describe: () => '小米 MiMo TTS：中文自然，云端合成（有配额与费用）。需要 MIMO_API_KEY。',

  preflight(env: VoiceEnv) {
    const ref = keyRef();
    const key = env.secret(ref);
    if (key === undefined || key.trim() === '') {
      return {
        ok: false,
        reason: 'credential-missing',
        hint:
          `没有找到凭据 ${ref}。三种配置办法：\n` +
          `  1. 启动时给环境变量：${ref}=… pnpm voice（或写进 shell profile）；\n` +
          `  2. 放到被讲解目录的 .env：${ref}=…（项目级隔离，优先于全局）；\n` +
          `  3. 放到 $DSH_HOME/.env（默认 ~/.dsh，DSH 自己的环境文件）。\n` +
          `值不会进日志与任何 JSON 产物。也可以先用默认的 --provider edge 出片（免密钥）。`,
      };
    }
    return { ok: true };
  },

  listVoices: () => [...MIMO_VOICES],

  /** 指定了音色就用它；没指定时不瞎猜 —— mimo_default 是服务端的默认值，如实记 undefined。 */
  async resolveVoice(request) {
    return request.voice === '' ? undefined : request.voice;
  },

  async synth(request: SynthRequest, env: VoiceEnv): Promise<SynthResult> {
    const ref = keyRef();
    const key = env.secret(ref);
    if (key === undefined || key.trim() === '') {
      // preflight 应当已经拦下；这里是兜底，避免「调用方忘了 preflight」时静默发出无密钥请求
      throw new Error(`缺少凭据 ${ref}：先配置它，或用默认的 --provider edge（免密钥）。`);
    }

    const format = request.format ?? 'wav';
    const body = buildRequestBody({
      text: request.text,
      ...(request.voice === undefined || request.voice === '' ? {} : { voice: request.voice }),
      ...(request.style === undefined ? {} : { style: request.style }),
      format,
    });

    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300_000),
    });

    if (!response.ok) {
      // 状态码与响应体都要报出来：401 与 429 的下一步完全不同
      const text = await response.text().catch(() => '');
      throw new Error(`MiMo 返回 ${String(response.status)}：${text.slice(0, 400)}`);
    }

    const payload: unknown = await response.json();
    const audio = extractAudio(payload);
    if (!audio.ok) throw new Error(`MiMo 的响应里没有音频（${audio.reason}）`);

    mkdirSync(dirname(request.outPath), { recursive: true });
    writeFileSync(request.outPath, Buffer.from(audio.base64, 'base64'));

    return { format, note: `mimo ${MODEL}${request.voice === undefined ? '' : ` · ${request.voice}`}` };
  },
};
