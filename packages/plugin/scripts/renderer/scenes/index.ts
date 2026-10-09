/**
 * 八种场景组件（`cover` / `tree` / `inventory` / `file` / `gallery` / `clip` / `document` / `outro`）。
 *
 * 三条约定的写法：
 *
 * 1. **组件只吃 `scene` + `plan`**（纯数据），不认识文件系统、不认识讲稿 JSON ——
 *    素材已经在 `plan.ts` 里解析成 `data:` / `file://` 地址，所以同一份计划在浏览器里与
 *    在测试里看到的是同一个东西。
 * 2. **画面上的每个数字都来自解读**（文件数、字节数、行数、页数），组件不做统计。
 * 3. **不认识的场景类型由 `plan.ts` 提前跳过**；这里再兜一层，画成只有标题的普通场景而不是崩。
 */
import { createElement as h, type ReactNode } from 'react';
import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig } from 'remotion';
import { isMarkdownFile } from '../../contracts/script.ts';
import {
  fitSize,
  humanBytes,
  metaLine,
  type Plan,
  type PlanScene,
  type SceneCommon,
} from '../plan.ts';
import { labelColor } from '../styles.ts';
import { progressStyle } from './captions.ts';
import { assetUrl, beatStyle, contentBox, panel, sceneHeader, useAppear } from './common.ts';

/** 场景组件的统一入参：只有纯数据（素材已在 `plan.ts` 里解析成 `data:` URI）。 */
export type SceneProps<S extends PlanScene> = {
  scene: S;
  plan: Plan;
};

/**
 * 节拍侧栏：points 类的节拍按时刻在右侧竖排浮现（0004）。
 *
 * 放侧栏而不是叠在正文上：内容场景的正文（摘录 / 条形 / 页图）已经占满画面，
 * 要点作为「旁白引导的注释流」挂右边，与字幕带错开。cover / outro 自带版式，
 * 不走 Shell，也就没有这层。
 */
const PointsRail = ({ scene, plan }: SceneProps<PlanScene>) => {
  const frame = useCurrentFrame();
  const tokens = plan.tokens;
  const beats = scene.beats.filter((beat) => beat.points !== undefined && beat.points.length > 0);
  if (beats.length === 0) return null;
  return h(
    'div',
    { style: { width: Math.round(tokens.width * 0.24), flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 18, justifyContent: 'center' } },
    ...beats.map((beat, index) =>
      h(
        'div',
        {
          key: `beat-${String(index)}`,
          style: {
            ...beatStyle(beat.enter, beat.startFrame, frame),
            borderLeft: `3px solid var(--accent)`,
            paddingLeft: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          },
        },
        ...(beat.points ?? []).map((point, pointIndex) =>
          h(
            'div',
            {
              key: `point-${String(pointIndex)}`,
              style: { fontSize: Math.round(tokens.bodySize * 0.82), lineHeight: 1.5, color: 'var(--ink)' },
            },
            point,
          ),
        ),
      ),
    ),
  );
};

/** 场景 id → shiki 高亮 HTML（Node 侧预算，纯展示数据）。 */
function highlightOf(plan: Plan, sceneId: string): string | undefined {
  return plan.highlight?.[sceneId];
}

/** 画面外壳：进度条 + （可选）头部 + 内容区。 */
const Shell = (props: {
  scene: SceneCommon;
  plan: Plan;
  /** 场景主体。写成具名字段而不是 `children`，因为 `createElement` 的可变参数与它撞名。 */
  body: ReactNode;
  /** 头部左侧小字；`cover` / `outro` 自带版式，传 undefined。 */
  eyebrow?: string;
}) => {
  const { scene, plan, body, eyebrow } = props;
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const progress = totalProgress(plan, scene, frame, durationInFrames);
  // `cover` / `outro` 自带版式（不传 eyebrow）→ 不套内容框；其余场景一律套。
  if (eyebrow === undefined) return h(AbsoluteFill, null, h('div', { style: progressStyle(plan.tokens, progress) }), body);

  return h(
    AbsoluteFill,
    null,
    h('div', { style: progressStyle(plan.tokens, progress) }),
    h(
      'div',
      { style: contentBox(plan.tokens) },
      sceneHeader(scene, plan, eyebrow),
      h(
        'div',
        { style: { flex: 1, minHeight: 0, display: 'flex', gap: 26 } },
        h('div', { style: { flex: 1, minWidth: 0 } }, body),
        h(PointsRail, { scene: scene as PlanScene, plan }),
      ),
    ),
  );
};

