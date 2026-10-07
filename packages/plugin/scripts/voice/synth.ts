/**
 * 配音阶段：**讲稿 → 逐场景音频 + 实测时长 + 字幕时序（`durations.json`）**。
 *
 * 三段式，与别的阶段一样是确定性程序（除了 TTS 本身会花钱、会联网、结果不完全可复现）：
 *
 * ```
 * script.json ──► 逐场景合成（provider）──► ffprobe 实测 ──► durations.json
 *                                                              └─► narration.wav（整条音轨）
 * ```
 *
 * 四条设计判断，都写在代码里因为它们看起来可以「简化」：
 *
 * 1. **时长以实测为准**（C3）。合成完立刻 `ffprobe`，用实测值写 `durations.json`；
 *    字数只用来**分配字幕块**，不用来定时长。
 * 2. **断点续跑**：音频已存在且不是 `--force` 就跳过合成（TTS 有配额与费用）。
 *    这与 provider 无关，所以放在调度层（rd 文档第四节第 4 条）。
 * 3. **场景时长 = 实测 + 留白**，两者都记进 `durations.json`（`audioSec` / `duration`）。
 *    留白算在场景里，于是音轨与画面只有一条时间轴。
 * 4. **`provider` / `voice` 记实际用的**，不是配置里写的 —— 配置可能没写音色而实际
 *    用了 provider 的默认音色，报告必须如实。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  DURATIONS_VERSION,
  EXIT_CREDENTIAL_MISSING,
  type DurationsDocument,
  type SceneDuration,
  type Sub,
  type TtsProvider,
  type VoiceEnv,
} from '../contracts/durations.ts';
import { allocateByWidth } from '../contracts/spans.ts';
import { splitSubtitles } from '../contracts/subtitles.ts';
import type { ScriptDocument, VoiceSpec } from '../contracts/script.ts';
import { buildTrack, probeDurationSec, readJsonIfExists } from './audio.ts';
import { edgeProvider } from './providers/edge.ts';

/** 每个场景末尾的留白（秒）。**算进场景时长**，所以画面与配音不会因此错开。 */
export const DEFAULT_PAUSE_SEC = 0.45;

/**
 * 从 provider 的说明里认出实际用的音色。
 *
 * 为什么要这么做：provider 不指定音色时会用**它自己的默认**（如 edge 的中文默认音色），
 * 而 `durations.json` 要记的是**实际用的**，不是配置里写的。没有显式音色时就从说明里取，
 * 取不到也不编 —— 那只是少一个字段，不是错。
 */
function voiceFromNotes(notes: readonly string[]): string | undefined {
  for (const note of notes) {
    const match = /音色「(.+?)」/.exec(note);
    if (match !== null && match[1] !== undefined) return match[1];
  }
  return undefined;
}

/** 音频格式：wav 是唯一「谁都能读」的。provider 产出别的就转一道。 */
const AUDIO_FORMAT = 'wav';

export type SynthOptions = {
  /** 被讲解的目录。 */
  target: string;
  /** 工作根，默认 `<目标>/.foldercast`。 */
  workRoot?: string;
  /** 讲稿路径覆盖。 */
  scriptPath?: string;
  /**
   * provider：默认 `edge`。给一个实现是为了**测试** —— 调度与算术（跳过已存在的音频、
   * 实测时长、写 durations.json）都可以用假 provider 完全离线地验，不必真的调 TTS。
   */
  provider?: TtsProvider;
  /** 音色覆盖。 */
  voice?: string;
  /** 风格覆盖。 */
  style?: string;
  /** 每个场景末尾的留白（秒）。 */
  pauseSec?: number;
  /** 已存在的音频重新合成。 */
  force?: boolean;
  /** 拼整条音轨。默认开：渲染阶段要它。 */
  track?: boolean;
  /** 只合成前 N 个场景（调音色时用，省配额）。 */
  limit?: number;
  env?: VoiceEnv;
  /** 覆盖「现在」，测试用。 */
  now?: Date;
  /** 进度回调。 */
  onProgress?: (event: { sceneId: string; index: number; total: number; cached: boolean; seconds: number }) => void;
  /**
   * 已知的实际音色（上一次跑出来的）。**全部命中缓存时靠它**：provider 可能用默认音色，
   * 而挑的动作发生在合成里，跳过合成之后就没地方知道了 —— 报告与 `durations.json`
   * 都要记「实际用的」，不能因为这次没合成就不写。
   */
  voiceOverride?: string;
};

