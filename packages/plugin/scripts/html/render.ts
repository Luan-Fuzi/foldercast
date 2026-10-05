/**
 * 渲染：视图模型 → 一个自包含的 HTML 文件。
 *
 * **纯函数**：不读文件、不跑命令、不看时间。图片由调用方先解析成 `src`（内联的 data URI 或
 * 相对路径）传进来，所以这一层可以直接拿夹具断言。
 *
 * 三条硬约束（ROADMAP M6）：
 *
 * 1. **无外部依赖**：CSS 内联、不引 CDN 字体、**一行 JavaScript 都没有**（折叠用 `<details>`，
 *    悬浮提示用 CSS）。图片要么内联，要么是工作根下的相对路径。
 * 2. **顺序确定**：视图模型已经排好序，这里只负责画，不再排序。
 * 3. **边界写清楚**：页面必须自己说明「收录了几个文件、排除了什么、密钥文件没读过」——
 *    解读是抽样，页面不能假装它是全部。
 */
import type { FileCard, TreeNode, ViewModel } from './collect.ts';

export type RenderOptions = {
  /** 素材路径（相对工作根）→ 可用的 `src`。缺席的图片不画，不留破图。 */
  images: ReadonlyMap<string, string>;
  /** 生成过程中要说给用户的话（图片没内联、图被截断等），写在页脚。 */
  notes: readonly string[];
  /** 页面生成时间。**由调用方传入**：渲染是纯函数，自己不取当前时间，否则同一份解读两次渲染不一致。 */
  pageGeneratedAt: string;
};

const KIND_LABEL: Record<string, string> = {
  code: '代码',
  text: '文本',
  markup: '标记',
  data: '数据',
  office: 'Office',
  pdf: 'PDF',
  image: '图片',
  video: '视频',
  audio: '音频',
  archive: '压缩包',
  binary: '二进制',
  other: '其他',
};

const ROLE_LABEL: Record<string, string> = {
  readme: '说明',
  // 角色 `entry` 与依赖图的「入口」是两回事（一个说文件类型，一个说图上的位置），
  // 标签不能撞车：`package.json` 既是 entry 又是 roots，撞起来会显示成「入口 入口」
  entry: '主入口',
  config: '配置',
  test: '测试',
  doc: '文档',
  asset: '素材',
  license: '许可证',
  build: '构建',
};

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

/** 字节数：给人看的写法，保留一位小数。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 百分比：整数就写整数，否则一位小数。 */
function percent(value: number): string {
  const scaled = value * 100;
  const text = Number.isInteger(scaled) ? String(scaled) : scaled.toFixed(1);
  return `${text}%`;
}

function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role;
}

