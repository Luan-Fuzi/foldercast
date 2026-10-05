/**
 * 样式 token 与派生色。
 *
 * 这一层原来只在 `deck`（深色）下看过，换 `swiss` / `paper`（浅色）之后分类条与字幕
 * 几乎看不见 —— 所以判据是「**四套预设下都要能读**」：
 *
 * 1. 预设 JSON 的 token 白名单只认它该认得字段，缺字段取兜底值（不能画成 `undefined`）；
 * 2. `style.overrides` 走点号路径，认不出的键要报出来而不是静默丢弃；
 * 3. 派生色跟着底色走：浅底压暗、深底提亮，字幕条两种底上都是「深底白字」对比。
 */
import { describe, expect, it } from 'vitest';
import {
  applyOverrides,
  captionColors,
  cssVariables,
  FALLBACK_TOKENS,
  isLight,
  kindColor,
  luminance,
  mixColors,
  parseHex,
  tokensFromPreset,
} from '../styles.ts';

const DECK = {
  name: 'deck',
  canvas: { aspect: '16:9', width: 1920, height: 1080, safeMargin: 80 },
  palette: { bg: '#0F1420', ink: '#F2F4F8', muted: '#8A93A6', accent: '#4D9EFF', panel: '#182031' },
  typography: { title: 'A', body: 'B', mono: 'C', titleWeight: 600 },
  texture: { shadow: 'soft', radius: 12, grain: 0 },
};

const PAPER = {
  name: 'paper',
  canvas: { width: 1920, height: 1080, safeMargin: 96 },
  palette: { bg: '#FBF8F1', ink: '#1B1A17', muted: '#6B6459', accent: '#A8442A', panel: '#F3EDE2' },
  typography: { title: 'X', body: 'Y', mono: 'Z', titleWeight: 500 },
  texture: { shadow: 'none', radius: 4, grain: 0 },
};

describe('预设 → token', () => {
  it('读出白名单字段，丢掉渲染器不用的段', () => {
    const tokens = tokensFromPreset(DECK);
    expect(tokens.bg).toBe('#0F1420');
    expect(tokens.accent).toBe('#4D9EFF');
    expect(tokens.width).toBe(1920);
    expect(tokens.radius).toBe(12);
    expect(tokens.shadow).toBe(1);
    expect(Object.keys(tokens)).not.toContain('narration');
  });

  it('缺字段取兜底值，不画成 undefined', () => {
    const tokens = tokensFromPreset({});
    expect(tokens.bg).toBe(FALLBACK_TOKENS.bg);
    expect(tokens.captionSize).toBeGreaterThan(0);
  });

  it('没有预设时整套兜底', () => {
    expect(tokensFromPreset(undefined)).toEqual(FALLBACK_TOKENS);
    expect(tokensFromPreset(null)).toEqual(FALLBACK_TOKENS);
  });

  it('节奏影响字号：慢节奏更大', () => {
    const fast = tokensFromPreset({ ...DECK, typography: { ...DECK.typography, pace: 'fast' } });
    const slow = tokensFromPreset({ ...DECK, typography: { ...DECK.typography, pace: 'slow' } });
    expect(slow.titleSize).toBeGreaterThan(fast.titleSize);
  });
});

describe('overrides', () => {
  it('点号路径覆盖预设里的键', () => {
    const { preset, ignored } = applyOverrides(DECK, { 'palette.bg': '#000000', 'texture.radius': 2 });
    expect(ignored).toEqual([]);
    const tokens = tokensFromPreset(preset);
    expect(tokens.bg).toBe('#000000');
    expect(tokens.radius).toBe(2);
  });

  it('认不出的键报出来，不静默丢弃', () => {
    expect(applyOverrides(DECK, { 'nosuch.key': 1, palette: 2 } as never).ignored).toEqual(['nosuch.key', 'palette']);
  });

  it('没有 overrides 时原样返回', () => {
    expect(applyOverrides(DECK, undefined).preset).toEqual(DECK);
  });
});

describe('派生色跟着底色走', () => {
  it('认得出深底与浅底', () => {
    expect(isLight(tokensFromPreset(PAPER))).toBe(true);
    expect(isLight(tokensFromPreset(DECK))).toBe(false);
  });

  it('浅底上的分类色比深底上的暗 —— 否则在浅色页面上看不见', () => {
    const dark = kindColor('code', tokensFromPreset(DECK));
    const light = kindColor('office', tokensFromPreset(PAPER));
    expect(luminance(light)).toBeLessThan(luminance(dark));
    expect(parseHex(light)).toBeDefined();
  });

  it('不同分类给不同颜色，而不是同一个', () => {
    const tokens = tokensFromPreset(DECK);
    const colors = new Set(['code', 'text', 'office', 'pdf', 'data'].map((kind) => kindColor(kind, tokens)));
    expect(colors.size).toBe(5);
  });

  it('字幕条在两种底上都是深底白字（浅色文档页上白字会消失）', () => {
    for (const preset of [DECK, PAPER]) {
      const colors = captionColors(tokensFromPreset(preset));
      expect(colors.color).toBe('#FFFFFF');
      expect(colors.background).toContain('rgba');
    }
  });

  it('颜色工具本身可靠', () => {
    expect(parseHex('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex('red')).toBeUndefined();
    expect(mixColors('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixColors('#000000', '#ffffff', 2)).toBe('#ffffff');
    expect(luminance('#ffffff')).toBeCloseTo(1, 3);
    expect(luminance('#000000')).toBe(0);
  });
});

describe('CSS 变量', () => {
  it('组件只认这些变量名', () => {
    const css = cssVariables(tokensFromPreset(DECK));
    expect(Object.keys(css).sort()).toEqual(
      ['--accent', '--bg', '--code-bg', '--font-body', '--font-mono', '--font-title', '--ink', '--line', '--muted', '--panel', '--radius', '--shadow'].sort(),
    );
    expect(css['--radius']).toBe('12px');
  });
});
