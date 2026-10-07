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