const CSS = `
:root {
  --bg: #FBFAF7;
  --panel: #FFFFFF;
  --ink: #1A1A18;
  --muted: #6E6A63;
  --line: #E2DED5;
  --accent: #B4472A;
  --root: #1F6F4A;
  --hub: #A9751B;
  --secret: #8A2B2B;
  --radius: 8px;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: -apple-system, "PingFang SC", "Helvetica Neue", "Microsoft YaHei", sans-serif;
  font-size: 15px;
  line-height: 1.65;
}
code, .mono { font-family: "SF Mono", Menlo, Consolas, "PingFang SC", monospace; font-size: 0.92em; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
.wrap { max-width: 1080px; margin: 0 auto; padding: 0 24px 96px; }

header.top { background: var(--ink); color: #F5F3EE; padding: 40px 0 28px; margin-bottom: 28px; }
header.top .wrap { padding-bottom: 0; }
.kicker { margin: 0 0 8px; font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; color: #B9B4AA; }
header.top h1 { margin: 0; font-size: 30px; line-height: 1.25; }
header.top .root { margin: 6px 0 18px; color: #B9B4AA; word-break: break-all; }
.facts { display: flex; flex-wrap: wrap; gap: 28px; margin: 0; padding: 0; list-style: none; }
.facts b { display: block; font-size: 20px; font-weight: 600; }
.facts span { font-size: 12px; color: #B9B4AA; }
nav.toc { position: sticky; top: 0; z-index: 5; background: rgba(251,250,247,0.94); border-bottom: 1px solid var(--line); padding: 10px 0; margin-bottom: 28px; backdrop-filter: blur(6px); }
nav.toc ul { display: flex; flex-wrap: wrap; gap: 18px; margin: 0; padding: 0; list-style: none; font-size: 13px; }
nav.toc a { color: var(--muted); }
section { margin-bottom: 44px; }
h2 { font-size: 19px; margin: 0 0 4px; }
h2 .count { color: var(--muted); font-weight: 400; font-size: 14px; margin-left: 8px; }
.lead { color: var(--muted); margin: 0 0 18px; font-size: 13px; }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 18px 20px; }
.grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
.bar { height: 8px; border-radius: 4px; background: var(--accent); min-width: 2px; }
.bar.alt { background: var(--hub); }
.row { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; }
.row .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row .value { color: var(--muted); font-variant-numeric: tabular-nums; font-size: 13px; }
.track { background: #EFEBE3; border-radius: 4px; overflow: hidden; }
dl.plain { margin: 0; }
dl.plain div { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; border-bottom: 1px dashed var(--line); }
dl.plain div:last-child { border-bottom: 0; }
dl.plain dt { color: var(--muted); font-size: 13px; margin: 0; }
dl.plain dd { margin: 0; font-variant-numeric: tabular-nums; }

ul.tree, ul.tree ul { list-style: none; margin: 0; padding-left: 18px; }
ul.tree { padding-left: 0; }
ul.tree details > summary { cursor: pointer; padding: 2px 0; }
ul.tree summary::marker { color: var(--muted); }
.node { display: flex; align-items: baseline; gap: 8px; padding: 2px 0; }
.node .path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.node .size { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.empty-dir { color: var(--muted); font-size: 12px; }

.badge { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 11px; line-height: 1.7; border: 1px solid var(--line); color: var(--muted); white-space: nowrap; }
.badge.root { border-color: var(--root); color: var(--root); }
.badge.hub { border-color: var(--hub); color: var(--hub); }
.badge.secret { border-color: var(--secret); color: var(--secret); }
.badge.kind { background: #F4F1EA; }

figure.graph { margin: 0; }
figure.graph svg { width: 100%; height: auto; display: block; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); }
.legend { margin: 14px 0 0; padding: 0; list-style: none; columns: 2; column-gap: 24px; font-size: 13px; }
.legend li { break-inside: avoid; padding: 2px 0; }
.legend .idx { display: inline-block; min-width: 26px; color: var(--muted); font-variant-numeric: tabular-nums; }

article.card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px 16px; margin-bottom: 12px; }
article.card.compact { padding: 6px 14px; margin-bottom: 5px; }
article.card.compact .card-head { margin-bottom: 0; flex-wrap: nowrap; align-items: baseline; }
article.card.compact h3 { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 500; }
article.card.compact .card-meta { margin: 0; white-space: nowrap; }
article.card:target { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(180,71,42,0.12); }
article.card h3 { margin: 0 0 6px; font-size: 14px; font-weight: 600; word-break: break-all; }
.card-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; margin-bottom: 8px; }
.card-body { display: flex; gap: 16px; align-items: flex-start; }
.card-body .text { flex: 1; min-width: 0; }
.card-body img { max-width: 260px; max-height: 200px; border: 1px solid var(--line); border-radius: 4px; background: #fff; }
figure.thumb { margin: 0; text-align: right; }
figure.thumb figcaption { font-size: 11px; color: var(--muted); margin-top: 4px; }
figure.thumb a { display: inline-block; }
figure.thumb.wide { flex: 1 1 100%; text-align: left; }
figure.thumb.wide img { max-width: 100%; max-height: 460px; }
.card-title { font-weight: 600; margin: 0 0 4px; }
.card-preview { margin: 0; color: #4A4741; font-size: 13px; white-space: pre-wrap; word-break: break-word; }
.card-meta { margin: 8px 0 0; color: var(--muted); font-size: 12px; display: flex; flex-wrap: wrap; gap: 14px; }
.card-links { margin: 6px 0 0; font-size: 12px; color: var(--muted); }
.card-links ul { margin: 2px 0 0; padding-left: 18px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 600; font-size: 12px; }
.note { background: #FFF8EC; border: 1px solid #EAD9B8; border-radius: var(--radius); padding: 12px 16px; font-size: 13px; color: #6A5424; }
.note ul { margin: 6px 0 0; padding-left: 18px; }
footer.end { border-top: 1px solid var(--line); margin-top: 40px; padding-top: 18px; color: var(--muted); font-size: 12px; }
@media print {
  nav.toc { display: none; }
  header.top { background: none; color: var(--ink); }
  header.top .kicker, header.top .root, .facts span { color: var(--muted); }
  article.card, figure.graph svg, .panel { break-inside: avoid; }
}
`;

function badge(text: string, className = ''): string {
  return `<span class="badge${className === '' ? '' : ` ${className}`}">${escapeHtml(text)}</span>`;
}

function row(name: string, value: string, shareValue: number, alt = false): string {
  return [
    '<div class="row">',
    `<span class="name">${escapeHtml(name)}</span>`,
    `<span class="value">${escapeHtml(value)}</span>`,
    '</div>',
    `<div class="track"><div class="bar${alt ? ' alt' : ''}" style="width:${(Math.max(shareValue, 0.01) * 100).toFixed(2)}%"></div></div>`,
  ].join('');
}

