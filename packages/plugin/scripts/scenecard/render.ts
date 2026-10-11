/**
 * 场景卡渲染：`SceneCard` → HTML 片段。**纯函数**：不读文件、不看时间。
 *
 * 一份标记服务两个出口（0006）：
 *
 * - **page**（`card--page`）：区块编号 + 眉标 + 引文 + 平铺要点，文档流排版；
 * - **video**（`card--video`）：960×540 基准盒（渲染层 `scale(2)` 到 1920×1080），
 *   引文不上画面（旁白在音轨与字幕条里），节拍要点在右栏。
 *
 * **节拍机制**：节拍元素带 `data-beat="i"` 与 `data-enter`；CARD_CSS 把入场写成
 * CSS 变量的函数（`opacity: var(--b3, 1)`）。**变量缺省 1**——page 没有时刻概念，
 * 全部直接可见、零 JS；视频侧由 Remotion 包装组件每帧把 `--bN` 算好设在注入容器上，
 * 变量沿 DOM 继承。没有 wall-clock、没有 CSS keyframes：同一帧号同一画面。
 * 条形图生长走独立的 `--grow` 变量（同样缺省 1）。
 */
import { barFillWidth, CARD_KIND_LABEL, escapeHtml, percent, type SceneCard } from './card.ts';

export type CardRenderOpts = {
  mode: 'page' | 'video';
  /** 场景序号（1 基）。封面与小结自带版式，不传。 */
  no?: number;
};

/* ---------------------------------------------------------------- CSS */

/** 节拍变量上限：超过 12 拍的场景（契约上不该有）按最后一拍兜底。 */
const MAX_BEATS = 12;

/** 入场规则按节拍序号生成：`enter` 决定驱动哪些属性（模型只写意图，0004）。 */
function beatRules(): string {
  const rules: string[] = [];
  for (let i = 0; i < MAX_BEATS; i += 1) {
    const v = `var(--b${String(i)}, 1)`;
    rules.push(`.scene [data-beat="${String(i)}"]{opacity:${v};}`);
    rules.push(`.scene [data-beat="${String(i)}"][data-enter="reveal"]{transform:translateY(calc((1 - ${v}) * 10px));}`);
    rules.push(`.scene [data-beat="${String(i)}"][data-enter="slide"]{transform:translateX(calc((1 - ${v}) * -22px));}`);
    rules.push(`.scene [data-beat="${String(i)}"][data-enter="grow"]{transform:scale(calc(0.96 + ${v} * 0.04));transform-origin:left center;}`);
  }
  return rules.join('\n');
}

/**
 * 场景卡样式：只写一份、只引用变量（变量清单与 page 预设一致：--bg --panel --ink
 * --muted --line --accent --accent-ink --track --code-bg --code-ink --font-display
 * --font-body --font-mono --radius --space）。布局基线是 page 的 960px 阅读宽度；
 * 视频以 2× 缩放消费同一套数值，`card--video` 只改布局模式（要点栏、基准盒、内边距）。
 */
