/**
 * 音频的测量与拼接。**两个动作，都只认字节不认后缀。**
 *
 * 1. `probeDurationSec`：`ffprobe` 实测。这是「长度以实测为准」这条设计的落点 ——
 *    不同引擎读同一段文字差 30%，用字数估会一路漂（C3）。
 * 2. `buildTrack`：把逐场景音频按**场景时长**拼成一条音轨。拼接不用重编码之外的任何处理：
 *    每个场景的音频后面补一段静音，补到该场景在成片里的时长，所以
 *    「场景 N 的音频起点 = 前面所有场景时长之和」，与画面帧号一一对应。
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** 实测一段音频的时长（秒）。读不出来时抛错 —— 静默给 0 会让后面全错位。 */
export function probeDurationSec(path: string): number {
  let output: string;
  try {
    output = execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path],
      { encoding: 'utf8' },
    );
  } catch (error) {
    throw new Error(`ffprobe 读不出时长：${path}\n${(error as Error).message}`);
  }
  const seconds = Number(output.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`ffprobe 给出的时长不是正数（${output.trim()}）：${path}`);
  }
  return seconds;
}

/** 生成一段静音 wav。拼接时补齐用。 */
export function makeSilence(path: string, seconds: number, sampleRate = 44100): void {
  mkdirSync(dirname(path), { recursive: true });
  const duration = Math.max(0.001, seconds);
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      `anullsrc=r=${String(sampleRate)}:cl=mono`,
      '-t',
      duration.toFixed(3),
      '-c:a',
      'pcm_s16le',
      path,
    ],
    { stdio: 'ignore' },
  );
}

export type TrackInput = {
  /** 每个场景的音频绝对路径。 */
  audio: string;
  /** 该场景在成片里的时长（秒）。音频比它短时补静音，比它长时**截断并报警**。 */
  duration: number;
};

export type TrackReport = { path: string; seconds: number; padded: number; trimmed: string[] };

/**
 * 拼出整条音轨。返回实际写出的长度与被截断的场景（调用方负责报出来）。
 *
 * 超过场景时长的音频会**被截断**：不截断就会把后面的场景整体推后，字幕与画面全部错位。
 * 这是配音阶段唯一会「丢掉内容」的地方，所以它一定会在报告里出现，而不是静默发生。
 */
export function buildTrack(options: {
  workRoot: string;
  items: readonly TrackInput[];
  outPath: string;
  /** 临时文件目录（静音片段）。 */
  tempDir: string;
}): TrackReport {
  mkdirSync(options.tempDir, { recursive: true });
  const pieces: string[] = [];
  const trimmed: string[] = [];
  let seconds = 0;
  let padded = 0;

  options.items.forEach((item, index) => {
    const measured = probeDurationSec(item.audio);
    if (measured > item.duration + 0.02) {
      trimmed.push(`${item.audio}（实测 ${measured.toFixed(2)}s > 场景 ${item.duration.toFixed(2)}s）`);
    }
    const audible = Math.min(measured, item.duration);
    pieces.push(`file '${item.audio.replace(/'/g, "'\\''")}'`);

    const gap = Math.max(0, item.duration - audible);
    if (gap > 0.005) {
      const silence = resolve(options.tempDir, `gap-${String(index)}.wav`);
      makeSilence(silence, gap);
      pieces.push(`file '${silence.replace(/'/g, "'\\''")}'`);
      padded += gap;
    }
    seconds += item.duration;
  });

  const listPath = resolve(options.tempDir, 'concat.txt');
  writeFileSync(listPath, `${pieces.join('\n')}\n`);
  mkdirSync(dirname(options.outPath), { recursive: true });

  // `-t` 卡住总长：截断场景时 concat 的输入会比目标长，不卡就会整体超时
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listPath,
      '-t',
      seconds.toFixed(3),
      '-ac',
      '1',
      '-ar',
      '44100',
      '-c:a',
      'pcm_s16le',
      options.outPath,
    ],
    { stdio: 'ignore' },
  );

  return { path: options.outPath, seconds, padded, trimmed };
}

/** 读一个 JSON 文件；不存在返回 undefined。 */
export function readJsonIfExists<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
}
