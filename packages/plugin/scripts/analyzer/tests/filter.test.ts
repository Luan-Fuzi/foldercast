import { describe, expect, it } from 'vitest';
import { createPathFilter, DEFAULT_EXCLUDE, resolveSources } from '../filter.ts';

const filter = createPathFilter(resolveSources());

describe('默认排除与筛选', () => {
  it('排除依赖与产物目录，并且能对目录本身剪枝', () => {
    expect(filter.isExcluded('node_modules/lodash/index.js')).toBe(true);
    // 目录剪枝看的是目录本身，不能只看里面的文件（ignore 的 `foo/**` 不匹配 `foo`）
    expect(filter.isExcluded('node_modules')).toBe(true);
    expect(filter.isExcluded('dist')).toBe(true);
    expect(filter.isExcluded('.git')).toBe(true);
  });

  it('R7 的坑：build/** 不误伤 build.gradle', () => {
    expect(filter.isExcluded('build.gradle')).toBe(false);
    expect(filter.isExcluded('build/output.js')).toBe(true);
    expect(filter.isExcluded('sub/build/out.js')).toBe(true);
  });

  it('排除压缩文件与锁文件', () => {
    expect(filter.isExcluded('app.min.js')).toBe(true);
    expect(filter.isExcluded('a/b/app.min.css')).toBe(true);
    expect(filter.isExcluded('pnpm-lock.yaml')).toBe(true);
    expect(filter.isExcluded('some.lock')).toBe(true);
  });

  it('排除 foldercast 自己的工作根，避免分析自己的产物', () => {
    expect(filter.isExcluded('.foldercast')).toBe(true);
    expect(filter.isExcluded('.foldercast/foldercast.json')).toBe(true);
  });

  it('默认不排除普通源码与文档', () => {
    for (const path of ['src/index.ts', 'README.md', 'docs/specs/x.md', 'assets/logo.png', 'LICENSE']) {
      expect(filter.isExcluded(path), path).toBe(false);
    }
  });

  it('白名单为空表示全要；给了白名单就按它来', () => {
    expect(filter.isIncluded('anything/at/all.ts')).toBe(true);

    const scoped = createPathFilter(resolveSources({ include: ['src/**', 'README.md'] }));
    expect(scoped.isIncluded('src/index.ts')).toBe(true);
    expect(scoped.isIncluded('README.md')).toBe(true);
    expect(scoped.isIncluded('docs/guide.md')).toBe(false);
  });

  it('类型开关可以整类关掉', () => {
    const noVideo = createPathFilter(resolveSources({ kinds: { video: false } }));
    expect(noVideo.isKindEnabled('video')).toBe(false);
    expect(noVideo.isKindEnabled('code')).toBe(true);
  });

  it('默认值写进 sources，用户看得到用了什么', () => {
    const sources = resolveSources();
    expect(sources.maxFiles).toBe(200);
    expect(sources.maxFileSizeMb).toBe(5);
    expect(sources.maxDepth).toBe(6);
    expect(sources.exclude).toEqual([...DEFAULT_EXCLUDE]);
  });
});
