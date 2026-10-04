/**
 * 源码文件 → 语法高亮图（SVG）。
 *
 * **为什么是 SVG 而不是 PNG**：最终画面由浏览器渲染（Remotion），矢量图不需要截图工具，
 * 缩放到 1080p / 4K 都不糊（SPEC-data-format.md 第三节 `code` 行）。
 *
 * **为什么自己拼 SVG 而不用 shiki 的 `codeToHtml`**：它产出 `<pre><span>` 加一整套主题 CSS，
 * 要塞进视频得把 CSS 一起搬过去；这里只取 token 的颜色写成 `fill` 属性，产物是**单文件、
 * 无外链**，`<img>`、`<Img>`、内联都能用。同一输入必须产出逐字节相同的 SVG —— 素材是可
 * 重算的缓存，内容飘了就没法比对、也没法做增量（SPEC-data-format.md 增量重算一节）。
 */
import {
  bundledLanguages,
  bundledThemes,
  createHighlighter,
  type BundledLanguage,
  type BundledTheme,
  type Highlighter,
} from 'shiki';

export type CodeImageOptions = {
  /** 源码全文。 */
  code: string;
  /** 项目内部的语言名，如 'TypeScript' / 'Python' / 'CSS'；未识别时按纯文本处理。 */
  language?: string;
  /** 最多渲染多少行，默认 60。 */
  maxLines?: number;
  /** shiki 主题名，默认 'github-light'。 */
  theme?: string;
};

export type CodeImage = {
  /** 自包含的 SVG 文本。 */
  svg: string;
  /** 实际渲染的行数。 */
  lines: number;
  /** 是否因为超过 maxLines 被截断。 */
  truncated: boolean;
  /** 实际用于高亮的 shiki 语言 id；按纯文本处理时是 'text'。 */
  language: string;
};

const FONT_SIZE = 14;
const LINE_HEIGHT = 21;
/**
 * 14px 等宽字体的常见字宽（约 0.6em）。它只用来算画布大小，不参与排版：估大了是右侧多留白，
 * 估小了才会裁掉行尾，所以宁可偏大。
 */
const CHAR_WIDTH = 8.4;
/** 代码区左右内边距。 */
const PADDING_X = 16;
/** 代码区四周的边距。 */
const MARGIN = 12;
/** 14px 字在 21px 行盒里的基线位置：行盒留白 3.5 加约 11 的 ascender。 */
const BASELINE = 15;
const FONT_STACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
/** 截断提示用 GitHub 的次级文本灰，和正文区分开但仍是同一套观感。 */
const NOTE_COLOR = '#57606a';
const FALLBACK_BACKGROUND = '#ffffff';
const DEFAULT_THEME = 'github-light';
const DEFAULT_MAX_LINES = 60;
const TAB_WIDTH = 4;
const TEXT_X = MARGIN + PADDING_X;

/** 表里没有的展示名，按 shiki id 原样再试一次。 */
type ResolvedLanguage = BundledLanguage | 'text';

/**
 * 项目内部的**展示名**（见 `../analyzer/classify.ts`，stats.languages 也用这套写法）到 shiki
 * 语言 id 的映射。键一律小写，调用方给 'TypeScript' 还是 'typescript' 都认。
 *
 * 值受 `BundledLanguage` 约束：写错 id 会在 typecheck 阶段报错，而不是等到渲染时才发现
 * 高亮器加载不了。shiki 没有文法的语言（Parquet、Avro、SQLite 这类）**不写进来**，
 * 由 `resolveLanguage` 统一退化成纯文本。
 */
const LANGUAGE_IDS: Readonly<Record<string, BundledLanguage>> = {
  // 代码
  typescript: 'typescript',
  tsx: 'tsx',
  javascript: 'javascript',
  jsx: 'jsx',
  python: 'python',
  go: 'go',
  golang: 'go',
  rust: 'rust',
  java: 'java',
  kotlin: 'kotlin',
  swift: 'swift',
  c: 'c',
  'c++': 'cpp',
  'c#': 'csharp',
  php: 'php',
  shell: 'shellscript',
  powershell: 'powershell',
  batch: 'bat',
  lua: 'lua',
  ruby: 'ruby',
  perl: 'perl',
  r: 'r',
  julia: 'julia',
  scala: 'scala',
  clojure: 'clojure',
  elixir: 'elixir',
  erlang: 'erlang',
  haskell: 'haskell',
  ocaml: 'ocaml',
  dart: 'dart',
  vue: 'vue',
  svelte: 'svelte',
  astro: 'astro',
  sql: 'sql',
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  stylus: 'stylus',
  groovy: 'groovy',
  'objective-c': 'objective-c',
  'objective-c++': 'objective-cpp',
  assembly: 'asm',
  // shiki 只提供固定/自由两种 Fortran 文法，展示名一个 'Fortran' 归到自由格式。
  fortran: 'fortran-free-form',
  'visual basic': 'vb',
  'protocol buffers': 'proto',
  hcl: 'hcl',
  solidity: 'solidity',
  zig: 'zig',
  nim: 'nim',
  // .ipynb 落盘就是 JSON，比当纯文本看强。
  jupyter: 'json',
  dockerfile: 'dockerfile',
  makefile: 'make',

  // 标记
  html: 'html',
  xml: 'xml',
  haml: 'haml',
  pug: 'pug',
  twig: 'twig',
  jinja: 'jinja',
  // Nunjucks 是 Jinja 方言，shiki 没有单独文法，用 Jinja 近似远好过不着色。
  nunjucks: 'jinja',
  erb: 'erb',

  // 文本
  markdown: 'markdown',
  mdx: 'mdx',
  restructuredtext: 'rst',
  asciidoc: 'asciidoc',
  org: 'org',
  tex: 'tex',
  bibtex: 'bibtex',

  // 数据
  json: 'json',
  yaml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  properties: 'properties',
  environment: 'dotenv',
  csv: 'csv',
  tsv: 'tsv',
};

