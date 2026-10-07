/**
 * Edge「大声朗读」：**免密钥的默认 provider**，接替弃用的 `say`。
 *
 * 走的是 Edge 浏览器朗读功能背后的 websocket 端点（`speech.platform.bing.com`），不是
 * 官方对外承诺的服务 —— 所以协议细节（DRM 令牌、消息分帧）交给 `msedge-tts` 处理，
 * 这里只做 provider 的本分：选音色、要音频、转成统一的 wav。选型依据：
 *
 * 1. **真实合成过中文**（`zh-CN-XiaoxiaoNeural`，产物过 ffprobe，见 voice-engine 分支报告）；
 * 2. **纯 JS 无原生依赖**（ws / axios，Windows 可用）；
 * 3. **带类型、仍在维护**（2026-10 调研时 msedge-tts 一周内有发版，node-edge-tts 八个月没动）。
 *    这条最要紧：这个端点 2024 年起要 `Sec-MS-GEC` DRM 令牌，过时的实现会直接 403，
 *    包不维护等于迟早全体失效。
 *
 * 三件要知道的事：
 *
 * 1. **免密钥但要联网**。断网或端点不可用时配音就跑不了 —— 那时可以不配音（静音片），
 *    或换 mimo。这是弃用 `say`（本地、离线）接受的代价（docs/decisions/0002）。
 * 2. **不指定音色时默认用 `zh-CN-XiaoxiaoNeural`**。与 `say` 时代的理由相同：不挑就是
 *    英文音色读中文；这里端点是云端固定的音色表，直接给默认值，不用像 `say` 那样跑
 *    `say -v '?'` 探测。
 * 3. **style 是自然语描述，edge 表达不了**（能力声明里没有 `instruct`），忽略。语速数字
 *    也不解析：讲稿的节奏靠写稿控制，比拧一个不可复现的百分比实在。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import type { SynthRequest, SynthResult, TtsProvider, VoiceEnv } from '../../contracts/durations.ts';

/** 不指定音色时的默认：中文女声，知识讲解语境里最稳的一个。 */
export const DEFAULT_VOICE = 'zh-CN-XiaoxiaoNeural';

/**
 * 预置中文音色（官方音色表里 zh-CN 的一小部分，全部 Neural）。
 * `listVoices` 是同步接口，不能联网拉全表 —— 全表两百多个音色对「讲目录」也没有意义。
 */
export const EDGE_VOICES = [
  'zh-CN-XiaoxiaoNeural', // 女声，亲切自然（默认）
  'zh-CN-XiaoyiNeural', // 女声，活泼
  'zh-CN-YunjianNeural', // 男声，沉稳，适合讲解
  'zh-CN-YunxiNeural', // 男声，阳光
  'zh-CN-YunyangNeural', // 男声，新闻播报
  'zh-CN-liaoning-XiaobeiNeural', // 东北口音
  'zh-CN-shaanxi-XiaoniNeural', // 陕西口音
] as const;

/**
 * 一次合成的硬超时（毫秒）。正常一段旁白几秒出完；挂到两分钟以上基本是连接黑洞，
 * 再等下去只会把整个配音阶段拖死。超时后主动 `close()`，`msedge-tts` 会把未完成的
 * 流按「截断」报错（它自己保证了不会把半截音频当好音频交出来）。
 */
const SYNTH_TIMEOUT_MS = 120_000;

export const edgeProvider: TtsProvider = {
  name: 'edge',
  requiresKey: false,
  capabilities: ['voices'],
  describe: () => 'Edge「大声朗读」端点：云端合成、免密钥、默认引擎。需要网络；音色为微软神经音色。',

  preflight(env: VoiceEnv) {
    if (!env.has('ffmpeg')) {
      return {
        ok: false,
        reason: 'command-missing',
        hint: '配音要把 edge 的输出（mp3）转成 wav，需要 ffmpeg（macOS：brew install ffmpeg，Windows：winget install ffmpeg）。缺它时渲染也不可用。',
      };
    }
    // 免密钥：不查 secret。网络通不通只有真连了才知道，交给 synth 报错并给出引导。
    return { ok: true };
  },

  /** 实际用哪个音色：显式指定就用它，否则用默认中文音色。合成之前就能答（全缓存时也要记）。 */
  async resolveVoice(request) {
    if (request.voice !== undefined && request.voice !== '') return request.voice;
    return DEFAULT_VOICE;
  },

  listVoices: () => [...EDGE_VOICES],

  async synth(request: SynthRequest, env: VoiceEnv): Promise<SynthResult> {
    const wanted = request.voice;
    const chosen = (await this.resolveVoice?.(request, env)) ?? DEFAULT_VOICE;

    const dir = mkdtempSync(join(tmpdir(), 'foldercast-edge-'));
    try {
      // 一次合成一条连接：场景之间不共享状态，失败重跑也不受上一次的残留连接影响
      const audio = await synthesizeRaw(request.text, chosen);
      if (audio.length === 0) {
        throw new Error('edge 返回了空音频（端点可能暂时不可用），重试或换 --provider mimo。');
      }
      const raw = join(dir, 'speech.mp3');
      writeFileSync(raw, audio);

      // mp3 → mono 44100 wav：与渲染/拼接层约定的一致格式（ pcm_s16le，谁都能读）
      const converted = await env.exec('ffmpeg', [
        '-y',
        '-loglevel',
        'error',
        '-i',
        raw,
        '-ac',
        '1',
        '-ar',
        '44100',
        '-c:a',
        'pcm_s16le',
        request.outPath,
      ]);
      if (!converted.ok) {
        throw new Error(`ffmpeg 转 wav 失败：${converted.stderr.trim()}`);
      }

      return {
        format: 'wav',
        ...(wanted === undefined ? { note: `没指定音色，用默认中文音色「${chosen}」` } : {}),
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
};

/**
 * 调 `msedge-tts` 拿一段原始音频（mp3）。抽出来是因为「库的用法」与「provider 的职责」
 * 是两件事：前者跟着库的 API 走，后者管音色、文件与格式约定。
 *
 * 错误都补上「下一步怎么办」：这个端点的失败几乎都是网络层的，裸抛一个 websocket
 * 错误用户看不出该检查什么。
 */
async function synthesizeRaw(text: string, voice: string): Promise<Buffer> {
  const tts = new MsEdgeTTS();
  const timeout = setTimeout(() => tts.close(), SYNTH_TIMEOUT_MS);
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text);
    const chunks: Buffer[] = [];
    for await (const chunk of audioStream) {
      chunks.push(Buffer.from(chunk as Buffer));
    }
    return Buffer.concat(chunks);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `edge 合成失败：${message}\n这个引擎走云端端点，先确认联网（断网时可以不配音出静音片，或用本地网络排查命令重试）。`,
    );
  } finally {
    clearTimeout(timeout);
    tts.close();
  }
}
