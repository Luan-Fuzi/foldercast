/**
 * schema 的定位：契约的机器可读表示只有一份，在 `docs/specs/` 下，校验器按仓库布局找它。
 *
 * 这一层容易坏在「换个工作目录就找不到」，所以单独测。
 */
import { describe, expect, it } from 'vitest';
import { findSpecsDir, loadSchemas } from '../schema.ts';

describe('按仓库布局找 schema', () => {
  it('从校验器自身的位置能找到', () => {
    const dir = findSpecsDir(import.meta.dirname);
    expect(dir).toBeDefined();
    expect(dir?.endsWith('docs/specs')).toBe(true);
  });

  it('从子目录往上找也能找到', () => {
    expect(findSpecsDir(`${import.meta.dirname}/deep/deeper`)).toBe(findSpecsDir(import.meta.dirname));
  });

  it('找不到时返回 undefined，不抛错', () => {
    // 临时目录里没有任何 docs/specs
    expect(findSpecsDir('/tmp')).toBeUndefined();
  });

  it('载入的两个 schema 都是对象，且带 $id', () => {
    const schemas = loadSchemas();
    expect(schemas.reading).toHaveProperty('$id');
    expect(schemas.script).toHaveProperty('$id');
  });

  it('显式指定目录时按它载入；目录里没有 schema 就报出来', () => {
    const dir = findSpecsDir(import.meta.dirname) as string;
    expect(loadSchemas(dir).reading).toHaveProperty('$id');
    expect(() => loadSchemas('/tmp')).toThrow(/schema 不存在/);
  });
});
