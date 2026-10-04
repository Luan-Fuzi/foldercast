import { describe, expect, it } from 'vitest';
import { classify, extensionOf } from '../classify.ts';

describe('分类', () => {
  it('按扩展名给出 kind 与语言', () => {
    expect(classify('a.ts')).toEqual({ kind: 'code', language: 'TypeScript' });
    expect(classify('a.py')).toEqual({ kind: 'code', language: 'Python' });
    expect(classify('a.css')).toEqual({ kind: 'code', language: 'CSS' });
    expect(classify('a.html')).toEqual({ kind: 'markup', language: 'HTML' });
    expect(classify('a.md')).toEqual({ kind: 'text', language: 'Markdown' });
    expect(classify('a.json')).toEqual({ kind: 'data', language: 'JSON' });
    expect(classify('a.xlsx')).toEqual({ kind: 'office', language: 'Excel' });
    expect(classify('a.pdf')).toEqual({ kind: 'pdf' });
    expect(classify('a.svg')).toEqual({ kind: 'image' });
    expect(classify('a.mp4')).toEqual({ kind: 'video' });
    expect(classify('a.mp3')).toEqual({ kind: 'audio' });
    expect(classify('a.zip')).toEqual({ kind: 'archive' });
    expect(classify('a.wasm')).toEqual({ kind: 'binary' });
  });

  it('大小写不敏感', () => {
    expect(classify('README.MD')).toEqual(classify('readme.md'));
    expect(classify('A.TS')).toEqual(classify('a.ts'));
  });

  it('不认识或没有扩展名 → other', () => {
    expect(classify('.gitkeep')).toEqual({ kind: 'other' });
    expect(classify('LICENSE')).toEqual({ kind: 'text' }); // 文件名表里有
    expect(classify('weird.zzz')).toEqual({ kind: 'other' });
  });

  it('文件名优先于扩展名', () => {
    // package.json 走文件名表（语言标成 JSON），Makefile 没有扩展名也算代码
    expect(classify('package.json').kind).toBe('data');
    expect(classify('Makefile')).toEqual({ kind: 'code', language: 'Makefile' });
    expect(classify('.gitignore')).toEqual({ kind: 'text' });
  });

  it('extensionOf 不把前导点当扩展名', () => {
    expect(extensionOf('.gitignore')).toBe('');
    expect(extensionOf('a.test.ts')).toBe('ts');
    expect(extensionOf('noext')).toBe('');
  });
});
