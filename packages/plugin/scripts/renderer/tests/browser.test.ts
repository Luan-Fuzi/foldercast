/**
 * 浏览器获取（C4）。**这是 M7 唯一可能因环境而不可用的东西**，所以判据是：
 *
 * 1. 有系统 Chrome / Chromium / Edge，或 Remotion 已经下过的 Headless Shell → `found`；
 * 2. 都没有 → `missing` + **结构化引导**（三种办法 + 已找过的路径），**不下载**；
 * 3. 指定的路径不可执行时，直接说这件事，不要退回去猜别的路径（否则会跑出用户没预期的浏览器）。
 *
 * 「不下载」是刻意的：渲染是唯一需要浏览器的一步，让它在第一次出片时才提出 150–300 MB 的
 * 请求，比在插件安装时提出合理。这条判据如果被改成「缺了就自动下载」，这个测试会红。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { guidanceFor, headlessShellRoots, resolveBrowser } from '../browser.ts';

describe('浏览器解析', () => {
  it('显式指定的路径优先，且标明来源', () => {
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (!existsSync(chrome)) return;
    const found = resolveBrowser(chrome);
    expect(found.kind).toBe('found');
    if (found.kind === 'found') {
      expect(found.path).toBe(chrome);
      expect(found.origin).toBe('flag');
    }
  });

  it('环境变量指到不存在的文件时给出可操作的说明，不静默换别的', () => {
    const result = resolveBrowser(undefined, { FOLDERCAST_BROWSER: '/nope/chrome' });
    expect(result.kind).toBe('missing');
    if (result.kind === 'missing') {
      expect(result.guidance).toContain('/nope/chrome');
      expect(result.guidance).toContain('FOLDERCAST_BROWSER');
    }
  });

  it('环境变量指到真实可执行文件时用它', () => {
    const found = resolveBrowser(undefined, { FOLDERCAST_BROWSER: process.execPath });
    expect(found.kind).toBe('found');
    if (found.kind === 'found') {
      expect(found.path).toBe(process.execPath);
      expect(found.origin).toBe('env');
    }
  });

  it('本机装了 Chrome 就找得到（找不到也不算失败，只是记下来）', () => {
    const found = resolveBrowser(undefined, {});
    if (found.kind === 'missing') {
      // 没有浏览器的机器：引导必须说清三种办法，且列了找过的地方
      expect(found.guidance).toContain('remotion browser ensure');
      expect(found.guidance).toContain('FOLDERCAST_BROWSER');
      expect(found.searched.length).toBeGreaterThan(0);
    } else {
      expect(existsSync(found.path)).toBe(true);
    }
  });

  it('引导不承诺「已经装了」：只说办法与查过的位置', () => {
    const text = guidanceFor(['/a/chrome', '/b/chromium']);
    expect(text).toContain('只影响出片');
    expect(text).toContain('/a/chrome');
    expect(text).not.toContain('已安装');
  });

  it('Headless Shell 的落点按平台给，且是绝对路径', () => {
    const roots = headlessShellRoots();
    expect(roots.length).toBeGreaterThan(0);
    for (const root of roots) expect(root.startsWith('/')).toBe(true);
  });

  it('判据是「可执行位 + 是文件」，不是「路径存在」', () => {
    // `/` 存在但不是文件；`/etc/hosts` 是文件但不可执行。两者都必须是 missing。
    for (const candidate of ['/', '/etc/hosts']) {
      if (!existsSync(candidate)) continue;
      const result = resolveBrowser(candidate);
      if (candidate === '/etc/hosts') expect(statSync(candidate).isFile()).toBe(true);
      expect(result.kind).toBe('missing');
    }
  });
});
