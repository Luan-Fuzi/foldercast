/**
 * 图片内联（`embed.ts`）的预算与回退逻辑。
 *
 * 缩放/内联的本体复用渲染器的 `embedImage`（它有自己的测试），这里注入一个假实现，
 * 把字节大小变成可控的 —— 预算边界（单张 / 总量）必须是确定性的，不能看真图运气。
 */
import { describe, expect, it } from 'vitest';
import type { EmbedFn } from '../../renderer/embed.ts';
import { embedPageImages, relativeSrc } from '../embed.ts';

/** 假内联：按路径字典给字节数，src 一眼能认出是哪张。 */
function fakeEmbed(sizes: Record<string, number>): EmbedFn {
  return (target) => {
    const bytes = sizes[target.path];
    if (bytes === undefined) return undefined;
    return { src: `data:image/jpeg;base64,${target.path}`, bytes, scaled: true };
  };
}

const KB = 1024;

describe('预算与回退', () => {
  it('两层预算都够 → 内联，无说明', () => {
    const report = embedPageImages(['a.png'], {
      sourceDir: '/src',
      outDir: '/src/.foldercast/out',
      embed: fakeEmbed({ 'a.png': 80 * KB }),
    });
    expect(report.inlined).toBe(1);
    expect(report.linked).toBe(0);
    expect(report.images.get('a.png')).toMatchObject({ inlined: true, bytes: 80 * KB });
    expect(report.notes).toEqual([]);
  });

  it('单张超预算 → 退相对路径并说明', () => {
    const report = embedPageImages(['big.png'], {
      sourceDir: '/src',
      outDir: '/src/.foldercast/out',
      embed: fakeEmbed({ 'big.png': 200 * KB }),
    });
    expect(report.inlined).toBe(0);
    expect(report.linked).toBe(1);
    const image = report.images.get('big.png');
    expect(image?.inlined).toBe(false);
    expect(image?.src).toBe('../../big.png');
    expect(report.notes[0]).toContain('big.png');
    expect(report.notes[0]).toContain('超过预算');
  });

  it('总预算用完 → 之后的全部退相对路径（即使单张没超）', () => {
    const report = embedPageImages(['a.png', 'b.png', 'c.png', 'd.png'], {
      sourceDir: '/src',
      outDir: '/src/.foldercast/out',
      perImageLimitBytes: 150 * KB,
      totalBudgetBytes: 250 * KB,
      embed: fakeEmbed({ 'a.png': 100 * KB, 'b.png': 100 * KB, 'c.png': 100 * KB, 'd.png': 50 * KB }),
    });
    expect(report.inlined).toBe(2);
    expect(report.linked).toBe(2);
    expect(report.images.get('c.png')?.reason).toContain('总预算');
    expect(report.images.get('d.png')?.reason).toContain('已用完');
    expect(report.inlineBytes).toBe(200 * KB);
  });

  it('缩不动 / 太大（embedImage 给不了）→ 退相对路径', () => {
    const report = embedPageImages(['huge.png'], {
      sourceDir: '/src',
      outDir: '/src/.foldercast/out',
      embed: fakeEmbed({}),
    });
    expect(report.images.get('huge.png')?.inlined).toBe(false);
    expect(report.images.get('huge.png')?.reason).toContain('缩不小');
  });

  it('缩图工具缺席时的说明会透传到页脚（内联的是原图）', () => {
    const report = embedPageImages(['a.png'], {
      sourceDir: '/src',
      outDir: '/src/.foldercast/out',
      embed: () => ({ src: 'data:image/png;base64,eA', bytes: 1_000, scaled: false, note: '没有找到缩图工具（sips / ffmpeg），内联的是原图，体积偏大。' }),
    });
    expect(report.inlined).toBe(1);
    expect(report.notes[0]).toContain('原图');
  });
});

describe('引用分类与去重', () => {
  it('非图片引用直接忽略（卡片归渲染层管）', () => {
    const report = embedPageImages(['notes.txt', 'demo.mp4', 'spec.pdf'], {
      sourceDir: '/src',
      outDir: '/src/.foldercast/out',
      embed: fakeEmbed({}),
    });
    expect(report.images.size).toBe(0);
    expect(report.notes).toEqual([]);
  });

  it('HEIC 这类浏览器放不了的图片格式有交代', () => {
    const report = embedPageImages(['photo.heic'], {
      sourceDir: '/src',
      outDir: '/src/.foldercast/out',
      embed: fakeEmbed({}),
    });
    expect(report.images.size).toBe(0);
    expect(report.notes[0]).toContain('photo.heic');
    expect(report.notes[0]).toContain('内联不了');
  });

  it('重复引用只算一次', () => {
    const report = embedPageImages(['a.png', 'a.png', 'a.png'], {
      sourceDir: '/src',
      outDir: '/src/.foldercast/out',
      embed: fakeEmbed({ 'a.png': 10 * KB }),
    });
    expect(report.inlined).toBe(1);
    expect(report.inlineBytes).toBe(10 * KB);
  });
});

describe('相对路径', () => {
  it('页面到源文件，POSIX 分隔符', () => {
    expect(relativeSrc('/src/.foldercast/out', '/src/assets/ui.png')).toBe('../../assets/ui.png');
    expect(relativeSrc('/src/.foldercast/out', '/src/cover.png')).toBe('../../cover.png');
  });
});
