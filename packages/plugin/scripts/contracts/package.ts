/** 源码与 lib 编译产物共用的包根定位，避免把依赖路径误算成 lib/node_modules。 */
import { existsSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';

export function findPackageRoot(start: string): string | undefined {
  let current = resolve(start);
  const { root } = parse(current);
  for (;;) {
    if (existsSync(join(current, 'package.json'))) return current;
    if (current === root) return undefined;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}