export const CARD_CSS = `
.scene { margin: 0; }
.scene-head { display: flex; align-items: baseline; gap: 14px; border-bottom: 1px solid var(--line); padding-bottom: 10px; margin-bottom: 14px; }
.scene-no { font-family: var(--font-mono); font-size: 20px; color: var(--accent); }
.scene-type { margin: 0; font-size: 12px; letter-spacing: 0.18em; color: var(--muted); }
.scene h2 { margin: 2px 0 0; font-family: var(--font-display); font-size: 24px; line-height: 1.3; font-weight: 700; }
.quote { margin: 0 0 18px; padding: 10px 16px; border-left: 3px solid var(--accent); background: var(--panel); border-radius: 0 var(--radius) var(--radius) 0; color: var(--ink); }
.quote::before { content: "旁白 · "; font-size: 12px; letter-spacing: 0.1em; color: var(--muted); }
.points { margin: 0 0 14px; padding: 0 0 0 22px; color: var(--ink); }
.points li { margin: 4px 0; }

/* ── 正文区：page 单列文档流；video 正文 + 右侧要点栏 ── */
.scene-body { display: block; }
.card--video { width: 960px; height: 540px; overflow: hidden; box-sizing: border-box; padding: 56px 40px 104px; display: flex; flex-direction: column; }
.card--video .scene-body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 230px; gap: 26px; }
.card--video .scene-main { min-width: 0; min-height: 0; }
.card--video .scene-main .bars { max-width: 640px; }
.points-rail { display: flex; flex-direction: column; gap: 16px; justify-content: center; }
.point-group { border-left: 3px solid var(--accent); padding-left: 12px; }
.point-group ul { margin: 0; padding: 0 0 0 18px; }
.point-group li { margin: 4px 0; font-size: 13.5px; line-height: 1.55; }

/* ── 条形图（structure / inventory 共用） ──────────── */
.bars { list-style: none; margin: 0; padding: 0; }
.bar-row { display: grid; grid-template-columns: minmax(9em, 24%) 1fr auto; gap: 12px; align-items: center; padding: 7px 0; border-bottom: 1px dashed var(--line); }
.bar-row:last-child { border-bottom: none; }
.bar-label { overflow-wrap: anywhere; }
.bar-track { position: relative; height: 14px; background: var(--track); border-radius: calc(var(--radius) / 2); overflow: hidden; }
.bar-fill { position: absolute; inset: 0 auto 0 0; background: var(--accent); border-radius: calc(var(--radius) / 2); }
.bar-row.is-highlight .bar-label { color: var(--accent); font-weight: 600; }
.bar-row.is-highlight .bar-fill { background: linear-gradient(90deg, var(--accent), var(--accent-ink) 140%); }
.bar-value { white-space: nowrap; font-size: 13px; color: var(--muted); }
.bar-note { grid-column: 1 / -1; margin: -2px 0 0; font-size: 12.5px; color: var(--muted); }
.bars-total { margin: 10px 0 0; font-size: 13px; color: var(--muted); text-align: right; }

/* proportion 节拍：按占比分段的堆叠条（一条色相，透明度分档——瑞士风不撒彩虹） */
.proportion { display: flex; height: 18px; border-radius: calc(var(--radius) / 2); overflow: hidden; background: var(--track); margin-top: 12px; }
.proportion span { height: 100%; background: var(--accent); }
.card--video .proportion { height: 26px; }

/* ── 论点 / 对比 / 流程（0005 WP3） ─────────────────── */
.concept-statement { margin: 4px 0 10px; font-family: var(--font-display); font-size: 22px; font-weight: 700; line-height: 1.4; }
.card--video .concept-statement { font-size: 27px; margin-top: 8px; }
.compare { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
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
.card--video .flow-step { padding: 16px 18px; gap: 6px; }

/* ── 卡片（file / clip / document） ─────────────────── */
.card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px 18px; }
.card + .card { margin-top: 14px; }
.card-path { margin: 0; overflow-wrap: anywhere; font-weight: 600; }
.card-note { margin: 6px 0 0; font-size: 13px; color: var(--muted); }
.card-range { margin-left: 10px; font-weight: 400; font-size: 12px; color: var(--muted); }
.excerpt { margin: 12px 0 0; }
.excerpt summary { cursor: pointer; font-size: 13px; color: var(--muted); }
.excerpt pre { margin: 8px 0 0; padding: 14px 16px; background: var(--code-bg); color: var(--code-ink); border-radius: calc(var(--radius) / 2); overflow-x: auto; font-size: 13px; line-height: 1.6; }
.shot { margin: 14px 0 0; }
.shot img { display: block; max-width: 100%; height: auto; border-radius: calc(var(--radius) / 2); border: 1px solid var(--line); }
.shot figcaption { margin-top: 6px; font-size: 12px; color: var(--muted); }

/* video 的摘录面板：顶部对齐撑满（0005 WP1 的量），行号槽 + 来源区间 */
.card--video .file-panel { display: flex; flex-direction: column; min-height: 0; }
.excerpt-panel { flex: 1; min-height: 0; margin-top: 12px; display: flex; background: var(--code-bg); border-radius: calc(var(--radius) / 2); padding: 14px 16px; overflow: hidden; }
.excerpt-gutter { flex-shrink: 0; display: flex; flex-direction: column; align-items: flex-end; padding-right: 14px; margin-right: 14px; border-right: 1px solid var(--line); font-family: var(--font-mono); font-size: 12px; line-height: 1.6; color: var(--muted); }
.excerpt-code { min-width: 0; flex: 1; }
.excerpt-code pre { margin: 0; padding: 0; background: transparent; color: var(--code-ink); font-family: var(--font-mono); font-size: 13px; line-height: 1.6; overflow: hidden; }
.excerpt-code code { font-family: var(--font-mono); }
.card--video .shot img { max-height: 300px; width: auto; max-width: 100%; margin: 0 auto; }

/* Markdown 摘录（highlight.ts 产出的 fc-md 作用域），page 与 video 共用 */
.fc-md { width: 100%; overflow: hidden; }
.fc-md p { margin: 0 0 0.55em; }
.fc-md p:last-child { margin-bottom: 0; }
.fc-md h1, .fc-md h2, .fc-md h3, .fc-md h4 { font-family: var(--font-display); line-height: 1.25; margin: 0.2em 0 0.4em; }
.fc-md h1 { font-size: 1.5em; }
.fc-md h2 { font-size: 1.3em; }
.fc-md h3, .fc-md h4 { font-size: 1.12em; }
.fc-md strong { color: var(--accent); font-weight: 700; }
.fc-md em { font-style: italic; }
.fc-md code { font-family: var(--font-mono); background: var(--track); color: var(--accent); padding: 0.06em 0.35em; border-radius: 4px; }
.fc-md pre { margin: 0 0 0.55em; padding: 0.55em 0.8em; background: var(--track); border-radius: 8px; overflow: hidden; }
.fc-md pre code { background: transparent; padding: 0; color: var(--ink); }
.fc-md ul, .fc-md ol { margin: 0 0 0.55em; padding-left: 1.3em; }
.fc-md li { margin: 0.15em 0; }
.fc-md blockquote { margin: 0 0 0.55em; padding-left: 0.9em; border-left: 3px solid var(--accent); color: var(--muted); }
.fc-md a { color: var(--accent); text-decoration: none; }
.card--video .excerpt-panel .fc-md { font-size: 14px; line-height: 1.65; }

/* ── 图集网格 ───────────────────────────────────────── */
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }
.card--video .grid { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
.cell { margin: 0; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; }
.cell img { display: block; width: 100%; height: auto; }
.cell figcaption { padding: 8px 12px; font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
.cell-plain { padding: 14px 16px; }
.cell-plain .kind { margin: 0 0 4px; font-size: 12px; letter-spacing: 0.14em; color: var(--accent); }
.cell-plain p { margin: 0; font-size: 13px; }

/* video 的 clip 封面与 document 页图 */
.clip-poster { margin: 12px 0 0; text-align: center; }
.clip-poster img { max-height: 300px; max-width: 100%; border-radius: calc(var(--radius) / 2); border: 1px solid var(--line); }
.pages-row { display: flex; gap: 12px; margin-top: 12px; overflow: hidden; }
.pages-row figure { margin: 0; min-width: 0; }
.pages-row img { height: 260px; width: auto; border-radius: calc(var(--radius) / 2); border: 1px solid var(--line); display: block; }
.card--page .pages-row { flex-wrap: wrap; overflow: visible; }
.card--page .pages-row img { max-width: 100%; height: auto; max-height: 520px; }
.card--page,.card--page .scene-main,.card--page .compare-side { min-width: 0; overflow-wrap: anywhere; }
.card--page .compare { grid-template-columns: repeat(2,minmax(0,1fr)); }
.card--page .fc-md pre { overflow-x: auto; }
/* 高亮器的内联 overflow:visible 用于视频；页面的代码块必须独立滚动。 */
.card--page pre { max-width: 100%; overflow-x: auto !important; }
@media(max-width:640px) {
  .card--page .compare { grid-template-columns: minmax(0,1fr); }
  .card--page .bar-row { grid-template-columns: minmax(0,1fr) minmax(24px,1fr) auto; gap: 8px; }
  .card--page .grid { grid-template-columns: repeat(auto-fill,minmax(min(240px,100%),1fr)); }
}
.pages-row figcaption { margin-top: 4px; font-size: 11px; color: var(--muted); text-align: center; }

/* ── 封面（video）与小结 ─────────────────────────────── */
.cover-kicker { margin: 0; font-size: 13px; letter-spacing: 0.22em; color: var(--accent); }
.card--video .cover-title { margin: 14px 0 0; font-family: var(--font-display); font-size: 44px; line-height: 1.2; font-weight: 700; }
.cover-subtitle { margin: 12px 0 0; font-size: 18px; color: var(--muted); }
.cover-facts { display: flex; gap: 48px; margin-top: 40px; }
.cover-facts .fact { display: flex; flex-direction: column; gap: 6px; }
.cover-facts .fact-label { font-size: 12px; letter-spacing: 0.14em; color: var(--muted); }
.cover-facts .fact-value { font-family: var(--font-display); font-size: 22px; }
.outro { text-align: center; padding: calc(28px * var(--space)) 0 8px; }
.outro h2 { font-family: var(--font-display); font-size: 30px; margin: 0; }
.outro-subtitle { margin: 8px 0 0; color: var(--muted); font-size: 15px; }
.outro-lines { list-style: none; margin: 18px auto 0; padding: 0; max-width: 36em; }
.outro-lines li { padding: 6px 0; border-bottom: 1px dashed var(--line); font-size: 14.5px; }
.outro-lines li:last-child { border-bottom: none; }
.card--video .outro { padding: 0; }
.card--video .outro h2 { font-size: 34px; }
.card--video.card--video-outro { justify-content: center; }

/* ── 节拍入场（变量缺省 1 = 直接可见；视频侧逐帧设置） ── */
${beatRules()}
`;

