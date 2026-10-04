/**
 * 仓库遍历与读取的公共部分。四个检查脚本共用，避免各写一套跳过规则。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 仓库根目录。本文件在 `scripts/lib/`，所以上溯两级。 */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * 遍历时跳过的目录名：依赖、生成物、版本库、测试夹具。
 * `assets/` 与 `.foldercast/` 是可重算的产物（见 .gitignore），不参与检查。
 * `fixtures/` 是分析器的输入样本，里面**故意**有坏链接与密钥文件名，不能按仓库文档检查。
 */
export const SKIP_DIRS: ReadonlySet<string> = new Set([
  '.git',
  'node_modules',
  'out',
  'assets',
  '.foldercast',
  'fixtures',
]);

/**
 * 递归收集指定后缀的普通文件，按路径排序。
 * 不跟随符号链接（`Dirent.isFile()` 对符号链接为 false），与原先 Python 版 `Path.rglob` 的行为一致。
 */
export function walkFiles(extension: string): string[] {
  const found: string[] = [];

  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        visit(join(dir, entry.name));
      } else if (entry.isFile() && entry.name.endsWith(extension)) {
        found.push(join(dir, entry.name));
      }
    }
  };

  visit(REPO_ROOT);
  return found.sort();
}

/** 相对仓库根的路径，用于打印。 */
export function rel(absolute: string): string {
  return relative(REPO_ROOT, absolute);
}

/** 读取文本文件（UTF-8）。 */
export function readText(absolute: string): string {
  return readFileSync(absolute, 'utf8');
}

/** 读取并解析 JSON；解析失败时把仓库相对路径带进错误信息。 */
export function readJson(absolute: string): unknown {
  const text = readText(absolute);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${rel(absolute)}: ${(error as Error).message}`);
  }
}
