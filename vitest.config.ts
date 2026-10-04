import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 夹具目录里有故意写成测试样子的文件（`util.test.ts`），它们是**被分析的对象**，
    // 不是要跑的测试。只收集 tests/ 下的用例。
    include: ['packages/plugin/scripts/analyzer/tests/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
