/**
 * Remotion 打包：把 `entry.ts` 与它引用的所有模块打成一个浏览器能跑的 bundle。
 *
 * 打包只做一次，之后可以用同一个 serveUrl 反复渲染（`renderStill` 预览、正式渲染、
 * 换讲稿再渲染）。缓存目录交给 Remotion 自己管（`.remotion`），所以第二次起明显更快。
 *
 * **入口是固定的**：讲稿不进 bundle，它走 `inputProps`（见 `plan.ts` 的说明）。
 */
import { bundle } from '@remotion/bundler';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 入口文件。**两套布局都认**，与 `src/runtime.ts` 选阶段入口同一条理由：
 * 仓库内跑 `scripts/renderer/entry.ts`（Node 直接剥类型），装进 `node_modules` 后跑编译产物
 * `lib/scripts/renderer/entry.js`（那里不允许剥类型，Node 会报
 * `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`）。
 *
 * 判据是「哪个文件在」，不猜路径 —— 发布版里 `.ts` 根本不存在。
 */
export function entryPointPath(rendererDir: string): string {
  const candidates = [resolve(rendererDir, 'entry.ts'), resolve(rendererDir, 'entry.js')];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0] ?? resolve(rendererDir, 'entry.ts');
}

/** 打包结果：一个 `file://` URL（Remotion 的 webpack 输出目录）。 */
export type Bundle = { serveUrl: string; ms: number };

export async function bundleProject(options: {
  rendererDir: string;
  /** 进度回调，0–100。 */
  onProgress?: (percent: number) => void;
  /** 关掉缓存：逐帧一致验收用，避免命中旧缓存掩盖问题。 */
  cache?: boolean;
}): Promise<Bundle> {
  const started = Date.now();
  const serveUrl = await bundle({
    entryPoint: entryPointPath(options.rendererDir),
    // 不需要静态资源目录：素材走 `file://`（见 `assetUrl`），不进 bundle。
    publicDir: null,
    enableCaching: options.cache ?? true,
    onProgress: (percent: number) => options.onProgress?.(percent),
  });
  return { serveUrl: String(serveUrl), ms: Date.now() - started };
}
