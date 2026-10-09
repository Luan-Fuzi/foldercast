/**
 * 渲染：把计划交给 Remotion，拿回 mp4（或一张静帧）。
 *
 * 帧号在这里是**唯一的时间单位**：`plan.composition.durationInFrames` 由 CLI 算好，
 * `calculateMetadata` 原样交给 Remotion，所以「两次渲染逐帧一致」不依赖浏览器里的计算。
 *
 * 静音片（M7 不出声）：`muted` 只影响音轨，画面与它无关。
 *
 * **默认单并发**（`DEFAULT_CONCURRENCY`）：这是「逐帧一致」的必要条件，不是保守。实测同一份
 * 讲稿连渲三次，默认并发下三次的帧 sha256 互不相同（差异集中在片头 100 多帧），
 * `concurrency: 1` 之后画面稳定。多页面并行时 Chrome 的字形缓存与排版状态不一致，
 * 画面就跟着漂。想要快可以显式 `--concurrency N`，代价是放弃可复现。
 *
 * 一致性判据（0006 起）：**每帧 PSNR ≥ 45dB（视觉一致）**，字节相等算快速通道。浅色
 * 视觉基下 Chrome 的字形光栅化有亚像素噪声，过 JPEG 量化后字节必差（实测噪声下限
 * 78dB、约一成帧数受影响；深色主题时同样噪声被量化抹平，旧判据才得以字节相等）。
 * 真画面回归会远低于 45dB。
 */
import type { BrowserLog } from '@remotion/renderer';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Plan } from './plan.ts';

/**
 * 默认并发：1。理由见文件头 —— 多并发会让同一份讲稿渲出不同的帧。
 */
export const DEFAULT_CONCURRENCY = 1;

export type RenderOptions = {
  serveUrl: string;
  plan: Plan;
  /** 被讲解目录的绝对路径（素材基准；音频走 data URI，不用它）。 */
  base: string;
  /** 旁白音轨（`data:` URI 或 http(s) URL）。不给就出静音片。 */
  audio?: string;
  outputPath: string;
  browserPath: string;
  /** 渲染并发数。默认 1（刻意：并发会让画面不可复现）。 */
  concurrency?: number;
  /** 只渲染这一段（1 起，含两端）。逐帧一致验收用它。 */
  frameRange?: [number, number];
  onProgress?: (progress: { rendered: number; total: number }) => void;
  onLog?: (message: string) => void;
};

/** 渲染计划里已经算好的那一个 composition。 */
export async function selectPlan(options: {
  serveUrl: string;
  plan: Plan;
  base: string;
  browserPath: string;
  audio?: string;
  onLog?: (message: string) => void;
}) {
  return selectComposition({
    serveUrl: options.serveUrl,
    id: options.plan.composition.id,
    inputProps: { plan: options.plan, base: options.base, ...(options.audio === undefined ? {} : { audio: options.audio }) },
    browserExecutable: options.browserPath,
    chromiumOptions: { gl: 'swangle' },
    logLevel: 'error',
    onBrowserLog: (log: BrowserLog) => options.onLog?.(`[browser:${log.type}] ${log.text}`),
  });
}

/** 出一张静帧（`--still`）：调画面时比整片快得多。 */
export async function renderStillFrame(options: {
  audio?: string;
  serveUrl: string;
  plan: Plan;
  base: string;
  browserPath: string;
  frame: number;
  outputPath: string;
  imageFormat?: 'png' | 'jpeg';
  onLog?: (message: string) => void;
}): Promise<void> {
  const composition = await selectPlan(options);
  mkdirSync(dirname(options.outputPath), { recursive: true });
  await renderStill({
    composition,
    serveUrl: options.serveUrl,
    output: options.outputPath,
    frame: options.frame,
    inputProps: { plan: options.plan, base: options.base, ...(options.audio === undefined ? {} : { audio: options.audio }) },
    browserExecutable: options.browserPath,
    chromiumOptions: { gl: 'swangle' },
    imageFormat: options.imageFormat ?? 'png',
    logLevel: 'error',
    overwrite: true,
    onBrowserLog: (log: BrowserLog) => options.onLog?.(`[browser:${log.type}] ${log.text}`),
  });
}

/**
 * 逐帧一致验收怎么做的（**别用 `renderFrames` 的 `frameRange`**）：
 *
 * 实测 Remotion 4.0.532 在按帧范围出图时会画错帧 —— 最小复现（一个只显示
 * `useCurrentFrame()` 的组合，`frameRange: [100,103]`）里第 101、102、103 帧分别画出了
 * 第 101、100、102 帧的内容；小范围（`[7,10]`）却是对的。整片渲染没有这个问题。
 *
 * 所以判据改成：**同一份计划整片渲染两次，比 mp4 的 sha256**。编码器（ffmpeg）在输入
 * 帧完全相同时产物也是确定的，字节相同即逐帧相同；要更强的证据再用 ffmpeg 抽帧核对。
 * 这条写在代码里，是因为它看起来像「多跑一遍没必要」，而实际是唯一可靠的判据。
 */

/** 出片。返回实际写出的路径与帧数。 */
export async function renderVideo(
  options: RenderOptions,
): Promise<{ outputPath: string; frames: number; ms: number }> {
  const started = Date.now();
  const composition = await selectPlan(options);
  mkdirSync(dirname(options.outputPath), { recursive: true });

  const range = options.frameRange;
  const frames = range === undefined ? composition.durationInFrames : range[1] - range[0] + 1;

  await renderMedia({
    composition,
    serveUrl: options.serveUrl,
    codec: 'h264',
    outputLocation: options.outputPath,
    inputProps: { plan: options.plan, base: options.base, ...(options.audio === undefined ? {} : { audio: options.audio }) },
    browserExecutable: options.browserPath,
    chromiumOptions: { gl: 'swangle' },
    // 没有音轨时**静音出片**（M7 的默认路径）；有音轨就编成 aac 一起封装。
    muted: options.audio === undefined,
    enforceAudioTrack: options.audio !== undefined,
    ...(options.audio === undefined ? {} : { audioCodec: 'aac' as const }),
    ...(range === undefined ? {} : { frameRange: range }),
    concurrency: options.concurrency ?? DEFAULT_CONCURRENCY,
    logLevel: 'error',
    overwrite: true,
    onProgress: ({ renderedFrames, encodedFrames }: { renderedFrames: number; encodedFrames: number }) =>
      options.onProgress?.({ rendered: Math.max(renderedFrames, encodedFrames), total: frames }),
    onBrowserLog: (log: BrowserLog) => options.onLog?.(`[browser:${log.type}] ${log.text}`),
  });

  return { outputPath: options.outputPath, frames, ms: Date.now() - started };
}
