/**
 * 样式 token 的解析与应用层。`styles/*.json` 是数据（四套预设），这里把预设 + 讲稿里的
 * `style.overrides` 合成渲染器直接可用的 token。
 *
 * **第一版只用一套硬编码预设**（`deck`，16:9 深色）—— 风格预设的暴露押后到看到真实成片
 * 之后（见 ROADMAP 押后表）。但 token 层现在就位，理由有两条：
 *
 * 1. 组件里不出现颜色字面量，改风格只改 JSON；
 * 2. `style.overrides` 的语义（点号路径覆盖任意 token）在 M7 就能验证。
 *
 * 预设里的 `narration` 段是给写稿阶段的语气提示（M5），渲染器**不读**它 —— 那是叙事层的
 * 输入，不是画面 token。显式丢掉，避免「两个阶段读同一份配置的不同部分」这种隐性耦合。
 */
import type { StyleSpec } from '../contracts/foldercast.ts';

/** 渲染器真正用到的 token，**扁平且封闭**：多一个字段就要在组件里有用。 */
export type Tokens = {
  preset: string;
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
  /** 面板圆角（像素）。 */
  radius: number;
  /** 面板阴影的强度：0 无、1 柔和、2 明显。 */
  shadow: number;
  /** 背景颗粒强度：0 无。 */
  grain: number;
  /** 主标题字号（像素，按 1920×1080 画布）。 */
  titleSize: number;
  /** 场景内小标题字号。 */
  headingSize: number;
  /** 正文字号。 */
  bodySize: number;
  /** 字幕字号。 */
  captionSize: number;
};

/** 预设 JSON 的形状（只声明用到的部分）。 */
export type PresetJson = {
  name?: string;
  canvas?: { width?: unknown; height?: unknown; safeMargin?: unknown };
  palette?: Record<string, unknown>;
  typography?: Record<string, unknown>;
  layout?: Record<string, unknown>;
  motion?: Record<string, unknown>;
  texture?: Record<string, unknown>;
};

/** 兜底预设：`styles/deck.json` 读不到时也必须能渲染。 */
export const FALLBACK_TOKENS: Tokens = {
  preset: 'deck',
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
};

/** `motion.pace` → 字号缩放。慢节奏（纸质风）字号大一些，快节奏（终端风）小一些。 */
const PACE_SCALE: Record<string, number> = { slow: 1.12, normal: 1, fast: 0.94 };

/** `texture.shadow` → 强度。 */
const SHADOW_LEVEL: Record<string, number> = { none: 0, soft: 1, hard: 2 };

const SHADOW_CSS: Record<number, string> = {
  0: 'none',
  1: '0 18px 48px rgba(0, 0, 0, 0.35)',
  2: '0 24px 64px rgba(0, 0, 0, 0.6)',
};

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' && value !== '' ? value : fallback;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * 把预设 JSON 变成 token。**只读白名单字段**：预设里没有的键一律取兜底值，
 * 这样新增预设不必同步改渲染器，拼错的键也不会静默变成 `undefined` 画到屏幕上。
 */
export function tokensFromPreset(preset: PresetJson | null | undefined): Tokens {
  const base = { ...FALLBACK_TOKENS };
  if (preset === null || preset === undefined) return base;

  const palette = preset.palette ?? {};
  const typography = preset.typography ?? {};
  const texture = preset.texture ?? {};
  const canvas = preset.canvas ?? {};
  const pace = str(typography['pace'], 'normal');
  const scale = PACE_SCALE[pace] ?? 1;
  const shadowName = str(texture['shadow'], 'soft');

  return {
    preset: str(preset.name, base.preset),
    width: num(canvas.width, base.width),
    height: num(canvas.height, base.height),
    safeMargin: num(canvas.safeMargin, base.safeMargin),
    bg: str(palette['bg'], base.bg),
    ink: str(palette['ink'], base.ink),
    muted: str(palette['muted'], base.muted),
    line: str(palette['line'], base.line),
    accent: str(palette['accent'], base.accent),
    panel: str(palette['panel'], base.panel),
    codeBg: str(palette['codeBg'], base.codeBg),
    fontTitle: str(typography['title'], base.fontTitle),
    fontBody: str(typography['body'], base.fontBody),
    fontMono: str(typography['mono'], base.fontMono),
    titleWeight: num(typography['titleWeight'], base.titleWeight),
    radius: num(texture['radius'], base.radius),
    shadow: SHADOW_LEVEL[shadowName] ?? base.shadow,
    grain: num(texture['grain'], base.grain),
    titleSize: Math.round(base.titleSize * scale),
    headingSize: Math.round(base.headingSize * scale),
    bodySize: Math.round(base.bodySize * scale),
    captionSize: Math.round(base.captionSize * scale),
  };
}

