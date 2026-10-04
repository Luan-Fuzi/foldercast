import { describe, expect, it } from 'vitest';
import { renderCodeImage } from '../code.ts';

const TS_SNIPPET = [
  "import { readFileSync } from 'node:fs';",
  '',
  '/** 计算斐波那契数列。 */',
  'export function fib(n: number): number {',
  '  return n < 2 ? n : fib(n - 1) + fib(n - 2);',
  '}',
  '',
  "const name = 'foldercast';",
  'console.log(`hello ${name}`, fib(10));',
  '',
].join('\n');

/** 只认颜色字面量：外链 CSS 的 `fill` 不会长这样，能真正证明颜色是写进属性的。 */
function fillsOf(svg: string): string[] {
  return [...svg.matchAll(/fill="(#[0-9a-fA-F]{3,8})"/g)].map((match) => match[1] ?? '');
}

describe('renderCodeImage', () => {
  it('TypeScript：代码文本进 SVG，且用了多个不同颜色', async () => {
    const image = await renderCodeImage({ code: TS_SNIPPET, language: 'TypeScript' });

    expect(image.language).toBe('typescript');
    expect(image.truncated).toBe(false);
    // 末尾换行不算多一行（与 analyzer 的 countLines 同一条约定）。
    expect(image.lines).toBe(9);
    expect(image.svg).toContain('fib');
    expect(image.svg).toContain('readFileSync');
    // `n < 2` 里的 < 必须转义，否则 SVG 直接解析失败。
    expect(image.svg).toContain('&lt;');

    const fills = new Set(fillsOf(image.svg));
    expect(fills.size).toBeGreaterThan(2);
  });

  it('未识别语言：不抛错，按纯文本渲染并报 text', async () => {
    const image = await renderCodeImage({
      code: '++++++++[>++++++++<-]>.\n',
      language: 'Brainfuck',
    });

    expect(image.language).toBe('text');
    expect(image.lines).toBe(1);
    expect(image.svg).toContain('++++++++[&gt;++++++++&lt;-]&gt;.');
    // 纯文本只有背景一个颜色，不该出现高亮色。
    expect(new Set(fillsOf(image.svg)).size).toBe(1);
  });

  it('确定性：同一输入两次调用逐字节相同', async () => {
    const first = await renderCodeImage({ code: TS_SNIPPET, language: 'TypeScript' });
    const second = await renderCodeImage({ code: TS_SNIPPET, language: 'TypeScript' });

    expect(second.svg).toBe(first.svg);
    expect(second).toEqual(first);
    // 尺寸也不能带小数：视频合成按整数像素摆放。
    expect(first.svg).toMatch(/width="\d+"/);
    expect(first.svg).toMatch(/height="\d+"/);
  });

  it('转义：`<`、`&`、引号与制表符都不原样出现', async () => {
    const image = await renderCodeImage({
      code: '\tconst html = \'<div class="x">A & B\';\n',
      language: 'TypeScript',
    });

    expect(image.svg).not.toContain('<div');
    expect(image.svg).toContain('&lt;div');
    expect(image.svg).toContain('&amp;');
    expect(image.svg).toContain('&quot;');
    expect(image.svg).toContain('&apos;');
    // 制表符换成 4 个空格后再进 SVG（shiki 把缩进单独切成一个 token）。
    expect(image.svg).toContain('<tspan>    </tspan>');
    expect(image.svg).not.toContain('\t');
  });

  it('截断：100 行 + maxLines 10 只画 10 行，末尾给灰色提示', async () => {
    const code = Array.from({ length: 100 }, (_, index) => `const v${index} = ${index};`).join('\n');
    const image = await renderCodeImage({ code, language: 'TypeScript', maxLines: 10 });

    expect(image.truncated).toBe(true);
    expect(image.lines).toBe(10);
    expect(image.svg).toContain('还有');
    expect(image.svg).toContain('90 行');
    // 第 11 行（v10）不渲染，只有 v0…v9 在。
    expect(image.svg).not.toContain('v10');
    expect(image.svg).toContain('v9');
    expect(image.svg).toContain(`fill="#57606a"`);
  });

  it('默认上限 60 行', async () => {
    const code = Array.from({ length: 80 }, (_, index) => `line${index}`).join('\n');
    const image = await renderCodeImage({ code, language: 'text' });

    expect(image.lines).toBe(60);
    expect(image.truncated).toBe(true);
    expect(image.svg).toContain('20 行');
  });

  it('自包含：没有脚本、样式表、外链资源', async () => {
    const image = await renderCodeImage({ code: TS_SNIPPET, language: 'TypeScript' });

    expect(image.svg).not.toContain('<script');
    expect(image.svg).not.toContain('<style');
    expect(image.svg).not.toContain('@import');
    expect(image.svg).not.toContain('<image');
    // 唯一的 http 是 SVG 命名空间标识（XML 要求，不会发起请求），不是外链。
    const urls = [...image.svg.matchAll(/https?:\/\/[^"')\s]+/g)].map((match) => match[0]);
    expect(urls).toEqual(['http://www.w3.org/2000/svg']);
    expect(image.svg).not.toMatch(/(?:href|src)="https?:/);
    expect(image.svg).not.toContain('url(http');
  });

  it('主题：背景取主题的 editor.background', async () => {
    const light = await renderCodeImage({ code: 'const a = 1;\n', language: 'TypeScript' });
    const dark = await renderCodeImage({
      code: 'const a = 1;\n',
      language: 'TypeScript',
      theme: 'github-dark',
    });

    expect(light.svg).toContain('<rect width="157" height="45" fill="#fff"/>');
    expect(dark.svg).toContain('<rect width="157" height="45" fill="#24292e"/>');
    expect(dark.svg).not.toBe(light.svg);
  });

  it('缩进：行元素带 xml:space="preserve"，缩进空格原样保留', async () => {
    const image = await renderCodeImage({
      code: 'if (a) {\n  return 1;\n}\n',
      language: 'TypeScript',
    });

    // 属性写在 <text> 上（写在 <svg> 根上 Blink 不认），否则缩进会被折掉。
    expect(image.svg).toContain('<text x="28" y="27" xml:space="preserve">');
    expect(image.svg).toContain('<tspan>  </tspan>');
  });

  it('中文注释：宽字符按两列算，画布才不会被裁', async () => {
    const code = 'const n = 1;\n// 这是一段比较长的中文注释\n';
    const image = await renderCodeImage({ code, language: 'TypeScript' });
    const width = Number(/width="(\d+)"/.exec(image.svg)?.[1]);

    // 整行按 ASCII 一列算只有 16 列（56 + 16 * 8.4 = 190.4），中文注释实际要宽得多。
    expect(width).toBeGreaterThan(56 + 16 * 8.4);
  });

  it('展示名映射：C++ 走 cpp、Python 走 python', async () => {
    const cpp = await renderCodeImage({ code: 'int main() { return 0; }\n', language: 'C++' });
    const python = await renderCodeImage({ code: 'def f(x):\n  return x\n', language: 'Python' });

    expect(cpp.language).toBe('cpp');
    expect(python.language).toBe('python');
    expect(python.lines).toBe(2);
    expect(new Set(fillsOf(python.svg)).size).toBeGreaterThan(1);
  });

  it('CRLF 与空文件：\r 不留进 SVG，空文件仍产出合法 SVG', async () => {
    const crlf = await renderCodeImage({ code: 'const a = 1;\r\nconst b = 2;\r\n', language: 'TypeScript' });
    const empty = await renderCodeImage({ code: '', language: 'TypeScript' });

    expect(crlf.lines).toBe(2);
    expect(crlf.svg).not.toContain('\r');
    expect(empty.lines).toBe(0);
    expect(empty.truncated).toBe(false);
    expect(empty.svg.startsWith('<svg ')).toBe(true);
    expect(empty.svg.trimEnd().endsWith('</svg>')).toBe(true);
  });
});