/* ---------------------------------------------------------------- 区块 */

/** 摘录超过这么多行就默认折叠（page 的 `<details>` 不带 open）。 */
const EXCERPT_OPEN_LINES = 16;

function renderFlatPoints(points: string[] | undefined): string {
  if (points === undefined || points.length === 0) return '';
  const items = points.map((point) => `<li>${escapeHtml(point)}</li>`).join('');
  return `  <ul class="points">\n${items}  </ul>\n`;
}

/** 视频的节拍要点栏：每拍一组，`data-beat` 对齐字幕时刻浮现（page 无此物）。 */
function renderPointsRail(beats: SceneCard['beats']): string {
  const groups = (beats ?? [])
    .map((beat, index) => ({ beat, index }))
    .filter(({ beat }) => (beat.points ?? []).length > 0);
  if (groups.length === 0) return '';
  const html = groups.map(({ beat, index }) => {
    const items = (beat.points ?? []).map((point) => `        <li>${escapeHtml(point)}</li>`).join('\n');
    return `    <div class="point-group" data-beat="${String(index)}" data-enter="${escapeHtml(beat.enter)}">
      <ul>
${items}
      </ul>
    </div>`;
  }, '').join('\n');
  return `  <div class="points-rail">
${html}
  </div>`;
}

function renderStructure(card: Extract<SceneCard, { kind: 'structure' }>): string {
  const rows = card.rows
    .map((row) => {
      const meta = [`${String(row.files)} 个文件`, row.bytesLabel].filter((part) => part !== undefined).join(' · ');
      return `    <li class="bar-row${row.highlight ? ' is-highlight' : ''}">
      <span class="bar-label mono">${escapeHtml(row.path)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${barFillWidth(row.share)}"></span></span>
      <span class="bar-value">${escapeHtml(meta)}</span>
    </li>`;
    })
    .join('\n');
  return `<ul class="bars">\n${rows}  </ul>`;
}

