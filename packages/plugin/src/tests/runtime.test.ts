/**
 * 包根定位与阶段入口选择。
 *
 * 这两个函数踩过一次**只在装上去之后才暴露**的坑：`PACKAGE_ROOT` 原来写成
 * `resolve(MODULE_DIR, '..')`，在源码布局下（`<包根>/src`）是对的，编译后（`<包根>/lib/src`）
 * 却算成 `<包根>/lib`，于是随包脚本全部「找不到」，工具直接报「插件包不完整」。
 * 仓库内的测试都从源码 import，所以全绿。
 *
 * 所以这里分两层测：纯函数两种布局都过一遍，再**从编译产物加载一次**（存在 `lib/` 时），
 * 确保发布版里算出来的包根也是对的。CI 先构建再跑测试，这一条在 CI 上必定执行。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync as makeTempDirectory, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PACKAGE_ROOT, findPackageRoot, resolveStageEntry, scriptsInstalled } from '../runtime.js';
import { resolveCommand } from '../../scripts/assets/run.ts';

/** 本文件在 `<包根>/src/tests/`。 */
const REAL_PACKAGE_ROOT = resolve(import.meta.dirname, '../..');
const temporaryRoots: string[] = [];
function mkdtempSync(prefix: string): string {
  const path = makeTempDirectory(prefix);
  temporaryRoots.push(path);
  return path;
}
afterAll(() => { for (const path of temporaryRoots) rmSync(path, { recursive: true, force: true }); });

function makePackage(layout: 'source' | 'built'): string {
  const root = mkdtempSync(join(tmpdir(), 'foldercast-pkg-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'dsh-foldercast', version: '0.0.0' }));

  const dirs = layout === 'source' ? ['src', 'scripts/renderer'] : ['lib/src', 'lib/scripts/renderer'];
  for (const dir of dirs) mkdirSync(join(root, dir), { recursive: true });
  const entry = layout === 'source' ? 'scripts/renderer/main.ts' : 'lib/scripts/renderer/main.js';
  writeFileSync(join(root, entry), '');

  return root;
}

describe('findPackageRoot', () => {
  it('开发布局：从 <包根>/src 上溯到包根', () => {
    const root = makePackage('source');
    expect(findPackageRoot(join(root, 'src'))).toBe(root);
  });

  it('编译布局：从 <包根>/lib/src 上溯到包根（不是 lib/）', () => {
    const root = makePackage('built');
    expect(findPackageRoot(join(root, 'lib', 'src'))).toBe(root);
  });

  it('本模块的包根就是插件包根', () => {
    expect(PACKAGE_ROOT).toBe(REAL_PACKAGE_ROOT);
    expect(existsSync(join(PACKAGE_ROOT, 'package.json'))).toBe(true);
  });
});

describe('resolveStageEntry', () => {
  it('仓库内（不在 node_modules）：跑 TypeScript 源码', () => {
    const root = makePackage('source');
    const entry = resolveStageEntry(root, 'render');

    expect(entry.relative).toBe(join('scripts', 'renderer', 'main.ts'));
    expect(existsSync(entry.absolute)).toBe(true);
  });

  it('装进 node_modules：跑编译产物（Node 不允许在那里剥离类型）', () => {
    const root = join(mkdtempSync(join(tmpdir(), 'foldercast-installed-')), 'node_modules', 'dsh-foldercast');
    mkdirSync(join(root, 'scripts/renderer'), { recursive: true });
    mkdirSync(join(root, 'lib/scripts/renderer'), { recursive: true });
    writeFileSync(join(root, 'package.json'), '{}');
    // 两套入口都在，仍然必须选 JS：这是 Node 的硬约束，不是偏好
    writeFileSync(join(root, 'scripts/renderer/main.ts'), '');
    writeFileSync(join(root, 'lib/scripts/renderer/main.js'), '');

    const entry = resolveStageEntry(root, 'render');

    expect(entry.relative).toBe(join('lib', 'scripts', 'renderer', 'main.js'));
    expect(existsSync(entry.absolute)).toBe(true);
  });

  it('源码缺失时回退到编译产物', () => {
    const root = makePackage('built');
    const entry = resolveStageEntry(root, 'render');

    expect(entry.relative).toBe(join('lib', 'scripts', 'renderer', 'main.js'));
  });
});

describe('随包脚本', () => {
  it('两个阶段入口都在', () => {
    expect(scriptsInstalled()).toEqual({ ok: true, missing: [] });
  });

  it('缺失时报出的是相对包根的路径', () => {
    const root = mkdtempSync(join(tmpdir(), 'foldercast-empty-'));
    mkdirSync(join(root, 'lib/src'), { recursive: true });
    writeFileSync(join(root, 'package.json'), '{}');

    const entry = resolveStageEntry(root, 'voice');

    expect(entry.relative).toBe(join('lib', 'scripts', 'voice', 'main.js'));
    expect(existsSync(entry.absolute)).toBe(false);
  });
});

/**
 * 编译产物里的包根。这条是防回归的主力：源码布局下永远看不出问题。
 * `lib/` 是构建产物且不入库，所以没构建时跳过；CI 里构建在测试之前。
 */
const BUILT_RUNTIME = resolve(REAL_PACKAGE_ROOT, 'lib/src/runtime.js');

describe.skipIf(!existsSync(BUILT_RUNTIME))('编译产物', () => {
  it('内置的包根与脚本入口都能用', async () => {
    const built = (await import(pathToFileURL(BUILT_RUNTIME).href)) as typeof import('../runtime.js');

    expect(built.PACKAGE_ROOT).toBe(REAL_PACKAGE_ROOT);
    expect(built.scriptsInstalled()).toEqual({ ok: true, missing: [] });
    expect(existsSync(built.stageEntryPath('render'))).toBe(true);
    expect(existsSync(built.stageEntryPath('voice'))).toBe(true);
    const assets = await import(pathToFileURL(resolve(REAL_PACKAGE_ROOT, 'lib/scripts/assets/run.js')).href) as { resolveCommand: typeof resolveCommand };
    expect(assets.resolveCommand('dsoffice')).toBe(resolveCommand('dsoffice'));
  });
});
