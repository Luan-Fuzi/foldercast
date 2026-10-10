/** 音频缓存绑定合成请求与音频字节。每场合成后写回，失败后可继续复用已完成的场景。 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashFile, hashValue } from '../contracts/revisions.ts';

export type AudioCache = Record<string, { inputHash: string; audioHash: string }>;

export function synthesisHash(request: { text: string; provider: string; voice?: string; style?: string; format: string }): string {
  return hashValue({ cache: 1, ...request });
}

export function loadAudioCache(workRoot: string): AudioCache {
  try { return JSON.parse(readFileSync(join(workRoot, 'audio', 'cache.json'), 'utf8')) as AudioCache; }
  catch { return {}; }
}

export function canReuseAudio(cache: AudioCache, path: string, inputHash: string): boolean {
  const entry = cache[path];
  return entry?.inputHash === inputHash && existsSync(path) && hashFile(path) === entry.audioHash;
}

export function saveAudioCache(workRoot: string, cache: AudioCache): void {
  const path = join(workRoot, 'audio', 'cache.json');
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(cache, null, 2)}\n`);
  renameSync(temp, path);
}
