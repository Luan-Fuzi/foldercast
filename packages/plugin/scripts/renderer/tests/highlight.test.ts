/**
 * 摘录画面预算的单元测试（0005 WP1）：纯 Node 侧，不起浏览器。
 *
 * 判据：代码走 shiki 高亮且**不带内联底色**（白条问题的根）；Markdown 走
 * marked 渲染出 HTML 标签而不是源码；同一输入产出同一 HTML（逐帧一致的素材层前提）。
 */
import { describe, expect, it } from 'vitest';
import { isMarkdownFile, type ScriptDocument } from '../../contracts/script.ts';
import { highlightExcerpts } from '../highlight.ts';

const script = (scenes: ScriptDocument['scenes']): ScriptDocument => ({
  foldercast: 2,
  source: { root: '/tmp/foldercast-highlight-fixture' },
  scenes,
});

describe('isMarkdownFile', () => {
  it('md 系扩展名认出来（大小写不敏感），其他不认', () => {
    expect(isMarkdownFile('README.md')).toBe(true);
    expect(isMarkdownFile('notes.MD')).toBe(true);
    expect(isMarkdownFile('a.markdown')).toBe(true);
    expect(isMarkdownFile('docs/b.mdx')).toBe(true);
    expect(isMarkdownFile('src/index.ts')).toBe(false);
    expect(isMarkdownFile('noext')).toBe(false);
  });
});

describe('highlightExcerpts', () => {
  it('代码高亮随深浅底切换主题，两个主题都保留透明面板底色', async () => {
    const input = script([{ id: 'code', type: 'file', file: 'sample.ts',
      excerpt: ['export const title = "风格";'], narration: '说明。' }]);
    const light = (await highlightExcerpts(input)).code ?? '';
    const dark = (await highlightExcerpts(input, true)).code ?? '';
    expect(light).toContain('github-light');
    expect(dark).toContain('github-dark');
    expect(dark).not.toEqual(light);
    expect(dark).not.toContain('background-color');
  });

  it('代码摘录：shiki 高亮，剥掉内联底色（底色由面板呈现）', async () => {
    const out = await highlightExcerpts(
      script([{ id: 'code', type: 'file', file: 'src/index.ts', excerpt: ['export const value = 1;', 'export const other = 2;'], narration: 'x' }]),
    );
    const html = out['code'] ?? '';
    expect(html).toContain('class="shiki');
    expect(html).not.toContain('background-color');
    expect(html).toMatch(/color:#/); // token 颜色还在
  });

  it('Markdown 摘录：渲染成 HTML 标签，粗体不再显示星号', async () => {
    const out = await highlightExcerpts(
      script([{ id: 'md', type: 'file', file: 'README.md', excerpt: ['这一条是**重点**，还有 `code`。'], narration: 'x' }]),
    );
    const html = out['md'] ?? '';
    expect(html).toContain('<div class="fc-md">');
    expect(html).toContain('<strong>重点</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).not.toContain('**');
  });

  it('同输入同输出（逐帧一致的素材层前提）', async () => {
    const scenes: ScriptDocument['scenes'] = [{ id: 'md', type: 'file', file: 'README.md', excerpt: ['- 一', '- 二'], narration: 'x' }];
    const first = await highlightExcerpts(script(scenes));
    const second = await highlightExcerpts(script(scenes));
    expect(first['md']).toBe(second['md']);
  });

  it('非 file 场景与空摘录跳过', async () => {
    const out = await highlightExcerpts(
      script([
        { id: 'c', type: 'cover', title: '封面', narration: 'x' },
        { id: 'empty', type: 'file', file: 'src/index.ts', excerpt: [], narration: 'x' },
      ]),
    );
    expect(out).toEqual({});
  });

  it('Markdown 的原始 HTML 只作文本，链接与图片不注入执行或网络资源', async () => {
    const out = await highlightExcerpts(script([{ id: 'md', type: 'file', file: 'README.md', narration: '说明。',
      excerpt: ['<script>alert(1)</script>', '<img src="https://example.com/image" onerror="alert(1)">',
        '', '[说明](javascript:alert(1))', '![图片](https://example.com/image.png)'] }]));
    expect(out.md).toContain('&lt;script&gt;');
    expect(out.md).not.toMatch(/<(?:script|img|a)\b/);
    expect(out.md).toContain('说明');
  });
});
