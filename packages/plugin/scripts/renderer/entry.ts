/**
 * Remotion 的入口。**它是唯一认识 Remotion 的文件**，场景组件只认 `Plan` 这个纯数据结构
 * （`plan.ts`），这样「讲稿会渲染成什么」可以在没有浏览器、没有 React 的情况下断言。
 *
 * 讲稿是在 CLI 里读的（`load.ts`），通过 `inputProps` 进来，所以这个入口里没有任何
 * 静态 import 的讲稿 —— 加一个目录不需要改这里的代码（ROADMAP 已识别的坑 1）。
 *
 * 时长也用 `calculateMetadata` 写死成 `plan.composition.durationInFrames`：帧数在 CLI 里
 * 就算好了，浏览器只负责画。这样「同一份讲稿两次渲染逐帧一致」不依赖浏览器里的任何计算。
 */
import { createElement as h } from 'react';
import { AbsoluteFill, Audio, Composition, Sequence, registerRoot } from 'remotion';
import type { Plan, PlanScene } from './plan.ts';
import { TOKENS } from './styles.ts';
import { captionStyle } from './scenes/captions.ts';
import { useTransition } from './scenes/common.ts';
import { SceneView } from './scenes/index.ts';

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

const Frame = ({ scene, plan, base }: { scene: PlanScene; plan: Plan; base: string }) => {
  // 转场（`motion.transition`）包住场景内容。**样式从原来的 AbsoluteFill 搬到这层**，
  // 好让转场只作用于内容、不作用于字幕条 —— 布局与搬运前逐项相同，只是多了一层可动画的容器。
  const style: Record<string, unknown> = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    fontFamily: 'var(--font-body)',
    color: 'var(--ink)',
    ...useTransition(plan.tokens),
  };
  if (scene.type === 'cover' || scene.type === 'outro') {
    style['justifyContent'] = 'center';
  }
  if (scene.type === 'gallery') {
    style['flexDirection'] = 'column';
    style['alignItems'] = 'center';
    style['justifyContent'] = 'center';
  }

  return h(
    AbsoluteFill,
    null,
    h('div', { style }, h(SceneView, { scene, plan })),
    h(CaptionBar, { scene, plan }),
  );
};

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

export const FoldercastVideo = ({ plan, base, audio }: FoldercastProps) => {
  const style: Record<string, unknown> = {
    ...plan.css,
    backgroundColor: 'var(--bg)',
    width: '100%',
    height: '100%',
  };
  if (plan.tokens.grain > 0) {
    style['backgroundImage'] = 'radial-gradient(rgba(255,255,255,0.04) 1px, transparent 0)';
    style['backgroundSize'] = '4px 4px';
  }

  // 每个场景挂在它自己的 `Sequence` 上。
  //
  // **`premountFor` 从整片长度换成 1 秒**：给足整片长度时实测同一段帧序列会画出重复的
  // 帧（第 100、101、102 帧字节完全相同），说明「提前挂载」在按帧范围渲染时会打乱
  // `useCurrentFrame()` 的取值。1 秒足够让下一场的图片在切换前开始解码，又不至于让
  // 多个场景同时处于「渲染中」的状态。
  return h(
    AbsoluteFill,
    { style },
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
        h(Frame, { scene, plan, base }),
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
