/**
 * 时长预估与字幕时序。**没有音频也要能渲染**，所以时长必须由字数算出来。
 *
 * 这是 M7 的时长来源；M8 用 `ffprobe` 实测音频后按实测时长重渲染（C3）。两遍渲染是
 * 设计的一部分：这一遍快，用来反复调画面；那一遍准，用来出成片。
 *
 * 三条判据：
 *
 * 1. **同一个讲稿永远算出同一组帧号**。只有整数与浮点算术，不看时钟、不用随机数。
 * 2. **字幕块与讲稿是同一份切分**。块来自 `contracts/subtitles.ts`（与校验器、M8 共用），
 *    这里只负责把时间轴分给它们。
 * 3. **留白不占朗读时间**。场景时长 = 朗读时间 + 留白，两者分开算，改留白不会让语速变慢。
 *
 * 语速取 `docs/specs/SPEC-data-format.md` 的「中文按约 4.3 字/秒」，其余按显示宽度推：
 * 宽度 1（中日韩文字）读 4.3 个/秒，宽度 0.5（拉丁字母、数字、半角符号）按 3 倍速 ——
 * 一眼能看出这是「按字数估」而不是测量值。这些是**校准常数**，M8 拿到真实音频后可
 * 按实测回校，`durations.json` 的结构与渲染链路不变。
 */
import { splitSubtitles } from '../contracts/subtitles.ts';

/** 一个宽度单位读多久（秒）。4.3 个中文字/秒。 */
export const SEC_PER_UNIT = 1 / 4.3;

/** 标点停顿：句末标点折成多少个宽度单位的朗读时间。 */
export const PAUSE_UNITS_SENTENCE = 2.4;

/** 标点停顿：逗号、顿号。 */
export const PAUSE_UNITS_CLAUSE = 1.2;

/** 每个场景的固定留白（秒）：切换画面时的呼吸。 */
export const TAIL_BASE_SEC = 0.45;

/** 每个场景按朗读时长的比例再加一点留白。 */
export const TAIL_RATIO = 0.07;

/** 场景下限（秒）。太短的场景一闪而过，看不清。 */
export const MIN_SCENE_SEC = 4.5;

/** 场景上限（秒）。 */
export const MAX_SCENE_SEC = 90;

/** 一段旁白读多久（秒）。不含场景留白；空白或纯符号时按 0 算，由场景下限兜底。 */
export function estimateNarrationSec(narration: string): number {
  return Math.max(0, spokenUnits(narration) + pauseUnits(narration)) * SEC_PER_UNIT;
}

/** 一个场景在画面上占多久（秒）。朗读时间 + 留白，夹在上下限之间。 */
export function estimateSceneSec(narration: string): number {
  const narrationSec = estimateNarrationSec(narration);
  const raw = narrationSec + TAIL_BASE_SEC + narrationSec * TAIL_RATIO;
  return Math.min(MAX_SCENE_SEC, Math.max(MIN_SCENE_SEC, raw));
}

/** 秒 → 帧，四舍五入到最近的帧，至少 1 帧。 */
export function secToFrames(sec: number, fps: number): number {
  return Math.max(1, Math.round(sec * fps));
}

/**
 * 把一个场景的帧数分给它的字幕块。
 *
 * 分配规则：先按宽度占比分；低于下限（`minFrames`）的块从**最长的块**那里要，
 * 要到最长块也只剩下限为止。最后一块吃掉余量，于是字幕在留白期间保持可见 ——
 * 与真实视频里「说完话字幕停一下」一致。分不够时宁可某块偏短，也不改变总帧数：
 * 场景时长已经定了，字幕必须迁就它。
 *
 * 返回的区间是**相对场景起点的帧号**，`from` 含、`to` 不含。
 */
