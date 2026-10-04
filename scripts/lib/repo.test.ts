import { describe, expect, it } from 'vitest';
import { isInsideRepo, REPO_ROOT } from './repo.ts';

describe('仓库边界判定', () => {
  it('仓库内的路径为真', () => {
    expect(isInsideRepo(REPO_ROOT)).toBe(true);
    expect(isInsideRepo(`${REPO_ROOT}/README.md`)).toBe(true);
    expect(isInsideRepo(`${REPO_ROOT}/docs/specs/SPEC-pipeline.md`)).toBe(true);
  });

  it('仓库之外的路径为假（CI 检出里必然不存在）', () => {
    expect(isInsideRepo(`${REPO_ROOT}/../qiuzhao202608/lecture-videos`)).toBe(false);
    expect(isInsideRepo('/etc/hosts')).toBe(false);
    expect(isInsideRepo('/')).toBe(false);
  });
});
