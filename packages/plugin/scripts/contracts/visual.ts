/** 共用美术预设：视频与 HTML 使用相同色板和系统字体。prompt 由写稿模型落实到场景设计。 */
/** 一套风格。名称与创作指导共用于设置页、工具返回和渲染。 */
export type PageStyle = {
  name: string;
  englishName: string;
  /** 给写稿模型的设计方向；不是渲染器执行的 CSS。 */
  direction: string;
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
// 保留默认视频的字体选择，页面与视频从这里读取同一套定义。
const SWISS_SANS_STACK = '"PingFang SC", "Helvetica Neue", Helvetica, "Microsoft YaHei", sans-serif';
const SWISS_MONO_STACK = '"SF Mono", Menlo, Consolas, monospace';

/** 瑞士风格：缺省预设。纸白底、墨色字、赭红强调色。 */
const DRAFT: PageStyle = {
  name: '瑞士风格',
  englishName: 'Swiss Style / International Typographic Style',
  direction: '采用瑞士风格（Swiss Style / International Typographic Style）作为设计方向：以网格、清晰对齐、无衬线排版和明确的信息层级组织内容；用留白、比例和少量强调色突出重点。根据内容选择流程、对比、图表与代表性素材，优先保证事实准确和阅读清晰，可结合本次目标调整。',
  description: '瑞士风格：纸面浅底、系统无衬线、清晰层级（默认）',
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
    '--font-display': SWISS_SANS_STACK,
    '--font-body': SWISS_SANS_STACK,
    '--font-mono': SWISS_MONO_STACK,
    '--radius': '10px',
    '--space': '1',
    '--page-width': '960px',
  },
};

/** 编辑设计风格：暖纸色、衬线大标题、细分割线。 */
const MAGAZINE: PageStyle = {
  name: '编辑设计风格',
  englishName: 'Editorial Design',
  direction: '采用编辑设计风格（Editorial Design）作为设计方向：围绕一条清晰的内容主线安排标题、导语、正文、引文与图文关系；以排版层级和有依据的代表性素材形成阅读节奏。本预设采用暖纸底、衬线标题和细分割线，可结合内容选择专题叙述、对比或流程，不为装饰编造事实。',
  description: '编辑设计（Editorial Design）：暖纸底、衬线标题、图文层级与阅读节奏',
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
/* 编辑设计的页头：居中衬线标题 + 上下细线 */
.hero { background: var(--hero-bg); color: var(--hero-ink); text-align: center; }
.hero-inner { padding: calc(72px * var(--space)) 24px calc(56px * var(--space)); }
.hero h1 { font-size: 46px; letter-spacing: 0.02em; }
.hero .lede { margin-left: auto; margin-right: auto; max-width: 34em; }`,
};

/** 科技风格：深底、蓝色强调的设计方向，不指代统一的历史流派。 */
const NIGHT: PageStyle = {
  name: '科技风格',
  englishName: 'Tech-inspired Design',
  direction: '采用科技风格（Tech-inspired Design）作为设计方向：突出系统结构、数据关系和过程，用清晰的流程图、对比与信息面板解释关键问题。本预设采用深色背景、蓝色强调与简洁无衬线排版；优先可读性和真实证据，可按内容调整表现，不把深色界面等同于赛博朋克，也不为科技感添加无依据的数据。',
  description: '科技风格（Tech-inspired Design）：深底、蓝色强调、系统结构与数据关系',
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
/* 深色预设的引文使用半透明面板 */
.quote { background: rgba(18, 25, 41, 0.55); border-color: var(--line); }`,
};

/** 预设注册表，供视频、页面和设置共用。 */
export const PAGE_STYLES: Readonly<Record<string, PageStyle>> = {
  [DRAFT.name]: DRAFT,
  [MAGAZINE.name]: MAGAZINE,
  [NIGHT.name]: NIGHT,
};