function renderInventory(card: Extract<SceneCard, { kind: 'inventory' }>, opts: CardRenderOpts): string {
  const rows = card.rows
    .map((row) => `    <li class="bar-row">
      <span class="bar-label">${escapeHtml(row.label)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${barFillWidth(row.share)}"></span></span>
      <span class="bar-value">${String(row.count)} · ${percent(row.share)}</span>
      ${row.note === undefined ? '' : `<span class="bar-note">${escapeHtml(row.note)}</span>`}
    </li>`)
    .join('\n');
  // proportion 图形节拍只上视频（page 零 JS 无时刻，堆叠条直接可见没有意义…也有意义，但保持 page 现状）
  const proportionIndex = (card.beats ?? []).findIndex((beat) => beat.graphic === 'proportion');
  const proportion =
    opts.mode === 'video' && proportionIndex >= 0
      ? `<div class="proportion" data-beat="${String(proportionIndex)}" data-enter="grow">${card.rows
          .map((row, index) => `<span style="width:${Math.max(0.5, row.share * 100).toFixed(2)}%;opacity:${(0.95 - index * 0.18).toFixed(2)}"></span>`)
          .join('')}</div>`
      : '';
  return `<ul class="bars">\n${rows}  </ul>\n  <p class="bars-total">共 ${String(card.total)} 个</p>${proportion}`;
}