/** 树上要标的三种身份：入口、枢纽、密钥。一次算好，递归时不再重建集合。 */
type TreeMarks = { roots: Set<string>; hubs: Set<string>; secrets: Map<string, string> };

function renderTree(node: TreeNode, model: ViewModel, marks: TreeMarks, depth: number): string {
  const children = node.children
    .map((child) => {
      const secret = marks.secrets.get(child.path);
      const badges = [
        marks.roots.has(child.path) ? badge('入口', 'root') : '',
        marks.hubs.has(child.path) ? badge('枢纽', 'hub') : '',
        secret === undefined ? '' : badge(`密钥（命中 ${secret}）`, 'secret'),
      ]
        .filter((item) => item !== '')
        .join('');

      if (child.kind === 'file') {
        const size = child.bytes > 0 ? ` ${formatBytes(child.bytes)}` : '';
        return [
          '<li>',
          `<div class="node"><a class="path mono" href="#${escapeHtml(anchorOf(child.path, model))}">${escapeHtml(child.name)}</a>`,
          badges,
          `<span class="size">${escapeHtml(size.trim())}</span></div>`,
          '</li>',
        ].join('');
      }

      const open = depth <= 1 ? ' open' : '';
      return [
        '<li>',
        `<details${open}><summary><span class="node"><span class="path mono">${escapeHtml(child.name)}/</span>`,
        badges,
        `<span class="size">${String(child.files)} 个文件 · ${formatBytes(child.bytes)}</span></span></summary>`,
        `<ul>${renderTree(child, model, marks, depth + 1)}</ul>`,
        '</details>',
        '</li>',
      ].join('');
    })
    .join('');

  return children;
}

/**
 * 链接到某个文件的锚点。
 *
 * 优先用视图模型里的表（唯一、且与卡片一致）；清单外的路径（坏引用）落不到表里，
 * 就退回化简式 —— 那种链接指不到卡片，但至少是可读的。
 */
function anchorOf(path: string, model: ViewModel): string {
  return model.anchors.get(path) ?? `f-${path.replace(/[^A-Za-z0-9._-]+/g, '-')}`;
}

function renderGraph(model: ViewModel): string {
  const { nodes, edges, omitted } = model.graph;
  if (nodes.length === 0) {
    return [
      '<div class="panel">',
      '<p class="lead" style="margin:0">这份解读里没有文件间的引用关系（`import` / Markdown 链接 / 文件名引用都没有命中）。',
      '资料型目录常常是这样 —— 它们按主题组织，不靠引用组织。</p>',
      '</div>',
    ].join('');
  }

  // 点不多时把文件名写进图里（只写名字，路径在图例里）；点多时只写编号，靠图例对照
  const labelled = nodes.length <= 24;
  const colWidth = labelled ? 240 : 170;
  const rowHeight = 30;
  const padX = 40;
  const padY = 30;
  const radius = 8;
  const maxRow = Math.max(...nodes.map((node) => node.row));
  const maxLayer = Math.max(...nodes.map((node) => node.layer));
  const width = padX * 2 + maxLayer * colWidth;
  const height = padY * 2 + maxRow * rowHeight;
  const position = new Map(
    nodes.map((node) => [node.index, { x: padX + node.layer * colWidth, y: padY + node.row * rowHeight }]),
  );

  const lines = edges
    .map((edge) => {
      const from = position.get(edge.from);
      const to = position.get(edge.to);
      if (from === undefined || to === undefined) return '';
      return `<line x1="${String(from.x + radius)}" y1="${String(from.y)}" x2="${String(to.x - radius)}" y2="${String(to.y)}" stroke="#D9D4C8" stroke-width="1" marker-end="url(#arrow)"/>`;
    })
    .join('');

  const circles = nodes
    .map((node) => {
      const at = position.get(node.index);
      if (at === undefined) return '';
      const fill = node.mark === 'root' ? '#1F6F4A' : node.mark === 'hub' ? '#A9751B' : '#8C877D';
      const ring = node.mark === 'root' || node.mark === 'hub' ? ` stroke="#FBFAF7" stroke-width="2"` : '';
      const label = node.path.split('/').pop() ?? node.path;
      return [
        `<g><circle cx="${String(at.x)}" cy="${String(at.y)}" r="${String(radius)}" fill="${fill}"${ring}/>`,
        `<text x="${String(at.x)}" y="${String(at.y + 3.5)}" text-anchor="middle" font-size="9" fill="#FFFFFF" font-family="monospace">${String(node.index)}</text>`,
        labelled
          ? `<text x="${String(at.x + radius + 6)}" y="${String(at.y + 3.5)}" font-size="10" fill="#4A4741" font-family="monospace">${escapeHtml(label)}</text>`
          : '',
        '</g>',
      ].join('');
    })
    .join('');

  const legend = nodes
    .map((node) => {
      const marks = [
        node.mark === 'root' ? badge('入口', 'root') : '',
        node.mark === 'hub' ? badge(`枢纽 入${String(node.inDegree)}`, 'hub') : '',
      ]
        .filter((item) => item !== '')
        .join(' ');
      return [
        '<li>',
        `<span class="idx">${String(node.index)}</span>`,
        `<a class="mono" href="#${escapeHtml(anchorOf(node.path, model))}">${escapeHtml(node.path)}</a> `,
        marks,
        `</li>`,
      ].join('');
    })
    .join('');

  return [
    '<figure class="graph">',
    `<svg viewBox="0 0 ${String(width)} ${String(height)}" role="img" aria-label="引用依赖图">`,
    '<defs><marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">',
    '<path d="M0,0 L8,4 L0,8 z" fill="#D9D4C8"/></marker></defs>',
    lines,
    circles,
    '</svg>',
    `<figcaption class="lead" style="margin-top:10px">箭头指向被引用的文件；横轴是依赖层次（越靠左越接近入口），纵轴只是排布。`,
    omitted > 0 ? `连接最多的 ${String(nodes.length)} 个文件画在这里，另有 ${String(omitted)} 个未画出。` : '',
    '</figcaption>',
    '</figure>',
    '<ul class="legend">',
    legend,
    '</ul>',
  ].join('');
}

