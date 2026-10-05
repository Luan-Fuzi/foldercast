/**
 * `durations.json`（配音产物）与 TTS 适配层的类型。
 *
 * 这是契约的第三份（前三份见 SPEC-data-format.md 第二、三节与 assets 契约），
 * 形状与语义在 [SPEC-data-format.md 第四节](../../../docs/specs/SPEC-data-format.md)。
 *
 * **它是可重算的缓存，不是创作产物**：删了能重跑，只是要重新调一次 TTS（可能花钱）。
 * 所以它记的是「实测事实」—— 时长、音色、音频路径 —— 而不是任何判断。
 *
 * 三条约定值得写在这里：
 *
 * 1. **时长以实测为准**（C3）。不同引擎读同一段文字差 30%，用字数估会一路漂。
 * 2. **`provider` 与 `voice` 记的是实际用的**，不是配置里写的 —— 配置可能写 `say` 而
 *    实际回落到某个中文音色，报告要如实。
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
  /** 音频路径，**相对工作根**（与 `asset` / `items` 同一套基准）。 */
  audio: string;
  /**
   * 音频的**实测**时长（秒）。这是 `ffprobe` 的数字，原样记下 —— 它是「实测为准」这条
   * 设计的证据，也是校验器核对的锚点。
   */
  audioSec: number;
  /**
   * 这个场景在**成片里占多久**（秒）= `audioSec` + `pause`（末尾留白）。
   *
   * 为什么要分开：音轨里两个场景的音频是紧挨着的，而画面需要在说完话之后停一下。
   * 留白算在**场景时长**里，于是「帧号 ↔ 秒数」的换算只有一条时间轴，
   * 画面与配音不会因为留白而被拉开（踩过一次设计上的犹豫，见 M8 记录）。
   */
  duration: number;
  /** 字幕块与它们的时长，合计等于 `duration`。切分与校验器、渲染器共用 `contracts/subtitles.ts`。 */
  subs: Sub[];
};

export type DurationsDocument = {
  durations: typeof DURATIONS_VERSION;
  generatedAt: string;
  /** 实际使用的 provider（`say` / `mimo`…），覆盖解读里的 `voice` 配置。 */
  provider: string;
  /** 实际使用的音色；provider 内的字符串，不做跨 provider 统一枚举。 */
  voice?: string;
  /** 「怎么读」的原始描述（各 provider 自己翻译）。 */
  style?: string;
  /**
   * 拼好的整条旁白音轨（相对工作根）。**长度等于所有场景 `duration` 之和**，
   * 所以它可以直接交给渲染阶段，不需要再对齐。
   */
  track: string;
  /** 每个场景末尾的留白（秒）。`duration = audioSec + pause`，校验器据此核对。 */
  pause: number;
  scenes: SceneDuration[];
};

/* ------------------------------------------------------------------ 适配层 */

/** provider 的能力声明。调用方按能力分支，而不是 try/except 撞运气。 */
export type TtsCapability = 'instruct' | 'clone' | 'design' | 'voices';

/** 一次合成请求。**实现方只关心这些**，调度、断点续跑、实测都在外面。 */
export type SynthRequest = {
  text: string;
  /** 输出文件的**绝对路径**。实现方负责写出可被 ffprobe 读的音频。 */
  outPath: string;
  /** 音色；不给表示用 provider 的默认。 */
  voice?: string;
  /** 「怎么读」：MiMo 落在 user 消息，`say` 落在 `-r`。 */
  style?: string;
  /** 期望格式。**实现方可以产出别的格式**（外面会用 ffprobe 实测并按实际字节处理）。 */
  format?: 'wav' | 'mp3';
};

export type SynthResult = {
  /** 实际写出的格式（可能被实现方降级，比如 `say` 只能出 AIFF/CAF）。 */
  format: string;
  /** 实现方的补充说明（走哪条路、做了什么转换），会原样进日志。 */
  note?: string;
};

/**
 * 一个 TTS provider。
 *
 * `name` 与 `requiresKey` 是注册表的判据；`synth` 是唯一必需的能力。
 * **不做「先调用再报 401」**：实现方在 `synth` 之前就应当能判断自己缺什么（见 `preflight`）。
 */
export type TtsProvider = {
  name: string;
  /** 需要密钥的 provider 必须实现 `preflight`，缺密钥时返回结构化引导。 */
  requiresKey: boolean;
  capabilities: readonly TtsCapability[];
  /** 合成本次任务的**开销说明**（云端有成本，本地没有），给日志用。 */
  describe(): string;
  /** 前置检查：缺密钥/缺命令时返回引导。**在发起合成之前调用**。 */
  preflight(env: VoiceEnv): { ok: true } | { ok: false; reason: string; hint: string };
  synth(request: SynthRequest, env: VoiceEnv): Promise<SynthResult>;
  /**
   * 可选的音色列表；不支持就返回空数组（`voices` 能力）。
   *
   * **要跑命令的 provider 可以不实现它**（`say` 就是这样：列表在 `say -v '?'` 的输出里），
   * 那种情况用 `resolveVoice`。
   */
  listVoices?(): string[];
  /**
   * 解析「实际会用哪个音色」。**在合成之前调用**，理由是实测出来的：
   *
   * - 报告与 `durations.json` 要记**实际用的**音色，不是配置里写的；
   * - 而「自动挑一个」的动作原本藏在 `synth` 里，于是**全部命中缓存的那一次就不知道用了谁**
   *   （`say` 会挑系统里的中文音色，跳过合成之后这个信息就丢了）。
   */
  resolveVoice?(request: { voice?: string; style?: string }, env: VoiceEnv): Promise<string | undefined>;
};

/** 外部命令的执行结果。**stdout 与 stderr 都要留**：`say -v '?'` 把音色表写在 stderr 上。 */
export type ExecResult = { ok: boolean; stdout: string; stderr: string };

/** 环境：实现方要用到的外部世界（命令在不在、密钥取值）。**注入而不是直接读 `process.env`**，测试才好替换。 */
export type VoiceEnv = {
  /** 取密钥。**唯一的读取口**：CLI、插件、测试都从这里拿，读不到就是没配。 */
  secret: (ref: string) => string | undefined;
  /** 可执行文件在不在。 */
  has: (command: string) => boolean;
  /** 跑一个命令（`say` 这类本地工具要用）。 */
  exec: (command: string, args: readonly string[]) => Promise<ExecResult>;
};

/** 配音配置的形状只定义一次（解读与讲稿共用），这里只是转出去方便配音阶段引用。 */
export type { VoiceSpec } from './foldercast.ts';

/**
 * 密钥的引用名。**配置里只放这个名字，值走凭据 seam**（C6）。
 * 这里集中定义，是为了让「哪个 provider 用哪个引用名」只有一处。
 */
export const KEY_REFS: Readonly<Record<string, string>> = {
  mimo: 'MIMO_API_KEY',
};

/** 缺密钥时的退出码。与「渲染缺浏览器」用 3 同一套思路：可操作的环境问题，不是崩溃。 */
export const EXIT_CREDENTIAL_MISSING = 4;
