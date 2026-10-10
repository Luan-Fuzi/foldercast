/**
 * skill 与契约的一致性。
 *
 * skill 是 M5 的**主要交付物**：写稿的人（模型）只按它做，而它自己不受任何机器检查。
 * 这里钉住几处**会悄悄漂移**的地方：
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
import { SKILL_CONTENT, SKILL_NAME, AUTHORING_REFERENCE, REVIEW_REFERENCE } from '../skill.js';
import { DIGEST_VERSION } from '../../scripts/contracts/digest.js';
import { SCRIPT_VERSION } from '../../scripts/contracts/script.js';
import { SUB_LIMIT } from '../../scripts/contracts/subtitles.js';

const PACKAGE_ROOT = resolve(import.meta.dirname, '../..');
const SCHEMA = JSON.parse(readFileSync(join(PACKAGE_ROOT, '..', '..', 'docs', 'specs', 'script.schema.json'), 'utf8')) as {
  $defs: { sceneType: { enum: string[] } };
};

/**
 * 场景类型表里第一列是反引号包起来的类型名。
 *
 * **只在这个表里找**，不是全文扫「第一列是反引号小写词」的表格。参考文件可能有其他表格，它们的首列也可能是反引号包起来的标识。
 * 判据是「场景类型表与 schema 一致」，那就只读场景类型表。
 */
function sceneTypesInSkill(): string[] {
  const lines = readFileSync(AUTHORING_REFERENCE, 'utf8').split('\n');
  const header = lines.findIndex((line) => /^\|\s*type\s*\|/.test(line));
  if (header < 0) return [];

  const types: string[] = [];
  // 跳过表头与分隔行，逐行取到表格结束（第一行不匹配的行）为止。
  for (const line of lines.slice(header + 2)) {
    const match = /^\|\s*`([a-z]+)`\s*\|/.exec(line);
    if (match === null) break;
    types.push(match[1] ?? '');
  }
  return types;
}

describe('skill 与契约一致', () => {
  it('名称对得上', () => {
    expect(SKILL_NAME).toBe('foldercast');
  });

  it('场景类型表覆盖 schema 里的全部类型，且没有多余', () => {
    const declared = [...SCHEMA.$defs.sceneType.enum].sort();
    expect(declared.length).toBeGreaterThan(0);
    expect(sceneTypesInSkill().sort()).toEqual(declared);
  });

  it('字幕上限与切分实现一致', () => {
    expect(SKILL_CONTENT).toContain(`≤${String(SUB_LIMIT)}`);
  });

  it('版本号来自契约，参考文件随包可读取', () => {
    expect(SKILL_CONTENT).toContain(`digest: ${DIGEST_VERSION}`);
    expect(SKILL_CONTENT).toContain(`foldercast: ${SCRIPT_VERSION}`);
    expect(readFileSync(REVIEW_REFERENCE, 'utf8')).toContain('两阶段核查');
  });

  it('写稿与评审两节的判据都在（M5 的交付物不能被删掉）', () => {
    expect(SKILL_CONTENT).toContain('## 评审判据');
    expect(SKILL_CONTENT).toContain('review.md');
    // 评审要换一条上下文，否则会为写稿时的选择辩护
    expect(SKILL_CONTENT).toContain('独立 subagent');
  });
});
