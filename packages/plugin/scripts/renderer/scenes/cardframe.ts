/**
 * 卡片帧（0006）：场景卡 HTML 的 Remotion 包装。**这是卡片唯一的动画层**：
 *
 * - 卡片 HTML 在入口里由 `cards.ts` 纯函数算好，这里只 `dangerouslySetInnerHTML` 注入；
 * - 动效 = 每帧把 `--bN`（节拍入场）与 `--grow`（条形生长）设在注入容器上，CSS 变量
 *   沿 DOM 继承，CARD_CSS 消费它们。**没有 wall-clock、没有 CSS keyframes**：同一个
 *   帧号 → 同一组变量 → 同一张图，逐帧一致的判据原样保留；
 * - 基准盒 960×540（与 page 的阅读宽度 2:1），`scale(2)` 到 1920×1080；非 16:9 的
 *   画布按短边等比缩放并居中；
 * - 卡片里的 `<img>` 不在这里等图：整片开工前由入口的 `preloadImages` 一次性解码
 *   （见 entry.ts——逐场景挂 delayRender 会让截图时机漂移，那个方案实测否决）。
 */
import { createElement as h, type CSSProperties } from 'react';
import { Easing, interpolate, useCurrentFrame } from 'remotion';
import type { Plan, PlanScene } from '../plan.ts';
import { useAppear, useTransition } from './common.ts';

/** 卡片基准盒：与 page 的 960px 阅读宽度成 2:1（page 正文字号 × 2 = 视频正文字号）。 */
export const CARD_BASE_WIDTH = 960;
export const CARD_BASE_HEIGHT = 540;

/** 节拍入场时长（帧）：与旧 beatStyle 一致的手感。 */
const BEAT_SPAN = 14;
/** 条形生长的入场时长（帧）。 */
const GROW_SPAN = 18;

function beatProgress(startFrame: number, frame: number, span: number): number {
  return interpolate(frame, [startFrame, startFrame + span], [0, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
}

/** 场景在整片里的进度（0–1）。到片尾刚好走满。 */
function totalProgress(plan: Plan, scene: PlanScene, frame: number): number {
  let before = 0;
  for (const item of plan.scenes) {
    if (item.id === scene.id) break;
    before += item.durationInFrames;
  }
  const total = Math.max(1, plan.composition.durationInFrames);
  return (before + Math.min(frame, scene.durationInFrames)) / total;
}

export const CardFrame = ({ scene, plan, html }: { scene: PlanScene; plan: Plan; html: string }) => {
  const frame = useCurrentFrame();

  // 节拍变量：第 i 拍从它的 startFrame（对齐字幕时刻，plan 里算好）起 14 帧内浮现。
  // 没到时刻给 0（占位不闪），变量数组按场景节拍数给——CARD_CSS 的规则覆盖前 12 拍。
  const vars: Record<string, string> = {};
  scene.beats.slice(0, 12).forEach((beat, index) => {
    vars[`--b${String(index)}`] = beatProgress(beat.startFrame, frame, BEAT_SPAN).toFixed(4);
  });
  // 条形生长：有 proportion 图形节拍就跟它，否则跟场景自己的入场
  const graphic = scene.beats.find((beat) => beat.graphic === 'proportion');
  const grow =
    graphic === undefined
      ? beatProgress(0, frame, GROW_SPAN)
      : beatProgress(graphic.startFrame, frame, GROW_SPAN);
  vars['--grow'] = grow.toFixed(4);

  const scale = Math.min(
    plan.composition.width / CARD_BASE_WIDTH,
    plan.composition.height / CARD_BASE_HEIGHT,
  );
  // 缩放盒只管 scale；入场（useAppear 也写 transform）套在外层包装上，两边不互相覆盖
  const appear = useAppear(plan.tokens);
  const boxStyle: CSSProperties & Record<string, string | number> = {
    position: 'absolute',
    width: CARD_BASE_WIDTH,
    height: CARD_BASE_HEIGHT,
    left: Math.round((plan.composition.width - CARD_BASE_WIDTH * scale) / 2),
    top: Math.round((plan.composition.height - CARD_BASE_HEIGHT * scale) / 2),
    transform: `scale(${String(scale)})`,
    transformOrigin: 'top left',
    ...vars,
  };

  const progress = totalProgress(plan, scene, frame);

  return h(
    'div',
    { style: { position: 'absolute', inset: 0, ...useTransition(plan.tokens) } },
    h('div', {
      style: { position: 'absolute', left: 0, top: 0, right: 0, height: 3, backgroundColor: 'var(--track)' },
    }),
    h('div', {
      style: {
        position: 'absolute',
        left: 0,
        top: 0,
        height: 3,
        width: `${String(Math.round(Math.min(1, Math.max(0, progress)) * 100))}%`,
        backgroundColor: 'var(--accent)',
      },
    }),
    h(
      'div',
      { style: { position: 'absolute', inset: 0, ...appear } },
      h('div', { style: boxStyle, dangerouslySetInnerHTML: { __html: html } }),
    ),
  );
};
