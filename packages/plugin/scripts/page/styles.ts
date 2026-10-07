/**
 * 页面风格预设：**名字稳定、成文档，整合阶段会把这里的名收窄成 config 的枚举**。
 *
 * | 名字   | 定位                                                       |
 * |--------|------------------------------------------------------------|
 * | 素稿   | 缺省。浅色纸面、系统无衬线，接近旧 M6 静态页的克制观感      |
 * | 杂志   | 暖纸色 + 衬线大标题，编辑部专题页的排版密度                  |
 * | 夜幕   | 深底，与渲染器成片同一套颜色（`renderer/styles.ts` 的 token）|
 *
 * 组织方式：布局 CSS（`render.ts` 里的 BASE_CSS）只写一份、只引用变量；一套预设就是一组
 * CSS custom properties（颜色、字体层级、间距、圆角），外加少量该预设独有的补充规则
 * （`extraCss`，比如杂志的居中大标题）。换观感不改结构 —— 这是从被删的四套 × 31 token
 * 系统里留下的教训：预设之间的差异应该一眼可辨，而不是 31 个旋钮各拧一度。
 *
 * 不引外部字体：字体栈只用系统字体（PingFang / Songti / SF Mono…），页面必须零外部资源。
 */
import { TOKENS } from '../renderer/styles.ts';

/** 一套页面风格。`name` 是 CLI `--style` 与 config 枚举用的标识（简体中文）。 */
export type PageStyle = {
  name: string;
  /** 一句话定位，给设置页的选项说明用。 */
  description: string;
  /** 变量名 → 值。键集必须覆盖 BASE_CSS 引用到的每一个变量（渲染测试逐套断言）。 */
  vars: Record<string, string>;
  /** 该预设独有的补充规则（选择器不得引入外部资源或 JavaScript）。 */
  extraCss?: string;
};

const SANS_STACK = '-apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif';
const SERIF_STACK = '"Songti SC", "STSong", "Source Han Serif SC", "Noto Serif CJK SC", Georgia, serif';
const MONO_STACK = '"SF Mono", Menlo, Consolas, "PingFang SC", monospace';

/** 素稿：缺省预设。纸白底、墨色字、一枚赭红强调色；页头是一条深色横带。 */
const DRAFT: PageStyle = {
  name: '素稿',
  description: '纸面白底、系统无衬线，克素的讲稿页面（缺省）',
  vars: {
    '--bg': '#FAF8F4',
    '--panel': '#FFFFFF',
    '--ink': '#24221E',
    '--muted': '#6F6A61',
    '--line': '#E4DFD5',
    '--accent': '#B4472A',
    '--accent-ink': '#FFFFFF',
    '--track': '#EFEBE2',
    '--code-bg': '#F3EFE7',
    '--code-ink': '#2A2620',
    '--hero-bg': '#26231E',
    '--hero-ink': '#F5F2EA',
    '--hero-muted': '#A9A296',
    '--font-display': SANS_STACK,
    '--font-body': SANS_STACK,
    '--font-mono': MONO_STACK,
    '--radius': '10px',
    '--space': '1',
    '--page-width': '960px',
  },
};

/** 杂志：暖纸色、衬线大标题、细分割线；页头不用色带，用排版本身压住版面。 */
const MAGAZINE: PageStyle = {
  name: '杂志',
  description: '暖纸底、衬线大标题，编辑部专题页的排版密度',
  vars: {
    '--bg': '#FBF7F0',
    '--panel': '#FFFDF8',
    '--ink': '#26211B',
    '--muted': '#7A7264',
    '--line': '#E6DECF',
    '--accent': '#9E2B25',
    '--accent-ink': '#FFFDF8',
    '--track': '#F0E9DB',
    '--code-bg': '#F5F0E5',
    '--code-ink': '#2A2419',
    '--hero-bg': '#F3ECDE',
    '--hero-ink': '#26211B',
    '--hero-muted': '#857A66',
    '--font-display': SERIF_STACK,
    '--font-body': SANS_STACK,
    '--font-mono': MONO_STACK,
    '--radius': '2px',
    '--space': '1.15',
    '--page-width': '900px',
  },
  extraCss: `
/* 杂志的页头靠排版不靠色带：居中大衬线标题 + 上下细线 */
.hero { background: var(--hero-bg); color: var(--hero-ink); text-align: center; }
.hero-inner { padding: calc(72px * var(--space)) 24px calc(56px * var(--space)); }
.hero h1 { font-size: 46px; letter-spacing: 0.02em; }
.hero .lede { margin-left: auto; margin-right: auto; max-width: 34em; }`,
};

/**
 * 夜幕：深底技术风。颜色直接搬渲染器的成片 token（`renderer/styles.ts`）——
 * 页面与视频是同一份讲稿的两个出口，用同一套颜色能一眼认出「这是同一部作品」。
 */
const NIGHT: PageStyle = {
  name: '夜幕',
  description: '深底技术风，与渲染成片同一套颜色',
  vars: {
    '--bg': '#0F1420',
    '--panel': '#182031',
    '--ink': '#F2F4F8',
    '--muted': '#8A93A6',
    '--line': '#2A3245',
    '--accent': '#4D9EFF',
    '--accent-ink': '#0B1220',
    '--track': '#141B2B',
    '--code-bg': '#0B0F18',
    '--code-ink': '#E6EAF2',
    '--hero-bg': '#0B0F18',
    '--hero-ink': '#F2F4F8',
    '--hero-muted': '#8A93A6',
    '--font-display': SANS_STACK,
    '--font-body': SANS_STACK,
    '--font-mono': MONO_STACK,
    '--radius': '12px',
    '--space': '1',
    '--page-width': '960px',
  },
  extraCss: `
/* 夜幕的引文压在半透明面板上，避免长引文在深底上糊成一片 */
.quote { background: rgba(18, 25, 41, 0.55); border-color: var(--line); }`,
};

/** 预设注册表。CLI `--style` 与 config 的 page.style 枚举都以这里的键为准。 */
export const PAGE_STYLES: Readonly<Record<string, PageStyle>> = {
  [DRAFT.name]: DRAFT,
  [MAGAZINE.name]: MAGAZINE,
  [NIGHT.name]: NIGHT,
};

/** 缺省风格：素稿。 */
export const DEFAULT_STYLE_NAME: string = DRAFT.name;

/** 全部预设名（报错与文档用，顺序即展示顺序）。 */
export const STYLE_NAMES: readonly string[] = Object.keys(PAGE_STYLES);

/**
 * 按名字取预设；不认识返回 undefined（调用方把可用名单写进报错）。
 */
export function styleByName(name: string): PageStyle | undefined {
  return PAGE_STYLES[name];
}

/**
 * 夜幕预设是否仍与渲染器成片 token 同色（漂移说明有人只改了一边）。
 * 页面与视频是同一份讲稿的两个出口，这套颜色该一起动。
 */
export function samePaletteAsVideo(): boolean {
  const night = PAGE_STYLES['夜幕'];
  if (night === undefined) return false;
  const pairs: [string, string][] = [
    ['--bg', TOKENS.bg],
    ['--ink', TOKENS.ink],
    ['--muted', TOKENS.muted],
    ['--line', TOKENS.line],
    ['--accent', TOKENS.accent],
    ['--panel', TOKENS.panel],
    ['--code-bg', TOKENS.codeBg],
  ];
  return pairs.every(([key, value]) => night.vars[key] === value);
}