function isBundledLanguage(id: string): id is BundledLanguage {
  return Object.hasOwn(bundledLanguages, id);
}

function isBundledTheme(name: string): name is BundledTheme {
  return Object.hasOwn(bundledThemes, name);
}

function resolveLanguage(language: string | undefined): ResolvedLanguage {
  const raw = (language ?? '').trim().toLowerCase();
  const candidate = LANGUAGE_IDS[raw] ?? raw;
  // shiki 的 'text' / 'plaintext' / 'txt' 不在 bundledLanguages 里，但它是内置的纯文本文法，
  // 直接返回 'text' 即可。
  return isBundledLanguage(candidate) ? candidate : 'text';
}

function resolveTheme(theme: string | undefined): BundledTheme {
  const raw = (theme ?? '').trim();
  // 主题名写错只该退化成默认主题，不该让整个素材阶段失败（素材阶段的原则是单个文件失败
  // 不中断，SPEC-data-format.md）。语言名同理。
  return isBundledTheme(raw) ? raw : DEFAULT_THEME;
}

/**
 * 高亮器缓存，键是 `语言\0主题`（一个高亮器只装一种语言 + 一个主题，正是本模块的用法）。
 *
 * 缓存的是 **Promise 而不是实例**：首次 `createHighlighter` 要读引擎与文法（秒级），并发调用
 * 同一组合时缓存实例会让两边各建一个。失败的 Promise 必须及时删掉，否则后续每次都拿到同一个错误。
 */
const highlighters = new Map<string, Promise<Highlighter>>();

function highlighterFor(language: ResolvedLanguage, theme: BundledTheme): Promise<Highlighter> {
  const key = `${language}\u0000${theme}`;
  const cached = highlighters.get(key);
  if (cached !== undefined) return cached;
  const pending = createHighlighter({ themes: [theme], langs: [language] }).catch(
    (error: unknown) => {
      highlighters.delete(key);
      throw error;
    },
  );
  highlighters.set(key, pending);
  return pending;
}

/** XML 里必须转义的五个字符。代码里 `<div>`、`&&`、引号都很常见，漏一个整张图就解析失败。 */
const XML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => XML_ESCAPES[character] ?? character);
}

function expandTabs(text: string): string {
  return text.replace(/\t/g, ' '.repeat(TAB_WIDTH));
}

/**
 * 只保留 XML 1.0 允许的字符。素材阶段的输入是磁盘上的任意文件，混进一个控制字符（例如被误判
 * 成代码的二进制）会让整个 SVG 解析失败，宁可悄悄去掉也不能让这张图变成空白。
 */
function stripControlCharacters(text: string): string {
  // 要过滤的就是控制字符本身，范围按 XML 1.0 的合法字符集取（\t \n 保留）。
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

/**
 * 归一化：CRLF 里的 \r 会被 XML 解析器当成换行，残留下来会变成行尾多一个空格，宽度估算也跟着偏。
 */
function normalizeSource(code: string): string {
  return stripControlCharacters(code.replace(/\r\n?/g, '\n'));
}

/**
 * 宽字符（CJK、全角标点、emoji）：等宽字体里它们占**两列**，而 `CHAR_WIDTH` 只描述 ASCII 一列。
 * 中文注释在这个仓库里到处都是，按一列算会把行尾裁掉。
 */
const WIDE_CHARACTER =
  /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]|[\u{1f300}-\u{1f64f}]|[\u{1f900}-\u{1f9ff}]/u;

/** 画布宽度按列数估：ASCII 一列，宽字符两列。只用于算尺寸，不参与排版。 */
function visualColumns(text: string): number {
  let columns = 0;
  for (const character of text) columns += WIDE_CHARACTER.test(character) ? 2 : 1;
  return columns;
}

