/**
 * 渲染（`render.ts`）的断言：页面的三条硬约束在 HTML 字符串层面钉住 ——
 *
 * 1. 零 JavaScript、零外部资源（无 `<script>`、无 http(s) 引用、无内联事件属性）；
 * 2. 文本全部转义（讲稿是 agent 写的，什么字符都可能出现）；
 * 3. 页面自我交代边界（「本页由 script.json 生成」、引用清单、未内联说明）。
 *
 * 风格预设逐套渲染：变量集必须齐全（BASE_CSS 引用到的每一个都要有值），预设名单与
 * 缺省值钉死（整合阶段要拿这些名字收窄 config 枚举，漂了就是破坏性变更）。
 */
import { describe, expect, it } from 'vitest';
import type { ScriptDocument } from '../../contracts/script.ts';
import { collectViewModel } from '../collect.ts';
import type { PageImage } from '../embed.ts';
import { renderPage } from '../render.ts';
import { DEFAULT_STYLE_NAME, PAGE_STYLES, STYLE_NAMES, styleByName, samePaletteAsVideo } from '../styles.ts';
import { fullScript } from './fixture.ts';

/** BASE_CSS 引用到的全部变量。预设少了任何一个，页面就有属性回退到初始值。 */
const CSS_VARS = [
  '--bg',
  '--panel',
  '--ink',
  '--muted',
  '--line',
  '--accent',
  '--accent-ink',
  '--track',
  '--code-bg',
  '--code-ink',
  '--hero-bg',
  '--hero-ink',
  '--hero-muted',
  '--font-display',
  '--font-body',
  '--font-mono',
  '--radius',
  '--space',
  '--page-width',
] as const;

const IMAGES = new Map<string, PageImage>([
  // 内联：缩放产物是 JPEG，src 就是 data URI
  ['assets/architecture.png', { src: 'data:image/jpeg;base64,Zm9v', inlined: true, bytes: 48_000 }],
  // 超预算退回：相对路径（相对页面所在目录）
  ['assets/ui.png', { src: '../../assets/ui.png', inlined: false, reason: '单张 200 KB 超过预算 160 KB' }],
]);

function renderFixture(script: ScriptDocument = fullScript('/tmp/fixture'), styleName = DEFAULT_STYLE_NAME): string {
  const style = styleByName(styleName);
  if (style === undefined) throw new Error(`测试夹具里的风格名不对：${styleName}`);
  return renderPage({
    model: collectViewModel(script),
    style,
    images: IMAGES,
    notes: ['assets/ui.png：单张 200 KB 超过预算 160 KB，页面按相对路径引用（转发时要把源文件一起带上）。'],
    generatedAt: '2026-10-07T08:09:10.000Z',
    scriptRef: '.foldercast/script.json',
  });
}