function renderCard(card: FileCard, model: ViewModel, images: ReadonlyMap<string, string>): string {
  const marks = [
    card.mark === 'root' ? badge('入口', 'root') : '',
    card.mark === 'hub' ? badge(`枢纽 入${String(card.inDegree ?? 0)}`, 'hub') : '',
    card.secret !== undefined ? badge(`密钥（命中判据 ${card.secret}）`, 'secret') : '',
  ]
    .filter((item) => item !== '')
    .join(' ');

  const meta: string[] = [];
  if (card.bytes !== undefined && card.bytes > 0) meta.push(formatBytes(card.bytes));
  if (card.lines !== undefined) meta.push(`${String(card.lines)} 行`);
  if (card.pageCount !== undefined) meta.push(`${String(card.pageCount)} 页`);
  if (card.language !== undefined) meta.push(card.language);
  const importedByTotal = card.importedByCount ?? card.importedBy.length;
  const importsTotal = card.importsCount ?? card.imports.length;
  if (importsTotal > 0) meta.push(importsTotal > card.imports.length ? `引用 ${String(importsTotal)}（清单列 ${String(card.imports.length)} 条）` : `引用 ${String(importsTotal)}`);
  if (importedByTotal > 0) {
    meta.push(
      importedByTotal > card.importedBy.length
        ? `被引用 ${String(importedByTotal)}（清单列 ${String(card.importedBy.length)} 条）`
        : `被引用 ${String(importedByTotal)}`,
    );
  }
  if (card.mtimeMs !== undefined) meta.push(formatTime(card.mtimeMs));

  const image = card.asset === undefined ? undefined : images.get(card.asset.path);
  // 源码高亮图（SVG）在 260px 下读不了：让它铺满卡片，并且可以点开看原尺寸。
  // **只给这一类加链接** —— raster 缩略图的 data URI 再写一遍会让页面体积翻倍（实测 1.5 → 3 MB）
  const zoomable = card.asset?.role === 'code';
  const img =
    image === undefined
      ? ''
      : [
          `<figure class="thumb${zoomable ? ' wide' : ''}">`,
          zoomable ? `<a href="${escapeHtml(image)}" target="_blank" rel="noopener">` : '',
          `<img src="${escapeHtml(image)}" alt="${escapeHtml(card.path)}" loading="lazy">`,
          zoomable ? '</a>' : '',
          card.pageCount === undefined || card.pageCount <= 1
            ? ''
            : `<figcaption>只画了第 1 页（共 ${String(card.pageCount)} 页）</figcaption>`,
          '</figure>',
        ].join('');

  const links: string[] = [];
  if (card.imports.length > 0) {
    links.push(
      `<div class="card-links">引用：${card.imports
        .map((path) => `<a class="mono" href="#${escapeHtml(anchorOf(path, model))}">${escapeHtml(path)}</a>`)
        .join('、')}</div>`,
    );
  }
  if (card.importedBy.length > 0) {
    links.push(
      `<div class="card-links">被引用：${card.importedBy
        .map((path) => `<a class="mono" href="#${escapeHtml(anchorOf(path, model))}">${escapeHtml(path)}</a>`)
        .join('、')}</div>`,
    );
  }
  if (card.assetError !== undefined) {
    links.push(`<div class="card-links">素材失败：${escapeHtml(card.assetError)}</div>`);
  }
  if (card.duplicateOf !== undefined) {
    links.push(
      `<div class="card-links">内容与 <a class="mono" href="#${escapeHtml(anchorOf(card.duplicateOf, model))}">${escapeHtml(card.duplicateOf)}</a> 完全相同（同一个 sha256）</div>`,
    );
  }

  // 标题与摘要常常是同一句（分析器两边都写），重复显示等于浪费一行
  const title = card.title !== undefined && card.title !== card.preview ? card.title : undefined;
  const body =
    card.secret !== undefined
      ? '<p class="card-preview">内容没有被读过 —— 只按文件名命中密钥判据，所以这里没有摘要与缩略图。</p>'
      : [
          title === undefined ? '' : `<p class="card-title">${escapeHtml(title)}</p>`,
          card.preview === undefined ? '' : `<p class="card-preview">${escapeHtml(card.preview)}</p>`,
          card.textPreview === undefined
            ? ''
            : `<p class="card-preview"><span class="lead">提取文本</span> ${escapeHtml(card.textPreview)}</p>`,
        ].join('');

  const metaLine = meta.length === 0 ? '' : `<p class="card-meta">${escapeHtml(meta.join(' · '))}</p>`;

  const head = [
    '<div class="card-head">',
    `<h3><a href="#${escapeHtml(card.anchor)}"><span class="mono">${escapeHtml(card.path)}</span></a></h3>`,
    badge(kindLabel(card.kind), 'kind'),
    card.role === undefined ? '' : badge(roleLabel(card.role), 'kind'),
    marks,
    '</div>',
  ].join('');

  // 没有摘要、没有配图、也没出错的文件（音频、二进制这类）走紧凑一行：
  // 它们在结构树里已经出现过，再铺几十个空卡片只会把页面拉长
  if (body === '' && img === '' && links.length === 0 && card.assetError === undefined) {
    return [
      `<article class="card compact" id="${escapeHtml(card.anchor)}">`,
      head.replace('</div>', `${meta.length === 0 ? '' : `<span class="card-meta">${escapeHtml(meta.join(' · '))}</span>`}</div>`),
      '</article>',
    ].join('');
  }

  return [
    `<article class="card" id="${escapeHtml(card.anchor)}">`,
    head,
    '<div class="card-body">',
    `<div class="text">${body}`,
    metaLine,
    links.join(''),
    '</div>',
    img,
    '</div>',
    '</article>',
  ].join('');
}

