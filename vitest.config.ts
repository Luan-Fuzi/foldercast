import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 夹具目录里有故意写成测试样子的文件（`util.test.ts`），它们是**被分析的对象**，
    // 不是要跑的测试。只收集各模块 tests/ 目录**直接**下的用例（`*` 不再往下匹配）。
    include: [
      'packages/plugin/scripts/analyzer/tests/*.test.ts',
      'packages/plugin/scripts/assets/tests/*.test.ts',
      'packages/plugin/scripts/validate/tests/*.test.ts',
      'packages/plugin/scripts/html/tests/*.test.ts',
      'packages/plugin/scripts/renderer/tests/*.test.ts',
      'packages/plugin/scripts/voice/tests/*.test.ts',
      'packages/plugin/scripts/contracts/tests/*.test.ts',
      'packages/plugin/src/tests/*.test.ts',
      'scripts/**/*.test.ts',
    ],
    // 集成测试要起 LibreOffice / ffmpeg 这类外部进程，CI runner 上比本机慢得多
    // （实测单次 dsoffice 转换本机 3.7 秒、GitHub runner 上 8 秒），默认 5 秒不够用。
    testTimeout: 30_000,
    // **用例文件串行跑**（同一时间只起一个测试进程）。理由不是速度而是正确性：
    // 出片那条用例会起无头 Chrome 并逐帧渲染，多个用例文件并行时会互相抢 CPU，
    // 表现是「单跑必过、全量跑偶发失败」——实测就撞过一次（渲染用例在整套里红了，
    // 单独跑绿）。素材与渲染这两个阶段本来就是重活，串行反而更容易判断结果。
    pool: 'forks',
    // Vitest 4 起 `poolOptions.forks.singleFork` 挪到了顶层
    singleFork: true,
  },
});
