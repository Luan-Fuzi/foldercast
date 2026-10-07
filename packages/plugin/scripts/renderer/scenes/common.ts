/**
 * 场景组件共用的几件东西：头部、自适应正文、面板。**没有 React 状态、没有时钟**，
 * 所以同一个 `scene` + 同一个帧号永远画出同一张图（逐帧一致的前提）。
 */
import { createElement as h, type CSSProperties, type ReactNode } from 'react';
import { Easing, interpolate, useCurrentFrame } from 'remotion';
import type { Media, Plan, SceneCommon, Tokens } from '../plan.ts';
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
/** 罗马数字（章节编号用）。超过 3999 不追精度，退化成十进制 —— 那是列表上不可能出现的长度。 */
const ROMAN: ReadonlyArray<readonly [number, string]> = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

function roman(value: number): string {
  if (value <= 0 || value > 3999) return String(value);
  let rest = value;
  let out = '';
  for (const [amount, glyph] of ROMAN) {
    while (rest >= amount) {
      out += glyph;
      rest -= amount;
    }
  }
  return out;
}

/**
 * 章节序号按 `layout.numbering` 排版。
 *
 * `none` 用不补零的阿拉伯数字：**它仍然要显示**，否则 `header: chapter-progress` 就没有进度了。
 * `numbering` 控制的是**样式**，不是要不要显示。
 */
function chapterIndex(value: number, numbering: Tokens['numbering']): string {
  if (numbering === 'roman') return roman(value);
  if (numbering === 'decimal') return String(value).padStart(2, '0');
  return String(value);
}

/**
 * 头部：可选装饰（`layout.header`）+ 编号样式（`layout.numbering`）+ 分隔线（`layout.rule`）。
 *
 * | `header` | 强调条 | 「小字 · 序号 / 总数」 | 标题 |
 * |---|---|---|---|
 * | `none` | ✗ | ✗ | ✓ |
 * | `title` | ✓ | ✗ | ✓ |
 * | `chapter-progress` | ✓ | ✓ | ✓ |
 *
 * **`none` 只去掉页眉装饰，标题永远保留。** 规格把三个取值写成「页眉：none / title /
 * chapter-progress」，没说标题算页眉还是算内容。实测按「都不画」实现之后，`console`
 * （`header: none`）的每一场都成了无标题画面 —— 观众看不出「代码 40% / 文本 40%」在讲什么。
 * 标题是内容，装饰才是页眉，所以这里只砍装饰。
 *
 * `cover` / `outro` 不走这条路径（它们自带版式）。
 */
export function sceneHeader(scene: SceneCommon, plan: Plan, eyebrow: string): ReactNode {
  const tokens = plan.tokens;

  const index = plan.scenes.findIndex((item) => item.id === scene.id) + 1;
  const total = plan.scenes.length;
  const decorated = tokens.header !== 'none';

  const heading = h(
    'div',
    {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: Math.round(24 * tokens.space),
        marginBottom: Math.round(tokens.bodySize * 0.9 * tokens.space),
      },
    },
    decorated
      ? h('div', {
          style: {
            width: 8,
            height: Math.round(tokens.headingSize * 1.1),
            borderRadius: 4,
            backgroundColor: 'var(--accent)',
            flexShrink: 0,
          },
        })
      : null,
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 } },
      tokens.header === 'chapter-progress'
        ? h(
            'div',
            {
              style: {
                fontSize: Math.round(tokens.bodySize * 0.62),
                letterSpacing: 2,
                color: 'var(--muted)',
                textTransform: 'uppercase',
              },
            },
            `${eyebrow} · ${chapterIndex(index, tokens.numbering)} / ${String(total).padStart(2, '0')}`,
          )
        : null,
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

  // 分隔线画在头部之下、整幅宽度：`hairline`（1px）与 `bold`（3px）肉眼可分。
  if (tokens.rule === 0) return heading;
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column' } },
    heading,
    h('div', {
      style: {
        height: 'var(--rule-w)',
        backgroundColor: 'var(--line)',
        marginBottom: Math.round(tokens.bodySize * 0.8 * tokens.space),
      },
    }),
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

/** 圆角面板。样式全部走 token，组件里不出现颜色字面量。内边距跟随 `layout.density`。 */
export function panel(style: CSSProperties, ...children: ReactNode[]): ReactNode {
  return h(
    'div',
    {
      style: {
        backgroundColor: 'var(--panel)',
        borderRadius: 'var(--radius)',
        boxShadow: 'var(--shadow)',
        border: '1px solid var(--line)',
        padding: `calc(28px * var(--space))`,
        ...style,
      },
    },
    ...children,
  );
}

/**
 * `motion.easing` → Remotion 的缓动函数。
 *
 * 名字取自规格 §3.5，白名单外的名字**回落到 `easeOutCubic` 并由 `tokensFromPreset` 报出来**
 * （不在这里报，因为这里每帧都会跑）。
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
 * 进入动画。三件事都由 `motion.*` 决定：
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