/**
 * 这张卡片有没有值得单独看的东西。
 *
 * 导出是为了让 CLI 报告里说的是**实际列出来的**卡片数，而不是清单条数。
 */
export function hasSomethingToShow(card: FileCard, images: ReadonlyMap<string, string>): boolean {
  if (card.title !== undefined || card.preview !== undefined || card.textPreview !== undefined) return true;
  if (card.duplicateOf !== undefined) return true;
  if (card.assetError !== undefined) return true;
  if (card.mark !== 'none' || card.secret !== undefined) return true;
  // 引用关系本身就是内容：入口与枢纽的价值有一半在这些链接上，不能因为「没有摘要」就丢掉
  if (card.imports.length > 0 || card.importedBy.length > 0) return true;
  return card.asset !== undefined && images.has(card.asset.path);
}

/**
 * 枢纽分两档。
 *
 * 解读的 `hubs` 是「被引用最多的前若干个」，入度 1 的也会进来 —— 一屏全是「被 1 个文件引用」
 * 等于没有区分度。分档之后，真正的中枢与「只被引用一次」的文件一眼分得开。
 */
function hubTiers(model: ViewModel): string {
  const strong = model.hubs.filter((hub) => hub.in >= 2);
  const weak = model.hubs.filter((hub) => hub.in < 2);
  const item = (path: string, inDegree: number): string =>
    `<li><a class="mono" href="#${escapeHtml(anchorOf(path, model))}">${escapeHtml(path)}</a> <span class="value">被 ${String(inDegree)} 个文件引用</span></li>`;

  const parts: string[] = [];
  if (strong.length > 0) {
    parts.push(
      `<p class="lead" style="margin:0 0 4px">被两个以上文件引用 · ${String(strong.length)} 个</p>`,
      `<ul style="margin:0 0 12px;padding-left:18px">${strong.slice(0, 20).map((hub) => item(hub.path, hub.in)).join('')}`,
      `${strong.length > 20 ? `<li class="lead">…另有 ${String(strong.length - 20)} 个</li>` : ''}</ul>`,
    );
  }
  if (weak.length > 0) {
    parts.push(
      `<details><summary class="lead">枢纽榜里只被引用一次 · ${String(weak.length)} 个</summary>`,
      `<ul style="margin:6px 0 0;padding-left:18px">${weak.slice(0, 40).map((hub) => item(hub.path, hub.in)).join('')}`,
      `${weak.length > 40 ? `<li class="lead">…另有 ${String(weak.length - 40)} 个</li>` : ''}</ul></details>`,
    );
  }
  return parts.join('');
}

