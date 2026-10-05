/**
 * 渲染入口的定位。
 *
 * 这条踩过一次（M4 的同类坑在阶段入口上，M7 在打包入口上）：仓库内开发时
 * `entry.ts` 一定在，装进 `node_modules` 之后只有编译产物 `entry.js`。写死 `.ts`
 * 会让发布版**打包阶段**直接失败 —— 而仓库内测试全绿。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { entryPointPath } from '../bundle.ts';
import { findStylesDir } from '../load.ts';

describe('渲染入口定位', () => {
  it('仓库内：用 TypeScript 源码入口', () => {
    const path = entryPointPath(resolve(import.meta.dirname, '..'));
    expect(path.endsWith('entry.ts')).toBe(true);
    expect(existsSync(path)).toBe(true);
  });

  it('发布版布局：`.ts` 不存在时用编译产物 `.js`', () => {
    const dir = mkdtempSync(join(tmpdir(), 'foldercast-renderer-'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'entry.js'), '// compiled\n');
    expect(entryPointPath(dir).endsWith('entry.js')).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('都没有时给出 `.ts` 路径（报错信息里能看到期望的位置）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'foldercast-renderer-'));
    expect(entryPointPath(dir).endsWith('entry.ts')).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('样式预设目录定位', () => {
  const repoRoot = resolve(import.meta.dirname, '../../../../..');

  it('仓库内布局（scripts/renderer）找得到', () => {
    expect(findStylesDir(resolve(import.meta.dirname, '..'))).toBe(join(repoRoot, 'styles'));
  });

  it('发布版布局（lib/scripts/renderer）也找得到 —— 按层级硬算会算成 packages/styles', () => {
    // lib/ 是构建产物、不入库，没构建时跳过（CI 里构建在测试之前，所以会执行）
    const builtDir = resolve(import.meta.dirname, '../../../lib/scripts/renderer');
    if (!existsSync(builtDir)) return;
    expect(findStylesDir(builtDir)).toBe(join(repoRoot, 'styles'));
  });

  it('找不到时返回 undefined（预设是装饰，不该让出片失败）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'foldercast-nostyles-'));
    expect(findStylesDir(dir)).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });
});
