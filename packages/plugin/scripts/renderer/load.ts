/**
 * 从磁盘读渲染需要的东西：讲稿与（可选的）配音产物。
 *
 * **这里就是「讲稿运行时加载」的落点**：路径是运行时参数，不是静态 import。
 * 所以加一个目录不需要改任何 TypeScript 源码。
 *
 * 每条错都带「下一步怎么办」：缺哪个文件、先跑哪一步。渲染阶段的用户是主 agent，
 * 它要靠这句话决定重跑哪一步。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { DurationsDocument } from '../contracts/durations.ts';
import { SCRIPT_VERSION, type ScriptDocument } from '../contracts/script.ts';
import { hashFile, hashValue } from '../contracts/revisions.ts';
import { synthesisHash } from '../voice/cache.ts';

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

/** 被讲解的目录 → 工作根 `<目录>/.foldercast/`。 */
export function workRootOf(target: string): string {
  return resolve(target, '.foldercast');
}

/** 读讲稿。 */
export function loadScript(workRoot: string, override?: string): Loaded<ScriptDocument> {
  const path = override === undefined ? join(workRoot, 'script.json') : resolve(override);
  const loaded = readJson<ScriptDocument>(path, '讲稿', '先按 skill 写一份 script.json（或手写）。');
  const version = (loaded.value as { foldercast?: unknown }).foldercast;
  if (version !== SCRIPT_VERSION) {
    throw new LoadError(
      `讲稿的格式版本是 ${String(version)}，这个版本只认 ${String(SCRIPT_VERSION)}：${path}\n按当前契约重写讲稿（v2：场景支持 beats 节拍）。`,
    );
  }
  if (!Array.isArray(loaded.value.scenes) || loaded.value.scenes.length === 0) {
    throw new LoadError(`讲稿里没有场景：${path}`);
  }
  return loaded;
}

/**
 * 读配音产物 `durations.json`。**可选**：没有它就用字数预估。
 *
 * 读不出来（坏 JSON）时返回 undefined 并**不报错**：配音产物是可重算的缓存，
 * 一台没跑过配音的机器上它本来就不存在。
 */
export function loadDurations(workRoot: string, override?: string, script?: ScriptDocument): DurationsDocument | undefined {
  const path = override === undefined ? join(workRoot, 'durations.json') : resolve(override);
  if (!existsSync(path)) return undefined;
  try {
    const document = JSON.parse(readFileSync(path, 'utf8')) as DurationsDocument;
    if (document.durations !== 1) return undefined;
    if (script !== undefined) {
      const expected = hashValue(script.scenes.map(({ id, narration }) => ({ id, narration })));
      const scenes = new Map(script.scenes.map((scene) => [scene.id, scene]));
      const valid = document.narrationHash === expected && document.scenes.every((scene) => {
        const narration = scenes.get(scene.id)?.narration;
        const audio = resolve(workRoot, scene.audio);
        return narration !== undefined && scene.inputHash === synthesisHash({
          text: narration, provider: document.provider, voice: document.synthesisVoice ?? undefined, style: document.style, format: 'wav',
        }) && existsSync(audio) && scene.audioHash === hashFile(audio);
      });
      const trackValid = document.track === '' ||
        (hashValue(document.scenes.map(({ id }) => id)) === hashValue(script.scenes.map(({ id }) => id)) &&
          existsSync(resolve(workRoot, document.track)) && document.trackHash === hashFile(resolve(workRoot, document.track)));
      const settingsValid = document.voiceSpecHash === hashValue(script.voice ?? {});
      if (!valid || !trackValid || !settingsValid) throw new LoadError('配音产物缺少版本记录、已过期、音轨不完整或音频被改动。先重跑 pnpm voice；匹配的场景音频会自动复用。');
    }
    return document;
  } catch (error) {
    if (error instanceof LoadError) throw error;
    if (script !== undefined) throw new LoadError('配音时长表无法读取。先重跑 pnpm voice，或移除旧 durations.json 后生成静音草稿。');
    return undefined;
  }
}

/** 工作根的父目录：`assets/` 路径的基准。 */
export function sourceDirOf(workRoot: string): string {
  return dirname(resolve(workRoot));
}