/** 场景在整片里的进度（0–1）。到片尾刚好走满。 */
function totalProgress(plan: Plan, scene: SceneCommon, frame: number, sceneFrames: number): number {
  let before = 0;
  for (const item of plan.scenes) {
    if (item.id === scene.id) break;
    before += item.durationInFrames;
  }
  const total = Math.max(1, plan.composition.durationInFrames);
  return (before + Math.min(Math.min(frame, sceneFrames), scene.durationInFrames)) / total;
}

/* ---------------------------------------------------------------- cover */

const Cover = ({ scene, plan }: SceneProps<Extract<PlanScene, { type: 'cover' }>>) => {
  const appear = useAppear(plan.tokens, 12);
  const tokens = plan.tokens;
  return h(
    'div',
    {
      style: {
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        paddingLeft: tokens.safeMargin,
        paddingRight: tokens.safeMargin,
        ...appear,
      },
    },
    h('div', { style: { fontSize: Math.round(tokens.bodySize * 0.7), letterSpacing: 6, color: 'var(--accent)' } }, plan.label),
    h(
      'div',
      {
        style: {
          fontFamily: 'var(--font-title)',
          fontSize: fitSize(plan.title, tokens.titleSize, 54),
          fontWeight: tokens.titleWeight,
          lineHeight: 1.14,
          marginTop: 18,
        },
      },
      plan.title,
    ),
    scene.subtitle === undefined
      ? null
      : h('div', { style: { fontSize: tokens.headingSize, color: 'var(--muted)', marginTop: 16 } }, scene.subtitle),
    h(
      'div',
      { style: { display: 'flex', gap: 48, marginTop: Math.round(tokens.height * 0.06) } },
      ...[...scene.facts, { label: '场景', value: `${plan.scenes.length} 个` }].map((fact) =>
        h(
          'div',
          { key: fact.label, style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          h('div', { style: { fontSize: Math.round(tokens.bodySize * 0.62), color: 'var(--muted)', letterSpacing: 1 } }, fact.label),
          h('div', { style: { fontSize: tokens.headingSize, fontFamily: 'var(--font-title)' } }, fact.value),
        ),
      ),
    ),
  );
};

/* ----------------------------------------------------------------- tree */

const Tree = ({ scene, plan }: SceneProps<Extract<PlanScene, { type: 'tree' }>>) => {
  const appear = useAppear(plan.tokens);
  const tokens = plan.tokens;
  const max = scene.rows.reduce((value, row) => Math.max(value, row.files), 1);
  return h(
    'div',
    { style: { ...appear, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden', width: '100%' } },
    ...scene.rows.map((row) =>
      h(
        'div',
        { key: row.path, style: { display: 'flex', alignItems: 'center', gap: 20 } },
        h(
          'div',
          {
            style: {
              width: Math.round(tokens.width * 0.026),
              textAlign: 'right',
              fontFamily: 'var(--font-mono)',
              fontSize: tokens.bodySize,
              color: 'var(--muted)',
            },
          },
          String(row.files),
        ),
        h(
          'div',
          {
            style: {
              flex: 1,
              minWidth: 0,
              fontFamily: 'var(--font-mono)',
              fontSize: fitSize(row.path, tokens.bodySize, Math.round(tokens.bodySize * 0.7)),
              color: row.highlight ? 'var(--accent)' : 'var(--ink)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            },
          },
          row.path,
        ),
        h(
          'div',
          {
            style: {
              width: Math.round(tokens.width * 0.24),
              height: 12,
              borderRadius: 6,
              backgroundColor: 'var(--line)',
              overflow: 'hidden',
            },
          },
          h('div', {
            style: {
              width: `${Math.round((row.files / max) * 100)}%`,
              height: '100%',
              backgroundColor: row.highlight ? 'var(--accent)' : 'var(--muted)',
              opacity: row.highlight ? 1 : 0.55,
            },
          }),
        ),
        h(
          'div',
          {
            style: {
              width: Math.round(tokens.width * 0.08),
              textAlign: 'right',
              fontSize: Math.round(tokens.bodySize * 0.8),
              color: 'var(--muted)',
            },
          },
          humanBytes(row.bytes),
        ),
      ),
    ),
  );
};

/* ------------------------------------------------------------ inventory */

const Inventory = ({ scene, plan }: SceneProps<Extract<PlanScene, { type: 'inventory' }>>) => {
  const appear = useAppear(plan.tokens);
  const frame = useCurrentFrame();
  const tokens = plan.tokens;
  const max = scene.groups.reduce((value, group) => Math.max(value, group.count), 1);
  // proportion 节拍：一条按占比分段的堆叠条（吃 groups 的 share，确定性生成）。
  const proportion = scene.beats.find((beat) => beat.graphic === 'proportion');
  return h(
    'div',
    { style: { ...appear, display: 'flex', flexDirection: 'column', gap: 14, width: '100%' } },
    ...scene.groups.map((group) =>
      h(
        'div',
        { key: group.label, style: { display: 'flex', alignItems: 'center', gap: 20 } },
        h('div', {
          style: {
            width: 14,
            height: 14,
            borderRadius: 3,
            backgroundColor: labelColor(group.label, tokens),
            flexShrink: 0,
          },
        }),
        h('div', { style: { width: Math.round(tokens.width * 0.14), fontSize: tokens.bodySize } }, group.label),
        h(
          'div',
          { style: { flex: 1, height: 22, borderRadius: 4, backgroundColor: 'var(--line)', overflow: 'hidden', display: 'flex' } },
          h('div', {
            style: {
              width: `${Math.round((group.count / max) * 100)}%`,
              height: '100%',
              backgroundColor: labelColor(group.label, tokens),
              opacity: 0.85,
            },
          }),
        ),
        h(
          'div',
          {
            style: {
              width: Math.round(tokens.width * 0.14),
              textAlign: 'right',
              fontFamily: 'var(--font-mono)',
              fontSize: tokens.bodySize,
            },
          },
          `${group.count} 个 · ${Math.round(group.share * 100)}%`,
        ),
        group.note === undefined
          ? null
          : h(
              'div',
              {
                style: {
                  width: Math.round(tokens.width * 0.2),
                  fontSize: Math.round(tokens.bodySize * 0.72),
                  color: 'var(--muted)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                },
              },
              group.note,
            ),
      ),
    ),
    h(
      'div',
      { style: { marginTop: 6, fontSize: Math.round(tokens.bodySize * 0.72), color: 'var(--muted)' } },
      `共 ${String(scene.totalFiles)} 个文件（写稿时清点的数字）`,
    ),
    proportion === undefined
      ? null
      : h(
          'div',
          {
            style: {
              ...beatStyle(proportion.enter, proportion.startFrame, frame),
              marginTop: 10,
              display: 'flex',
              height: 30,
              borderRadius: 6,
              overflow: 'hidden',
              backgroundColor: 'var(--line)',
            },
          },
          ...scene.groups.map((group, index) =>
            h('div', {
              key: `seg-${String(index)}`,
              style: {
                width: `${Math.max(0.5, group.share * 100).toFixed(2)}%`,
                backgroundColor: labelColor(group.label, tokens),
                opacity: 0.9,
              },
            }),
          ),
        ),
  );
};

/* ----------------------------------------------------------------- file */

/**
 * Markdown 摘录的样式（`highlight.ts` 产出的 HTML 带 `fc-md` 作用域类）。
 * 静态字符串、每场一份 —— Remotion 的合成互相独立，不存在重复注入的问题。
 */
const FC_MD_CSS = `
.fc-md { width: 100%; overflow: hidden; }
.fc-md p { margin: 0 0 0.55em; }
.fc-md p:last-child { margin-bottom: 0; }
.fc-md h1, .fc-md h2, .fc-md h3, .fc-md h4 { font-family: var(--font-title); line-height: 1.25; margin: 0.2em 0 0.4em; }
.fc-md h1 { font-size: 1.5em; }
.fc-md h2 { font-size: 1.3em; }
.fc-md h3, .fc-md h4 { font-size: 1.12em; }
.fc-md strong { color: var(--accent); font-weight: 700; }
.fc-md em { font-style: italic; }
.fc-md code { font-family: var(--font-mono); background: var(--line); color: var(--accent); padding: 0.06em 0.35em; border-radius: 4px; }
.fc-md pre { margin: 0 0 0.55em; padding: 0.55em 0.8em; background: var(--line); border-radius: 8px; overflow: hidden; }
.fc-md pre code { background: transparent; padding: 0; color: var(--ink); }
.fc-md ul, .fc-md ol { margin: 0 0 0.55em; padding-left: 1.3em; }
.fc-md li { margin: 0.15em 0; }
.fc-md blockquote { margin: 0 0 0.55em; padding-left: 0.9em; border-left: 3px solid var(--accent); color: var(--muted); }
.fc-md a { color: var(--accent); text-decoration: none; }
`;

/**
 * file 场景（0005 重排版）：摘录是**画面主体**，从面板顶部排满，不再垂直居中悬一条。
 *
 * - 代码文件：shiki 深色高亮（Node 侧预算），带行号槽与来源区间（`excerptStart`）；
 * - Markdown 文件：marked 渲染成排版（粗体是粗体、列表是列表），不再显示源码；
 * - 字号按行数自适应（`fitSize`），长行不折行（`pre`），放不下就缩、缩到下限为止。
 */
const File = ({ scene, plan }: SceneProps<Extract<PlanScene, { type: 'file' }>>) => {
  const appear = useAppear(plan.tokens);
  const tokens = plan.tokens;
  const url = assetUrl(scene.media);
  const html = highlightOf(plan, scene.id);
  const markdown = isMarkdownFile(scene.path);
  const start = scene.excerptStart;
  const excerpt = scene.excerpt;
  const hasExcerpt = excerpt.length > 0;
  const range =
    start !== undefined && hasExcerpt ? `L${String(start)}–L${String(start + excerpt.length - 1)}` : undefined;
  const codeSize = fitSize(excerpt.join('\n'), Math.round(tokens.bodySize * 0.85), Math.round(tokens.bodySize * 0.5));

  /** 行号槽：只在写了 `excerptStart` 时出现；`pre` 不折行，行高对得齐。 */
  const gutter =
    start === undefined || !hasExcerpt || markdown
      ? null
      : h(
          'div',
          {
            style: {
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              paddingRight: 18,
              marginRight: 18,
              borderRight: '1px solid var(--line)',
              fontFamily: 'var(--font-mono)',
              fontSize: codeSize,
              lineHeight: 1.6,
              color: 'var(--muted)',
              opacity: 0.6,
              whiteSpace: 'pre',
            },
          },
          ...excerpt.map((_, index) =>
            h('div', { key: `ln-${String(index)}` }, String(start + index)),
          ),
        );

  const codeBody = hasExcerpt
    ? h(
        'div',
        { style: { flex: 1, minWidth: 0, display: 'flex', alignItems: 'flex-start', overflow: 'hidden' } },
        gutter,
        html === undefined
          ? h(
              'div',
              {
                style: {
                  fontFamily: 'var(--font-mono)',
                  fontSize: codeSize,
                  lineHeight: 1.6,
                  color: 'var(--ink)',
                  whiteSpace: 'pre',
                },
              },
              excerpt.join('\n'),
            )
          : h('div', {
              dangerouslySetInnerHTML: { __html: html },
              style: {
                flex: 1,
                minWidth: 0,
                fontFamily: 'var(--font-mono)',
                fontSize: codeSize,
                lineHeight: 1.6,
                whiteSpace: 'pre',
                overflow: 'hidden',
              },
            }),
      )
    : h(
        'div',
        { style: { fontSize: tokens.bodySize, color: 'var(--muted)' } },
        scene.noteMissing ?? '没有素材，也没有摘录 —— 写稿时给这个文件加几行 excerpt',
      );

  return h(
    'div',
    { style: { ...appear, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, height: '100%' } },
    h(
      'div',
      { style: { display: 'flex', alignItems: 'baseline', gap: 20 } },
      h(
        'div',
        { style: { flex: 1, minWidth: 0, fontFamily: 'var(--font-mono)', fontSize: Math.round(tokens.bodySize * 0.86), color: 'var(--accent)' } },
        scene.path,
      ),
      range === undefined
        ? null
        : h(
            'div',
            { style: { flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: Math.round(tokens.bodySize * 0.62), color: 'var(--muted)' } },
            range,
          ),
    ),
    scene.note === undefined
      ? null
      : h('div', { style: { fontSize: Math.round(tokens.bodySize * 0.72), color: 'var(--muted)' } }, scene.note),
    h(
      'div',
      { style: { flex: 1, minHeight: 0, display: 'flex', marginTop: 4 } },
      url !== undefined
        ? panel(
            {
              flex: 1,
              minHeight: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              backgroundColor: 'var(--panel)',
            },
            h(Img, { src: url, style: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' } }),
          )
        : panel(
            { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', overflow: 'hidden' },
            markdown && html !== undefined
              ? [
                  h('style', { key: 'fc-md-css', dangerouslySetInnerHTML: { __html: FC_MD_CSS } }),
                  h('div', {
                    key: 'fc-md',
                    dangerouslySetInnerHTML: { __html: html },
                    style: {
                      width: '100%',
                      overflow: 'hidden',
                      fontSize: fitSize(excerpt.join('\n'), Math.round(tokens.bodySize * 0.9), Math.round(tokens.bodySize * 0.6)),
                      lineHeight: 1.55,
                    },
                  }),
                ]
              : codeBody,
          ),
    ),
  );
};

/* -------------------------------------------------------------- concept */

/**
 * concept：大字论断 + 支撑要点（0005 WP3）。画面主角是这句话本身——讲「一条判据」
 * 这类内容时，大字比「引某文件的两行」诚实得多。垂直居中，要点用强调点引导。
 */
const Concept = ({ scene, plan }: SceneProps<Extract<PlanScene, { type: 'concept' }>>) => {
  const appear = useAppear(plan.tokens);
  const tokens = plan.tokens;
  return h(
    'div',
    { style: { ...appear, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: Math.round(tokens.height * 0.055), height: '100%' } },
    h(
      'div',
      {
        style: {
          fontFamily: 'var(--font-title)',
          fontSize: fitSize(scene.statement, Math.round(tokens.titleSize * 1.2), Math.round(tokens.titleSize * 0.62)),
          fontWeight: tokens.titleWeight,
          lineHeight: 1.35,
        },
      },
      scene.statement,
    ),
    scene.points.length === 0
      ? null
      : h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
          ...scene.points.map((point, index) =>
            h(
              'div',
              { key: `point-${String(index)}`, style: { display: 'flex', gap: 14, alignItems: 'center' } },
              h('div', { style: { width: 9, height: 9, borderRadius: 5, backgroundColor: 'var(--accent)', flexShrink: 0 } }),
              h(
                'div',
                { style: { fontSize: Math.round(tokens.bodySize * 1.08), lineHeight: 1.55, color: 'var(--ink)' } },
                point,
              ),
            ),
          ),
        ),
  );
};

/* -------------------------------------------------------------- compare */

/** compare：左右两栏对比（0005 WP3）。左栏走强调色、右栏走中性色，方向感「主 vs 副」。 */
const Compare = ({ scene, plan }: SceneProps<Extract<PlanScene, { type: 'compare' }>>) => {
  const appear = useAppear(plan.tokens);
  const tokens = plan.tokens;
  const side = (data: { label: string; lines: string[] }, accent: boolean): ReactNode =>
    panel(
      { flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 16, overflow: 'hidden' },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 12 } },
        h('div', {
          style: {
            width: 8,
            height: Math.round(tokens.headingSize * 1.1),
            borderRadius: 4,
            backgroundColor: accent ? 'var(--accent)' : 'var(--muted)',
            flexShrink: 0,
          },
        }),
        h(
          'div',
          { style: { fontFamily: 'var(--font-title)', fontSize: tokens.headingSize, fontWeight: tokens.titleWeight } },
          data.label,
        ),
      ),
      ...data.lines.map((line, index) =>
        h(
          'div',
          {
            key: `line-${String(index)}`,
            style: {
              display: 'flex',
              gap: 12,
              alignItems: 'baseline',
              fontSize: fitSize(line, Math.round(tokens.bodySize * 0.95), Math.round(tokens.bodySize * 0.7)),
              lineHeight: 1.55,
              color: 'var(--ink)',
            },
          },
          h('div', { style: { color: accent ? 'var(--accent)' : 'var(--muted)', flexShrink: 0 } }, '·'),
          h('div', { style: { minWidth: 0 } }, line),
        ),
      ),
    );
  return h(
    'div',
    { style: { ...appear, flex: 1, minHeight: 0, display: 'flex', gap: 26 } },
    side(scene.left, true),
    side(scene.right, false),
  );
};

/* ----------------------------------------------------------------- flow */

/**
 * flow：步骤条（0005 WP3）。编号圆点 + 步骤名 + 补充说明，横向排布，
 * 步骤间用箭头连接。字号按最长的步骤名自适应，6 步以内放得下。
 */
const Flow = ({ scene, plan }: SceneProps<Extract<PlanScene, { type: 'flow' }>>) => {
  const appear = useAppear(plan.tokens);
  const tokens = plan.tokens;
  const steps = scene.steps;
  const labelSize = fitSize(
    steps.map((step) => step.label).join('\n'),
    Math.round(tokens.bodySize * 0.95),
    Math.round(tokens.bodySize * 0.62),
  );
  const children: ReactNode[] = [];
  steps.forEach((step, index) => {
    if (index > 0) {
      children.push(
        h(
          'div',
          { key: `arrow-${String(index)}`, style: { flexShrink: 0, display: 'flex', alignItems: 'center', padding: '0 8px' } },
          h('div', { style: { color: 'var(--accent)', fontSize: Math.round(tokens.headingSize), fontFamily: 'var(--font-mono)' } }, '→'),
        ),
      );
    }
    children.push(
      h(
        'div',
        {
          key: `step-${String(index)}`,
          style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 12, justifyContent: 'center' },
        },
        h(
          'div',
          {
            style: {
              width: Math.round(tokens.bodySize * 1.7),
              height: Math.round(tokens.bodySize * 1.7),
              borderRadius: '50%',
              border: '2px solid var(--accent)',
              color: 'var(--accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'var(--font-mono)',
              fontSize: Math.round(tokens.bodySize * 0.9),
              flexShrink: 0,
            },
          },
          String(index + 1),
        ),
        h('div', { style: { fontSize: labelSize, lineHeight: 1.4, fontFamily: 'var(--font-title)', fontWeight: tokens.titleWeight } }, step.label),
        step.note === undefined
          ? null
          : h(
              'div',
              { style: { fontSize: Math.round(labelSize * 0.78), lineHeight: 1.45, color: 'var(--muted)' } },
              step.note,
            ),
      ),
    );
  });
  return h('div', { style: { ...appear, flex: 1, minHeight: 0, display: 'flex', alignItems: 'stretch' } }, ...children);
};

/* -------------------------------------------------------------- gallery */

const Gallery = ({ scene, plan }: SceneProps<Extract<PlanScene, { type: 'gallery' }>>) => {
  const appear = useAppear(plan.tokens);
  const tokens = plan.tokens;
  if (scene.items.length === 0) {
    return h('div', { style: { fontSize: tokens.bodySize, color: 'var(--muted)' } }, '这个场景没有可用图片');
  }
  const items = scene.items.filter((item) => item.src !== undefined);
  if (items.length === 0) {
    return h('div', { style: { fontSize: tokens.bodySize, color: 'var(--muted)' } }, '这些图片没有可用的内联素材');
  }
  const rows = Math.ceil(items.length / scene.columns);
  return h(
    'div',
    {
      style: {
        ...appear,
        display: 'grid',
        gridTemplateColumns: `repeat(${scene.columns}, 1fr)`,
        gap: 24,
        width: '100%',
        maxWidth: Math.round(tokens.width * 0.86),
      },
    },
    ...items.map((item, index) =>
      h(
        'div',
        {
          key: `${item.path}-${index}`,
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: Math.round((tokens.height * 0.6) / rows),
            overflow: 'hidden',
          },
        },
        h(Img, { src: assetUrl(item) as string, style: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' } }),
      ),
    ),
  );
};

/* ----------------------------------------------------------------- clip */

/**
 * `clip`：**展示封面图，不播活动画面**。
 *
 * 不是偷懒：Remotion 的 `<OffthreadVideo>` 只接受 `http(s)://`（实测报
 * `Can only download URLs starting with http:// or https://, got "file://…"`），而素材在
 * 被讲解目录里、没有 HTTP 服务。所以画面用素材阶段抽的封面图 + 文件名 + 片段区间，
 * 讲稿的 `clipRange` 仍然会显示出来。真播视频要等有一个能服务本地文件的层（第一版不做）。
 */
const Clip = ({ scene, plan }: SceneProps<Extract<PlanScene, { type: 'clip' }>>) => {
  const appear = useAppear(plan.tokens);
  const tokens = plan.tokens;
  const poster = assetUrl(scene.poster);
  return h(
    'div',
    { style: { ...appear, display: 'flex', flexDirection: 'column', gap: 14, height: '100%', minHeight: 0 } },
    h(
      'div',
      { style: { fontFamily: 'var(--font-mono)', fontSize: Math.round(tokens.bodySize * 0.86), color: 'var(--accent)' } },
      scene.file,
    ),
    h(
      'div',
      { style: { flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' } },
      poster !== undefined
        ? h(Img, { src: poster, style: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' } })
        : h('div', { style: { fontSize: tokens.bodySize, color: 'var(--muted)' } }, '这个片段没有封面图可展示'),
    ),
    h(
      'div',
      { style: { fontSize: Math.round(tokens.bodySize * 0.72), color: 'var(--muted)' } },
      metaLine([
        scene.range === undefined ? undefined : `讲稿指定片段 ${scene.range[0]}s – ${scene.range[1]}s`,
        '画面是封面图（不播活动画面）',
      ]),
    ),
  );
};

/* ------------------------------------------------------------- document */

const Document = ({ scene, plan }: SceneProps<Extract<PlanScene, { type: 'document' }>>) => {
  const appear = useAppear(plan.tokens);
  const tokens = plan.tokens;
  const shown = scene.pages.filter((page) => page.src !== undefined).slice(0, 4);
  const pageHeight = Math.round(tokens.height * (shown.length <= 2 ? 0.62 : 0.56));
  return h(
    'div',
    { style: { ...appear, display: 'flex', flexDirection: 'column', gap: 12, height: '100%', minHeight: 0 } },
    h(
      'div',
      { style: { display: 'flex', alignItems: 'baseline', gap: 20 } },
      h(
        'div',
        { style: { fontFamily: 'var(--font-mono)', fontSize: Math.round(tokens.bodySize * 0.86), color: 'var(--accent)' } },
        shown[0]?.file ?? '',
      ),
      h(
        'div',
        { style: { fontSize: Math.round(tokens.bodySize * 0.72), color: 'var(--muted)' } },
        metaLine([scene.footer, scene.pages.length > shown.length ? `画面里放前 ${shown.length} 页` : undefined]),
      ),
    ),
    h(
      'div',
      { style: { flex: 1, minHeight: 0, display: 'flex', gap: 20, alignItems: 'center', justifyContent: 'center' } },
      ...shown.map((page, index) =>
        h(
          'div',
          { key: `${page.path}-${index}`, style: { display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' } },
          h(Img, {
            src: assetUrl(page) as string,
            style: {
              height: pageHeight,
              maxWidth: '100%',
              objectFit: 'contain',
              borderRadius: 4,
              backgroundColor: '#FFFFFF',
              boxShadow: 'var(--shadow)',
            },
          }),
          h('div', { style: { fontSize: Math.round(tokens.bodySize * 0.6), color: 'var(--muted)' } }, `第 ${index + 1} 页`),
        ),
      ),
    ),
  );
};

/* ---------------------------------------------------------------- outro */

const Outro = ({ scene, plan }: SceneProps<Extract<PlanScene, { type: 'outro' }>>) => {
  const appear = useAppear(plan.tokens, 12);
  const tokens = plan.tokens;
  return h(
    'div',
    {
      style: {
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        paddingLeft: tokens.safeMargin,
        paddingRight: tokens.safeMargin,
        ...appear,
      },
    },
    h('div', { style: { fontFamily: 'var(--font-title)', fontSize: tokens.titleSize, fontWeight: tokens.titleWeight } }, scene.title),
    scene.subtitle === undefined
      ? null
      : h('div', { style: { fontSize: tokens.headingSize, color: 'var(--muted)', marginTop: 14 } }, scene.subtitle),
    h(
      'div',
      { style: { display: 'flex', gap: 56, marginTop: Math.round(tokens.height * 0.06) } },
      ...scene.facts.map((fact) =>
        h(
          'div',
          { key: fact.label, style: { display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' } },
          h('div', { style: { fontSize: Math.round(tokens.bodySize * 0.62), color: 'var(--muted)', letterSpacing: 1 } }, fact.label),
          h('div', { style: { fontSize: tokens.headingSize, fontFamily: 'var(--font-title)' } }, fact.value),
        ),
      ),
    ),
    ...scene.lines.map((line) =>
      h('div', { key: line, style: { marginTop: 26, fontSize: Math.round(tokens.bodySize * 0.82), color: 'var(--muted)' } }, line),
    ),
  );
};

/* ----------------------------------------------------------------- 路由 */

type AnyView = (props: SceneProps<never>) => ReactNode;

const VIEWS: Record<PlanScene['type'], AnyView> = {
  cover: Cover as unknown as AnyView,
  tree: Tree as unknown as AnyView,
  inventory: Inventory as unknown as AnyView,
  file: File as unknown as AnyView,
  concept: Concept as unknown as AnyView,
  compare: Compare as unknown as AnyView,
  flow: Flow as unknown as AnyView,
  gallery: Gallery as unknown as AnyView,
  clip: Clip as unknown as AnyView,
  document: Document as unknown as AnyView,
  outro: Outro as unknown as AnyView,
};

/** 头部左侧的小字：告诉观众「这一段在讲什么维度」。 */
const EYEBROWS: Record<PlanScene['type'], string | undefined> = {
  cover: undefined,
  tree: '结构',
  inventory: '构成',
  file: '文件',
  concept: '论点',
  compare: '对比',
  flow: '流程',
  gallery: '图片',
  clip: '片段',
  document: '文档',
  outro: undefined,
};

/** 场景路由。未知类型画成只有标题的普通场景（`plan.ts` 已提前跳过它们）。 */
export const SceneView = ({ scene, plan }: SceneProps<PlanScene>) => {
  const view = VIEWS[scene.type];
  if (view === undefined) {
    return h(Shell, {
      scene,
      plan,
      eyebrow: '场景',
      body: h('div', { style: { fontSize: plan.tokens.bodySize } }, scene.narration),
    });
  }
  return h(Shell, {
    scene,
    plan,
    eyebrow: EYEBROWS[scene.type],
    body: h(view, { scene: scene as never, plan }),
  });
};
