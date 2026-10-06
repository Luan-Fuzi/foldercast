/**
 * 解读（`foldercast.json`）的自洽校验：ROADMAP M3 的「结构树与 `stats` 的一致性
 * （计数与清单对得上）」，以及引用依赖图的度数。
 *
 * 做法是拿分析器的真实产物，**注入一处缺陷**，看校验器能不能定位到它 —— 这正是分析器
 * 出 bug 时的样子。同时反向验一遍：不改缺陷时解读必须是干净的（否则说明校验器在乱报）。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { FoldercastDocument } from '../../contracts/foldercast.ts';
import { analyzeDirectory } from '../../analyzer/analyze.ts';
import { checkReading } from '../check-reading.ts';
import { createValidator } from '../ajv.ts';
import { loadSchemas } from '../schema.ts';

const SAMPLE = new URL('../../analyzer/tests/fixtures/sample', import.meta.url).pathname;

let clean: FoldercastDocument;
let text: string;

/** 改一处后重新校验，返回「指针 → 消息」。 */
function issuesOf(mutate: (document: FoldercastDocument) => void): { codes: string[]; pointers: string[] } {
  const copy = structuredClone(clean);
  mutate(copy);
  const raw = JSON.stringify(copy, null, 2);
  const schemas = loadSchemas();
  const found = checkReading({
    document: copy,
    path: '/tmp/foldercast.json',
    text: raw,
    validateSchema: createValidator(schemas.reading),
  });
  return {
    codes: found.all().map((issue) => issue.code),
    pointers: found.all().map((issue) => issue.pointer),
  };
}

beforeAll(() => {
  const { document } = analyzeDirectory({ root: SAMPLE });
  clean = document;
  text = JSON.stringify(document, null, 2);
});

describe('分析器的产物本身是干净的', () => {
  it('没有 blocker', () => {
    const schemas = loadSchemas();
    const found = checkReading({
      document: clean,
      path: '/tmp/foldercast.json',
      text,
      validateSchema: createValidator(schemas.reading),
    });
    expect(found.all()).toEqual([]);
  });
});

describe('stats 与 manifest 对不上时要报出来', () => {
  it('totalFiles', () => {
    const { codes, pointers } = issuesOf((document) => {
      document.stats.totalFiles += 1;
    });
    expect(codes).toContain('stats-mismatch');
    expect(pointers).toContain('/stats/totalFiles');
  });

  it('totalBytes', () => {
    const { pointers } = issuesOf((document) => {
      document.stats.totalBytes += 100;
    });
    expect(pointers).toContain('/stats/totalBytes');
  });

  it('kindCounts 的某一类', () => {
    const { pointers } = issuesOf((document) => {
      document.stats.kindCounts.code = 99;
    });
    expect(pointers).toContain('/stats/kindCounts/code');
  });

  it('stats.maxDepth 与实际深度不符', () => {
    const { pointers } = issuesOf((document) => {
      document.stats.maxDepth = 99;
    });
    expect(pointers).toContain('/stats/maxDepth');
  });

  it('密钥审计里的路径不在清单里', () => {
    const { pointers } = issuesOf((document) => {
      document.stats.secrets.excluded.push({ path: '.env.local', match: '.env.*' });
    });
    expect(pointers).toContain('/stats/secrets/excluded/2/path');
  });
});

describe('解读的顶层约束', () => {
  it('source.root 必须是绝对路径', () => {
    const { codes, pointers } = issuesOf((document) => {
      document.source.root = 'relative/path';
    });
    expect(codes).toContain('source-root-relative');
    expect(pointers).toContain('/source/root');
  });

  it('source.label 与目录名不一致时只提醒', () => {
    const found = issuesOf((document) => {
      document.source.label = '别的名字';
    });
    expect(found.codes).toContain('label-mismatch');
  });

  it('manifest 路径重复要报出来（计数会重复）', () => {
    const before = clean.manifest.length;
    const { codes, pointers } = issuesOf((document) => {
      const first = document.manifest[0];
      if (first !== undefined) document.manifest.push({ ...first });
    });
    expect(codes).toContain('stats-mismatch');
    expect(pointers).toContain(`/manifest/${String(before)}/path`);
  });

  it('version 不是 1 时报错，而不是猜', () => {
    const copy = structuredClone(clean) as unknown as Record<string, unknown>;
    copy.foldercast = 2;
    const schemas = loadSchemas();
    const found = checkReading({
      document: copy as unknown as FoldercastDocument,
      path: '/tmp/foldercast.json',
      text: JSON.stringify(copy),
      validateSchema: createValidator(schemas.reading),
    });
    expect(found.all().map((issue) => issue.code)).toContain('version-unsupported');
  });

  it('schema 不认识的键要报出来（拼错键名被拦住）', () => {
    const copy = structuredClone(clean) as unknown as Record<string, unknown>;
    copy.generated_at = 'nope';
    const schemas = loadSchemas();
    const found = checkReading({
      document: copy as unknown as FoldercastDocument,
      path: '/tmp/foldercast.json',
      text: JSON.stringify(copy),
      validateSchema: createValidator(schemas.reading),
    });
    expect(found.all().map((issue) => issue.code)).toContain('schema');
  });
});
