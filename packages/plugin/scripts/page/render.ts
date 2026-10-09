/**
 * 渲染：视图模型 → 一个自包含的 HTML 字符串。
 *
 * **纯函数**：不读文件、不跑命令、不看时间（生成时间由调用方传入，否则同一份讲稿
 * 两次渲染不一致）。图片由调用方先经 `embed.ts` 解析成 `src`（内联 data URI 或相对
 * 路径）传进来，所以这一层可以直接拿夹具断言。
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

/** 区块类型的中文标签（目录导航与区块眉标共用）。 */
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

/** 摘录超过这么多行就默认折叠（`<details>` 不带 open）。 */
const EXCERPT_OPEN_LINES = 16;

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return map[char] ?? char;
  });
}

/** 百分比：整数就写整数，否则一位小数。 */
function percent(value: number): string {
  const scaled = value * 100;
  const text = Number.isInteger(scaled) ? String(scaled) : scaled.toFixed(1);
  return `${text}%`;
}

function barWidth(share: number): number {
  return Math.max(0, Math.min(1, share)) * 100;
}

/* ---------------------------------------------------------------- CSS */

/**
 * 布局样式：只写一份、只引用变量（变量由风格预设给，见 `styles.ts`）。
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
.hero .subtitle { margin: 10px 0 0; font-size: 17px; color: var(--hero-muted); }
.hero .lede { margin: 18px 0 0; max-width: 40em; font-size: 15px; color: var(--hero-ink); opacity: 0.86; border-left: 3px solid var(--accent); padding-left: 14px; }

/* ── 目录（区块多时才有） ───────────────────────────── */
.toc { border-bottom: 1px solid var(--line); background: var(--panel); }
.toc ol { margin: 12px 0; padding: 0 0 0 1.4em; columns: 2; column-gap: 40px; font-size: 14px; }
.toc li { margin: 2px 0; break-inside: avoid; }

/* ── 区块外壳 ───────────────────────────────────────── */
main { display: block; padding: calc(8px * var(--space)) 0 32px; }
.scene { margin: calc(44px * var(--space)) auto; }
.scene-head { display: flex; align-items: baseline; gap: 14px; border-bottom: 1px solid var(--line); padding-bottom: 10px; margin-bottom: 14px; }
.scene-no { font-family: var(--font-mono); font-size: 20px; color: var(--accent); }
.scene-type { margin: 0; font-size: 12px; letter-spacing: 0.18em; color: var(--muted); }
.scene h2 { margin: 2px 0 0; font-family: var(--font-display); font-size: 24px; line-height: 1.3; font-weight: 700; }
.quote { margin: 0 0 18px; padding: 10px 16px; border-left: 3px solid var(--accent); background: var(--panel); border-radius: 0 var(--radius) var(--radius) 0; color: var(--ink); }
.quote::before { content: "旁白 · "; font-size: 12px; letter-spacing: 0.1em; color: var(--muted); }
.points { margin: 0 0 14px; padding: 0 0 0 22px; color: var(--ink); }
.points li { margin: 4px 0; }

/* ── 条形图（tree / inventory 共用） ────────────────── */
.bars { list-style: none; margin: 0; padding: 0; }
.bar-row { display: grid; grid-template-columns: minmax(9em, 22%) 1fr auto; gap: 12px; align-items: center; padding: 7px 0; border-bottom: 1px dashed var(--line); }
.bar-row:last-child { border-bottom: none; }
.bar-label { overflow-wrap: anywhere; }
.bar-track { position: relative; height: 14px; background: var(--track); border-radius: calc(var(--radius) / 2); overflow: hidden; }
.bar-fill { position: absolute; inset: 0 auto 0 0; background: var(--accent); border-radius: calc(var(--radius) / 2); }
.bar-row.is-highlight .bar-label { color: var(--accent); font-weight: 600; }
.bar-row.is-highlight .bar-fill { background: linear-gradient(90deg, var(--accent), var(--accent-ink) 140%); }
.bar-value { white-space: nowrap; font-size: 13px; color: var(--muted); }
.bar-note { grid-column: 1 / -1; margin: -2px 0 0; font-size: 12.5px; color: var(--muted); }
.bars-total { margin: 10px 0 0; font-size: 13px; color: var(--muted); text-align: right; }