describe('自包含（三条硬约束）', () => {
  const html = renderFixture();

  it('没有 <script> 标签，也没有内联事件属性', () => {
    expect(html).not.toMatch(/<script[\s>]/i);
    expect(html).not.toMatch(/\son[a-z]+\s*=\s*["']/i);
  });

  it('没有外部 http(s) 资源引用（src / href / CSS url / @import）', () => {
    expect(html).not.toMatch(/(?:src|href)\s*=\s*["']\s*(?:https?:)?\/\//i);
    expect(html).not.toMatch(/@import/i);
    expect(html).not.toMatch(/url\(\s*["']?\s*(?:https?:)?\/\//i);
  });

  it('图片要么是 data URI、要么是相对路径', () => {
    expect(html).toContain('src="data:image/jpeg;base64,Zm9v"');
    expect(html).toContain('src="../../assets/ui.png"');
  });

  it('页脚交代来源、引用清单与未内联原因', () => {
    expect(html).toContain('本页由讲稿');
    expect(html).toContain('.foldercast/script.json');
    expect(html).toContain('引用的文件（5）');
    expect(html).toContain('assets/ui.png：单张 200 KB 超过预算 160 KB');
    expect(html).toContain('无 JavaScript、无外部资源');
    expect(html).toContain('2026-10-07T08:09:10.000Z');
  });

  it('每类区块都在：hero、条形图、盘点、代码块、图集、卡片、小结、目录、论点、对比、流程', () => {
    expect(html).toContain('class="hero"');
    expect(html).toContain('class="bars"');
    expect(html).toContain('共 14 个');
    expect(html).toContain('<pre><code>export const main = () =&gt; {');
    expect(html).toContain('class="grid"');
    expect(html).toContain('翻第 2、4 页');
    expect(html).toContain('12–18.5 秒');
    expect(html).toContain('class="toc"');
    expect(html).toContain('class="concept-statement"');
    expect(html).toContain('class="compare-side"');
    expect(html).toContain('class="flow-step"');
  });

  it('concept 的要点只画一遍（区块内容与节拍要点共用同一个字段）', () => {
    const script = fullScript('/tmp/fixture');
    const concept = script.scenes.find((scene) => scene.id === 'principle');
    if (concept?.type !== 'concept') throw new Error('夹具缺 concept 场景');
    // 概念自己的要点 + 节拍追加的要点都得在，而且各出现一次
    const expected = [...(concept.points ?? []), ...(concept.beats ?? []).flatMap((beat) => beat.points ?? [])];
    expect(expected).toHaveLength(3);
    const page = renderFixture(script);
    for (const point of expected) expect(page.split(point)).toHaveLength(2);
  });

  it('narration 全部作为引文出现（字幕文本不丢）', () => {
    expect(html).toContain('这是示例目录的导览页夹具。');
    expect(html).toContain('就这些，谢谢观看。');
  });
});

describe('转义', () => {
  it('标题与旁白里的 HTML 控制字符全部转义（含字面的 </script>）', () => {
    const script = fullScript('/tmp/fixture');
    const cover = script.scenes[0];
    if (cover?.type !== 'cover') throw new Error('夹具第一个场景应是 cover');
    cover.title = '示例 <目录> & "夹具"';
    cover.narration = '旁白里写 </script> 与 <img src=x> 也不该被执行。';
    const html = renderFixture(script);
    expect(html).toContain('示例 &lt;目录&gt; &amp; &quot;夹具&quot;');
    expect(html).toContain('&lt;/script&gt;');
    expect(html).not.toMatch(/<script[\s>]/i);
    expect(html).not.toContain('<img src=x>');
  });
});

describe('折叠与目录', () => {
  it('短摘录默认展开（<details open>），长摘录默认折叠', () => {
    const script = fullScript('/tmp/fixture');
    const entry = script.scenes.find((scene) => scene.type === 'file');
    if (entry?.type !== 'file') throw new Error('缺 file 场景');
    const short = renderFixture(script);

    entry.excerpt = Array.from({ length: 20 }, (_, i) => `第 ${String(i + 1)} 行`);
    const long = renderFixture(script);

    expect(short).toContain('<details class="excerpt" open>');
    expect(long).toContain('<details class="excerpt">');
    expect(long).not.toContain('<details class="excerpt" open>');
  });

  it('区块少于 4 个时不出现目录', () => {
    const script: ScriptDocument = {
      foldercast: 2,
      source: { root: '/tmp/x' },
      scenes: [
        { id: 'cover', type: 'cover', title: 'x', narration: '开头。' },
        { id: 'outro', type: 'outro', title: '完', narration: '完。' },
      ],
    };
    const html = renderFixture(script);
    expect(html).not.toContain('class="toc"');
  });
});

describe('风格预设', () => {
  it('预设名单与缺省稳定（config 枚举要以它为准）', () => {
    expect(STYLE_NAMES).toEqual(['瑞士风格', '编辑设计风格', '科技风格']);
    expect(DEFAULT_STYLE_NAME).toBe('瑞士风格');
    expect(PAGE_STYLES['瑞士风格']).toBeDefined();
    expect(PAGE_STYLES['编辑设计风格']).toBeDefined();
    expect(PAGE_STYLES['科技风格']).toBeDefined();
  });

  it('每套预设都定义了 BASE_CSS 用到的全部变量', () => {
    for (const name of STYLE_NAMES) {
      const style = PAGE_STYLES[name];
      if (style === undefined) throw new Error(`预设 ${name} 不在注册表里`);
      for (const variable of CSS_VARS) {
        expect(style.vars[variable], `${name} 缺 ${variable}`).toBeDefined();
      }
    }
  });

  it('每套预设都渲染出完整页面（:root 带全套变量、区块齐全）', () => {
    for (const name of STYLE_NAMES) {
      const html = renderFixture(fullScript('/tmp/fixture'), name);
      expect(html.startsWith('<!doctype html>'), name).toBe(true);
      expect(html).toContain('<html lang="zh-CN">');
      for (const variable of CSS_VARS) {
        expect(html.includes(`${variable}:`), `${name} 没写出 ${variable}`).toBe(true);
      }
      // 编辑设计独有的补充规则真的进了页面（extraCss 不是摆设）
      if (name === '编辑设计风格') expect(html).toContain('text-align: center');
      if (name === '科技风格') expect(html).toContain('rgba(18, 25, 41, 0.55)');
    }
  });

  it('瑞士风格与渲染器成片保持同一套颜色（两边一起动）', () => {
    expect(samePaletteAsVideo()).toBe(true);
  });
});
