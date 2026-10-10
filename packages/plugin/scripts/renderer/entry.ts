/// <reference lib="dom" />
/**
 * Remotion 的入口。**它是唯一认识 Remotion 的文件**，画面本体是场景卡 HTML
 * （`scenecard/`，0006）：这里只做三件事——注入卡片 CSS、按场景挂 `Sequence`、
 * 每帧把节拍变量交给 `CardFrame`。讲稿在 CLI 里读（`load.ts`）经 `inputProps` 进来，
 * 所以这里没有静态 import 的讲稿。
 *
 * 时长用 `calculateMetadata` 写死成 `plan.composition.durationInFrames`：帧数在 CLI 里
 * 就算好了，浏览器只负责画。「同一份讲稿两次渲染逐帧一致」不依赖浏览器里的任何计算。
 */
import { createElement as h, useMemo, type ReactElement } from 'react';
import { AbsoluteFill, Audio, Composition, Sequence, continueRender, delayRender, registerRoot } from 'remotion';
import type { Plan, PlanScene } from './plan.ts';
import { TOKENS } from './styles.ts';
import { buildCards } from './cards.ts';
import { CARD_CSS } from '../scenecard/render.ts';
import { captionStyle } from './scenes/captions.ts';
import { CardFrame } from './scenes/cardframe.ts';

export type FoldercastProps = {
  plan: Plan;
  /** 素材路径的基准：**被讲解目录的绝对路径**（只有 `clip` 的封面图用得着）。 */
  base: string;
  /**
   * 旁白音轨的地址（`data:` URI）。**必须内联**：Remotion 取资源只认 http(s) 与 data，
   * `file://` 会被拒（`Can only download URLs starting with http:// or https://`）。
   * 一段 6 分钟的 wav 大约 30 MB，转成 base64 约 40 MB —— 换一次「不用起本地服务」是划算的。
   */
  audio?: string;
};

/** 兜底规格，与 `plan.ts` 的 `DEFAULT_VIDEO` 一致；真正渲染时一律由 plan 决定。 */
const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;
const DEFAULT_FPS = 30;

/**
 * 图片预载（0006）：卡片里的 `<img>` 是 innerHTML 注入的，Remotion 的 `<Img>` 组件
 * （自带逐张 delayRender）罩不到。**不在每张卡上挂 handle**——实测每场景挂
 * delayRender/continueRender 会让截图时机漂移，逐帧一致性间歇性挂掉；改成**整片开工前
 * 一次性预载全部图片**（单个 handle、只解析一次），之后每帧的 `<img>` 全是内存缓存
 * 命中，同步可用。素材都是 `data:` URI（`embed.ts`），预载不依赖网络。
 * 在渲染期调用（不是 useEffect）：handle 必须在第一次截图前登记。
 */
function preloadImages(htmls: readonly string[]): void {
  const srcs = new Set<string>();
  for (const html of htmls) {
    for (const match of html.matchAll(/src="(data:image\/[^"]+)"/g)) srcs.add(match[1] ?? '');
  }
  if (srcs.size === 0) return;
  const handle = delayRender(`preload ${String(srcs.size)} card images`);
  let rest = srcs.size;
  for (const src of srcs) {
    const img = document.createElement('img');
    const done = (): void => {
      rest -= 1;
      if (rest === 0) continueRender(handle);
    };
    img.addEventListener('load', done, { once: true });
    img.addEventListener('error', done, { once: true });
    img.src = src;
  }
}

const Frame = ({
  scene,
  plan,
  html,
}: {
  scene: PlanScene;
  plan: Plan;
  html: string;
}) => h(AbsoluteFill, null, h(CardFrame, { scene, plan, html }), h(CaptionBar, { scene, plan }));