/* ── 论点 / 对比 / 流程（0005 WP3） ─────────────────── */
.concept-statement { margin: 4px 0 10px; font-family: var(--font-display); font-size: 22px; font-weight: 700; line-height: 1.4; }
.compare { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
@media (max-width: 720px) { .compare { grid-template-columns: 1fr; } }
.compare-side { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px 16px; }
.compare-side.is-accent { border-top: 3px solid var(--accent); }
.compare-label { margin: 0 0 8px; font-weight: 700; }
.compare-lines { margin: 0; padding: 0 0 0 20px; }
.compare-lines li { margin: 5px 0; }
.flow { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
.flow-step { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 12px 14px; display: flex; flex-direction: column; gap: 4px; }
.flow-no { width: 22px; height: 22px; border-radius: 50%; border: 1.5px solid var(--accent); color: var(--accent); font-size: 12px; font-family: var(--font-mono); display: flex; align-items: center; justify-content: center; }
.flow-label { font-weight: 600; }
.flow-note { font-size: 12.5px; color: var(--muted); }

/* ── 卡片（file / clip / document） ─────────────────── */
.card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px 18px; }
.card + .card { margin-top: 14px; }
.card-path { margin: 0; overflow-wrap: anywhere; font-weight: 600; }
.card-note { margin: 6px 0 0; font-size: 13px; color: var(--muted); }
.excerpt { margin: 12px 0 0; }
.excerpt summary { cursor: pointer; font-size: 13px; color: var(--muted); }
.excerpt pre { margin: 8px 0 0; padding: 14px 16px; background: var(--code-bg); color: var(--code-ink); border-radius: calc(var(--radius) / 2); overflow-x: auto; font-size: 13px; line-height: 1.6; }
.shot { margin: 14px 0 0; }
.shot img { display: block; max-width: 100%; height: auto; border-radius: calc(var(--radius) / 2); border: 1px solid var(--line); }
.shot figcaption { margin-top: 6px; font-size: 12px; color: var(--muted); }

/* ── 图集网格 ───────────────────────────────────────── */
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }
.cell { margin: 0; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; }
.cell img { display: block; width: 100%; height: auto; }
.cell figcaption { padding: 8px 12px; font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
.cell-plain { padding: 14px 16px; }
.cell-plain .kind { margin: 0 0 4px; font-size: 12px; letter-spacing: 0.14em; color: var(--accent); }
.cell-plain p { margin: 0; font-size: 13px; }

/* ── 结尾（outro） ──────────────────────────────────── */
.outro { text-align: center; padding: calc(28px * var(--space)) 0 8px; }
.outro h2 { font-family: var(--font-display); font-size: 30px; margin: 0; }
.outro-subtitle { margin: 8px 0 0; color: var(--muted); font-size: 15px; }
.outro-lines { list-style: none; margin: 18px auto 0; padding: 0; max-width: 36em; }
.outro-lines li { padding: 6px 0; border-bottom: 1px dashed var(--line); font-size: 14.5px; }
.outro-lines li:last-child { border-bottom: none; }

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
  .bar-row { grid-template-columns: 1fr auto; }
  .bar-track { grid-column: 1 / -1; order: 3; }
  .grid { grid-template-columns: 1fr 1fr; }
}
@media print {
  .hero, .toc { background: none; color: inherit; border: none; }
  .scene { break-inside: avoid; }
}`;

/* ---------------------------------------------------------------- 区块 */

function imgTag(path: string, image: PageImage): string {
  return `<img src="${escapeHtml(image.src)}" alt="${escapeHtml(path)}" loading="lazy">`;
}

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

function renderStructure(section: Extract<PageSection, { kind: 'structure' }>): string {
  const rows = section.rows
    .map((row) => {
      const meta = [`${String(row.files)} 个文件`, row.bytesLabel].filter((part) => part !== undefined).join(' · ');
      return `    <li class="bar-row${row.highlight ? ' is-highlight' : ''}">
      <span class="bar-label mono">${escapeHtml(row.path)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${barWidth(row.share).toFixed(1)}%"></span></span>
      <span class="bar-value">${escapeHtml(meta)}</span>
    </li>`;
    })
    .join('\n');
  return `  <ul class="bars">\n${rows}\n  </ul>`;
}

function renderInventory(section: Extract<PageSection, { kind: 'inventory' }>): string {
  const rows = section.rows
    .map((row) => `    <li class="bar-row">
      <span class="bar-label">${escapeHtml(row.label)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${barWidth(row.share).toFixed(1)}%"></span></span>
      <span class="bar-value">${String(row.count)} · ${percent(row.share)}</span>
      ${row.note === undefined ? '' : `<span class="bar-note">${escapeHtml(row.note)}</span>`}
    </li>`)
    .join('\n');
  return `  <ul class="bars">\n${rows}\n  </ul>\n  <p class="bars-total">共 ${String(section.total)} 个</p>`;
}

function renderFile(section: Extract<PageSection, { kind: 'file' }>, images: ReadonlyMap<string, PageImage>): string {
  const image = images.get(section.file);
  const excerpt =
    section.excerpt.length === 0
      ? ''
      : `    <details class="excerpt"${section.excerpt.length <= EXCERPT_OPEN_LINES ? ' open' : ''}>
      <summary>摘录（${String(section.excerpt.length)} 行）</summary>
      <pre><code>${escapeHtml(section.excerpt.join('\n'))}</code></pre>
    </details>`;
  return `  <div class="card">
    <p class="card-path mono">${escapeHtml(section.file)}</p>
    ${section.note === undefined ? '' : `<p class="card-note">${escapeHtml(section.note)}</p>`}
    ${image === undefined ? '' : `    <figure class="shot">${imgTag(section.file, image)}\n      <figcaption>${escapeHtml(section.file)}</figcaption>\n    </figure>`}
${excerpt}
  </div>`;
}

function renderGallery(section: Extract<PageSection, { kind: 'gallery' }>, images: ReadonlyMap<string, PageImage>): string {
  const cells = section.items
    .map((item) => {
      const image = images.get(item.path);
      if (image !== undefined) {
        return `    <figure class="cell">${imgTag(item.path, image)}\n      <figcaption class="mono">${escapeHtml(item.path)}</figcaption>\n    </figure>`;
      }
      const why = item.isImage ? '图片未能内联（原因见页脚）' : '本阶段不做转换，页面上不出画面';
      return `    <div class="cell cell-plain">
      <p class="kind">${escapeHtml(item.kindLabel)}</p>
      <p class="mono">${escapeHtml(item.path)}</p>
      <p class="muted">${why}</p>
    </div>`;
    })
    .join('\n');
  return `  <div class="grid">\n${cells}\n  </div>`;
}

function renderRefCard(section: Extract<PageSection, { kind: 'clip' } | { kind: 'document' }>): string {
  const isClip = section.kind === 'clip';
  const note = isClip
    ? `视频${section.rangeLabel === undefined ? '' : ` · 片段 ${section.rangeLabel}`} · 本阶段不转封面，页面上不出画面`
    : `${section.pagesLabel} · 本阶段不转页图，页面上不出画面`;
  return `  <div class="card">
    <p class="card-path mono">${escapeHtml(section.source)}</p>
    <p class="card-note">${escapeHtml(note)}</p>
  </div>`;
}

function renderOutro(section: Extract<PageSection, { kind: 'outro' }>): string {
  const lines =
    section.lines.length === 0
      ? ''
      : `    <ul class="outro-lines">\n${section.lines.map((line) => `      <li>${escapeHtml(line)}</li>`).join('\n')}\n    </ul>`;
  return `  <div class="outro">
    <h2>${escapeHtml(section.title)}</h2>
    ${section.subtitle === undefined ? '' : `<p class="outro-subtitle">${escapeHtml(section.subtitle)}</p>`}${lines}
  </div>`;
}

/** concept：论断单独一行大字，要点跟在下面（与视频里的大字版式同构）。 */
function renderConcept(section: Extract<PageSection, { kind: 'concept' }>): string {
  const points =
    section.points.length === 0
      ? ''
      : `    <ul class="compare-lines">\n${section.points.map((point) => `      <li>${escapeHtml(point)}</li>`).join('\n')}\n    </ul>`;
  return `    <p class="concept-statement">${escapeHtml(section.statement)}</p>${points}`;
}

/** compare：两栏并排（窄屏自动落成上下）。 */
function renderCompare(section: Extract<PageSection, { kind: 'compare' }>): string {
  const side = (data: { label: string; lines: string[] }, accent: boolean): string =>
    `    <div class="compare-side${accent ? ' is-accent' : ''}">
      <p class="compare-label">${escapeHtml(data.label)}</p>
      <ul class="compare-lines">
${data.lines.map((line) => `        <li>${escapeHtml(line)}</li>`).join('\n')}
      </ul>
    </div>`;
  return `    <div class="compare">\n${side(section.left, true)}\n${side(section.right, false)}\n    </div>`;
}

/** flow：步骤条，编号 + 步骤名 + 补充说明。 */
function renderFlow(section: Extract<PageSection, { kind: 'flow' }>): string {
  const steps = section.steps
    .map(
      (step, index) => `      <li class="flow-step">
        <span class="flow-no">${String(index + 1)}</span>
        <span class="flow-label">${escapeHtml(step.label)}</span>
        ${step.note === undefined ? '' : `<span class="flow-note">${escapeHtml(step.note)}</span>`}
      </li>`,
    )
    .join('\n');
  return `    <ol class="flow">\n${steps}\n    </ol>`;
}

function renderSection(section: PageSection, index: number, images: ReadonlyMap<string, PageImage>): string {
  // outro 不套区块外壳（自带居中版式），其余类型统一：编号 + 眉标 + 标题 + 引文 + 主体
  if (section.kind === 'outro') {
    return `<section class="scene scene-outro" id="scene-${escapeHtml(section.id)}">\n${renderOutro(section)}\n  <blockquote class="quote">${escapeHtml(section.narration)}</blockquote>\n</section>`;
  }
  if (section.kind === 'hero') {
    return renderHero(section, false);
  }
  const body =
    section.kind === 'structure'
      ? renderStructure(section)
      : section.kind === 'inventory'
        ? renderInventory(section)
        : section.kind === 'file'
          ? renderFile(section, images)
          : section.kind === 'concept'
            ? renderConcept(section)
            : section.kind === 'compare'
              ? renderCompare(section)
              : section.kind === 'flow'
                ? renderFlow(section)
                : section.kind === 'gallery'
                  ? renderGallery(section, images)
                  : renderRefCard(section);
  return `<section class="scene scene-${section.kind}" id="scene-${escapeHtml(section.id)}">
  <div class="scene-head">
    <span class="scene-no">${String(index + 1).padStart(2, '0')}</span>
    <div>
      <p class="scene-type">${KIND_LABEL[section.kind]}</p>
      <h2>${escapeHtml(section.title)}</h2>
    </div>
  </div>
${renderPoints(section)}  <blockquote class="quote">${escapeHtml(section.narration)}</blockquote>
${body}
</section>`;
}

/** 节拍要点的平铺清单（v2）：零 JS 页面没有时刻，要点按顺序排成列表。 */
function renderPoints(section: { points?: string[] }): string {
  if (section.points === undefined || section.points.length === 0) return '';
  const items = section.points.map((point) => `<li>${escapeHtml(point)}</li>`).join('');
  return `  <ul class="points">\n${items}\n  </ul>\n`;
}

/* ---------------------------------------------------------------- 页面 */

function renderToc(model: PageModel): string {
  const items = model.sections
    .filter((section) => section.kind !== 'hero')
    .map((section) => `      <li><a href="#scene-${escapeHtml(section.id)}">${escapeHtml(section.title)}</a></li>`)
    .join('\n');
  if (items === '') return '';
  return `<nav class="toc">\n  <div class="wrap">\n    <ol>\n${items}\n    </ol>\n  </div>\n</nav>`;
}

function renderColophon(input: RenderInput): string {
  const { model, images, notes, generatedAt, scriptRef } = input;
  const refs =
    model.references.length === 0
      ? ''
      : `    <details>
      <summary>引用的文件（${String(model.references.length)}）</summary>
      <ul>\n${model.references.map((ref) => `        <li><code>${escapeHtml(ref)}</code></li>`).join('\n')}\n      </ul>
    </details>`;
  const noteBlock =
    notes.length === 0
      ? ''
      : `    <div class="notes">
      <p>边界说明</p>
      <ul>\n${notes.map((note) => `        <li>${escapeHtml(note)}</li>`).join('\n')}\n      </ul>
    </div>`;
  const inlined = [...images.values()].filter((image) => image.inlined).length;
  const skipped =
    model.skipped.length === 0
      ? ''
      : `    <p class="fine">有 ${String(model.skipped.length)} 个场景的类型页面不认识，未渲染：${model.skipped.map((item) => `${escapeHtml(item.id)}（${escapeHtml(item.type)}）`).join('、')}。</p>`;
  return `<footer class="colophon">
  <div class="wrap">
    <p>本页由讲稿 <code>${escapeHtml(scriptRef)}</code> 生成（foldercast page）—— 同一份讲稿也渲染讲解视频，页面是它的文字版。</p>
    <p class="fine">${escapeHtml(model.label)}（${escapeHtml(model.sourceRoot)}）· ${String(countSections(model))} 个区块 · 图片内联 ${String(inlined)} 张 · 生成于 ${escapeHtml(generatedAt)}</p>${refs}
${noteBlock}
${skipped}    <p class="fine">自包含静态页：无 JavaScript、无外部资源；未能内联的图片按相对路径引用，转发时需连同源文件。</p>
  </div>
</footer>`;
}

/** 视图模型 → HTML 文档。 */
export function renderPage(input: RenderInput): string {
  const { model, style, images } = input;
  const vars = Object.entries(style.vars)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');
  const css = `:root {\n${vars}\n}\n${BASE_CSS}${style.extraCss === undefined ? '' : `\n${style.extraCss}`}`;

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
