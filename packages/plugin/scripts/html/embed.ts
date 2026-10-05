/**
 * 图片内联：把素材图片变成页面上能直接用的 `src`。
 *
 * 目标是 ROADMAP M6 的「单文件输出，无外部依赖」—— 页面要能整份转发。做法是先按页面尺寸
 * 缩小（`sips`，跨平台回退 `ffmpeg`），再编码成 data URI；缩不小或超过预算的才退回相对路径，
 * **并在页脚说明哪几张没内联**（页面自己交代边界，而不是悄悄引用外部文件）。
 *
 * 外部命令的用法与素材阶段一致（`docs/conventions/coding.md`：转图这类事不引库）。
 * 两个命令都没有时不是错误：原图仍可能小到可以直接内联。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, relative, resolve } from 'node:path';

/** 能内联的栅格格式。SVG 走文本内联（代码高亮图就是 SVG）。 */
const RASTER: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

export type EmbedResult = {
  /** 素材路径（相对工作根）→ `src`。 */
  images: Map<string, string>;
  /** 给页脚看的说明。 */
  notes: string[];
};

export type EmbedOptions = {
  /** 工作根：素材路径相对它。 */
  workRoot: string;
  /** 页面所在目录（用于算相对路径）。默认 `<工作根>/out`。 */
  outDir?: string;
  /** 缩小后的最大宽度。 */
  maxWidth?: number;
  /** 单张超过这个字节数就不内联（页面会变大，转发也变重）。 */
  inlineLimitBytes?: number;
  /** 关掉外部命令（测试与 CI 用）。 */
  downscale?: boolean;
};

type RunResult = { ok: boolean; stdout: string; stderr: string };

function run(command: string, args: readonly string[]): Promise<RunResult> {
  return new Promise<RunResult>((resolvePromise) => {
    let child;
    try {
      child = spawn(command, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      resolvePromise({ ok: false, stdout: '', stderr: 'spawn failed' });
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', () => {
      resolvePromise({ ok: false, stdout, stderr });
    });
    child.on('close', (code) => {
      resolvePromise({ ok: code === 0, stdout, stderr });
    });
  });
}

/** 缩小一张图；两个命令都不可用时返回 undefined（调用方回退原图）。 */
async function downscale(source: string, target: string, maxWidth: number): Promise<boolean> {
  const sips = await run('sips', ['-Z', String(maxWidth), '-s', 'format', 'jpeg', '-s', 'formatOptions', '70', source, '--out', target]);
  if (sips.ok && existsSync(target)) return true;

  const ffmpeg = await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', source, '-vf', `scale=${String(maxWidth)}:-1`, '-q:v', '4', target]);
  return ffmpeg.ok && existsSync(target);
}

/** 页面与素材之间的相对路径：页面在 `<工作根>/out/`，素材在 `<工作根>/assets/`。 */
export function relativeAssetPath(outDir: string, assetAbsolute: string): string {
  const relativePath = relative(outDir, assetAbsolute);
  return relativePath.split(/[\\/]/).join('/');
}

/**
 * 解析要画的图片。
 *
 * 路径不存在、不是图片、或超过预算的文件都会被跳过 —— 页面里**不留破图**，也会在 notes 里
 * 说清楚为什么。
 */
export async function embedImages(assetPaths: readonly string[], options: EmbedOptions): Promise<EmbedResult> {
  const workRoot = resolve(options.workRoot);
  const outDir = resolve(options.outDir ?? join(workRoot, 'out'));
  // 页面里缩略图最大显示到 260px（CSS），所以 560 已经留了 2 倍余量；
  // 再大只是让文件更肥 —— 密集扫描页在 560/q70 下约 60–90 KB，能全部内联进单文件
  const maxWidth = options.maxWidth ?? 560;
  const inlineLimitBytes = options.inlineLimitBytes ?? 160 * 1024;
  const downscaleEnabled = options.downscale ?? true;

  const images = new Map<string, string>();
  const notes: string[] = [];
  const skipped: string[] = [];
  const linked: string[] = [];
  let temporary: string | undefined;

  const scratch = (): string => {
    temporary ??= mkdtempSync(join(tmpdir(), 'foldercast-html-'));
    return temporary;
  };

  try {
    for (const assetPath of [...new Set(assetPaths)].sort((left, right) => left.localeCompare(right, 'en'))) {
      const absolute = resolve(workRoot, assetPath);
      if (!existsSync(absolute)) {
        skipped.push(assetPath);
        continue;
      }

      const extension = extname(absolute).toLowerCase();
      if (extension === '.svg') {
        // 代码高亮图是 SVG：本身是文本，直接内联最省事，也不必缩
        const svg = readFileSync(absolute, 'utf8');
        images.set(assetPath, `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`);
        continue;
      }

      const mime = RASTER[extension];
      if (mime === undefined) {
        skipped.push(assetPath);
        continue;
      }

      let buffer = readFileSync(absolute);
      // 缩小产物是 JPEG：data URI 的 mime 必须跟着**实际字节**走，否则会写出
      // 「声明 png、内容是 jpeg」的 data URI（浏览器能显示，但这是错的）
      let bufferMime = mime;
      if (downscaleEnabled) {
        const target = join(scratch(), `${String(images.size)}.jpg`);
        const shrunk = await downscale(absolute, target, maxWidth);
        if (shrunk) {
          const candidate = readFileSync(target);
          // 缩不小就别缩（小图转 JPEG 反而更大）
          if (candidate.byteLength < buffer.byteLength) {
            buffer = candidate;
            bufferMime = 'image/jpeg';
          }
        }
      }

      if (buffer.byteLength <= inlineLimitBytes) {
        images.set(assetPath, `data:${bufferMime};base64,${buffer.toString('base64')}`);
      } else {
        images.set(assetPath, relativeAssetPath(outDir, absolute));
        linked.push(`${assetPath}（${String(Math.round(buffer.byteLength / 1024))} KB）`);
      }
    }

    if (skipped.length > 0) {
      notes.push(`有 ${String(skipped.length)} 个素材文件没有画出来（文件不存在或不是图片）：${skipped.slice(0, 5).join('、')}${skipped.length > 5 ? ' 等' : ''}`);
    }
    if (linked.length > 0) {
      notes.push(
        `有 ${String(linked.length)} 张图超过内联预算（${String(Math.round(inlineLimitBytes / 1024))} KB），页面用相对路径引用它们：${linked.slice(0, 5).join('、')}${linked.length > 5 ? ' 等' : ''} —— 转发这一页时要把 <span class="mono">assets/</span> 一起带上。`,
      );
    }
  } finally {
    if (temporary !== undefined) rmSync(temporary, { recursive: true, force: true });
  }

  return { images, notes };
}

/** 供测试与说明用：单张图在页面里的体积。 */
export function dataUriBytes(source: string): number {
  const comma = source.indexOf(',');
  if (!source.startsWith('data:') || comma === -1) return statSync(source, { throwIfNoEntry: false })?.size ?? 0;
  return Math.round((source.length - comma - 1) * 0.75);
}
