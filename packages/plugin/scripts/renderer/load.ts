/**
 * 从磁盘读渲染需要的东西：讲稿、解读、素材清单、样式预设。
 *
 * **这里就是「讲稿运行时加载」的落点**（ROADMAP 已识别的坑 1）：路径是运行时参数，
 * 不是静态 import。所以加一个目录不需要改任何 TypeScript 源码。
 *
 * 每条错都带「下一步怎么办」：缺哪个文件、先跑哪个命令。渲染阶段的用户是主 agent，
 * 它要靠这句话决定重跑哪一步。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';
import type { AssetManifest } from '../contracts/assets.ts';
import type { FoldercastDocument } from '../contracts/foldercast.ts';
import type { DurationsDocument } from '../contracts/durations.ts';
import type { ScriptDocument } from '../contracts/script.ts';
import { DEFAULT_PRESET } from './plan.ts';

/** 一个读进来的文件，附带它的来源路径（报错与日志要用）。 */
export type Loaded<T> = { value: T; path: string };

export class LoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoadError';
  }
}

function readJson<T>(path: string, what: string, hint: string): Loaded<T> {
  if (!existsSync(path)) {
    throw new LoadError(`找不到${what}：${path}\n${hint}`);
  }
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new LoadError(`读不了${what}：${path}\n${(error as Error).message}`);
  }
  try {
    return { value: JSON.parse(text) as T, path };
  } catch (error) {
    throw new LoadError(`${what}不是合法 JSON：${path}\n${(error as Error).message}`);
  }
}

/** 被讲解的目录 → 工作根 `<目录>/.foldercast/`。与其它阶段同一套路径基准。 */
export function workRootOf(target: string): string {
  return resolve(target, '.foldercast');
}

/** 读讲稿。`source.root` 与解读不一致时由校验器负责报，这里只读。 */
export function loadScript(workRoot: string, override?: string): Loaded<ScriptDocument> {
  const path = override === undefined ? join(workRoot, 'script.json') : resolve(override);
  const loaded = readJson<ScriptDocument>(path, '讲稿', '先用 M5 写稿，或手写一份 script.json。');
  const version = (loaded.value as { foldercast?: unknown }).foldercast;
  if (version !== 1) {
    throw new LoadError(
      `讲稿的格式版本是 ${String(version)}，这个版本只认 1：${path}\n重跑写稿阶段。`,
    );
  }
  if (!Array.isArray(loaded.value.scenes) || loaded.value.scenes.length === 0) {
    throw new LoadError(`讲稿里没有场景：${path}`);
  }
  return loaded;
}

/** 读解读。渲染只要它的一部分（文件名、尺寸、统计），但缺了就没法出片。 */
export function loadReading(workRoot: string, override?: string): Loaded<FoldercastDocument> {
  const path = override === undefined ? join(workRoot, 'foldercast.json') : resolve(override);
  const loaded = readJson<FoldercastDocument>(path, '解读', '先跑分析器：pnpm analyze <目录>');
  const version = (loaded.value as { foldercast?: unknown }).foldercast;
  if (version !== 1) {
    throw new LoadError(
      `解读的格式版本是 ${String(version)}，这个版本只认 1：${path}\n重跑分析器。`,
    );
  }
  return loaded;
}

/**
 * 读配音产物 `durations.json`。**可选**：没有它就用字数预估（M7 的默认路径）。
 *
 * 读不出来（坏 JSON）时返回 undefined 并**不报错**：配音产物是可重算的缓存，
 * 一台没跑过配音的机器上它本来就不存在。渲染报告里会写明用的是哪一套时长。
 */
export function loadDurations(workRoot: string, override?: string): DurationsDocument | undefined {
  const path = override === undefined ? join(workRoot, 'durations.json') : resolve(override);
  if (!existsSync(path)) return undefined;
  try {
    const document = JSON.parse(readFileSync(path, 'utf8')) as DurationsDocument;
    return document.durations === 1 ? document : undefined;
  } catch {
    return undefined;
  }
}

/** 读素材清单。**可选**：没有它照样出片，只是画面拿不到尺寸与提取出的正文。 */
export function loadAssets(workRoot: string): AssetManifest | undefined {
  const path = join(workRoot, 'assets', 'manifest.json');
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as AssetManifest;
  } catch {
    return undefined;
  }
}

/**
 * 找样式预设。查找顺序：显式 `--style` 指定的名字 → 讲稿里的 `style.preset` → `deck`。
 *
 * 找不到时**不报错**：预设是装饰，缺了照样出片（用兜底 token）。这也是「换预设不必改代码」
 * 的落点 —— 预设是 `styles/*.json` 数据文件。
 */
export function loadPreset(
  stylesDir: string,
  preferred: string,
): { name: string; value: unknown; path?: string; warning?: string } {
  const candidates = [preferred, DEFAULT_PRESET];
  for (const name of candidates) {
    const path = join(stylesDir, `${name}.json`);
    if (!existsSync(path)) continue;
    try {
      return { name, value: JSON.parse(readFileSync(path, 'utf8')) as unknown, path };
    } catch (error) {
      return {
        name,
        value: undefined,
        warning: `样式预设读不了（用兜底 token）：${path}\n${(error as Error).message}`,
      };
    }
  }
  return {
    name: preferred,
    value: undefined,
    warning: `样式预设 ${preferred} 不在 ${stylesDir} 里，用兜底 token`,
  };
}

/**
 * 样式预设目录（`<仓库根>/styles/`）。
 *
 * **上溯找标记文件，不按目录层级硬算**：`main.ts` 有两套布局（仓库内 `scripts/renderer/`
 * 与发布版 `lib/scripts/renderer/`），按 `../../..` 数层级在发布版里会算成 `packages/styles`
 * —— 实测就是这样（编译产物跑出来「样式预设 deck 不在 …」）。与 `src/runtime.ts` 找包根同一套办法。
 *
 * 找不到时返回 undefined：预设是装饰，缺了用兜底 token 照样出片（渲染器不该因此失败）。
 */
export function findStylesDir(start: string): string | undefined {
  let current = resolve(start);
  const { root } = parse(current);
  for (;;) {
    const candidate = join(current, 'styles');
    if (existsSync(join(candidate, `${DEFAULT_PRESET}.json`))) return candidate;
    if (current === root) return undefined;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/** 工作根的父目录：`assets/` 路径的基准。 */
export function sourceDirOf(workRoot: string): string {
  return dirname(resolve(workRoot));
}