export function captionWindows(
  narration: string,
  frames: number,
  minFrames: number,
): { text: string; from: number; to: number }[] {
  const texts = splitSubtitles(narration);
  if (texts.length === 0) return [];

  const weights = texts.map(spokenUnits).map((value) => (value > 0 ? value : 0.5));
  const total = weights.reduce((sum, value) => sum + value, 0);
  const quota = weights.map((value) => Math.max(1, Math.round((value / total) * frames)));

  const floor = Math.max(1, Math.min(minFrames, Math.floor(frames / texts.length)));
  for (let i = 0; i < quota.length; i += 1) {
    let need = floor - (quota[i] ?? 0);
    let guard = 0;
    while (need > 0 && guard < quota.length * 4) {
      guard += 1;
      let donor = -1;
      let donorValue = floor;
      for (let j = 0; j < quota.length; j += 1) {
        const value = quota[j] ?? 0;
        if (j === i || value <= donorValue) continue;
        donor = j;
        donorValue = value;
      }
      if (donor === -1) break;
      const give = Math.min(need, donorValue - floor);
      quota[donor] = donorValue - give;
      quota[i] = (quota[i] ?? 0) + give;
      need -= give;
    }
  }

  const windows: { text: string; from: number; to: number }[] = [];
  let cursor = 0;
  for (let i = 0; i < texts.length; i += 1) {
    const text = texts[i] ?? '';
    const isLast = i === texts.length - 1;
    const span = isLast ? Math.max(1, frames - cursor) : (quota[i] ?? 1);
    windows.push({ text, from: cursor, to: cursor + span });
    if (!isLast) cursor += span;
  }
  return windows;
}

/** 一份讲稿的时长预估汇总，`--check` 与日志用它。 */
export type DurationSummary = {
  scenes: { id: string; type: string; narrationUnits: number; seconds: number; frames: number }[];
  totalSeconds: number;
  totalFrames: number;
};

/** 预估整片时长。`fps` 只影响帧数换算。 */
export function summarizeDurations(
  scenes: readonly { id: string; type: string; narration: string }[],
  fps: number,
): DurationSummary {
  const rows = scenes.map((scene) => ({
    id: scene.id,
    type: scene.type,
    narrationUnits: spokenUnits(scene.narration) + pauseUnits(scene.narration),
    seconds: estimateSceneSec(scene.narration),
    frames: secToFrames(estimateSceneSec(scene.narration), fps),
  }));
  return {
    scenes: rows,
    totalSeconds: rows.reduce((sum, row) => sum + row.seconds, 0),
    totalFrames: rows.reduce((sum, row) => sum + row.frames, 0),
  };
}

/**
 * `video.targetDurationSec` 是**软约束**（见 SPEC-data-format.md）：写了目标时长就按比例
 * 缩放各场景，缩放后总帧数**精确等于**目标帧数（余数给最后一场），字幕时序跟着重算。
 */
export function scaleToTarget(frames: readonly number[], targetFrames: number): number[] {
  const sum = frames.reduce((total, value) => total + value, 0);
  if (sum <= 0 || targetFrames <= 0 || frames.length === 0) return [...frames];

  const scaled = frames.map((value) => Math.max(1, Math.round((value / sum) * targetFrames)));
  const drift = targetFrames - scaled.reduce((total, value) => total + value, 0);
  const last = scaled.length - 1;
  scaled[last] = Math.max(1, (scaled[last] ?? 1) + drift);
  return scaled;
}

/** 朗读用掉的宽度（标点不计，它的时间单独算停顿）。 */
export function spokenUnits(text: string): number {
  let units = 0;
  for (const char of text) {
    if (SENTENCE_END.has(char) || CLAUSE_END.has(char)) continue;
    units += CJK.test(char) ? 1 : 0.5;
  }
  return units;
}

/** 标点造成的停顿，折成宽度单位。 */
export function pauseUnits(text: string): number {
  let units = 0;
  for (const char of text) {
    if (SENTENCE_END.has(char)) units += PAUSE_UNITS_SENTENCE;
    else if (CLAUSE_END.has(char)) units += PAUSE_UNITS_CLAUSE;
    else if (OTHER_PUNCT.test(char)) units += OTHER_PUNCT_UNITS;
  }
  return units;
}

/** 其余标点（省略号、引号、括号）的停顿。 */
export const OTHER_PUNCT_UNITS = 0.6;

const SENTENCE_END = new Set(['。', '！', '？', '；', '：']);
const CLAUSE_END = new Set(['，', '、']);
const OTHER_PUNCT = /[\u2014\u2026\u00b7!?,.;:()\u3010\u3011\u300c\u300d\u201c\u201d"'<>]/u;
const CJK = /[\u2E80-\u9FFF\u3000-\u303F\uAC00-\uD7FF\uFF00-\uFF60\uFFE0-\uFFE6]/u;