/**
 * 时间：统一写成「本地时间 + 偏移」。
 *
 * 解读的 `generatedAt` 是 ISO 串，页面的生成时间也是 —— 两种格式并排会让人以为差了几小时
 * （读者反馈过），所以这里统一格式化。
 */
export function formatTime(value: string | number): string {
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (input: number): string => String(input).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset < 0 ? '-' : '+';
  const absolute = Math.abs(offset);
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

/** 被筛掉的文件举几个例子，别让读者猜「为什么少了一个」。 */
function hiddenExamples(model: ViewModel, images: ReadonlyMap<string, string>, take = 3): string {
  const hidden = model.cards.filter((card) => !hasSomethingToShow(card, images)).map((card) => card.path);
  if (hidden.length === 0) return '';
  const shown = hidden.slice(0, take).join('、');
  return hidden.length > take ? `${shown} 等` : shown;
}

/** 生成整个页面。 */
export function renderPage(model: ViewModel, options: RenderOptions): string {
  const marks: TreeMarks = {
    roots: new Set(model.roots),
    hubs: new Set(model.hubs.map((hub) => hub.path)),
    secrets: new Map(model.secrets.excluded.map((hit) => [hit.path, hit.match])),
  };

  const secretsNote =
    model.secrets.excluded.length === 0
      ? '<p class="lead" style="margin:0">这次解读没有排除任何密钥类文件（只按文件名匹配，没有命中）。</p>'
      : [
          '<table><thead><tr><th>文件</th><th>命中的判据</th></tr></thead><tbody>',
          model.secrets.excluded
            .map(
              (hit) =>
                `<tr><td class="mono">${escapeHtml(hit.path)}</td><td class="mono">${escapeHtml(hit.match)}</td></tr>`,
            )
            .join(''),
          '</tbody></table>',
        ].join('');

  const truncated = model.stats.totalFiles >= model.stats.maxFiles;
  const boundary: string[] = [
    `这份解读收录了 <b>${String(model.stats.totalFiles)}</b> 个文件${
      truncated
        ? `（按重要性截断到 ${String(model.stats.maxFiles)} 个 —— 分析器按 角色 → 类型 → 路径深度 → 路径 排序后取前 N 个；密钥类文件不占这个配额，所以清单可能比它多几条。**它不是整个目录**）`
        : `（没有触发 ${String(model.stats.maxFiles)} 个的截断上限，但下面那些路径没有走查）`
    }。`,
    `走查时排除了 <b>${String(model.stats.excluded)}</b> 类路径 —— 它们下面的文件不会出现在页面上（构建产物、依赖、版本库等都在其中）：` +
      `<details><summary>看排除清单</summary><ul>${model.excludedPatterns
        .map((pattern) => `<li class="mono">${escapeHtml(pattern)}</li>`)
        .join('')}</ul></details>`,
    '密钥类文件只按文件名匹配（不可能完备）：命中的文件只进结构树与计数，<b>内容没有被读过</b>，也没有摘要与缩略图。',
    '解读对每个文件记录的引用列表有上限，所以卡片上的「引用 / 被引用」清单可能不是全部；卡片正文里的「标题」也是分析器从内容里提取的（首个标题或首段），不是文件名，也不保证是作者写的标题。',
    '代码高亮图只画文件开头若干行，不是整个文件；要看全文请打开源文件。',
  ];
  if (model.dangling.length > 0) {
    boundary.push(`有 ${String(model.dangling.length)} 个引用指向清单外的路径（坏引用或已截断），已在文件卡片里如实标出。`);
  }

  const notes = options.notes.length === 0 ? '' : `<div class="note">渲染说明<ul>${options.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul></div>`;

  // 只给「有东西可看」的文件列卡片：摘要、配图、特殊身份（入口/枢纽/密钥）、素材出错。
  // 剩下的（大量音频、二进制）在结构树里已经有，重复铺一遍只会把页面拉长
  const shown = model.cards.filter((card) => hasSomethingToShow(card, options.images));
  const hidden = model.cards.length - shown.length;

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>目录放映 · ${escapeHtml(model.label)}</title>
<style>${CSS}</style>
</head>
<body>
<header class="top">
  <div class="wrap">
    <p class="kicker">目录放映 · 解读视图</p>
    <h1>${escapeHtml(model.label)}</h1>
    <p class="root mono">${escapeHtml(model.root)}</p>
    <ul class="facts">
      <li><b>${String(model.stats.totalFiles)}</b><span>收录文件</span></li>
      <li><b>${formatBytes(model.stats.totalBytes)}</b><span>合计</span></li>
      <li><b>${String(model.stats.maxDepth)}</b><span>最大深度</span></li>
      <li><b>${String(model.roots.length)}</b><span>图入口</span></li>
      <li><b>${String(model.hubs.length)}</b><span>枢纽</span></li>
      <li><b>${String(model.graph.summary.totalEdges)}</b><span>引用边（解读记录）</span></li>
    </ul>
  </div>
</header>

<nav class="toc"><div class="wrap"><ul>
  <li><a href="#overview">内容盘点</a></li>
  <li><a href="#tree">结构树</a></li>
  <li><a href="#marks">入口与枢纽</a></li>
  <li><a href="#graph">依赖图</a></li>
  <li><a href="#files">文件卡片</a></li>
  <li><a href="#secrets">密钥审计</a></li>
  <li><a href="#boundary">这份解读的边界</a></li>
</ul></div></nav>

<div class="wrap">
  <p class="lead" style="margin:-8px 0 28px">
    这一页是「目录解读」的视图。解读由 foldercast 程序遍历目录得出 —— 有什么文件、怎么组织、谁引用谁、
    哪些是入口与枢纽；下面的数字与清单都来自它，不是估计。它是<b>抽样</b>：收录范围与排除规则见
    文末「这份解读的边界」。
  </p>

  <section id="overview">
    <h2>内容盘点</h2>
    <p class="lead">数字来自解读的 <span class="mono">stats</span>，由程序统计。</p>
    <div class="grid">
      <div class="panel">
        <h3 style="margin:0 0 10px;font-size:14px">按类型</h3>
        ${model.kinds
          .map((item) =>
            row(`${kindLabel(item.kind)}（${item.kind}）`, `${String(item.count)} · ${percent(item.share)}`, item.share),
          )
          .join('')}
      </div>
      <div class="panel">
        <h3 style="margin:0 0 4px;font-size:14px">按角色</h3>
        <p class="lead" style="margin:0 0 10px">${
          model.rolesUnclassified === 0
            ? '每个文件都识别出了角色。'
            : `${String(model.stats.totalFiles - model.rolesUnclassified)}/${String(model.stats.totalFiles)} 个文件识别出角色，其余是普通内容文件。`
        }</p>
        ${
          model.roles.length === 0
            ? '<p class="lead" style="margin:0">没有识别出特殊角色。</p>'
            : model.roles
                .map((group) =>
                  row(
                    `${roleLabel(group.role)}（${group.role}）`,
                    String(group.count),
                    model.stats.totalFiles === 0 ? 0 : group.count / model.stats.totalFiles,
                    true,
                  ),
                )
                .join('') +
              (model.rolesUnclassified === 0
                ? ''
                : row('未分类（普通内容）', String(model.rolesUnclassified), model.rolesUnclassified / Math.max(model.stats.totalFiles, 1), true))
        }
      </div>
      <div class="panel">
        <h3 style="margin:0 0 4px;font-size:14px">最大的顶层目录</h3>
        <p class="lead" style="margin:0 0 10px">按<b>体积</b>排（含子目录），避免只看文件数漏掉「文件少但内容重」的块。</p>
        ${
          model.topLevel.length === 0
            ? '<p class="lead" style="margin:0">没有子目录。</p>'
            : model.topLevel
                .map((dir) => row(dir.path, `${formatBytes(dir.bytes)} · ${String(dir.files)} 个 · ${percent(dir.share)}`, dir.share))
                .join('')
        }
      </div>
      <div class="panel">
        <h3 style="margin:0 0 4px;font-size:14px">语言（按行数）</h3>
        <p class="lead" style="margin:0 0 10px">占比的分母是<b>表内合计行数</b>。参与统计的是「有行数<b>且</b>有语言归属」的 ${String(model.filesWithLanguage)} 个文件：Office / PDF 没有行数，${String(model.filesWithLines - model.filesWithLanguage)} 个文件（如 .gitignore、LICENSE）有行数但没有语言，都不进这张表。</p>
        ${
          model.languages.length === 0
            ? '<p class="lead" style="margin:0">没有可统计的文本。</p>'
            : model.languages
                .map((item) => row(item.language, `${String(item.lines)} 行 · ${percent(item.share)}`, item.share, true))
                .join('')
        }
      </div>
    </div>
  </section>

  <section id="tree">
    <h2>结构树<span class="count">${String(model.stats.totalFiles)} 个文件</span></h2>
    <p class="lead">点文件名跳到它的卡片；带「入口」「枢纽」标记的是解读给出的重点。</p>
    <div class="panel"><ul class="tree">${renderTree(model.tree, model, marks, 0)}</ul></div>
  </section>

  <section id="marks">
    <h2>入口与枢纽</h2>
    <p class="lead">由解读的引用关系算出：<b>入口</b>（<span class="mono">graph.roots</span>）是没有任何文件引用它、并且它引用了别人（或本身是说明 / 入口文件）的起点；<b>枢纽</b>（<span class="mono">graph.hubs</span>）是被引用最多的文件（解读最多给 20 个，并列时按路径取前几个 —— 所以「被引用 1 次」的文件里只有一部分上榜）。这里的「入口」是<b>引用图的起点</b>，与内容盘点里的角色「主入口（entry）」不是一回事：那个说的是文件类型。</p>
    <div class="grid">
      <div class="panel">
        <h3 style="margin:0 0 10px;font-size:14px">入口 · ${String(model.roots.length)}</h3>
        ${
          model.roots.length === 0
            ? '<p class="lead" style="margin:0">没有入口：这个目录里的文件之间没有引用关系（资料型目录常见）。</p>'
            : `<ul style="margin:0;padding-left:18px">${model.roots
                .map((path) => `<li><a class="mono" href="#${escapeHtml(anchorOf(path, model))}">${escapeHtml(path)}</a></li>`)
                .join('')}</ul>`
        }
      </div>
      <div class="panel">
        <h3 style="margin:0 0 10px;font-size:14px">枢纽 · ${String(model.hubs.length)}</h3>
        ${
          model.hubs.length === 0
            ? '<p class="lead" style="margin:0">没有枢纽：同上，没有文件被其他文件引用。</p>'
            : hubTiers(model)
        }
      </div>
    </div>
  </section>

  <section id="graph">
    <h2>引用依赖图<span class="count">画了 ${String(model.graph.summary.drawn)} 个点 · ${String(model.graph.edges.length)} 条边</span></h2>
    <p class="lead">谁引用谁，由解读的 <span class="mono">manifest[].imports</span> 得出：<b>只有代码与文档里的 import / 链接算边</b>，音频、图片、二进制靠路径字符串被引用，不进这张图；**正文里写的「见 八股/02_SFT八股.md」这类中文提及也不算** —— 解读只认链接语法与 import。绿色是入口，土黄是枢纽。</p>
    <p class="lead">解读记录 <b>${String(model.graph.summary.totalEdges)}</b> 条引用边、<b>${String(model.graph.summary.involved)}</b> 个文件参与其中；
    这里画的是连接最多的 ${String(model.graph.summary.drawn)} 个点<b>以及它们之间的</b> ${String(model.graph.edges.length)} 条边 —— 三个数不是一回事。</p>
    ${renderGraph(model)}
  </section>

  <section id="files">
    <h2>文件卡片<span class="count">${String(shown.length)} 张</span></h2>
    <p class="lead">摘要来自程序读取，缩略图来自素材阶段。${
      hidden === 0
        ? ''
        : `另有 ${String(hidden)} 个文件既没有摘要、也没有配图与引用关系，所以没有单独列卡片（例如 ${hiddenExamples(model, options.images)}）—— 结构树里有全部 ${String(model.cards.length)} 个文件。`
    }</p>
    ${shown.map((card) => renderCard(card, model, options.images)).join('')}
  </section>

  <section id="secrets">
    <h2>密钥审计<span class="count">排除 ${String(model.secrets.excluded.length)} 个</span></h2>
    <p class="lead">命中的文件没有被读取内容。判据只按文件名匹配，<b>不可能完备</b> —— 靠这张表确认命中了什么、有没有该排除却没排除的。</p>
    <div class="panel">
      ${secretsNote}
      ${
        model.secrets.rescanned.length === 0
          ? ''
          : `<p class="lead" style="margin:12px 0 0">用 <span class="mono">sources.rescan</span> 显式放回：${model.secrets.rescanned.map((path) => `<span class="mono">${escapeHtml(path)}</span>`).join('、')}</p>`
      }
    </div>
  </section>

  <section id="boundary">
    <h2>这份解读的边界</h2>
    <div class="note"><ul>${boundary.map((item) => `<li>${item}</li>`).join('')}</ul></div>
    ${notes}
  </section>

  <footer class="end">
    <p>由 foldercast 从 <span class="mono">.foldercast/foldercast.json</span> 生成 · 解读生成于 ${escapeHtml(formatTime(model.generatedAt))} · 页面生成于 ${escapeHtml(formatTime(options.pageGeneratedAt))}</p>
    <p>本页是静态页面：没有 JavaScript、没有外部资源，可以直接用浏览器打开或整份转发。</p>
  </footer>
</div>
</body>
</html>
`;
}
