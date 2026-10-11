/** 源引用只允许目录内相对路径；输出比较使用真实路径，避免符号链接别名绕过。 */
import { lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';

export class ReferencePathError extends Error {
  constructor(reference: string) {
    super(`引用必须是源目录内的相对路径（包括符号链接的真实位置）：${reference}`);
    this.name = 'ReferencePathError';
  }
}

/** 未创建的输出也按最近存在的祖先解析；损坏的链接不能当成普通缺失文件。 */
export function realPath(path: string): string {
  const absolute = resolve(path);
  if (lstatSync(absolute, { throwIfNoEntry: false }) !== undefined) return realpathSync(absolute);
  const parent = dirname(absolute);
  return parent === absolute ? absolute : join(realPath(parent), basename(absolute));
}

export function withinPath(parent: string, child: string): boolean {
  const part = relative(parent, child);
  return part === '' || (part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part));
}

export function resolveReference(root: string, reference: string): string {
  if (reference === '' || reference.includes('\0') || isAbsolute(reference) || win32.isAbsolute(reference) || /^[a-z]:/i.test(reference)) {
    throw new ReferencePathError(reference);
  }
  const base = resolve(root);
  const absolute = resolve(base, reference.replaceAll('\\', '/'));
  if (!withinPath(base, absolute)) throw new ReferencePathError(reference);
  let actual: string;
  try { actual = realPath(absolute); }
  catch { throw new ReferencePathError(reference); }
  if (!withinPath(realPath(base), actual)) throw new ReferencePathError(reference);
  return actual;
}
