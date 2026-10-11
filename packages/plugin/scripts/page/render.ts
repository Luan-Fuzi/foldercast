/**
 * 渲染：视图模型 → 一个自包含的 HTML 字符串。
 *
 * **纯函数**：不读文件、不跑命令、不看时间（生成时间由调用方传入，否则同一份讲稿
 * 两次渲染不一致）。图片由调用方先经 `embed.ts` 解析成 `src`（内联 data URI 或相对
 * 路径）传进来，所以这一层可以直接拿夹具断言。
 *
 * 0006 起场景区块的标记与样式在 `scenecard/`（与视频共享同一份实现）；这里只剩
 * **文档壳**：页头 hero、目录、页脚与页面级排版。区块长什么样不再由本文件决定。
 *
 * 三条硬约束（继承自 M6 的静态页，测试逐条钉住）：
 *
 * 1. **零 JavaScript、零外部资源**：不引 CDN、无外部字体，CSS 全内联，折叠用
 *    `<details>`。图片要么是 data URI，要么是源目录下的相对路径。
 * 2. **顺序确定**：视图模型已排好序，这里只画不排。
 * 3. **页面自我交代边界**：页脚写清「本页由 script.json 生成、引用了哪些文件、哪些图
 *    没内联」—— 页面是讲稿的压缩形态，不能假装自己是全部。
 */
import type { PageModel, PageSection } from './collect.ts';
import { countSections } from './collect.ts';
import type { PageImage } from './embed.ts';
import type { PageStyle } from './styles.ts';
import { CARD_CSS, renderSceneCard } from '../scenecard/render.ts';
import { escapeHtml, type SceneCard } from '../scenecard/card.ts';

export { escapeHtml };

export type RenderInput = {
  model: PageModel;
  style: PageStyle;
  /** 引用路径 → 落点（data URI 或相对路径）。没有条目的引用按无画面处理。 */
  images: ReadonlyMap<string, PageImage>;
  /** 生成过程中的说明（图片没内联、格式放不了等），写在页脚。 */
  notes: readonly string[];
  /** 生成时间（ISO 字符串），**由调用方传入**。 */
  generatedAt: string;
  /** 讲稿路径的展示写法（相对被讲解目录），页脚交代来源用。 */
  scriptRef: string;
};

/** 区块类型的中文标签（目录导航用；区块眉标由 scenecard 的 CARD_KIND_LABEL 给）。 */
const KIND_LABEL: Record<PageSection['kind'], string> = {
  hero: '封面',
  structure: '结构',
  inventory: '盘点',
  file: '文件',
  concept: '论点',
  compare: '对比',
  flow: '流程',
  gallery: '图集',
  clip: '视频',
  document: '文档',
  outro: '小结',
};

/* ---------------------------------------------------------------- CSS */

/**
 * 页面壳样式：只写一份、只引用变量（变量由风格预设给，见 `styles.ts`）。
 * 变量清单：--bg --panel --ink --muted --line --accent --accent-ink --track
 * --code-bg --code-ink --hero-bg --hero-ink --hero-muted --font-display
 * --font-body --font-mono --radius --space --page-width
 */
const BASE_CSS = `
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: var(--font-body);
  font-size: 15px;
  line-height: 1.7;
}
.wrap { max-width: var(--page-width); margin: 0 auto; padding: 0 24px; }
.mono, code { font-family: var(--font-mono); font-size: 0.92em; }
.muted { color: var(--muted); }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

/* ── 页头（cover 场景） ─────────────────────────────── */
.hero { background: var(--hero-bg); color: var(--hero-ink); }
.hero-inner { max-width: var(--page-width); margin: 0 auto; padding: calc(56px * var(--space)) 24px calc(44px * var(--space)); }
.hero .kicker { margin: 0 0 10px; font-size: 12px; letter-spacing: 0.22em; color: var(--hero-muted); }
.hero h1 { margin: 0; font-family: var(--font-display); font-size: 38px; line-height: 1.2; font-weight: 700; }
.hero,.hero-inner,.toc,.colophon { overflow-wrap: anywhere; min-width: 0; }
.hero .subtitle { margin: 10px 0 0; font-size: 17px; color: var(--hero-muted); }
.hero .lede { margin: 18px 0 0; max-width: 40em; font-size: 15px; color: var(--hero-ink); opacity: 0.86; border-left: 3px solid var(--accent); padding-left: 14px; }

/* ── 目录（区块多时才有） ───────────────────────────── */
.toc { border-bottom: 1px solid var(--line); background: var(--panel); }
.toc ol { margin: 12px 0; padding: 0 0 0 1.4em; columns: 2; column-gap: 40px; font-size: 14px; }
.toc li { margin: 2px 0; break-inside: avoid; }

/* ── 区块间距（文档流；卡片内部见 scenecard 的 CARD_CSS） ── */
main { display: block; padding: calc(8px * var(--space)) 0 32px; }
.scene { margin: calc(44px * var(--space)) auto; }

/* ── 页脚（边界自述） ───────────────────────────────── */
.colophon { margin-top: calc(56px * var(--space)); border-top: 3px double var(--line); background: var(--panel); font-size: 13px; color: var(--muted); }
.colophon .wrap { padding-top: 20px; padding-bottom: 40px; }
.colophon p { margin: 6px 0; }
.colophon .fine { font-size: 12px; }
.colophon details { margin: 10px 0; }
.colophon summary { cursor: pointer; color: var(--ink); }
.colophon ul { margin: 8px 0; padding-left: 1.3em; }
.colophon code { overflow-wrap: anywhere; }

@media (max-width: 640px) {
  .toc ol { columns: 1; }
}
@media print {
  .hero, .toc { background: none; color: inherit; border: none; }
  .scene { break-inside: avoid; }
}`;

