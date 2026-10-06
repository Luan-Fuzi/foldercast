import { describe, expect, it } from 'vitest';
import { classify, extensionOf } from '../classify.ts';

describe('分类', () => {
  it('按扩展名给出 kind（只给 kind，不猜语言）', () => {
    expect(classify('a.ts')).toBe('code');
    expect(classify('a.py')).toBe('code');
    expect(classify('a.css')).toBe('code');
    expect(classify('a.html')).toBe('markup');
    expect(classify('a.md')).toBe('text');
    expect(classify('a.json')).toBe('data');
    expect(classify('a.xlsx')).toBe('office');
    expect(classify('a.pdf')).toBe('pdf');
    expect(classify('a.svg')).toBe('image');
    expect(classify('a.mp4')).toBe('video');
    expect(classify('a.mp3')).toBe('audio');
    expect(classify('a.zip')).toBe('archive');
    expect(classify('a.wasm')).toBe('binary');
  });

  it('大小写不敏感', () => {
    expect(classify('README.MD')).toBe(classify('readme.md'));
    expect(classify('A.TS')).toBe(classify('a.ts'));
  });

  it('不认识或没有扩展名 → other', () => {
    expect(classify('.gitkeep')).toBe('other');
    expect(classify('LICENSE')).toBe('text'); // 文件名表里有
    expect(classify('weird.zzz')).toBe('other');
  });

  it('文件名优先于扩展名', () => {
    // package.json 走文件名表，Makefile 没有扩展名也算代码
    expect(classify('package.json')).toBe('data');
    expect(classify('Makefile')).toBe('code');
    expect(classify('.gitignore')).toBe('text');
  });

  it('extensionOf 不把前导点当扩展名', () => {
    expect(extensionOf('.gitignore')).toBe('');
    expect(extensionOf('a.test.ts')).toBe('ts');
    expect(extensionOf('noext')).toBe('');
  });
});
