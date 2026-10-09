/**
 * 场景帧共用的动画 hooks：转场与入场。**没有 React 状态、没有时钟**，所以同一个
 * `plan` + 同一个帧号永远算出同一组样式（逐帧一致的前提）。
 *
 * 场景本体（标记与排版）在 `scenecard/`（0006）；节拍的逐帧变量在 `cardframe.ts`。
 */
import { createElement as h, type CSSProperties } from 'react';
import { Easing, interpolate, useCurrentFrame } from 'remotion';
import type { Tokens } from '../plan.ts';

/**
 * `motion.easing` → Remotion 的缓动函数。
 *
 * 名字取自规格 §3.5，白名单外的名字回落到 `easeOutCubic`。
 */
const EASINGS: Record<string, (input: number) => number> = {
  linear: Easing.linear,
  ease: Easing.ease,
  easeInCubic: Easing.in(Easing.cubic),
  easeOutCubic: Easing.out(Easing.cubic),
  easeInOutCubic: Easing.inOut(Easing.cubic),
  easeOutQuint: Easing.out(Easing.poly(5)),
  easeOutSine: Easing.out(Easing.sin),
  easeInOutSine: Easing.inOut(Easing.sin),
  easeOutBack: Easing.out(Easing.back(1.4)),
  easeOutExpo: Easing.out(Easing.exp),
};

function resolveEasing(name: string): (input: number) => number {
  return EASINGS[name] ?? Easing.out(Easing.cubic);
}

/** `motion.in: type` 的离散步数。**离散**才有「打印」的质感，平滑划过就只是擦除。 */
const TYPE_STEPS = 12;

/** 转场的基准帧数（30fps 下 12 帧 = 0.4 秒），再乘 `motion.pace`。 */
const TRANSITION_FRAMES = 12;

/**
 * 场景间转场（`motion.transition`）：`cut` 硬切 / `fade` 从底色淡入 / `wipe` 横向揭开。
 *
 * **实现方式是「本场景自己的入场」，不是两场交叉叠化。** 交叉叠化要让相邻两个 `Sequence`
 * 重叠，而重叠会同时渲染两场 —— README 里 `premountFor` 那条实测（多场同时处于渲染中会画出
 * 重复帧）正是这个坑。淡入用画面底层的 `--bg` 当过渡色，观感上仍是「淡出再淡入」，
 * 但每个帧号只渲染一个场景，**逐帧一致的判据不受影响**。
 *
 * 转场只包场景内容，**不包字幕条**：字幕与音轨对齐，跟着一起淡会看起来像掉帧。
 */
export function useTransition(tokens: Tokens): CSSProperties {
  const frame = useCurrentFrame();
  if (tokens.transition === 'cut') return {};

  const span = Math.max(1, Math.round(TRANSITION_FRAMES * tokens.pace));
  const progress = interpolate(frame, [0, span], [0, 1], {
    easing: resolveEasing(tokens.easing),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  if (tokens.transition === 'wipe') {
    return { clipPath: `inset(0 ${Math.round((1 - progress) * 100)}% 0 0)` };
  }
  return { opacity: progress };
}

/**
 * 卡片入场（挂在基准盒上）。三件事都由 `motion.*` 决定：
 *
 * | 字段 | 作用 |
 * |---|---|
 * | `pace` | 时长倍率（慢 → 更久），**不影响字号** |
 * | `in` | `fade` 只淡入 / `slide` 淡入 + 上移 / `type` 横向分步揭开 / `none` 不动 |
 * | `easing` | 缓动曲线 |
 *
 * **不做退场**，避免末帧闪烁。`type` 用 `clipPath` 分步揭开而不是逐字渲染 —— 逐字会改变换行
 * 与字宽，同一个场景在不同字号下会跳版。
 */
export function useAppear(tokens: Tokens, frames = 10): CSSProperties {
  const frame = useCurrentFrame();
  if (tokens.enter === 'none') return {};

  const span = Math.max(1, Math.round(frames * tokens.pace));
  const progress = interpolate(frame, [0, span], [0, 1], {
    easing: resolveEasing(tokens.easing),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  if (tokens.enter === 'type') {
    const stepped = Math.floor(progress * TYPE_STEPS) / TYPE_STEPS;
    return { clipPath: `inset(0 ${Math.round((1 - stepped) * 100)}% 0 0)` };
  }
  if (tokens.enter === 'fade') return { opacity: progress };
  return { opacity: progress, transform: `translateY(${Math.round((1 - progress) * 14)}px)` };
}
