/**
 * 样式层的断言：一套硬编码 token、CSS 变量、标签派生色。
 */
import { describe, expect, it } from 'vitest';
import { cssVariables, labelColor, TOKENS, tokensFor } from '../styles.ts';
import { styleByName, VISUAL_STYLE_NAMES } from '../../contracts/visual.ts';

describe('token', () => {
  it('CSS 变量覆盖组件用到的全部变量名', () => {
    const css = cssVariables(TOKENS);
    for (const name of [
      '--bg', '--ink', '--muted', '--line', '--accent', '--accent-ink', '--panel', '--code-bg',
      '--code-ink', '--track', '--font-title', '--font-display', '--font-body', '--font-mono',
      '--radius', '--shadow', '--space', '--rule-w',
    ]) {
      expect(css[name], name).toBeTruthy();
    }
  });

  it('讲稿写了小尺寸画布时，字号与安全边距按比例缩', () => {
    const tokens = tokensFor({ width: 960, height: 540 });
    expect(tokens.width).toBe(960);
    expect(tokens.titleSize).toBe(Math.round(TOKENS.titleSize / 2));
    expect(tokens.safeMargin).toBe(Math.round(TOKENS.safeMargin / 2));
  });

  it('没写 video 时原样返回', () => {
    expect(tokensFor(undefined)).toEqual(TOKENS);
  });

  it('每套视频预设使用对应页面色板与字体，编辑设计采用衬线标题', () => {
    for (const name of VISUAL_STYLE_NAMES) {
      const tokens = tokensFor(undefined, name);
      const vars = styleByName(name)!.vars;
      expect(tokens.bg).toBe(vars['--bg']);
      expect(tokens.ink).toBe(vars['--ink']);
      expect(tokens.accent).toBe(vars['--accent']);
      expect(tokens.fontTitle).toBe(vars['--font-display']);
      expect(tokens.fontBody).toBe(vars['--font-body']);
      expect(tokens.fontMono).toBe(vars['--font-mono']);
    }
    expect(tokensFor(undefined, '杂志').fontTitle).toContain('Songti');
    expect(tokensFor({ width: 960, height: 540 }, '夜幕').safeMargin).toBe(TOKENS.safeMargin / 2);
  });

  it('旧名称与设计名称生成相同的渲染参数', () => {
    for (const [legacy, canonical] of [['素稿', '瑞士风格'], ['杂志', '编辑设计风格'], ['夜幕', '科技风格']] as const) {
      expect(tokensFor(undefined, legacy)).toEqual(tokensFor(undefined, canonical));
      expect(styleByName(legacy)).toBe(styleByName(canonical));
    }
  });
});

describe('标签派生色', () => {
  it('同名标签永远同色，不同标签大多不同色', () => {
    expect(labelColor('Markdown 笔记', TOKENS)).toBe(labelColor('Markdown 笔记', TOKENS));
    expect(labelColor('Markdown 笔记', TOKENS)).not.toBe(labelColor('视频素材', TOKENS));
    expect(labelColor('a', TOKENS)).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('是合法的 hex 颜色（组件直接塞进 backgroundColor）', () => {
    for (const label of ['代码', '文档', '图片', 'x', '很长的标签名称一二三']) {
      expect(labelColor(label, TOKENS)).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
