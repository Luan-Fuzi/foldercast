import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 夹具目录里有故意写成测试样子的文件（`util.test.ts`），它们是**被分析的对象**，
    // 不是要跑的测试。只收集各模块 tests/ 目录**直接**下的用例（`*` 不再往下匹配）。
    include: [
      'packages/plugin/scripts/analyzer/tests/*.test.ts',
      'packages/plugin/scripts/assets/tests/*.test.ts',
      'scripts/**/*.test.ts',
    ],
  },
});
