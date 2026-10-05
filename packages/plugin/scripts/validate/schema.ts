/**
 * 校验用到的 JSON Schema 的位置。
 *
 * **契约的机器可读表示只有一份**，在 `docs/specs/` 下（docs/conventions/docs.md 第五节）。
 * 校验器直接读它，不复制第二份 —— 复制等于给自己造一个会漂移的权威。
 *
 * 代价是校验器要求仓库布局：从本文件往上找含 `docs/specs/script.schema.json` 的目录。
 * 打包发布时把这两个 schema 一并放进包里（M4 做），届时这里要能同时认包内布局。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';

export type SchemaPair = {
  /** `foldercast.json` 的 schema。 */
  reading: object;
  /** `script.json` 的 schema。 */
  script: object;
};

const MARKER = join('docs', 'specs', 'script.schema.json');

/** 从起点往上逐级找含 `docs/specs/` 的目录。 */
export function findSpecsDir(start: string): string | undefined {
  let current = resolve(start);
  const { root } = parse(current);

  for (;;) {
    if (existsSync(join(current, MARKER))) return join(current, 'docs', 'specs');
    if (current === root) return undefined;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function readJsonObject(path: string): object {
  return JSON.parse(readFileSync(path, 'utf8')) as object;
}

/**
 * 载入两个 schema。
 *
 * `specsDir` 可显式指定（测试与打包后用），默认从本文件往上找。
 * 找不到时**报出可操作的错误**，而不是抛一个 `ENOENT`。
 */
export function loadSchemas(specsDir?: string): SchemaPair {
  const dir = specsDir ?? findSpecsDir(import.meta.dirname);
  if (dir === undefined) {
    throw new Error(
      `找不到契约 schema（docs/specs/*.schema.json）。校验器按仓库布局查找，请从仓库内运行；` +
        `若 schema 已随包分发，用 --specs <目录> 指定位置。`,
    );
  }

  const reading = join(dir, 'foldercast.schema.json');
  const script = join(dir, 'script.schema.json');
  for (const path of [reading, script]) {
    if (!existsSync(path)) throw new Error(`schema 不存在：${path}`);
  }

  return { reading: readJsonObject(reading), script: readJsonObject(script) };
}
