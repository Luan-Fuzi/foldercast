/**
 * 画面样式。**一套硬编码 token，没有预设、没有覆盖** —— 收缩时把四套预设 × 31 token
 * 的系统删掉了：没看到真实成片之前，暴露「可换风格」只是在给判断增加面。
 * 要改观感，改这里的常量。
 *
 * 组件里不出现颜色字面量，都走 token 与 CSS 变量 —— 所以改这一处就能换整套观感。
 */
import type { VideoSpec } from '../contracts/script.ts';

/** 渲染器真正用到的 token，扁平且封闭：多一个字段就要在组件里有用。 */
export type Tokens = {
  width: number;
  height: number;
  safeMargin: number;
  bg: string;
  ink: string;
  muted: string;
  line: string;
  accent: string;
  panel: string;
  codeBg: string;
  fontTitle: string;
  fontBody: string;
  fontMono: string;
  titleWeight: number;
  radius: number;
  shadow: 0 | 1 | 2;
  grain: number;
  titleSize: number;
  headingSize: number;
  bodySize: number;
  captionSize: number;
  density: 'compact' | 'normal' | 'airy';
  space: number;
  rule: 0 | 1 | 2;
  numbering: 'none' | 'decimal' | 'roman';
  header: 'none' | 'title' | 'chapter-progress';
  pace: number;
  enter: 'fade' | 'slide' | 'type' | 'none';
  easing: string;
  transition: 'cut' | 'fade' | 'wipe';
};

/** 唯一的一套 token（16:9 深色汇报风）。画布尺寸在 plan 里按讲稿的 `video` 改写。 */
export const TOKENS: Tokens = {
  width: 1920,
  height: 1080,
  safeMargin: 80,
  bg: '#0F1420',
  ink: '#F2F4F8',
  muted: '#8A93A6',
  line: '#2A3245',
  accent: '#4D9EFF',
  panel: '#182031',
  codeBg: '#0B0F18',
  fontTitle: '"PingFang SC", "Helvetica Neue", Helvetica, "Microsoft YaHei", sans-serif',
  fontBody: '"PingFang SC", "Helvetica Neue", Helvetica, "Microsoft YaHei", sans-serif',
  fontMono: '"SF Mono", Menlo, Consolas, monospace',
  titleWeight: 600,
  radius: 12,
  shadow: 1,
  grain: 0,
  titleSize: 92,
  headingSize: 44,
  bodySize: 30,
  captionSize: 40,
  density: 'normal',
  space: 1,
  rule: 0,
  numbering: 'none',
  header: 'title',
  pace: 1,
  enter: 'slide',
  easing: 'easeOutQuint',
  transition: 'fade',
};

/** 讲稿写了 `video` 尺寸时跟着改：安全边距按画布比例算。 */
export function tokensFor(video: VideoSpec | undefined): Tokens {
  const tokens = { ...TOKENS };
  if (video?.width !== undefined) tokens.width = video.width;
  if (video?.height !== undefined) tokens.height = video.height;
  if (video?.width !== undefined || video?.height !== undefined) {
    const scale = Math.min(tokens.width / TOKENS.width, tokens.height / TOKENS.height);
    tokens.safeMargin = Math.round(TOKENS.safeMargin * scale);
    tokens.titleSize = Math.round(TOKENS.titleSize * scale);
    tokens.headingSize = Math.round(TOKENS.headingSize * scale);
    tokens.bodySize = Math.round(TOKENS.bodySize * scale);
    tokens.captionSize = Math.round(TOKENS.captionSize * scale);
  }
  return tokens;
}

const SHADOW_CSS: Record<number, string> = {
  0: 'none',
  1: '0 18px 48px rgba(0, 0, 0, 0.35)',
  2: '0 24px 64px rgba(0, 0, 0, 0.6)',
};

const RULE_WIDTH: Record<number, number> = { 0: 0, 1: 1, 2: 3 };

/** token → CSS 变量表。组件只认这几个变量名。 */
export function cssVariables(tokens: Tokens): Record<string, string> {
  return {
    '--bg': tokens.bg,
    '--ink': tokens.ink,
    '--muted': tokens.muted,
    '--line': tokens.line,
    '--accent': tokens.accent,
    '--panel': tokens.panel,
    '--code-bg': tokens.codeBg,
    '--font-title': tokens.fontTitle,
    '--font-body': tokens.fontBody,
    '--font-mono': tokens.fontMono,
    '--radius': `${tokens.radius}px`,
    '--shadow': SHADOW_CSS[tokens.shadow] ?? 'none',
    '--space': String(tokens.space),
    '--rule-w': `${RULE_WIDTH[tokens.rule] ?? 0}px`,
  };
}

