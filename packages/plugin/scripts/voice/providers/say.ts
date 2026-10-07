/**
 * macOS `say`：**零配置的兜底 provider**。
 *
 * 它存在的理由不是音质，而是「装了插件不配任何东西就能出片」。所以这一版把它做成默认：
 * 没有密钥、没有网络、没有配额，`say` 装了就有。
 *
 * 三件实测才知道的事：
 *
 * 1. **输出格式**：`say -o x.aiff` 写的是 AIFF；新版系统里神经音色（中文那批都带
 *    `(中文（中国大陆）)` 后缀）直接产出 CAF 容器里的 AAC —— 后缀是 `.aiff` 也没用。
 *    所以这里统一走「`say` 写临时文件 → ffmpeg 转 wav」，只认字节不认后缀。
 * 2. **系统默认音色是英文的**（本机是 `Eddy (English (US))`）。中文讲稿用它读出来是一串
 *    字母音，所以**没有显式指定音色时，这里自动挑一个中文音色**（`listVoices` 里找
 *    `zh_CN`），并在 `note` 里说明挑了哪个。这不是「智能」，是「否则零配置出不了中文片」。
 * 3. **语速**：`say -r <词/分>` 是唯一的语速旋钮，`style` 里的数字会被当成语速用；
 *    其余风格的描述 `say` 表达不了，只能忽略（能力声明里没有 `instruct`）。
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SynthRequest, SynthResult, TtsProvider, VoiceEnv } from '../../contracts/durations.ts';

/** `say` 的输出默认语速（词/分）。`-r` 不给时系统就是按这个读。 */
const DEFAULT_RATE = 175;

export type SayVoice = { name: string; locale: string };

/**
 * 解析 `say -v '?'` 的输出。每行形如：
 *
 * ```
 * Eddy (中文（中国大陆）)     zh_CN    # 你好！我叫Eddy。
 * ```
 *
 * 音色名本身可能带空格与括号，所以按**制表符/多空格**切，不按空格切。
 */
export function parseVoiceList(output: string): SayVoice[] {
  const voices: SayVoice[] = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const match = /^(.*?)\s{2,}([a-zA-Z]{2,3}[_-][A-Za-z0-9]+)\s+#\s/.exec(trimmed);
    if (match === null) continue;
    const name = match[1]?.trim();
    const locale = match[2]?.trim();
    if (name === undefined || locale === undefined) continue;
    voices.push({ name, locale });
  }
  return voices;
}

/**
 * 挑一个能读中文的音色。优先 `zh_CN`，其次任何 `zh`。
 *
 * 为什么要自动挑：不挑就会用系统默认（英文）音色读中文，出来的是「字正腔圆的字母」。
 * 用户显式指定音色时不会被覆盖 —— 这一层只在 `voice` 缺失时生效。
 */
export function pickChineseVoice(voices: readonly SayVoice[]): SayVoice | undefined {
  return voices.find((voice) => voice.locale === 'zh_CN') ?? voices.find((voice) => voice.locale.startsWith('zh_'));
}

/** `style` 里没有数字时给个默认语速：知识讲解比系统默认稍慢一点，更清楚。 */
export function rateFromStyle(style: string | undefined): number | undefined {
  if (style === undefined) return undefined;
  const match = /(\d{2,3})\s*(?:字|词|words?)?\s*\/?\s*(?:分|min|wpm)?/i.exec(style);
  if (match === null) return undefined;
  const rate = Number(match[1]);
  return Number.isFinite(rate) && rate >= 60 && rate <= 400 ? rate : undefined;
}

export const sayProvider: TtsProvider = {
  name: 'say',
  requiresKey: false,
  capabilities: ['voices'],
  describe: () => 'macOS 自带 say：本地、免密钥、无配额。音质一般，适合先出片看效果。',

  preflight(env: VoiceEnv) {
    if (!env.has('say')) {
      return {
        ok: false,
        reason: 'command-missing',
        hint: '这台机器上没有 `say`（macOS 自带）。配音只能在 macOS 上跑；不传 voice 就不出旁白（静音片）。',
      };
    }
    if (!env.has('ffmpeg')) {
      // `say` 的产物要过一遍 ffmpeg 才能保证格式可读（AIFF / CAF 都可能）
      return {
        ok: false,
        reason: 'command-missing',
        hint: '配音要把 say 的输出转成 wav，需要 ffmpeg（macOS：brew install ffmpeg）。缺它时渲染也不可用。',
      };
    }
    return { ok: true };
  },

  /**
   * 实际用哪个音色：显式指定就用它，否则挑系统里的中文音色。
   *
   * 这一步**必须能在不合成的情况下调用**：全部命中缓存时报告仍然要记「实际用的音色」。
   */
  async resolveVoice(request, env) {
    if (request.voice !== undefined && request.voice !== '') return request.voice;
    const listing = await env.exec('say', ['-v', '?']);
    return pickChineseVoice(parseVoiceList(`${listing.stderr}${listing.stdout}`))?.name;
  },

  async synth(request: SynthRequest, env: VoiceEnv): Promise<SynthResult> {
    const wanted = request.voice;
    const chosen = await this.resolveVoice?.(request, env);

    const dir = mkdtempSync(join(tmpdir(), 'foldercast-say-'));
    const raw = join(dir, 'speech.aiff');
    const rate = rateFromStyle(request.style);
    const notes: string[] = [];

    try {
      const args = ['-o', raw];
      if (chosen !== undefined) args.push('-v', chosen);
      if (rate !== undefined) args.push('-r', String(rate));
      args.push(request.text);

      const spoken = await env.exec('say', args);
      if (!spoken.ok || !existsSync(raw) || statSync(raw).size === 0) {
        throw new Error(`say 没读出音频：${spoken.stderr.trim() === '' ? '未知原因' : spoken.stderr.trim()}`);
      }
      if (wanted === undefined && chosen !== undefined) {
        notes.push(`没指定音色，自动挑了系统里的中文音色「${chosen}」`);
      } else if (wanted === undefined) {
        notes.push('系统里没有中文音色，用的是默认音色（读中文可能不自然）');
      }

      // 转成 wav：`say` 在带神经音色时会写 CAF 容器里的 AAC，只认后缀会踩坑
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
        ...(notes.length === 0 ? {} : { note: notes.join('；') }),
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
};

/** `say -v '?'` 的输出走的是 **stderr**（实测），所以这里显式声明一下，免得后来人以为读错了流。 */
export const SAY_VOICE_LIST_STREAM = 'stderr' as const;

/** 默认语速常量导出给测试用。 */
export const SAY_DEFAULT_RATE = DEFAULT_RATE;

/* ------------------------------------------------------------------ 小工具 */

/** `exec` 的通用实现（CLI 与测试共用）。 */
export function makeExecutor(): VoiceEnv['exec'] {
  return (command, args) =>
    new Promise((resolve) => {
      execFile(
        command,
        [...args],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
        (error, stdout, stderr) => {
          resolve({
            ok: error === null,
            stdout: stdout ?? '',
            stderr: stderr === '' || stderr === undefined ? (error?.message ?? '') : stderr,
          });
        },
      );
    });
}