/* ---------------------------------------------------------------- 区块 */

function renderHero(hero: NonNullable<PageModel['hero']>, inHeader: boolean): string {
  const cls = inHeader ? 'hero' : 'scene scene-hero';
  const inner = `
  <p class="kicker">foldercast · 目录导览</p>
  <h1>${escapeHtml(hero.title)}</h1>
  ${hero.subtitle === undefined ? '' : `<p class="subtitle">${escapeHtml(hero.subtitle)}</p>`}
  <p class="lede">${escapeHtml(hero.narration)}</p>`;
  if (inHeader) {
    return `<header class="${cls}">\n <div class="hero-inner">${inner}\n </div>\n</header>`;
  }
  return `<section class="${cls}" id="scene-${escapeHtml(hero.id)}">\n <div class="hero-inner">${inner}\n </div>\n</section>`;
}

/** 页面区块 → 场景卡：把图片落点并进卡片（file 的素材图、gallery 的格子图）。hero 不进卡片体系。 */
function toCard(section: Exclude<PageSection, { kind: 'hero' }>, images: ReadonlyMap<string, PageImage>): SceneCard {
  if (section.kind === 'file') {
    const image = images.get(section.file);
    return { ...section, ...(section.shotSrc !== undefined || image === undefined ? {} : { shotSrc: image.src }) };
  }
  if (section.kind === 'gallery') {
    return {
      ...section,
      items: section.items.map((item) => {
        const image = images.get(item.path);
        const fallbackNote = item.fallbackNote ?? '没有可用画面（原因见页脚）';
        return { ...item, fallbackNote, ...(item.src !== undefined || image === undefined ? {} : { src: image.src }) };
      }),
    };
  }
  return section;
}

function renderSection(section: PageSection, index: number, images: ReadonlyMap<string, PageImage>): string {
  // hero（第二个 cover）不进卡片体系：页头版式是页面自己的
  if (section.kind === 'hero') {
    return renderHero(section, false);
  }
  return renderSceneCard(toCard(section, images), { mode: 'page', no: index + 1 });
}

/* ---------------------------------------------------------------- 页面 */

function renderToc(model: PageModel): string {
  const items = model.sections
    .filter((section) => section.kind !== 'hero')
    .map((section) => `      <li><a href="#scene-${escapeHtml(section.id)}">${escapeHtml(section.title)}</a></li>`)
    .join('\n');
  if (items === '') return '';
  return `<nav class="toc">\n  <div class="wrap">\n    <ol>\n${items}    </ol>\n  </div>\n</nav>`;
}

function renderColophon(input: RenderInput): string {
  const { model, images, notes, generatedAt, scriptRef } = input;
  const refs =
    model.references.length === 0
      ? ''
      : `    <details>
      <summary>引用的文件（${String(model.references.length)}）</summary>
      <ul>\n${model.references.map((ref) => `        <li><code>${escapeHtml(ref)}</code></li>`).join('\n')}      </ul>
    </details>`;
  const noteBlock =
    notes.length === 0
      ? ''
      : `    <div class="notes">
      <p>边界说明</p>
      <ul>\n${notes.map((note) => `        <li>${escapeHtml(note)}</li>`).join('\n')}      </ul>
    </div>`;
  const inlined = [...images.values()].filter((image) => image.inlined).length;
  const skipped =
    model.skipped.length === 0
      ? ''
      : `    <p class="fine">有 ${String(model.skipped.length)} 个场景的类型页面不认识，未渲染：${model.skipped.map((item) => `${escapeHtml(item.id)}（${escapeHtml(item.type)}）`).join('、')}。</p>`;
  return `<footer class="colophon">
  <div class="wrap">
    <p>本页由讲稿 <code>${escapeHtml(scriptRef)}</code> 生成（foldercast page）—— 同一份讲稿也渲染讲解视频，页面是它的文字版。</p>
    <p class="fine">${escapeHtml(model.label)}· ${String(countSections(model))} 个区块 · 图片内联 ${String(inlined)} 张 · 生成于 ${escapeHtml(generatedAt)}</p>${refs}
${noteBlock}
${skipped}    <p class="fine">${[...images.values()].some((image) => !image.inlined) ? '静态页：无 JavaScript、无远程资源；部分图片按相对路径引用，转发时需附带对应素材并保留相对位置。' : '自包含静态页：无 JavaScript、无外部资源，可以单文件保存和转发。'}</p>
  </div>
</footer>`;
}

/** 视图模型 → HTML 文档。 */
export function renderPage(input: RenderInput): string {
  const { model, style, images } = input;
  const vars = Object.entries(style.vars)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');
  const css = `:root {\n${vars}\n}\n${BASE_CSS}\n${CARD_CSS}${style.extraCss === undefined ? '' : `\n${style.extraCss}`}`;

  const header = model.hero === undefined ? '' : renderHero(model.hero, true);
  const sections = model.sections
    .map((section, index) => renderSection(section, index, images))
    .join('\n');
  const toc = model.sections.filter((section) => section.kind !== 'hero').length >= 4 ? renderToc(model) : '';

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(model.title)} · 目录导览</title>
<style>
${css}
</style>
</head>
<body>
${header}
${toc}
<main class="wrap">
${sections}
</main>
${renderColophon(input)}
</body>
</html>
`;
}
