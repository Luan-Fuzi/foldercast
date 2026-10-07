/**
 * `durations.json`（配音产物）与 `say` provider 的类型。
 *
 * **它是可重算的缓存，不是创作产物**：删了能重跑，只是要重新合成一次。所以它记的是
 * 「实测事实」—— 时长、音色、音频路径 —— 而不是任何判断。
 *
 * 三条约定：
 *
 * 1. **时长以实测为准**。不同引擎读同一段文字差 30%，用字数估会一路漂。
 * 2. **`provider` 与 `voice` 记实际用的**，不是配置里写的 —— 配置可能没写音色而
 *    实际自动挑了一个，报告要如实。
 * 3. **`subs` 是 [文本, 秒] 的二元组**，顺序与 `contracts/subtitles.ts` 的切分一致。
 *    两处不一致就会「声音说到第三句、字幕还在第二句」。
 */

/** 产物格式版本。破坏性变更时递增。 */
export const DURATIONS_VERSION = 1 as const;

/** 一个字幕块：`[文本, 该块时长秒]`。 */
export type Sub = [string, number];

export type SceneDuration = {
  /** 对应讲稿里的场景 `id`。 */
  id: string;
  /** 音频路径，相对工作根。 */
  audio: string;
  /** 音频的**实测**时长（秒），`ffprobe` 的数字原样记下。 */
  audioSec: number;
  /**
   * 这个场景在**成片里占多久**（秒）= `audioSec` + 留白。留白算进场景时长，
   * 于是「帧号 ↔ 秒数」只有一条时间轴，画面与配音不会错开。
   */
  duration: number;
  /** 字幕块与它们的时长，合计等于 `duration`。切分与校验、渲染共用 `contracts/subtitles.ts`。 */
  subs: Sub[];
};

export type DurationsDocument = {
  durations: typeof DURATIONS_VERSION;
  generatedAt: string;
  /** 实际使用的 provider（现在是 `say`）。 */
  provider: string;
  /** 实际使用的音色。 */
  voice?: string;
  /** 「怎么读」的原始描述。 */
  style?: string;
  /** 拼好的整条旁白音轨（相对工作根），长度等于所有场景 `duration` 之和。 */
  track: string;
  /** 每个场景末尾的留白（秒）。 */
  pause: number;
  scenes: SceneDuration[];
};

/* ------------------------------------------------------------------ provider */

/** 一次合成请求。 */
export type SynthRequest = {
  text: string;
  /** 输出文件的**绝对路径**，实现方负责写出 ffprobe 读得了的音频。 */
  outPath: string;
  voice?: string;
  style?: string;
  format?: 'wav' | 'mp3';
};

export type SynthResult = {
  format: string;
  note?: string;
};

/**
 * TTS provider 的最小接口（现在只有 `say` 一个实现，接口保留是为了测试能注入假实现）。
 * `preflight` 在合成之前调用：缺命令时给可操作的引导，不等跑到一半才失败。
 */
export type TtsProvider = {
  name: string;
  describe(): string;
  preflight(env: VoiceEnv): { ok: true } | { ok: false; reason: string; hint: string };
  synth(request: SynthRequest, env: VoiceEnv): Promise<SynthResult>;
  /** 「实际会用哪个音色」。合成之前就要能答（全部命中缓存时也要记实际音色）。 */
  resolveVoice?(request: { voice?: string; style?: string }, env: VoiceEnv): Promise<string | undefined>;
};

/** 外部命令的执行结果。stdout 与 stderr 都要留：`say -v '?'` 把音色表写在 stderr 上。 */
export type ExecResult = { ok: boolean; stdout: string; stderr: string };

/** 外部世界：注入而不是直接读 `process.env`，测试才好替换。 */
export type VoiceEnv = {
  has: (command: string) => boolean;
  exec: (command: string, args: readonly string[]) => Promise<ExecResult>;
};