/**
 * 应用 `style.overrides`。键是点号路径（`palette.bg`、`typography.title`…），与
 * `styles/*.json` 的结构一致 —— 讲稿的 overrides 覆盖的是**预设文件里的键**，不是 token 字段，
 * 所以这里先把二者合并再转 token。
 *
 * 返回认不出的键：不静默丢弃，交给调用方报出来（与 `style.unresolved` 同一态度）。
 */
export function applyOverrides(
  preset: PresetJson,
  overrides: StyleSpec['overrides'] | undefined,
): { preset: PresetJson; ignored: string[] } {
  if (overrides === undefined) return { preset, ignored: [] };

  const merged = structuredClone(preset) as Record<string, unknown>;
  const ignored: string[] = [];

  for (const [path, value] of Object.entries(overrides)) {
    const parts = path.split('.');
    const section = parts[0];
    const key = parts[1];
    if (parts.length !== 2 || section === undefined || key === undefined) {
      ignored.push(path);
      continue;
    }
    const target = merged[section];
    if (target === undefined || typeof target !== 'object' || target === null) {
      ignored.push(path);
      continue;
    }
    (target as Record<string, unknown>)[key] = value;
  }

  return { preset: merged as PresetJson, ignored };
}

/** token → CSS 变量表。组件只认这几个变量名，换预设不必改组件。 */
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
    '--shadow': SHADOW_CSS[tokens.shadow] ?? SHADOW_CSS[1] ?? 'none',
  };
}

/* ------------------------------------------------------------ 派生色 */

/** RGB 三元组，各分量 0–255。 */
export type Rgb = { r: number; g: number; b: number };

/** `#rgb` / `#rrggbb`。认不出返回 undefined（预设里写了变量名或颜色函数时不猜）。 */
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

/**
 * 这套预设是浅底还是深底。
 *
 * **所有派生色都以此为准**：同一份组件要在四套预设下都能读。深底上「亮一点」才醒目，
 * 浅底上必须「暗一点」 —— 早期版本把颜色写死在组件里，换 `swiss` / `paper` 之后
 * 分类条与文字几乎看不见。
 */
export function isLight(tokens: Tokens): boolean {
  return luminance(tokens.bg) > 0.5;
}

/**
 * 内容分类的颜色。**以预设的强调色为基准**，按类型偏一点色相，再按底色深浅决定明暗 ——
 * 不引第二套配色表，换预设时整张图仍然是一套颜色。
 */
const KIND_HUE_OFFSET: Record<string, number> = {
  code: 0,
  markup: 18,
  text: -95,
  data: 45,
  office: 25,
  pdf: -20,
  image: 150,
  video: -30,
  audio: 130,
  archive: 0,
  binary: 0,
  other: 0,
};

export function kindColor(kind: string, tokens: Tokens): string {
  const base = parseHex(tokens.accent) ?? { r: 77, g: 158, b: 255 };
  const offset = KIND_HUE_OFFSET[kind] ?? 0;
  const shifted = toHex(rotateHue(base, offset));
  // 浅底上压暗、深底上提亮：条形图要在两种底上都有分量，而不是融进背景。
  return isLight(tokens) ? mixColors(shifted, '#101010', 0.4) : mixColors(shifted, '#FFFFFF', 0.08);
}

/** 色相旋转（保持明度与饱和度），用于把强调色派生成一组同族的颜色。 */
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
 * 字幕条与它的文字色。深底用「深色半透明面板 + 白字」，浅底反过来 ——
 * 白字压在浅色文档页上会看不见（实测 `paper` 预设）。
 */
export function captionColors(tokens: Tokens): { background: string; color: string; shadow: string } {
  return isLight(tokens)
    ? { background: 'rgba(20, 20, 20, 0.82)', color: '#FFFFFF', shadow: '0 10px 30px rgba(0, 0, 0, 0.18)' }
    : { background: 'rgba(0, 0, 0, 0.62)', color: '#FFFFFF', shadow: '0 10px 30px rgba(0, 0, 0, 0.35)' };
}