function renderFile(card: Extract<SceneCard, { kind: 'file' }>, opts: CardRenderOpts): string {
  const page = opts.mode === 'page';
  const notes = [card.note, card.noteMissing].filter((part) => part !== undefined).join(' · ');
  const range =
    card.excerptStart !== undefined && card.excerpt.length > 0
      ? `L${String(card.excerptStart)}–L${String(card.excerptStart + card.excerpt.length - 1)}`
      : undefined;
  const shot =
    card.shotSrc === undefined
      ? ''
      : `    <figure class="shot"><img src="${escapeHtml(card.shotSrc)}" alt="${escapeHtml(card.file)}">\n      <figcaption>${escapeHtml(card.file)}</figcaption>\n    </figure>`;

  let excerptHtml = '';
  if (card.excerpt.length > 0) {
    if (page) {
      excerptHtml = `    <details class="excerpt"${card.excerpt.length <= EXCERPT_OPEN_LINES ? ' open' : ''}>
      <summary>摘录（${String(card.excerpt.length)} 行）</summary>
      ${card.highlightHtml ?? `<pre><code>${escapeHtml(card.excerpt.join('\n'))}</code></pre>`}
    </details>`;
    } else {
      const gutter =
        card.excerptStart !== undefined && !card.highlightIsMarkdown
          ? `<div class="excerpt-gutter">${card.excerpt.map((_, index) => String(card.excerptStart! + index)).join('<br>')}</div>`
          : '';
      excerptHtml = `    <div class="excerpt-panel">
${gutter}<div class="excerpt-code">${card.highlightHtml ?? `<pre><code>${escapeHtml(card.excerpt.join('\n'))}</code></pre>`}</div>
    </div>`;
    }
  }

  return `  <div class="card file-panel">
    <p class="card-path mono">${escapeHtml(card.file)}${page || range === undefined ? '' : `<span class="card-range">${range}</span>`}</p>
    ${notes === '' ? '' : `<p class="card-note">${escapeHtml(notes)}</p>`}${shot}
${excerptHtml}  </div>`;
}