/** 按仓库里 `countLines` 的约定切行：末尾换行不算多一行。 */
function splitLines(code: string): string[] {
  if (code === '') return [];
  const lines = code.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** 只用到这几个字段：不直接依赖 shiki 的 token 类型，测试里替换 token 也更省事。 */
type TokenLike = {
  readonly content: string;
  readonly color?: string;
  readonly fontStyle?: number;
};

/**
 * 一个行元素。
 *
 * `xml:space="preserve"` 是缩进能不能显示出来的关键：SVG 默认会把连续空格折掉，代码的缩进、
 * 对齐空格全靠它。**必须写在 `<text>` 上**——实测 Blink 不从 `<svg>` 根继承（写在根上计算出的
 * `white-space` 仍是 `nowrap`），写在 text 上才会变成 `pre`。也因此 tspan 之间不能有换行或缩进，
 * 那些空白会被当成正文画进图里。
 */
function textElement(y: number, content: string, fill?: string): string {
  const paint = fill === undefined ? '' : ` fill="${fill}"`;
  return `<text x="${TEXT_X}" y="${y}"${paint} xml:space="preserve">${content}</text>`;
}

/** shiki 的 fontStyle 是位标志：1 斜体、2 粗体、4 下划线。 */
function fontAttributes(fontStyle: number | undefined): string {
  if (fontStyle === undefined || fontStyle === 0) return '';
  const italic = (fontStyle & 1) !== 0 ? ' font-style="italic"' : '';
  const bold = (fontStyle & 2) !== 0 ? ' font-weight="bold"' : '';
  const underline = (fontStyle & 4) !== 0 ? ' text-decoration="underline"' : '';
  return `${italic}${bold}${underline}`;
}

/** 一行 token → 一串 `<tspan>`。只在颜色与主题前景不同时写 `fill`，默认色靠继承，省体积。 */
function tspansFor(tokens: readonly TokenLike[], defaultColor: string): string {
  let markup = '';
  for (const token of tokens) {
    const text = escapeXml(expandTabs(token.content));
    // 纯文本模式下 shiki 会给出空 token（行尾、空行），跳过。
    if (text === '') continue;
    const color = token.color;
    const fill =
      color === undefined || color.toLowerCase() === defaultColor.toLowerCase()
        ? ''
        : ` fill="${color}"`;
    markup += `<tspan${fill}${fontAttributes(token.fontStyle)}>${text}</tspan>`;
  }
  return markup;
}

export async function renderCodeImage(options: CodeImageOptions): Promise<CodeImage> {
  const language = resolveLanguage(options.language);
  const theme = resolveTheme(options.theme);
  const requestedLines = options.maxLines ?? DEFAULT_MAX_LINES;
  // 非正数 / NaN 没有意义，退回默认值，好过画一张空图或抛错。
  const maxLines =
    Number.isFinite(requestedLines) && requestedLines >= 1
      ? Math.floor(requestedLines)
      : DEFAULT_MAX_LINES;

  const source = normalizeSource(options.code);
  const highlighter = await highlighterFor(language, theme);

  // 传解析后的主题对象而不是主题名：`codeToTokens` 的参数类型只认已加载的 BundledTheme 联合，
  // 而这个名字是运行时决定的字符串。
  const resolvedTheme = highlighter.getTheme(theme);
  const background = resolvedTheme.colors?.['editor.background'] ?? FALLBACK_BACKGROUND;
  const result = highlighter.codeToTokens(source, { lang: language, theme: resolvedTheme });
  const defaultColor = result.fg ?? resolvedTheme.fg ?? '#000000';

  const allLines = splitLines(source);
  const visible = allLines.slice(0, maxLines);
  const hidden = allLines.length - visible.length;
  const truncated = hidden > 0;

  let longest = 0;
  const rows = visible.map((line, index) => {
    longest = Math.max(longest, visualColumns(expandTabs(line)));
    const y = MARGIN + index * LINE_HEIGHT + BASELINE;
    const tokens = result.tokens[index] ?? [];
    return textElement(y, tspansFor(tokens, defaultColor));
  });

  const note = truncated ? `… 还有 ${hidden} 行` : '';
  if (truncated) {
    const y = MARGIN + visible.length * LINE_HEIGHT + BASELINE;
    rows.push(textElement(y, escapeXml(note), NOTE_COLOR));
    // 提示也要算进宽度，不然短行的代码会把提示裁掉。
    longest = Math.max(longest, visualColumns(note));
  }

  const width = Math.ceil(MARGIN * 2 + PADDING_X * 2 + longest * CHAR_WIDTH);
  const height = Math.ceil(MARGIN * 2 + rows.length * LINE_HEIGHT);
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT_STACK}" font-size="${FONT_SIZE}">`,
    `<rect width="${width}" height="${height}" fill="${background}"/>`,
    ...rows,
    '</svg>',
    '',
  ].join('\n');

  return { svg, lines: visible.length, truncated, language };
}