/** 字幕条：**由渲染层画，不走 ffmpeg**（本机 ffmpeg 没有 libass，见 ADR 0003）。 */
const CaptionBar = ({ scene, plan }: { scene: PlanScene; plan: Plan }) => {
  const tokens = plan.tokens;
  const bandHeight = Math.round(tokens.height * 0.13);
  const boxes = scene.parts.map((part, index) =>
    h(
      Sequence,
      { key: `part-${index}`, from: part.from, durationInFrames: Math.max(1, part.to - part.from) },
      h('div', { style: captionStyle(tokens, part.text, bandHeight) }, part.text),
    ),
  );
  return h(
    'div',
    {
      style: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: Math.round(tokens.height * 0.045),
        height: bandHeight,
        pointerEvents: 'none',
      },
    },
    ...boxes,
  );
};

export const FoldercastVideo = ({ plan, base, audio }: FoldercastProps): ReactElement => {
  const style: Record<string, unknown> = {
    ...plan.css,
    backgroundColor: 'var(--bg)',
    color: 'var(--ink)',
    width: '100%',
    height: '100%',
  };
  if (plan.tokens.grain > 0) {
    style['backgroundImage'] = 'radial-gradient(rgba(255,255,255,0.04) 1px, transparent 0)';
    style['backgroundSize'] = '4px 4px';
  }
  // 场景卡 HTML 纯函数现算：同一份 plan 永远得到同一组卡（逐帧一致不受影响）。
  // 图片预载也只在这一步发生一次（渲染期登记 handle，首帧截图前完成解码）。
  const cards = useMemo(() => buildCards(plan), [plan]);
  useMemo(() => {
    preloadImages(Object.values(cards));
    return null;
  }, [cards]);

  // 每个场景挂在它自己的 `Sequence` 上。
  //
  // **`premountFor: 0`（0006 起禁用提前挂载）**：场景卡是大块 innerHTML 注入，下一场
  // 提前挂载会扰动长驻渲染页的光栅状态——实测同一夹具连渲四次出三种字节（差异是
  // 个别帧上亚像素级的抗锯齿漂移），关掉 premount 后 4/4 字节一致；旧 React 场景
  // 组件对此不敏感，所以这个问题是 0006 换卡片注入后才出现的。premount 原本的
  // 收益（下一场的图片提前解码）由 `CardFrame` 里对卡片 `<img>` 的显式 delayRender
  // 承担，不再需要预挂载。
  return h(
    AbsoluteFill,
    { style },
    h('style', { dangerouslySetInnerHTML: { __html: CARD_CSS } }),
    // 整条音轨从头播到尾：它的长度等于场景时长之和，与画面一一对应（配音阶段保证）
    audio === undefined ? null : h(Audio, { src: audio, volume: 1 }),
    ...plan.scenes.map((scene, index) =>
      h(
        Sequence,
        {
          key: scene.id,
          from: plan.scenes.slice(0, index).reduce((sum, item) => sum + item.durationInFrames, 0),
          durationInFrames: scene.durationInFrames,
          premountFor: Math.min(30, plan.composition.fps),
        },
        h(Frame, { scene, plan, html: cards[scene.id] ?? '' }),
      ),
    ),
  );
};

/**
 * `calculateMetadata` 只做一件事：把 CLI 算好的帧数交给 Remotion。宽度/帧率也在这里，
 * 于是「出片规格」的唯一来源是 `plan.composition`，浏览器里不再有第二份时长计算。
 */
const Root = () =>
  h(Composition, {
    id: 'foldercast',
    component: FoldercastVideo,
    durationInFrames: 1,
    fps: DEFAULT_FPS,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    defaultProps: { plan: EMPTY_PLAN, base: '' },
    calculateMetadata: ({ props }: { props: FoldercastProps }) => ({
      durationInFrames: Math.max(1, props.plan.composition.durationInFrames),
      fps: props.plan.composition.fps,
      width: props.plan.composition.width,
      height: props.plan.composition.height,
      props,
    }),
  } as never);

/** `defaultProps` 只为满足类型；真正渲染时一定带完整 plan。 */
const EMPTY_PLAN = {
  composition: { id: 'foldercast', width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, fps: DEFAULT_FPS, durationInFrames: 1 },
  title: '',
  label: '',
  root: '',
  tokens: { ...TOKENS },
  css: {},
  scenes: [],
  warnings: [],
} satisfies Plan;

registerRoot(Root);