function renderConcept(card: Extract<SceneCard, { kind: 'concept' }>): string {
  const points =
    card.points.length === 0
      ? ''
      : `    <ul class="compare-lines">\n${card.points.map((point) => `      <li>${escapeHtml(point)}</li>`).join('\n')}    </ul>`;
  return `    <p class="concept-statement">${escapeHtml(card.statement)}</p>${points}`;
}

function renderCompare(card: Extract<SceneCard, { kind: 'compare' }>): string {
  const side = (data: { label: string; lines: string[] }, accent: boolean): string =>
    `    <div class="compare-side${accent ? ' is-accent' : ''}">
      <p class="compare-label">${escapeHtml(data.label)}</p>
      <ul class="compare-lines">
${data.lines.map((line) => `        <li>${escapeHtml(line)}</li>`).join('\n')}
      </ul>
    </div>`;
  return `    <div class="compare">\n${side(card.left, true)}\n${side(card.right, false)}\n    </div>`;
}

function renderFlow(card: Extract<SceneCard, { kind: 'flow' }>): string {
  const steps = card.steps
    .map(
      (step, index) => `      <li class="flow-step">
        <span class="flow-no">${String(index + 1)}</span>
        <span class="flow-label">${escapeHtml(step.label)}</span>
        ${step.note === undefined ? '' : `<span class="flow-note">${escapeHtml(step.note)}</span>`}
      </li>`,
    )
    .join('\n');
  return `    <ol class="flow">\n${steps}    </ol>`;
}

function renderGallery(card: Extract<SceneCard, { kind: 'gallery' }>): string {
  const cells = card.items
    .map((item) => {
      if (item.src !== undefined) {
        return `    <figure class="cell"><img src="${escapeHtml(item.src)}" alt="${escapeHtml(item.path)}">\n      <figcaption class="mono">${escapeHtml(item.path)}</figcaption>\n    </figure>`;
      }
      return `    <div class="cell cell-plain">
      <p class="kind">${escapeHtml(item.kindLabel)}</p>
      <p class="mono">${escapeHtml(item.path)}</p>
      ${item.fallbackNote === undefined ? '' : `<p class="muted">${escapeHtml(item.fallbackNote)}</p>`}
    </div>`;
    })
    .join('\n');
  return `  <div class="grid">\n${cells}  </div>`;
}

function renderClip(card: Extract<SceneCard, { kind: 'clip' }>, opts: CardRenderOpts): string {
  if (card.posterSrc !== undefined) {
    return `  <div class="card">
    <p class="card-path mono">${escapeHtml(card.source)}</p>
    <p class="card-note">视频${card.rangeLabel === undefined ? '' : ` · 片段 ${escapeHtml(card.rangeLabel)}`}</p>
    <figure class="clip-poster"><img src="${escapeHtml(card.posterSrc)}" alt="${escapeHtml(card.source)}"></figure>
  </div>`;
  }
  const note = `视频${card.rangeLabel === undefined ? '' : ` · 片段 ${escapeHtml(card.rangeLabel)}`} · 没有可用封面${opts.mode === 'page' ? '，原因见页脚' : ''}`;
  return `  <div class="card">
    <p class="card-path mono">${escapeHtml(card.source)}</p>
    <p class="card-note">${note}</p>
  </div>`;
}

function renderDocument(card: Extract<SceneCard, { kind: 'document' }>, opts: CardRenderOpts): string {
  if ((card.pages ?? []).length > 0) {
    const figures = (card.pages ?? [])
      .map((page) => `    <figure><img src="${escapeHtml(page.src)}" alt="${escapeHtml(card.source)}"></figure>`)
      .join('\n');
    return `  <div class="card">
    <p class="card-path mono">${escapeHtml(card.source)}</p>
    <p class="card-note">${escapeHtml(card.pagesLabel)}</p>
  <div class="pages-row">\n${figures}  </div>
  </div>`;
  }
  return `  <div class="card">
    <p class="card-path mono">${escapeHtml(card.source)}</p>
    <p class="card-note">${escapeHtml(card.pagesLabel)} · 没有可用页图${opts.mode === 'page' ? '，原因见页脚' : ''}</p>
  </div>`;
}

