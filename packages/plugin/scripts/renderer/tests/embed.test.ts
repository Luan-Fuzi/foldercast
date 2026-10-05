/**
 * 图片内联。
 *
 * 为什么必须有这一层：Remotion 把 bundle 挂在 `http://localhost:<端口>` 上，页面里的
 * `<img src="file://…">` 会被 Chrome 按跨源拦掉（实测整片渲染直接失败）。图片只能在
 * 渲染前读成 `data:` URI，所以「读得对、缩得动、mime 不撒谎」是要钉住的。
 *
 * 三条判据：
 * 1. **mime 跟着实际字节走**：缩图产物是 JPEG，声明成 `image/png` 会让浏览器按错格式解。
 * 2. **矢量图不缩放**：SVG 是文本，缩了反而糊。
 * 3. **不是图片、文件不存在、太大 → 返回 undefined**，由调用方决定怎么显示。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hasCommand } from '../../assets/run.ts';
import { embedImage, isImagePath, pickScaler, resetScalerCache, sniffMime, MAX_INLINE_BYTES } from '../embed-node.ts';

/**
 * 夹具图片用 ffmpeg 现场造（不往仓库里塞二进制）。ffmpeg 是**系统工具**：本机有、CI runner
 * 上没有 —— 缺它时相关的两条跳过，其余的照样跑。
 */
const hasFfmpeg = hasCommand('ffmpeg');

let workRoot = '';

/** 用 ffmpeg 现场造一张 2000×1000 的 PNG（不往仓库里塞二进制夹具）。 */
function makePng(path: string, width: number, height: number): void {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=red:s=${width}x${height}`, '-frames:v', '1', path]);
}

beforeAll(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'foldercast-embed-'));
  mkdirSync(join(workRoot, 'assets', 'pages'), { recursive: true });
  if (hasFfmpeg) makePng(join(workRoot, 'assets', 'pages', 'big.png'), 2000, 1000);
  writeFileSync(join(workRoot, 'assets', 'code.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
  writeFileSync(join(workRoot, 'assets', 'notes.txt'), 'not an image');
});

afterAll(() => {
  if (workRoot !== '') rmSync(workRoot, { recursive: true, force: true });
});

describe('mime 判定', () => {
  it('JPEG 与 PNG 按魔数认，不看后缀', () => {
    expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(sniffMime(Buffer.from('GIF89a'))).toBe('image/gif');
    expect(sniffMime(Buffer.from('nonsense'))).toBe('application/octet-stream');
  });

  it('认得出图片后缀，认不出文本', () => {
    expect(isImagePath('assets/pages/a.PNG')).toBe(true);
    expect(isImagePath('assets/code/a.svg')).toBe(true);
    expect(isImagePath('notes.txt')).toBe(false);
  });
});

describe('内联', () => {
  it.skipIf(!hasFfmpeg)('位图缩到目标宽度并声明成 JPEG（缩图工具的产物就是 JPEG）', () => {
    const result = embedImage({ path: 'assets/pages/big.png', workRoot, width: 800 });
    if (result === undefined || !result.scaled) {
      // 机器上既没有 sips 也没有 ffmpeg：这时应当内联原图，并在 note 里说明
      expect(pickScaler()).toBe('none');
      expect(result?.scaled).toBe(false);
      expect(result?.note).toContain('原图');
      return;
    }
    expect(result.src.startsWith('data:image/jpeg;base64,')).toBe(true);
    const bytes = Buffer.from(result.src.split(',')[1] ?? '', 'base64');
    expect(sniffMime(bytes)).toBe('image/jpeg');
    expect(result.bytes).toBe(bytes.length);
    // 缩过之后一定比原图小
    expect(bytes.length).toBeLessThan(readFileSync(join(workRoot, 'assets', 'pages', 'big.png')).length);
  });

  it('SVG 原样内联，不做缩放', () => {
    const result = embedImage({ path: 'assets/code.svg', workRoot, width: 400 });
    expect(result?.scaled).toBe(false);
    expect(result?.src.startsWith('data:image/svg+xml;base64,')).toBe(true);
  });

  it('不是图片就不管，交给调用方', () => {
    expect(embedImage({ path: 'assets/notes.txt', workRoot, width: 400 })).toBeUndefined();
  });

  it('文件不存在返回 undefined，不抛错', () => {
    expect(embedImage({ path: 'assets/missing.png', workRoot, width: 400 })).toBeUndefined();
  });

  it('超过上限的矢量图不内联（不把 props 撑爆）', () => {
    const huge = join(workRoot, 'assets', 'huge.svg');
    writeFileSync(huge, `<svg xmlns="http://www.w3.org/2000/svg">${'<!-- pad -->'.repeat(Math.ceil(MAX_INLINE_BYTES / 12) + 10)}</svg>`);
    expect(embedImage({ path: 'assets/huge.svg', workRoot, width: 400 })).toBeUndefined();
  });

  it('缩图工具探测只做一次', () => {
    resetScalerCache();
    const first = pickScaler();
    expect(pickScaler()).toBe(first);
  });
});
