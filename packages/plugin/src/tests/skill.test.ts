/**
 * skill 与契约的一致性。
 *
 * skill 是 M5 的**主要交付物**：写稿的人（模型）只按它做，而它自己不受任何机器检查。
 * 这里钉住两处**会悄悄漂移**的地方：
 *
 * 1. **场景类型表**必须与 `script.schema.json` 的 `sceneType` 枚举逐字一致 ——
 *    schema 加了新类型而 skill 没写，模型就永远不会用它；skill 写了 schema 没有的类型，
 *    写了也会被校验器拦下。
 * 2. **字幕上限**必须与切分实现（`SUB_LIMIT`，校验与配音共用）一致 ——
 *    改了一边不改另一边，等于给模型一条错的判据。
 *
 * 不断言 skill 的措辞与结构：判据怎么写是内容问题，不是机器能判的。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SKILL_CONTENT, SKILL_NAME } from '../skill.js';
import { SUB_LIMIT } from '../../scripts/contracts/subtitles.js';

const PACKAGE_ROOT = resolve(import.meta.dirname, '../..');
const SCHEMA = JSON.parse(readFileSync(join(PACKAGE_ROOT, '..', '..', 'docs', 'specs', 'script.schema.json'), 'utf8')) as {
  $defs: { sceneType: { enum: string[] } };
};

/** 场景类型表里第一列是反引号包起来的类型名。 */
function sceneTypesInSkill(): string[] {
  const table = /^\|\s*`([a-z]+)`\s*\|/gm;
  return [...SKILL_CONTENT.matchAll(table)].map((match) => match[1] ?? '');
}

describe('skill 与契约一致', () => {
  it('名称与 schema 引用对得上', () => {
    expect(SKILL_NAME).toBe('foldercast');
    expect(SKILL_CONTENT).toContain('script.schema.json');
  });

  it('场景类型表覆盖 schema 里的全部类型，且没有多余', () => {
    const declared = [...SCHEMA.$defs.sceneType.enum].sort();
    expect(declared.length).toBeGreaterThan(0);
    expect(sceneTypesInSkill().sort()).toEqual(declared);
  });

  it('字幕上限与切分实现一致', () => {
    expect(SKILL_CONTENT).toContain(`≤${String(SUB_LIMIT)}`);
  });

  it('写稿与评审两节的判据都在（M5 的交付物不能被删掉）', () => {
    expect(SKILL_CONTENT).toContain('## 评审判据');
    expect(SKILL_CONTENT).toContain('review.md');
    // 评审要换一条上下文，否则会为写稿时的选择辩护
    expect(SKILL_CONTENT).toContain('独立 subagent');
  });
});