function renderOutro(card: Extract<SceneCard, { kind: 'outro' }>, opts: CardRenderOpts): string {
  const lines =
    card.lines.length === 0
      ? ''
      : `    <ul class="outro-lines">\n${card.lines.map((line) => `      <li>${escapeHtml(line)}</li>`).join('\n')}    </ul>`;
  const quote = opts.mode === 'page' ? `  <blockquote class="quote">${escapeHtml(card.narration)}</blockquote>` : '';
  return `<section class="scene scene-outro card--${opts.mode} card--video-outro" id="scene-${escapeHtml(card.id)}">
  <div class="outro">
    <h2>${escapeHtml(card.title)}</h2>
    ${card.subtitle === undefined ? '' : `<p class="outro-subtitle">${escapeHtml(card.subtitle)}</p>`}${lines}
  </div>
${quote}</section>`;
}

/** 封面卡（video）：kicker + 大标题 + 副题 + 事实行——瑞士风的扉页。 */
function renderCover(card: Extract<SceneCard, { kind: 'cover' }>, opts: CardRenderOpts): string {
  const facts = card.facts
    .map(
      (fact) => `    <div class="fact">
      <span class="fact-label">${escapeHtml(fact.label)}</span>
      <span class="fact-value">${escapeHtml(fact.value)}</span>
    </div>`,
    )
    .join('\n');
  return `<section class="scene scene-cover card--${opts.mode}" id="scene-${escapeHtml(card.id)}" style="justify-content:center">
  <p class="cover-kicker">${escapeHtml(card.label)}</p>
  <h1 class="cover-title">${escapeHtml(card.title)}</h1>
  ${card.subtitle === undefined ? '' : `<p class="cover-subtitle">${escapeHtml(card.subtitle)}</p>`}
  <div class="cover-facts">\n${facts}  </div>
</section>`;
}

/** 场景卡 → HTML 片段。封面与小结自带版式；其余：编号头 + （page：要点与引文）+ 正文。 */
export function renderSceneCard(card: SceneCard, opts: CardRenderOpts): string {
  if (card.kind === 'cover') return renderCover(card, opts);
  if (card.kind === 'outro') return renderOutro(card, opts);

  const page = opts.mode === 'page';
  const body =
    card.kind === 'structure'
      ? renderStructure(card)
      : card.kind === 'inventory'
        ? renderInventory(card, opts)
        : card.kind === 'file'
          ? renderFile(card, opts)
          : card.kind === 'concept'
            ? renderConcept(card)
            : card.kind === 'compare'
              ? renderCompare(card)
              : card.kind === 'flow'
                ? renderFlow(card)
                : card.kind === 'gallery'
                  ? renderGallery(card)
                  : card.kind === 'clip'
                    ? renderClip(card, opts)
                    : renderDocument(card, opts);

  const no = opts.no === undefined ? '' : String(opts.no).padStart(2, '0');
  const head = `
  <div class="scene-head">
    <span class="scene-no">${no}</span>
    <div>
      <p class="scene-type">${CARD_KIND_LABEL[card.kind]}</p>
      <h2>${escapeHtml(card.title)}</h2>
    </div>
  </div>`;
  // page：要点平铺在引文前；concept 的 `points` 是区块内容（由正文画），不平铺避免画两遍
  const points = page && card.kind !== 'concept' ? renderFlatPoints(card.points) : '';
  const quote = page ? `  <blockquote class="quote">${escapeHtml(card.narration)}</blockquote>\n` : '';
  const rail = page ? '' : renderPointsRail(card.beats);

  return `<section class="scene scene-${card.kind} card--${opts.mode}" id="scene-${escapeHtml(card.id)}">${head}
${points}${quote}  <div class="scene-body">
    <div class="scene-main">
${body}
    </div>${rail === '' ? '' : `\n${rail}`}  </div>
</section>`;
}
