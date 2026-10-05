/**
 * 素材内联的**类型与默认值**。这个文件会进浏览器 bundle（`plan.ts` 引它），
 * 所以**不许 import 任何 `node:` 模块** —— 实现放在 `embed-node.ts`，由 CLI 与渲染器调用。
 *
 * 这条边界是硬的，不是风格问题：`plan.ts` 原来直接 import 实现文件，webpack 打包时
 * 撞上 `node:child_process` 直接失败（`UnhandledSchemeError`）。浏览器那一侧只认数据。
 */

/** 内联一件素材的目标。 */
export type EmbedTarget = {
  /** 工作根下的相对路径（讲稿里的素材路径）。 */
  path: string;
  workRoot: string;
  /** 位图缩放后的最大宽度。 */
  width: number;
  /** JPEG 质量（1–100）。 */
  quality?: number;
};

/** 内联成功的结果。 */
export type Embedded = {
  /** 可直接放进 `src` 的 data URI。 */
  src: string;
  /** 实际内联的字节数（解码后）。 */
  bytes: number;
  /** 是否做过缩放（`false` 表示内联的是原文件）。 */
  scaled: boolean;
  /** 缩放工具不可用时的说明，调用方可以报出来。 */
  note?: string;
};

/** 内联函数：给不了就返回 undefined（调用方保留路径引用）。 */
export type EmbedFn = (target: EmbedTarget) => Embedded | undefined;

/** 内联时的目标宽度：画面上最大的素材是整页文档（1920 宽的画布里放两页），1600 够用。 */
export const EMBED_WIDTH = 1600;
