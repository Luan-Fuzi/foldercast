import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { FormatsPlugin } from 'ajv-formats';
import { analyzeDirectory } from '../analyze.ts';

const require = createRequire(import.meta.url);
const addFormats = require('ajv-formats') as FormatsPlugin;

const FIXTURE = resolve(import.meta.dirname, 'fixtures/sample');
const REPO_ROOT = resolve(import.meta.dirname, '../../../../..');

function analyze(sources?: Parameters<typeof analyzeDirectory>[0]['sources']) {
  return analyzeDirectory({ root: FIXTURE, ...(sources === undefined ? {} : { sources }) });
}

describe('分析器端到端（夹具目录）', () => {
  const { document, report } = analyze();

  it('顶层结构符合契约', () => {
    expect(document.foldercast).toBe(1);
    expect(document.source.root).toBe(FIXTURE);
    expect(document.source.label).toBe('sample');
    expect(document.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  });

  it('排除规则生效，但不误伤 build.gradle', () => {
    const paths = document.manifest.map((entry) => entry.path);
    expect(paths).not.toContain('node_modules/ignored/foo.js');
    expect(paths).not.toContain('dist/bundle.js');
    expect(paths).toContain('build.gradle');
  });

  it('密钥文件进清单与计数，但不读内容', () => {
    const env = document.manifest.find((entry) => entry.path === '.env');
    expect(env).toBeDefined();
    expect(env?.preview).toBeUndefined();
    expect(env?.lines).toBeUndefined();
    expect(env?.imports).toBeUndefined();

    const audits = document.stats.secrets.excluded;
    expect(audits.map((hit) => hit.path).sort()).toEqual(['.env', 'credentials.json']);
    expect(audits.find((hit) => hit.path === '.env')?.match).toBe('.env');
    expect(report.secrets).toHaveLength(2);
  });

  it('角色识别覆盖八类里的常见情形', () => {
    const roleOf = (path: string): string | undefined =>
      document.manifest.find((entry) => entry.path === path)?.role;
    expect(roleOf('README.md')).toBe('readme');
    expect(roleOf('LICENSE')).toBe('license');
    expect(roleOf('package.json')).toBe('entry');
    expect(roleOf('src/index.ts')).toBe('entry');
    expect(roleOf('tsconfig.json')).toBe('config');
    expect(roleOf('src/util.test.ts')).toBe('test');
    expect(roleOf('docs/guide.md')).toBe('doc');
    expect(roleOf('docs/specs/thing.md')).toBe('doc');
    expect(roleOf('assets/logo.png')).toBe('asset');
    expect(roleOf('Makefile')).toBe('build');
  });

  it('引用关系与坏引用', () => {
    const readme = document.manifest.find((entry) => entry.path === 'README.md');
    expect(readme?.imports).toContain('docs/guide.md');
    expect(readme?.imports).toContain('src/index.ts');
    expect(readme?.importsCount).toBe(2); // 跨出根目录的那条不算

    const util = document.manifest.find((entry) => entry.path === 'src/util.ts');
    expect(util?.importedBy).toContain('src/index.ts');
    expect(util?.importedBy).toContain('src/util.test.ts');
    expect(util?.importedBy).toContain('docs/guide.md');
    expect(util?.importedByCount).toBe(3);

    expect(document.graph.dangling).toEqual(['docs/missing-two.md', 'docs/missing.md']);
    expect(document.graph.roots).toContain('README.md');
    expect(document.graph.hubs[0]?.path).toBe('src/util.ts');
  });

  it('stats 与 manifest 自洽（M3 会核对这一条）', () => {
    const kinds = Object.values(document.stats.kindCounts).reduce((sum, count) => sum + (count ?? 0), 0);
    expect(kinds).toBe(document.manifest.length);
    expect(document.stats.totalFiles).toBe(document.manifest.length);
    expect(document.stats.totalBytes).toBe(
      document.manifest.reduce((sum, entry) => sum + (entry.bytes ?? 0), 0),
    );
    expect(document.graph.nodes).toBe(document.manifest.length);

    const paths = new Set(document.manifest.map((entry) => entry.path));
    for (const rolePaths of Object.values(document.stats.roles)) {
      for (const path of rolePaths ?? []) expect(paths.has(path)).toBe(true);
    }
  });

  it('产出能通过 foldercast.schema.json 校验', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    const schema: unknown = JSON.parse(readFileSync(`${REPO_ROOT}/docs/specs/foldercast.schema.json`, 'utf8'));
    const validate = ajv.compile(schema as object);
    const valid = validate(document);
    expect(validate.errors ?? []).toEqual([]);
    expect(valid).toBe(true);
  });

  it('同一目录跑两次，除 generatedAt 外完全一致', () => {
    const first = analyze().document;
    const second = analyze().document;
    const strip = (value: typeof first): string => JSON.stringify({ ...value, generatedAt: '' });
    expect(strip(first)).toBe(strip(second));
  });

  it('maxFiles 截断保留最该讲的，并如实报告丢了多少', () => {
    const limited = analyze({ maxFiles: 3 });
    expect(limited.document.manifest).toHaveLength(3);
    expect(limited.report.droppedByMaxFiles).toBeGreaterThan(0);
    // README 是最高优先级，一定留下
    expect(limited.document.manifest.map((entry) => entry.path)).toContain('README.md');
  });

  it('maxFileSizeMb 只影响内容，不影响计数', () => {
    const tiny = analyze({ maxFileSizeMb: 0.0001 });
    expect(tiny.document.manifest.length).toBe(document.manifest.length);
    expect(tiny.report.skippedForSize).toBeGreaterThan(0);
    const readme = tiny.document.manifest.find((entry) => entry.path === 'README.md');
    expect(readme?.preview).toBeUndefined();
    expect(readme?.bytes).toBeGreaterThan(0);
  });

  it('kinds 开关能整类关掉', () => {
    const noImages = analyze({ kinds: { image: false } });
    expect(noImages.document.manifest.map((entry) => entry.path)).not.toContain('assets/logo.png');
    expect(noImages.document.stats.kindCounts.image).toBe(0);
  });
});
