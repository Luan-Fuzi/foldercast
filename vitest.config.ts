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
    // 集成测试要起 LibreOffice / ffmpeg 这类外部进程，CI runner 上比本机慢得多
    // （实测单次 dsoffice 转换本机 3.7 秒、GitHub runner 上 8 秒），默认 5 秒不够用。
    testTimeout: 30_000,
  },
});
