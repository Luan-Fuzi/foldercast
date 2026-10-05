/**
 * 渲染：一个自包含的静态页面。
 *
 * 这里断言的是 ROADMAP M6 的硬约束与几处容易写错的地方：**没有外部依赖**（不引 CDN、没有一行
 * JavaScript）、**输出确定**、**用户的内容要转义**、**密钥文件不能出现摘要**、没有内容的文件
 * 不单独占一张卡片。
 */
import { describe, expect, it } from 'vitest';
import { collectViewModel } from '../collect.ts';
import { escapeHtml, formatBytes, hasSomethingToShow, renderPage } from '../render.ts';
import { assets, entry, reading } from './reading.ts';

const AT = '2026-10-05T12:00:00.000Z';

function page(overrides: Parameters<typeof reading>[0] = {}, withImages = false): string {
  const document = reading(overrides);
  const model = collectViewModel(document, withImages ? assets() : undefined);
  return renderPage(model, { images: new Map(), notes: [], pageGeneratedAt: AT });
}

describe('escapeHtml / formatBytes', () => {
  it('转义会破坏结构的字符', () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe(
      '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;',
    );
    expect(escapeHtml("it's & that")).toBe('it&#39;s &amp; that');
  });

  it('字节数按人看的单位写', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});

describe('页面的硬约束', () => {
  const html = page();

  it('没有一行 JavaScript', () => {
    expect(html).not.toContain('<script');
    expect(html.toLowerCase()).not.toContain('javascript:');
    expect(html).not.toContain('onclick=');
  });

  it('没有外部资源：CSS 内联，不引字体或图片 CDN', () => {
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain('@import');
    expect(html).not.toContain('<link');
    expect(html).toContain('<style>');
  });

  it('同一份解读渲染两次完全一致（时间由调用方传入）', () => {
    expect(page()).toBe(html);
  });

  it('是一个完整的 HTML 文档', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="zh-CN">');
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
  });
});

describe('内容正确性', () => {
  it('转义用户内容：文件名里带标签也不会变成标签', () => {
    const html = page({
      manifest: [entry('<img src=x onerror=alert(1)>.md', { preview: '<b>粗体</b>' })],
      stats: { ...reading().stats, totalFiles: 1 },
    });
    expect(html).not.toContain('<img src=x onerror');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;.md');
    expect(html).toContain('&lt;b&gt;粗体&lt;/b&gt;');
  });

  it('密钥文件：出现在审计表里，卡片上只有「内容没有被读过」', () => {
    const html = page();
    expect(html).toContain('密钥审计');
    expect(html).toContain('.env');
    expect(html).toContain('内容没有被读过');
    // 审计表里那一条带命中的判据
    expect(html).toMatch(/<td class="mono">\.env<\/td><td class="mono">\.env<\/td>/);
  });

  it('边界写清楚：收录了多少、有没有截断、排除了什么', () => {
    const full = page();
    expect(full).toContain('这份解读的边界');
    // 只收 5 个、上限 200：不能说「截断到 200」，得说实话
    expect(full).toContain('没有触发 200 个的截断上限');
    expect(full).toContain('.git/**'); // 排除清单要能展开看到

    const truncated = page({ sources: { maxFiles: 2, exclude: ['.git/**'] } });
    expect(truncated).toContain('它不是整个目录');
    // 密钥不占配额，所以清单条数可能比上限多 —— 这句必须写出来，否则读者会以为数字对不上
    expect(truncated).toContain('密钥类文件不占这个配额');
  });

  it('引用列表有上限、标题是提取的、代码图只画开头 —— 三条边界都要交代', () => {
    const html = page();
    expect(html).toContain('引用列表有上限');
    expect(html).toContain('首个标题或首段');
    expect(html).toContain('只画文件开头若干行');
  });

  it('入口、枢纽、坏引用都如实出现', () => {
    const html = page();
    expect(html).toContain('入口与枢纽');
    expect(html).toContain('src/util.ts');
    expect(html).toContain('src/missing.ts');
  });

  it('页脚说明来源与生成时间，两处时间用同一种格式', () => {
    const html = page();
    expect(html).toContain('解读生成于');
    expect(html).toContain('页面生成于');
    // 本地时间 + 偏移（不写死具体时刻：跑在哪个时区都该是这个形状）
    const stamps = [...html.matchAll(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}[+-]\d{2}:\d{2}/g)];
    expect(stamps.length).toBeGreaterThanOrEqual(2);
  });
});

describe('文件卡片的取舍', () => {
  it('没有摘要也没有配图的文件不单独列卡片，但要说明漏了多少', () => {
    const html = page();
    // public/clip.wav 没有摘要、也没有配图与引用关系
    expect(html).toContain('另有 1 个文件既没有摘要、也没有配图与引用关系');
    expect(html).toContain('public/clip.wav'); // 举例说明是哪一个，别让读者猜
    expect(html).toContain('结构树里有全部 5 个文件');
  });

  it('入口/枢纽/密钥即使没有摘要也保留卡片', () => {
    const model = collectViewModel(reading(), undefined);
    const kept = model.cards.filter((card) => hasSomethingToShow(card, new Map()));
    expect(kept.map((card) => card.path).sort()).toEqual(['.env', 'README.md', 'src/index.ts', 'src/util.ts']);
  });

  it('有素材图时那张卡片也算有内容', () => {
    const model = collectViewModel(reading(), assets());
    const card = model.cards.find((item) => item.path === 'src/index.ts');
    expect(card).toBeDefined();
    expect(hasSomethingToShow(card as never, new Map([['assets/code/src_index.ts.svg', 'data:image/svg+xml;base64,AA==']]))).toBe(true);
  });
});
