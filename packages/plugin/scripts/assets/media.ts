/**
 * 图片与视频的素材化。
 *
 * 图片缩放优先 `sips`（macOS 自带，零依赖），其他平台回退 ffmpeg；视频一律 ffmpeg/ffprobe。
 * 关键帧用**时间比例**取（10% / 50% / 90%）而不是帧号 —— 不同帧率的视频用帧号会取到完全
 * 不同的位置，比例取法对任何视频都稳定。
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { hasCommand, runCommand, runJson } from './run.ts';

export type ImageSize = { width: number; height: number };

/** 缩略图最长边。够视频里看清，又不至于让素材目录膨胀。 */
export const THUMB_MAX_EDGE = 640;

/** 视频取 3 个关键帧。 */
export const FRAME_RATIOS: readonly number[] = [0.1, 0.5, 0.9];

function ensureParent(target: string): void {
  mkdirSync(dirname(target), { recursive: true });
}

/** 读图片尺寸。先 sips，失败再用 ffprobe（跨平台）。 */
export function readImageSize(absolute: string): ImageSize | undefined {
  if (hasCommand('sips')) {
    const outcome = runCommand('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', absolute]);
    if (outcome.ok) {
      const width = /pixelWidth:\s*(\d+)/.exec(outcome.stdout)?.[1];
      const height = /pixelHeight:\s*(\d+)/.exec(outcome.stdout)?.[1];
      if (width !== undefined && height !== undefined) {
        return { width: Number(width), height: Number(height) };
      }
    }
  }

  const probe = probeVideo(absolute);
  if (probe?.width !== undefined && probe.height !== undefined) {
    return { width: probe.width, height: probe.height };
  }
  return undefined;
}

export type ProductResult = { ok: true } | { ok: false; error: string };

/** 生成图片缩略图（PNG，最长边 640）。 */
export function makeThumbnail(source: string, target: string): ProductResult {
  ensureParent(target);

  if (hasCommand('sips')) {
    const outcome = runCommand('sips', ['-Z', String(THUMB_MAX_EDGE), '--setProperty', 'format', 'png', '--out', target, source]);
    if (outcome.ok) return { ok: true };
    // sips 不认的格式（少见）再给 ffmpeg 一次机会
  }

  const outcome = runCommand('ffmpeg', [
    '-y',
    '-i',
    source,
    '-frames:v',
    '1',
    '-vf',
    `scale=${THUMB_MAX_EDGE}:-2:force_original_aspect_ratio=decrease`,
    target,
  ]);
  return outcome.ok ? { ok: true } : { ok: false, error: outcome.error };
}

export type VideoInfo = {
  durationSec?: number;
  width?: number;
  height?: number;
  codec?: string;
};

type FfprobeOutput = {
  streams?: Array<{ width?: number; height?: number; codec_name?: string }>;
  format?: { duration?: string };
};

/** ffprobe 读视频元数据。时长以**实测**为准（C3）。 */
export function probeVideo(absolute: string): VideoInfo | undefined {
  const result = runJson<FfprobeOutput>('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height,codec_name',
    '-show_entries',
    'format=duration',
    '-of',
    'json',
    absolute,
  ]);
  if (!result.ok) return undefined;

  const stream = result.value.streams?.[0];
  const duration = result.value.format?.duration;
  const info: VideoInfo = {};
  if (stream?.width !== undefined) info.width = stream.width;
  if (stream?.height !== undefined) info.height = stream.height;
  if (stream?.codec_name !== undefined) info.codec = stream.codec_name;
  if (duration !== undefined && Number.isFinite(Number(duration))) info.durationSec = Number(duration);
  return info;
}

/** 抽首帧当封面。 */
export function extractPoster(source: string, target: string): ProductResult {
  ensureParent(target);
  const outcome = runCommand('ffmpeg', [
    '-y',
    '-ss',
    '0',
    '-i',
    source,
    '-frames:v',
    '1',
    '-vf',
    `scale=${THUMB_MAX_EDGE}:-2:force_original_aspect_ratio=decrease`,
    '-q:v',
    '3',
    target,
  ]);
  return outcome.ok ? { ok: true } : { ok: false, error: outcome.error };
}

/**
 * 按时间比例抽关键帧。`durationSec` 未知时退化成按帧号取（0/1/2 秒处）。
 * `targets` 与 `FRAME_RATIOS` 一一对应。
 */
export function extractFrames(source: string, targets: readonly string[], durationSec?: number): ProductResult {
  for (const [index, target] of targets.entries()) {
    ensureParent(target);
    const ratio = FRAME_RATIOS[index] ?? 0.5;
    const seconds = durationSec === undefined ? index : Math.max(0, durationSec * ratio);
    const outcome = runCommand('ffmpeg', [
      '-y',
      '-ss',
      seconds.toFixed(2),
      '-i',
      source,
      '-frames:v',
      '1',
      '-vf',
      `scale=${THUMB_MAX_EDGE}:-2:force_original_aspect_ratio=decrease`,
      '-q:v',
      '3',
      target,
    ]);
    if (!outcome.ok) return { ok: false, error: outcome.error };
  }
  return { ok: true };
}
