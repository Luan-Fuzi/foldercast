import { describe, expect, it } from 'vitest';
import { extractSpecifiers, resolveSpecifier } from '../imports.ts';

const noDisk = (): boolean => false;

describe('引用提取', () => {
  it('TypeScript 的 import / require / export from', () => {
    const text = [
      "import { a } from './util';",
      'import "side-effect";',
      "const b = require('../lib/b');",
      "const c = await import('./lazy');",
      "export { d } from './d';",
      "import fs from 'node:fs';",
    ].join('\n');
    const specifiers = extractSpecifiers({ path: 'src/index.ts', kind: 'code', language: 'TypeScript', text });
    expect(specifiers).toContain('./util');
    expect(specifiers).toContain('../lib/b');
    expect(specifiers).toContain('./lazy');
    expect(specifiers).toContain('./d');
    expect(specifiers).toContain('side-effect');
    expect(specifiers).toContain('node:fs');
  });

  it('Python 的 from / import，含相对导入', () => {
    const text = ['import os', 'from .util import add', 'from pkg.sub import thing'].join('\n');
    const specifiers = extractSpecifiers({ path: 'pkg/mod.py', kind: 'code', language: 'Python', text });
    expect(specifiers).toContain('os');
    expect(specifiers).toContain('.util');
    expect(specifiers).toContain('pkg.sub');
  });

  it('Markdown 的链接与图片', () => {
    const text = ['# 标题', '[指南](docs/guide.md)', '![图](assets/logo.png)', '[外链](https://example.com)'].join('\n');
    const specifiers = extractSpecifiers({ path: 'README.md', kind: 'text', language: 'Markdown', text });
    expect(specifiers).toEqual(['docs/guide.md', 'assets/logo.png', 'https://example.com']);
  });

  it('Markdown 链接目标里的括号不算截断（回归）', () => {
    const text = '3. [爬楼梯(一)](003_228_爬楼梯(一).md)\n16. [最长路径(一)](016_962_最长路径(一).md)';
    expect(extractSpecifiers({ path: 'index.md', kind: 'text', language: 'Markdown', text })).toEqual([
      '003_228_爬楼梯(一).md',
      '016_962_最长路径(一).md',
    ]);
  });

  it('Markdown 代码块与行内代码里的方括号不是链接（回归）', () => {
    const text = [
      '正文：[真链接](docs/guide.md)',
      '',
      '```python',
      'obs = TOOLS[name](arg)   # 代码里的调用不是链接',
      '```',
      '',
      '行内：`arr[index](value)` 也不是。',
    ].join('\n');
    expect(extractSpecifiers({ path: 'post.md', kind: 'text', language: 'Markdown', text })).toEqual(['docs/guide.md']);
  });

  it('HTML 的 src / href', () => {
    const text = '<img src="a.png"><a href="./b.html">x</a>';
    expect(extractSpecifiers({ path: 'index.html', kind: 'markup', language: 'HTML', text })).toEqual(['a.png', './b.html']);
  });

  it('数据文件只认明确的相对路径（裸文件名不算）', () => {
    const text = JSON.stringify({
      entry: './src/index.ts',
      name: '不是路径',
      file: 'math00_taylor.png', // 裸文件名：数据里太常见，不能当引用
      path: 'src/index.ts', // 根相对路径同理
      image: '../shared/logo.png',
    });
    const specifiers = extractSpecifiers({ path: 'config.json', kind: 'data', language: 'JSON', text });
    expect(specifiers).toEqual(['./src/index.ts', '../shared/logo.png']);
  });

  it('不识别其他类型（宁缺毋滥，避免假边）', () => {
    expect(extractSpecifiers({ path: 'a.png', kind: 'image', text: 'x' })).toEqual([]);
  });
});

describe('引用解析', () => {
  const analyzed = new Set(['src/util.ts', 'src/nested/index.ts', 'pkg/__init__.py', 'docs/guide.md']);

  it('相对路径直接命中', () => {
    expect(resolveSpecifier('src/index.ts', './util.ts', analyzed, noDisk)).toEqual({ target: 'src/util.ts' });
  });

  it('补全扩展名与 index', () => {
    expect(resolveSpecifier('src/index.ts', './util', analyzed, noDisk)).toEqual({ target: 'src/util.ts' });
    expect(resolveSpecifier('src/index.ts', './nested', analyzed, noDisk)).toEqual({ target: 'src/nested/index.ts' });
  });

  it('上一级目录', () => {
    expect(resolveSpecifier('src/nested/index.ts', '../util.ts', analyzed, noDisk)).toEqual({ target: 'src/util.ts' });
  });

  it('Python 相对导入与包', () => {
    const paths = new Set([...analyzed, 'pkg/util.py', 'pkg/sub/thing.py']);
    expect(resolveSpecifier('pkg/mod.py', '.', paths, noDisk)).toEqual({ target: 'pkg/__init__.py' });
    expect(resolveSpecifier('pkg/mod.py', '.util', paths, noDisk)).toEqual({ target: 'pkg/util.py' });
    expect(resolveSpecifier('pkg/mod.py', 'pkg.sub.thing', paths, noDisk)).toEqual({ target: 'pkg/sub/thing.py' });
    // 第三方包解析不到，也不是坏引用
    expect(resolveSpecifier('pkg/mod.py', 'os', paths, noDisk)).toEqual({});
  });

  it('去掉锚点与查询串，忽略外链', () => {
    expect(resolveSpecifier('docs/x.md', './guide.md#section', analyzed, noDisk)).toEqual({ target: 'docs/guide.md' });
    expect(resolveSpecifier('README.md', 'https://example.com/x.md', analyzed, noDisk)).toEqual({});
    expect(resolveSpecifier('docs/x.md', '../docs/guide.md?raw', analyzed, noDisk)).toEqual({ target: 'docs/guide.md' });
  });

  it('裸模块名不是文件', () => {
    expect(resolveSpecifier('src/index.ts', 'react', analyzed, noDisk)).toEqual({});
    expect(resolveSpecifier('src/index.ts', 'node:fs', analyzed, noDisk)).toEqual({});
  });

  it('根目录之内且不存在 → 坏引用（文档里的裸相对路径也算相对）', () => {
    expect(
      resolveSpecifier('README.md', 'docs/missing.md', analyzed, noDisk, { assumeRelative: true }),
    ).toEqual({ dangling: 'docs/missing.md' });
    // 代码里的裸标识符是模块名，不是坏引用
    expect(resolveSpecifier('src/index.ts', 'react', analyzed, noDisk)).toEqual({});
  });

  it('跨出根目录的引用不算坏引用', () => {
    expect(resolveSpecifier('README.md', '../outside.md', analyzed, noDisk)).toEqual({});
    expect(resolveSpecifier('README.md', '../../etc/hosts', analyzed, noDisk)).toEqual({});
  });

  it('文件存在但被排除规则挡掉时不算坏引用', () => {
    const onDisk = (path: string): boolean => path === 'vendor/lib.js';
    expect(resolveSpecifier('src/index.ts', '../vendor/lib.js', analyzed, onDisk)).toEqual({});
  });
});
