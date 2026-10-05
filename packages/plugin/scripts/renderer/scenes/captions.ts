/**
 * 字幕组件。**必须由渲染层画**：本机 ffmpeg 没有 libass，`subtitles` 与 `drawtext`
 * 滤镜都不可用（ADR 0003、SYSTEM-DESIGN §4.2）。自己画反而更好控：字体、位置、换行、
 * 描边全部确定，不依赖系统字体配置。
 *
 * 文本本身来自 `contracts/subtitles.ts` 的切分（与校验器、M8 同一份实现），
 * 这里只负责排版：一行不换行（切分规则保证每块 ≤24 宽度单位），底衬保证在任何背景上都能读。
 */
import { createElement as h, type CSSProperties } from 'react';
import { captionColors, type Tokens } from '../styles.ts';

/**
 * 字幕条的可读性底衬：半透明面板 + 圆角，深浅背景上都能读。
 *
 * **面板不用「内容撑高 + flex 居中」**：无头 Chrome 在这种嵌套下会把面板与文字分开摆放
 * （面板按一行算、文字掉到盒子外，实测过），所以这里所有尺寸都是像素级的确定值 ——
 * 面板绝对定位在字幕带正中间，高度由行数算出来。宁可多写几行算式，也不要一个
 * 「理论上居中、实际跑偏」的布局。
 */
export function captionStyle(tokens: Tokens, text: string, bandHeight: number): CSSProperties {
  const colors = captionColors(tokens);
  // 一行按 22 个宽度单位估（切分上限是 24，留一点余量），够判断要不要两行。
  const lines = Math.max(1, Math.ceil([...text].length / 22));
  const height = Math.min(bandHeight, Math.round(tokens.captionSize * 1.38 * lines + tokens.captionSize * 0.5));
  return {
    position: 'absolute',
    left: '50%',
    top: Math.round((bandHeight - height) / 2),
    transform: 'translateX(-50%)',
    height,
    maxWidth: Math.round(tokens.width * 0.72),
    borderRadius: Math.round(tokens.radius * 1.6),
    backgroundColor: colors.background,
    color: colors.color,
    fontFamily: 'var(--font-body)',
    fontSize: tokens.captionSize,
    lineHeight: `${height}px`,
    textAlign: 'center',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    boxShadow: colors.shadow,
    boxSizing: 'border-box',
  };
}

/** 画面顶部的一条进度：当前场景在整片里的位置。到片尾刚好走满。 */
export function progressStyle(tokens: Tokens, progress: number): CSSProperties {
  return {
    position: 'absolute',
    left: 0,
    top: 0,
    height: 4,
    width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`,
    backgroundColor: 'var(--accent)',
  };
}