/** 对外名称直接表达设计方向；旧名称仅在输入处兼容。 */
export const VISUAL_STYLE_NAMES = ['瑞士风格', '编辑设计风格', '科技风格'] as const;
export type VisualStyleName = typeof VISUAL_STYLE_NAMES[number];
export const CUSTOM_VISUAL_STYLE = '自定义风格' as const;
export type VisualSelectionName = VisualStyleName | typeof CUSTOM_VISUAL_STYLE;
export const LEGACY_VISUAL_STYLE_NAMES = ['素稿', '杂志', '夜幕'] as const;
export const VISUAL_STYLE_INPUT_NAMES = [...VISUAL_STYLE_NAMES, ...LEGACY_VISUAL_STYLE_NAMES] as const;
export type VisualStyleInputName = typeof VISUAL_STYLE_INPUT_NAMES[number];
export const DEFAULT_STYLE_NAME: VisualStyleName = '瑞士风格';

/** 全部预设名（报错与文档用，顺序即展示顺序）。 */
export const STYLE_NAMES = VISUAL_STYLE_NAMES;

/**
 * 按名字取预设；不认识返回 undefined（调用方把可用名单写进报错）。
 */
export function styleByName(name: string): PageStyle | undefined {
  const canonical = normalizeVisualStyle(name);
  return canonical === undefined ? undefined : PAGE_STYLES[canonical];
}

/** 旧讲稿不改写，保留原始哈希；在使用处将旧名称归一为对外名称。 */
export type VisualSpec = {
  style?: VisualStyleInputName | typeof CUSTOM_VISUAL_STYLE;
  /** 自定义风格的名称与效果由模型理解，基础预设用于实际渲染。 */
  name?: string;
  baseStyle?: VisualStyleInputName;
  prompt?: string;
};
export function isVisualStyle(value: unknown): value is VisualStyleName {
  return typeof value === 'string' && VISUAL_STYLE_NAMES.some((name) => name === value);
}

export function normalizeVisualStyle(value: unknown): VisualStyleName | undefined {
  if (isVisualStyle(value)) return value;
  if (value === '素稿') return '瑞士风格';
  if (value === '杂志') return '编辑设计风格';
  if (value === '夜幕') return '科技风格';
  return undefined;
}

export type VisualPreferences = {
  style: VisualSelectionName; stylePrompt: string; prompt?: string;
  name?: string; baseStyle?: VisualStyleName;
};
export function visualPreferencesFor(style: unknown, prompt?: string,
  custom: { name?: string; baseStyle?: VisualStyleName } = {}): VisualPreferences {
  if (style === CUSTOM_VISUAL_STYLE) {
    const name = custom.name?.trim() || CUSTOM_VISUAL_STYLE;
    return { style: CUSTOM_VISUAL_STYLE, name, baseStyle: custom.baseStyle ?? DEFAULT_STYLE_NAME,
      stylePrompt: `采用用户自定义风格「${name}」作为本次设计方向。${prompt?.trim()
        ? `用户期望的效果：\n${prompt}\n` : '效果描述尚未填写，先利用当前对话确定需要的表现；无法判断且影响创作取舍时再询问。'}结合内容落实到选材、场景组织和节拍，以事实准确与可读性为先。`,
      ...(prompt === undefined ? {} : { prompt }) };
  }
  const name = normalizeVisualStyle(style) ?? DEFAULT_STYLE_NAME;
  return { style: name, stylePrompt: PAGE_STYLES[name]!.direction,
    ...(prompt === undefined ? {} : { prompt }) };
}

/** 只解析实际画面所用的预设，不把自定义描述执行为 CSS。 */
export function renderStyleFor(visual: VisualSpec | undefined,
  fallback: VisualStyleName = DEFAULT_STYLE_NAME): VisualStyleName {
  if (visual?.style === CUSTOM_VISUAL_STYLE) return normalizeVisualStyle(visual.baseStyle) ?? DEFAULT_STYLE_NAME;
  return normalizeVisualStyle(visual?.style) ?? fallback;
}
