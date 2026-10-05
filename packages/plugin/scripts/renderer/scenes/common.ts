/**
 * 场景组件共用的几件东西：头部、自适应正文、面板。**没有 React 状态、没有时钟**，
 * 所以同一个 `scene` + 同一个帧号永远画出同一张图（逐帧一致的前提）。
 */
import { createElement as h, type CSSProperties, type ReactNode } from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import type { Media, Plan, SceneCommon } from '../plan.ts';
import { fitSize } from '../plan.ts';

/**
 * 素材 → 浏览器能读的地址。**只有 `media.src`**（`data:` URI）。
 *
 * 为什么没有第二条路：渲染时页面在 `http://localhost:<端口>`，`file://` 资源会被跨源拦掉。
 * 图片内联成 `data:`（`embed.ts`）；**视频连内联都不行** —— Remotion 的 `<OffthreadVideo>`
 * 只认 `http(s)://`（实测：`Can only download URLs starting with http:// or https://`），
 * 所以 `clip` 场景放的是素材阶段抽出来的**封面图**，不是活动画面。
 *
 * 拼不出地址时返回 `undefined`，画面落到占位说明上 —— 比让 `<img>` 去 fetch 一个必然被拦的
 * `file://` 好。
 */
export function assetUrl(media: Media | undefined): string | undefined {
  return media?.src;
}

/**
 * 正文自适应：字符多就小一号。**按最长的可见文本估**，因为没有布局引擎可以回读。
 * 这不是精修版式，是把「一定放不下」压到「勉强放得下」，剩下的交给换行。
 */
/** 头部：进度点 + 「场景 03 / 15」+ 标题。`cover` / `outro` 不用它（它们自己有版式）。 */
export function sceneHeader(scene: SceneCommon, plan: Plan, eyebrow: string): ReactNode {
  const index = plan.scenes.findIndex((item) => item.id === scene.id) + 1;
  const total = plan.scenes.length;
  const tokens = plan.tokens;

  return h(
    'div',
    {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 24,
        marginBottom: Math.round(tokens.bodySize * 0.9),
      },
    },
    h('div', {
      style: {
        width: 8,
        height: Math.round(tokens.headingSize * 1.1),
        borderRadius: 4,
        backgroundColor: 'var(--accent)',
        flexShrink: 0,
      },
    }),
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 } },
      h(
        'div',
        {
          style: {
            fontSize: Math.round(tokens.bodySize * 0.62),
            letterSpacing: 2,
            color: 'var(--muted)',
            textTransform: 'uppercase',
          },
        },
        `${eyebrow} · ${String(index).padStart(2, '0')} / ${String(total).padStart(2, '0')}`,
      ),
      h(
        'div',
        {
          style: {
            fontFamily: 'var(--font-title)',
            fontSize: fitSize(scene.title, tokens.headingSize, Math.round(tokens.headingSize * 0.62)),
            fontWeight: tokens.titleWeight,
            lineHeight: 1.2,
          },
        },
        scene.title,
      ),
    ),
  );
}

/** 内容区：整屏减去安全边距与字幕条的位置。 */
export function contentBox(tokens: Plan['tokens']): CSSProperties {
  return {
    position: 'absolute',
    left: tokens.safeMargin,
    right: tokens.safeMargin,
    top: Math.round(tokens.height * 0.11),
    bottom: Math.round(tokens.height * 0.2),
    display: 'flex',
    flexDirection: 'column',
  };
}

/** 圆角面板。样式全部走 token，组件里不出现颜色字面量。 */
export function panel(style: CSSProperties, ...children: ReactNode[]): ReactNode {
  return h(
    'div',
    {
      style: {
        backgroundColor: 'var(--panel)',
        borderRadius: 'var(--radius)',
        boxShadow: 'var(--shadow)',
        border: '1px solid var(--line)',
        padding: 28,
        ...style,
      },
    },
    ...children,
  );
}

/** 进入动画：只在开头 10 帧淡入 + 轻微上移。**不做退场**，避免末帧闪烁。 */
export function useAppear(frames = 10): CSSProperties {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [0, frames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return { opacity: progress, transform: `translateY(${Math.round((1 - progress) * 14)}px)` };
}
