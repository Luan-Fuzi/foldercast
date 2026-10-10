/**
 * `durations.json`（配音产物）与 TTS provider 的接口。
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
  /** 当前合成请求与音频字节，用于核对缓存与渲染输入。旧产物缺席时需重新配音。 */
  inputHash?: string;
  audioHash?: string;
};

export type DurationsDocument = {
  durations: typeof DURATIONS_VERSION;
  generatedAt: string;
  /** 实际使用的 provider（`say` / `edge` / `mimo`…）。 */
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
  /** 场景顺序、id 与旁白的版本；画面文案变化不使音频失效。 */
  narrationHash?: string;
  trackHash?: string;
  /** 实际请求的音色（null 表示未指定）；与仅作报告的实际音色分开。 */
  synthesisVoice?: string | null;
  /** 合成时讲稿中的配音设置；允许 CLI 覆盖音色，又能发现之后的讲稿设置变化。 */
  voiceSpecHash?: string;
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

/** provider 的能力声明。调用方按能力分支，而不是 try/catch 撞运气。 */
export type TtsCapability = 'instruct' | 'voices';

/**
 * 一个 TTS provider。接口在这里定死（P0 seam，见 docs/decisions/0002）：注册表认 `name` 与
 * `requiresKey`，实现方各占一个文件（`voice/providers/`），互不依赖。
 *
 * `preflight` 在合成之前调用：缺命令、缺密钥时给可操作的引导，不等跑到一半才失败 ——
 * 云端 provider 等一个 401 再报错，用户看不出该怎么办。
 */
export type TtsProvider = {
  name: string;
  /** 需要密钥的 provider 必须在 `preflight` 里查密钥（`env.secret` + `KEY_REFS`），缺了不发起请求。 */
  requiresKey: boolean;
  capabilities: readonly TtsCapability[];
  /** 合成本次任务的开销说明（云端有费用，本地没有），给日志用。 */
  describe(): string;
  preflight(env: VoiceEnv): { ok: true } | { ok: false; reason: string; hint: string };
  synth(request: SynthRequest, env: VoiceEnv): Promise<SynthResult>;
  /** 预置音色列表。要跑命令才知道的（如 `say -v '?'`）不实现它，用 `resolveVoice`。 */
  listVoices?(): string[];
  /** 「实际会用哪个音色」。合成之前就要能答（全部命中缓存时也要记实际音色）。 */
  resolveVoice?(request: { voice?: string; style?: string }, env: VoiceEnv): Promise<string | undefined>;
};

/** 外部命令的执行结果。stdout 与 stderr 都要留：`say -v '?'` 把音色表写在 stderr 上。 */
export type ExecResult = { ok: boolean; stdout: string; stderr: string };

/**
 * 外部世界：注入而不是直接读 `process.env`，测试才好替换。
 * 密钥只有 `secret` 一个读取口（实现方不直接碰 `process.env`），值不进日志与报告。
 */
export type VoiceEnv = {
  /** 取凭据（按引用名，如 `MIMO_API_KEY`）。读不到就是没配。 */
  secret: (ref: string) => string | undefined;
  has: (command: string) => boolean;
  exec: (command: string, args: readonly string[]) => Promise<ExecResult>;
};

/**
 * 密钥的引用名。**配置里只放这个名字，值走凭据 seam**：哪个 provider 用哪个引用名，只有这一处。
 */
export const KEY_REFS: Readonly<Record<string, string>> = {
  mimo: 'MIMO_API_KEY',
};

/** 缺密钥的专用退出码：可操作的环境问题，不是崩溃（与渲染缺浏览器用 3 同一套思路）。 */
export const EXIT_CREDENTIAL_MISSING = 4;
