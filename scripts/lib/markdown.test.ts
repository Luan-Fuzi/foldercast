import { describe, expect, it } from 'vitest';
import { blankCode, extractLinks } from './markdown.ts';

describe('Markdown 链接抽取', () => {
  it('抽出普通链接与图片，保留行号', () => {
    const text = ['# 标题', '', '看 [指南](docs/guide.md) 和 ![图](assets/a.png)'].join('\n');
    expect(extractLinks(text)).toEqual([
      { line: 3, target: 'docs/guide.md' },
      { line: 3, target: 'assets/a.png' },
    ]);
  });

  it('行内代码里的方括号不是链接（回归）', () => {
    const text = '用 `[name](arg)` 表示调用，真链接是 [指南](docs/guide.md)。';
    expect(extractLinks(text).map((link) => link.target)).toEqual(['docs/guide.md']);
  });

  it('围栏代码块里的链接不算，且行号不错位', () => {
    const text = ['```md', '[假的](nope.md)', '```', '', '[真的](docs/guide.md)'].join('\n');
    expect(extractLinks(text)).toEqual([{ line: 5, target: 'docs/guide.md' }]);
  });

  it('目标里的一层括号不被截断（回归）', () => {
    const text = '[爬楼梯(一)](003_228_爬楼梯(一).md)';
    expect(extractLinks(text)).toEqual([{ line: 1, target: '003_228_爬楼梯(一).md' }]);
  });

  it('带标题与尖括号的写法', () => {
    const text = '[a](docs/a.md "标题") 与 [b](<docs/b c.md>)';
    expect(extractLinks(text).map((link) => link.target)).toEqual(['docs/a.md', 'docs/b c.md']);
  });

  it('blankCode 只抹代码，保留行数', () => {
    const text = 'a `x` b\n```\nc\n```\nd';
    const blanked = blankCode(text);
    expect(blanked.split('\n')).toHaveLength(5);
    expect(blanked.split('\n')[0]).toBe('a     b');
    expect(blanked.split('\n')[1]).toBe('');
    expect(blanked.split('\n')[2]).toBe('');
    expect(blanked.split('\n')[4]).toBe('d');
  });
});
