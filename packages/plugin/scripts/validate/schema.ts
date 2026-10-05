/**
 * 校验用到的 JSON Schema 的位置。
 *
 * **契约的机器可读表示只有一份**，在 `docs/specs/` 下（docs/conventions/docs.md 第五节）。
 * 校验器直接读它，不复制第二份 —— 复制等于给自己造一个会漂移的权威。
 *
 * 两种布局都认，按顺序找：
 *
 * | 顺序 | 位置 | 什么时候用 |
 * |---|---|---|
 * | ① | `<包根>/schemas/` | 插件从 npm 装出来时（`docs/` 不在包里，这份由 `prepack` 生成） |
 * | ② | `<仓库根>/docs/specs/` | 在仓库里直接跑时 |
 *
 * `--specs` 可显式指定，优先于两者。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';

export type SchemaPair = {
  /** `foldercast.json` 的 schema。 */
  reading: object;
  /** `script.json` 的 schema。 */
  script: object;
};

/** 本文件在 `<包根>/scripts/validate/`（开发）或 `<包根>/lib/scripts/validate/`（发布版编译产物）。 */
const MODULE_DIR = import.meta.dirname;

const MARKER_FILE = 'script.schema.json';
const MARKER = join('docs', 'specs', MARKER_FILE);

/**
 * 从起点往上找第一个含 `<目录名>/script.schema.json` 的目录。
 *
 * 这样两种布局都能认，且不依赖「上溯几级」——阶段脚本会编译到 `lib/scripts/...`，
 * 层级比开发时多一层：
 * - 包内 `<包根>/schemas/`（发布版：由 `prepack` 从 docs/specs 复制）
 * - 仓库 `<仓库根>/docs/specs/`（开发时）
 */
function findUp(dirName: string, start: string): string | undefined {
  let current = resolve(start);
  const { root } = parse(current);

  for (;;) {
    const candidate = join(current, dirName);
    if (existsSync(join(candidate, MARKER_FILE))) return candidate;
    if (current === root) return undefined;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/** 从起点往上逐级找含 `docs/specs/` 的目录（仓库布局）。 */
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

/** 实际使用的 schema 目录：包内的优先，仓库的兜底。 */
function resolveSpecsDir(explicit?: string): string | undefined {
  if (explicit !== undefined) return explicit;
  return findUp('schemas', MODULE_DIR) ?? findSpecsDir(MODULE_DIR);
}

function readJsonObject(path: string): object {
  return JSON.parse(readFileSync(path, 'utf8')) as object;
}

/**
 * 载入两个 schema。
 *
 * `specsDir` 可显式指定（测试与打包后用），默认按上表查找。
 * 找不到时**报出可操作的错误**，而不是抛一个 `ENOENT`。
 */
export function loadSchemas(specsDir?: string): SchemaPair {
  const dir = resolveSpecsDir(specsDir);
  if (dir === undefined) {
    throw new Error(
      `找不到契约 schema（foldercast.schema.json / script.schema.json）。` +
        `从 npm 装的包应自带 schemas/；在仓库里跑请从仓库内运行，或用 --specs <目录> 指定位置。`,
    );
  }

  const reading = join(dir, 'foldercast.schema.json');
  const script = join(dir, 'script.schema.json');
  for (const path of [reading, script]) {
    if (!existsSync(path)) throw new Error(`schema 不存在：${path}`);
  }

  return { reading: readJsonObject(reading), script: readJsonObject(script) };
}

/**
 * 素材清单的 schema。它是 M4 补进契约的（原来只有人读的说明），没有就不校验，
 * 不因为缺一份 schema 让整条校验失败。
 */
export function loadAssetsSchema(specsDir?: string): object | undefined {
  const dir = resolveSpecsDir(specsDir);
  if (dir === undefined) return undefined;
  const path = join(dir, 'assets.schema.json');
  return existsSync(path) ? readJsonObject(path) : undefined;
}