/* ---------------------------------------------------------------- 派生色 */

/** RGB 三元组，各分量 0–255。 */
export type Rgb = { r: number; g: number; b: number };

/** `#rgb` / `#rrggbb`。认不出返回 undefined。 */
export function parseHex(color: string): Rgb | undefined {
  const text = color.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(text);
  if (short !== null) {
    const [r, g, b] = [short[1], short[2], short[3]].map((part) => Number.parseInt(`${part ?? '0'}${part ?? '0'}`, 16));
    return { r: r ?? 0, g: g ?? 0, b: b ?? 0 };
  }
  const full = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(text);
  if (full === null) return undefined;
  return {
    r: Number.parseInt(full[1] ?? '0', 16),
    g: Number.parseInt(full[2] ?? '0', 16),
    b: Number.parseInt(full[3] ?? '0', 16),
  };
}

function toHex({ r, g, b }: Rgb): string {
  const part = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** 两色按比例混合，`amount` 是第二个颜色的占比（0–1）。认不出的颜色原样返回第一个。 */
export function mixColors(from: string, to: string, amount: number): string {
  const a = parseHex(from);
  const b = parseHex(to);
  if (a === undefined || b === undefined) return from;
  const ratio = Math.max(0, Math.min(1, amount));
  return toHex({
    r: a.r + (b.r - a.r) * ratio,
    g: a.g + (b.g - a.g) * ratio,
    b: a.b + (b.b - a.b) * ratio,
  });
}

/** 相对亮度（WCAG 的简化式，够判断「深底还是浅底」）。 */
export function luminance(color: string): number {
  const rgb = parseHex(color);
  if (rgb === undefined) return 0;
  const channel = (value: number): number => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

export function isLight(tokens: Tokens): boolean {
  return luminance(tokens.bg) > 0.5;
}

/** 色相旋转（保持明度与饱和度）。 */
function rotateHue({ r, g, b }: Rgb, degrees: number): Rgb {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const lightness = (max + min) / 2;
  const delta = max - min;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));

  let hue = 0;
  if (delta !== 0) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    if (max === rn) hue = ((gn - bn) / delta) % 6;
    else if (max === gn) hue = (bn - rn) / delta + 2;
    else hue = (rn - gn) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  const rotated = (hue + degrees + 360) % 360;

  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs(((rotated / 60) % 2) - 1));
  const m = lightness - c / 2;
  const sector = Math.floor(rotated / 60) % 6;
  const [r1, g1, b1] =
    sector === 0 ? [c, x, 0]
    : sector === 1 ? [x, c, 0]
    : sector === 2 ? [0, c, x]
    : sector === 3 ? [0, x, c]
    : sector === 4 ? [x, 0, c]
    : [c, 0, x];
  return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 };
}

/**
 * 一个标签的颜色：以强调色为基准，按标签文字的哈希偏一点色相 —— 同名标签永远同色，
 * 不同标签大多不同色，且整张图仍是一套颜色。深底提亮、浅底压暗，保证条形图有分量。
 */
export function labelColor(label: string, tokens: Tokens): string {
  let hash = 0;
  for (const char of label) hash = (hash * 31 + char.codePointAt(0)!) % 9973;
  const base = parseHex(tokens.accent) ?? { r: 77, g: 158, b: 255 };
  const shifted = toHex(rotateHue(base, (hash % 12) * 30));
  return isLight(tokens) ? mixColors(shifted, '#101010', 0.4) : mixColors(shifted, '#FFFFFF', 0.08);
}

/**
 * 字幕条与它的文字色。深底用「深色半透明面板 + 白字」，浅底反过来 ——
 * 白字压在浅色文档页上会看不见。
 */
export function captionColors(tokens: Tokens): { background: string; color: string; shadow: string } {
  return isLight(tokens)
    ? { background: 'rgba(20, 20, 20, 0.82)', color: '#FFFFFF', shadow: '0 10px 30px rgba(0, 0, 0, 0.18)' }
    : { background: 'rgba(0, 0, 0, 0.62)', color: '#FFFFFF', shadow: '0 10px 30px rgba(0, 0, 0, 0.35)' };
}
