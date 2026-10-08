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

const File = ({ scene, plan }: SceneProps<Extract<PlanScene, { type: 'file' }>>) => {
  const appear = useAppear(plan.tokens);
  const tokens = plan.tokens;
  const url = assetUrl(scene.media);
  return h(
    'div',
    { style: { ...appear, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, height: '100%' } },
    h(
      'div',
      { style: { fontFamily: 'var(--font-mono)', fontSize: Math.round(tokens.bodySize * 0.86), color: 'var(--accent)' } },
      scene.path,
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
        : // 没有素材图时画**写稿人摘的原文行**：它说明这个文件写了什么，比一句「没有素材」有用。
          // 有 shiki 高亮（`plan.highlight`，Node 侧预算好的 HTML）就上色；没有就等宽纯文本。
          panel(
            { flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', overflow: 'hidden' },
            scene.excerpt.length === 0
              ? h(
                  'div',
                  { style: { fontSize: tokens.bodySize, color: 'var(--muted)' } },
                  scene.noteMissing ?? '没有素材，也没有摘录 —— 写稿时给这个文件加几行 excerpt',
                )
              : highlightOf(plan, scene.id) === undefined
                ? h(
                    'div',
                    {
                      style: {
                        fontFamily: 'var(--font-mono)',
                        fontSize: fitSize(scene.excerpt.join('\n'), Math.round(tokens.bodySize * 0.86), Math.round(tokens.bodySize * 0.6)),
                        lineHeight: 1.6,
                        color: 'var(--ink)',
                        opacity: 0.92,
                        whiteSpace: 'pre',
                      },
                    },
                    scene.excerpt.join('\n'),
                  )
                : h('div', {
                    dangerouslySetInnerHTML: { __html: highlightOf(plan, scene.id) as string },
                    style: {
                      width: '100%',
                      overflow: 'hidden',
                      // shiki 产物自带 <pre> 的白底与内边距，这里统一交给面板配色与字号
                      fontSize: fitSize(scene.excerpt.join('\n'), Math.round(tokens.bodySize * 0.8), Math.round(tokens.bodySize * 0.56)),
                    },
                  }),
          ),
    ),
  );
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
