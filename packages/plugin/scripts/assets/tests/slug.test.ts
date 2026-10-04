import { describe, expect, it } from 'vitest';
import { slugify, uniqueSlug, withoutExtension } from '../slug.ts';

describe('产物 slug', () => {
  it('保留层级信息，把目录分隔符变成下划线', () => {
    expect(slugify('docs/specs/SPEC-pipeline.md')).toBe('docs_specs_SPEC-pipeline.md');
    expect(slugify('README.md')).toBe('README.md');
  });

  it('中文文件名完整保留（只把分隔符换成下划线）', () => {
    expect(slugify('面试准备/自我介绍.md')).toBe('面试准备_自我介绍.md');
    expect(slugify('docs/2026年规划.md')).toBe('docs_2026年规划.md');
  });

  it('空格等不安全字符换成短横', () => {
    expect(slugify('a b/c d.txt')).toBe('a-b_c-d.txt');
    expect(slugify('report (final).docx')).toBe('report-final-.docx');
  });

  it('不可用字符组成的文件名有兜底', () => {
    expect(slugify('###')).toBe('file');
  });

  it('同一份解读重复跑，slug 必须一致（讲稿里写下的路径要长期有效）', () => {
    const first = uniqueSlug('src/index.ts', new Set());
    const second = uniqueSlug('src/index.ts', new Set());
    expect(first).toBe(second);
  });

  it('slug 冲突时加确定性后缀，避免两个源文件互相覆盖', () => {
    const taken = new Set<string>();
    const a = uniqueSlug('a/b.md', taken);
    const b = uniqueSlug('a_b.md', taken);
    expect(a).toBe('a_b.md');
    expect(b).not.toBe(a);
    expect(b.startsWith('a_b.md-')).toBe(true);
  });

  it('withoutExtension 不把前导点当扩展名', () => {
    expect(withoutExtension('report.docx')).toBe('report');
    expect(withoutExtension('.env')).toBe('.env');
    expect(withoutExtension('noext')).toBe('noext');
  });
});
