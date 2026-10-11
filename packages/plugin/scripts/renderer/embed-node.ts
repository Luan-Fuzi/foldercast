/**
 * 把本地图片变成浏览器能读的 `data:` URI。
 *
 * **为什么必须内联**：Remotion 渲染时把 bundle 挂在 `http://localhost:<端口>` 上，
 * 而页面里的 `<img src="file://…">` 会被 Chrome 按跨源请求拦掉（实测报
 * `Error loading image with src: file://…`）。素材都在被讲解目录里，不可能都拷进 bundle，
 * 所以图片在**渲染前**读成 base64 内联进去 —— 这与 M6 的 HTML 视图同一套做法，只不过
 * 那边是为了「单文件」，这边是因为 `file://` 根本读不了。
 *
 * 两条实现约定：
 *
 * 1. **先缩小再内联**。整页图原图能到 2000×2800、一张 1 MB 以上，15 页就是 20 MB 塞进
 *    props，浏览器解码也慢。缩到画面上够用的尺寸（本机用 macOS 自带 `sips`，其他平台
 *    回退 ffmpeg，都没有就内联原图）。
 * 2. **mime 跟着实际字节走**，不跟着后缀走 —— `sips` 产出的是 JPEG，声明成 `image/png`
 *    会让浏览器按错格式解（M6 踩过同一个坑）。
 *
 * **这个文件不许进浏览器 bundle**（它要 `node:child_process`）；类型与默认值在同目录的
 * `embed.ts` 里，`plan.ts` 只引那一份。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { resolveReference } from '../contracts/paths.ts';
import type { EmbedTarget, Embedded } from './embed.ts';

/** 能内联的图片类型。视频不在其列（`<video>` 不受 `<img>` 那条跨源限制约束）。 */
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.svg',
  '.avif',
]);

/** 单个素材内联后的字节上限。超过就退回「不内联」，由调用方决定怎么显示。 */
export const MAX_INLINE_BYTES = 12 * 1024 * 1024;

/** 矢量图不缩放：它是文本，缩了反而糊；体积本来就小。 */
const VECTOR_EXTENSIONS: ReadonlySet<string> = new Set(['.svg']);

/** 这个路径看起来是不是能内联的图片。`plan.ts` 用它决定要不要试内联。 */
export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(path).toLowerCase());
}

/** 扩展名 → mime。只在内联原文件时用得上（缩放后一律按实际字节判断）。 */
function mimeOf(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.svg':
      return 'image/svg+xml';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.bmp':
      return 'image/bmp';
    case '.avif':
      return 'image/avif';
    default:
      return 'image/png';
  }
}

/** 按魔数认类型。**优先于扩展名**：缩图工具产出的是 JPEG，与原后缀无关。 */
export function sniffMime(bytes: Buffer): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (bytes.length >= 6 && bytes.subarray(0, 6).toString('latin1').startsWith('GIF8')) return 'image/gif';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  return 'application/octet-stream';
}

function commandExists(command: string): boolean {
  try {
    execFileSync('which', [command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

let cachedScalers: 'sips' | 'ffmpeg' | 'none' | undefined;

/** 可用的缩图工具。**探测一次就记住**：渲染一帧要调很多次，不该每张图都 `which` 一遍。 */
export function pickScaler(): 'sips' | 'ffmpeg' | 'none' {
  if (cachedScalers !== undefined) return cachedScalers;
  cachedScalers = commandExists('sips') ? 'sips' : commandExists('ffmpeg') ? 'ffmpeg' : 'none';
  return cachedScalers;
}

/** 测试用：把探测结果清掉。 */
export function resetScalerCache(): void {
  cachedScalers = undefined;
}

/**
 * 缩小一张位图，返回 JPEG 字节。返回 undefined 表示缩不了（工具缺失或命令失败），
 * 这时调用方内联原图。
 */
function scaleWithSips(source: string, width: number, quality: number): Buffer | undefined {
  const dir = mkdtempSync(join(tmpdir(), 'foldercast-embed-'));
  const output = join(dir, 'scaled.jpg');
  try {
    execFileSync(
      'sips',
      ['-Z', String(width), '-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality), source, '--out', output],
      { stdio: 'ignore' },
    );
    return existsSync(output) ? readFileSync(output) : undefined;
  } catch {
    return undefined;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function scaleWithFfmpeg(source: string, width: number, quality: number): Buffer | undefined {
  const dir = mkdtempSync(join(tmpdir(), 'foldercast-embed-'));
  const output = join(dir, 'scaled.jpg');
  try {
    // `-1` 让高度按比例算；`scale=min(iw,N)` 只缩不放（比目标小的原样保留）。
    const filter = `scale='min(${String(width)},iw)':-1`;
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', source, '-vf', filter, '-q:v', String(Math.max(2, Math.round(31 - quality / 4))), output], {
      stdio: 'ignore',
    });
    return existsSync(output) ? readFileSync(output) : undefined;
  } catch {
    return undefined;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * 内联一件素材。返回 `undefined` 表示它不该/不能内联（不是图片、文件不存在、太大），
 * 调用方应当保留原来的路径引用。
 */
export function embedImage(target: EmbedTarget): Embedded | undefined {
  const absolute = resolveReference(target.workRoot, target.path);
  if (!existsSync(absolute) || !isImagePath(target.path)) return undefined;

  const stat = statSync(absolute);
  const quality = target.quality ?? 78;

  // 矢量图：直接内联文本，不经过缩放工具。
  if (VECTOR_EXTENSIONS.has(extname(target.path).toLowerCase())) {
    if (stat.size > MAX_INLINE_BYTES) return undefined;
    const bytes = readFileSync(absolute);
    return {
      src: `data:${mimeOf(target.path)};base64,${bytes.toString('base64')}`,
      bytes: bytes.length,
      scaled: false,
    };
  }

  const scaler = pickScaler();
  const scaled =
    scaler === 'sips'
      ? scaleWithSips(absolute, target.width, quality)
      : scaler === 'ffmpeg'
        ? scaleWithFfmpeg(absolute, target.width, quality)
        : undefined;

  if (scaled !== undefined && scaled.length > 0 && scaled.length <= MAX_INLINE_BYTES) {
    return {
      src: `data:${sniffMime(scaled)};base64,${scaled.toString('base64')}`,
      bytes: scaled.length,
      scaled: true,
    };
  }

  // 没有缩图工具（或缩图失败）：内联原图，前提是它没有大到把 props 撑爆。
  if (stat.size > MAX_INLINE_BYTES) return undefined;
  const bytes = readFileSync(absolute);
  return {
    src: `data:${mimeOf(target.path)};base64,${bytes.toString('base64')}`,
    bytes: bytes.length,
    scaled: false,
    note:
      scaler === 'none'
        ? '没有找到缩图工具（sips / ffmpeg），内联的是原图，体积偏大。'
        : '缩图失败，内联的是原图，体积偏大。',
  };
}