export type SynthReport = {
  ok: boolean;
  target: string;
  workRoot: string;
  durationsPath: string;
  trackPath?: string;
  provider: string;
  voice?: string;
  /** 实际用了哪些音色（provider 没指定时会用自己的默认，报告要如实）。 */
  notes: string[];
  scenes: { id: string; audio: string; audioSec: number; duration: number; parts: number; cached: boolean }[];
  totalSec: number;
  /** 已存在的音频被跳过时是真的没花钱 —— 报出来，用户才知道 `--force` 什么时候值得用。 */
  cached: number;
  synthesized: number;
  warnings: string[];
};

/** 本地时区的 ISO 8601，带偏移量（与解读、讲稿同一写法）。 */
function localIsoString(date: Date): string {
  const pad = (value: number): string => String(Math.abs(value)).padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const offset = `${sign}${pad(Math.trunc(Math.abs(offsetMinutes) / 60))}:${pad(Math.abs(offsetMinutes) % 60)}`;
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${offset}`
  );
}

/**
 * 音频文件名：用场景 id（稳定、可读），而不是序号 —— 序号在中间插一个场景就全部错位。
 *
 * 只替换路径分隔符与控制字符，**保留 Unicode 字母数字**：把所有非 ASCII 都换成 `_`
 * 会让「封面」与「小结」这类 id 撞成同一个文件名。
 */
export function audioFileName(sceneId: string): string {
  const safe = sceneId
    .replace(/[/\\]/g, '_')
    // eslint-disable-next-line no-control-regex -- 控制字符不能进文件名
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/^\.+$/, '_');
  return `audio/${safe === '' ? 'scene' : safe}.wav`;
}

export class SynthError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode: number) {
    super(message);
    this.name = 'SynthError';
    this.exitCode = exitCode;
  }
}

/** 把一个场景的实测时长切成字幕块。**切分与校验器、渲染器同一份实现**。 */
export function subtitlesFor(narration: string, durationSec: number): Sub[] {
  const texts = splitSubtitles(narration);
  if (texts.length === 0) return [];
  const spans = allocateByWidth(texts, Math.round(durationSec * 1000), 1000);
  return texts.map((text, index) => {
    const span = spans[index] ?? { from: 0, to: 1000 };
    // 秒保留三位小数：毫秒级足够，又能让「各块之和 = 总时长」在浮点下也对得上
    return [text, Math.round((span.to - span.from)) / 1000] as Sub;
  });
}

export async function synthesize(options: SynthOptions): Promise<SynthReport> {
  const target = resolve(options.target);
  const workRoot = options.workRoot === undefined ? resolve(target, '.foldercast') : resolve(options.workRoot);
  const scriptPath = options.scriptPath === undefined ? join(workRoot, 'script.json') : resolve(options.scriptPath);
  const env = options.env;
  if (env === undefined) throw new SynthError('没有提供 VoiceEnv（调用方要传一个）', 2);

  if (!existsSync(scriptPath)) {
    throw new SynthError(`找不到讲稿：${scriptPath}\n先按 skill 写一份 script.json。`, 2);
  }
  const script = JSON.parse(readFileSync(scriptPath, 'utf8')) as ScriptDocument;
  const spec: VoiceSpec = script.voice ?? {};

  const provider = options.provider ?? edgeProvider;

  const preflight = provider.preflight(env);
  if (!preflight.ok) {
    // 缺密钥是可操作的环境问题（专用退出码 4），与参数、讲稿问题（2）分开
    const exitCode = preflight.reason === 'credential-missing' ? EXIT_CREDENTIAL_MISSING : 2;
    throw new SynthError(`provider ${provider.name} 还不能用（${preflight.reason}）：\n${preflight.hint}`, exitCode);
  }

  const style = options.style ?? spec.style;
  // 上一轮的产物：provider 说不出音色时的兜底（见 `voiceOverride`）
  const previous = readJsonIfExists<DurationsDocument>(join(workRoot, 'durations.json'));
  const requestedVoice = options.voice ?? spec.voice ?? options.voiceOverride ?? previous?.voice;
  // **在合成之前**解析实际音色：报告要记「实际用的」，而全部命中缓存时合成根本不会跑
  const resolvedVoice =
    provider.resolveVoice === undefined
      ? undefined
      : await provider.resolveVoice(
          {
            ...(requestedVoice === undefined ? {} : { voice: requestedVoice }),
            ...(style === undefined ? {} : { style }),
          },
          env,
        );
  const voice = resolvedVoice ?? requestedVoice;
  const pauseSec = options.pauseSec ?? DEFAULT_PAUSE_SEC;
  const notes: string[] = [provider.describe()];

  const scenes = options.limit === undefined ? script.scenes : script.scenes.slice(0, options.limit);
  mkdirSync(join(workRoot, 'audio'), { recursive: true });
  mkdirSync(join(workRoot, 'tmp'), { recursive: true });

  const rows: SynthReport['scenes'] = [];
  const durations: SceneDuration[] = [];
  const warnings: string[] = [];
  let cached = 0;
  let synthesized = 0;

  for (const [index, scene] of scenes.entries()) {
    if (scene.narration.trim() === '') {
      warnings.push(`场景 ${scene.id} 的 narration 是空的：跳过合成，画面仍然占一段时长`);
    }
    const relative = audioFileName(scene.id);
    const absolute = resolve(workRoot, relative);
    const alreadyThere = existsSync(absolute) && statSync(absolute).size > 0;

    if (alreadyThere && options.force !== true) {
      cached += 1;
    } else {
      const result = await provider.synth(
        {
          text: scene.narration,
          outPath: absolute,
          ...(voice === undefined ? {} : { voice }),
          ...(style === undefined ? {} : { style }),
          format: AUDIO_FORMAT,
        },
        env,
      );
      if (result.note !== undefined) notes.push(`${scene.id}：${result.note}`);
      synthesized += 1;
    }

    const seconds = probeDuration(absolute);
    const duration = Math.round((seconds + pauseSec) * 1000) / 1000;
    const subs = subtitlesFor(scene.narration, duration);
    durations.push({ id: scene.id, audio: relative, audioSec: seconds, duration, subs });
    rows.push({
      id: scene.id,
      audio: relative,
      audioSec: seconds,
      duration,
      parts: subs.length,
      cached: alreadyThere && options.force !== true,
    });
    options.onProgress?.({ sceneId: scene.id, index: index + 1, total: scenes.length, cached: alreadyThere, seconds });
  }

  const totalSec = durations.reduce((sum, scene) => sum + scene.duration, 0);
  let trackRelative: string | undefined;
  if (options.track !== false && durations.length > 0) {
    trackRelative = 'audio/narration.wav';
    const report = buildTrack({
      workRoot,
      items: durations.map((scene) => ({ audio: resolve(workRoot, scene.audio), duration: scene.duration })),
      outPath: resolve(workRoot, trackRelative),
      tempDir: join(workRoot, 'tmp', 'voice'),
    });
    for (const trimmed of report.trimmed) {
      warnings.push(`音频比场景长，已截断：${trimmed}`);
    }
    // 音轨长度是「场景时长之和」的硬要求：渲染阶段按帧切场景，音轨短了就整体错位
    const actual = probeDurationSec(resolve(workRoot, trackRelative));
    if (Math.abs(actual - totalSec) > 0.05) {
      warnings.push(
        `音轨长度 ${actual.toFixed(3)}s 与场景总长 ${totalSec.toFixed(3)}s 差 ${(actual - totalSec).toFixed(3)}s（超过 50ms）` +
          '：画面与配音可能错位，重跑配音或检查 ffmpeg 版本。',
      );
    } else if (report.padded > 0) {
      notes.push(`补了 ${report.padded.toFixed(2)}s 静音（场景留白）`);
    }
    rmSync(join(workRoot, 'tmp', 'voice'), { recursive: true, force: true });
  }

  // 兜底：provider 说不出音色时，从它在合成说明里留下的痕迹里认（说明里带「音色「…」」字样）
  const actualVoice = voice ?? voiceFromNotes(notes);

  const document: DurationsDocument = {
    durations: DURATIONS_VERSION,
    generatedAt: localIsoString(options.now ?? new Date()),
    provider: provider.name,
    ...(actualVoice === undefined ? {} : { voice: actualVoice }),
    ...(style === undefined ? {} : { style }),
    track: trackRelative ?? '',
    pause: pauseSec,
    scenes: durations,
  };

  const durationsPath = join(workRoot, 'durations.json');
  writeFileSync(durationsPath, `${JSON.stringify(document, null, 2)}\n`);

  return {
    ok: true,
    target,
    workRoot,
    durationsPath,
    ...(trackRelative === undefined ? {} : { trackPath: resolve(workRoot, trackRelative) }),
    provider: provider.name,
    ...(actualVoice === undefined ? {} : { voice: actualVoice }),
    notes,
    scenes: rows,
    totalSec: Math.round(totalSec * 100) / 100,
    cached,
    synthesized,
    warnings,
  };
}

/** `ffprobe` 实测时长；缺 ffprobe 时给可操作的说明（而不是一个 `ENOENT` 栈）。 */
function probeDuration(path: string): number {
  try {
    return Math.round(probeDurationSec(path) * 1000) / 1000;
  } catch (error) {
    throw new SynthError(
      `量不出音频时长：${(error as Error).message}\n配音与「按实测时长重渲染」都要 ffprobe（macOS：brew install ffmpeg）。`,
      2,
    );
  }
}
