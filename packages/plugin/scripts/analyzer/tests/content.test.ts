import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { classify } from '../classify.ts';
import { countLines, inspectFile } from '../content.ts';

const FIXTURE = resolve(import.meta.dirname, 'fixtures/sample');
const BIG = 5 * 1024 * 1024;

describe('内容读取与预览', () => {
  it('行数统计：末尾换行不多算一行', () => {
    expect(countLines('')).toBe(0);
    expect(countLines('a')).toBe(1);
    expect(countLines('a\n')).toBe(1);
    expect(countLines('a\nb')).toBe(2);
    expect(countLines('a\nb\n')).toBe(2);
  });

  it('Markdown：标题与首段', () => {
    const insight = inspectFile(`${FIXTURE}/README.md`, classify('README.md'), BIG);
    expect(insight.title).toBe('示例目录');
    expect(insight.preview).toContain('夹具目录');
    expect(insight.lines).toBeGreaterThan(5);
  });

  it('代码：首个块注释或前几行', () => {
    const insight = inspectFile(`${FIXTURE}/src/index.ts`, classify('index.ts'), BIG);
    expect(insight.preview).toBe('示例入口：把两个数相加');
    expect(insight.text).toContain('import');
  });

  it('JSON：顶层键', () => {
    const insight = inspectFile(`${FIXTURE}/package.json`, classify('package.json'), BIG);
    expect(insight.preview).toBe('{name, version, private}');
  });

  it('图片：读文件头拿尺寸（宽高不能写反）', () => {
    const insight = inspectFile(`${FIXTURE}/assets/logo.png`, classify('logo.png'), BIG);
    expect(insight.preview).toBe('3×2');
  });

  it('超过体积上限就不读内容，也不假装读到了', () => {
    const insight = inspectFile(`${FIXTURE}/src/index.ts`, classify('index.ts'), 10);
    expect(insight.skippedForSize).toBe(true);
    expect(insight.preview).toBeUndefined();
    expect(insight.lines).toBeUndefined();
    expect(insight.text).toBeUndefined();
  });

  it('office / pdf / video 的内容提取属于 M2，现在不猜', () => {
    for (const name of ['report.docx', 'paper.pdf', 'clip.mp4']) {
      const insight = inspectFile(`${FIXTURE}/${name}`, classify(name), BIG);
      expect(insight.preview, name).toBeUndefined();
      expect(insight.lines, name).toBeUndefined();
    }
  });
});
