#!/usr/bin/env node
/**
 * 素材阶段入口：解读 → `assets/`。
 *
 * 用法：
 *     node packages/plugin/scripts/assets/main.ts <目录> [选项]
 *
 * 选项：
 *     --limit <N>        本阶段最多处理 N 个文件（不含命中缓存的）
 *     --only <kinds>     只处理这些类型，逗号分隔（image,video,office,pdf,code）
 *     --force            忽略缓存，全部重算
 *     --dry-run          只报告会做什么，不写任何文件
 *
 * 前置：该目录已经跑过分析器（存在 `.foldercast/foldercast.json`）。
 * 产物：`assets/`（缩略图、逐页图、封面、关键帧、代码高亮图、提取的文本）+ `assets/manifest.json`，
 *       并回填解读里的 `manifest[].asset` 与 office/pdf/video 的 `preview`。
 */
import { resolve } from 'node:path';
import type { Kind } from '../contracts/foldercast.ts';
import { HANDLED_KINDS, runAssetsStage, type StageReport } from './stage.ts';

const USAGE = `用法：node packages/plugin/scripts/assets/main.ts <目录> [选项]

选项：
  --limit <N>      本阶段最多处理 N 个文件（不含命中缓存的）
  --only <kinds>   只处理这些类型，逗号分隔（${[...HANDLED_KINDS].join(',')}）
  --force          忽略缓存，全部重算
  --dry-run        只报告会做什么，不写任何文件

前置：该目录已跑过分析器（node packages/plugin/scripts/analyzer/main.ts <目录>）`;

type Options = {
  root: string;
  limit?: number;
  only?: ReadonlySet<Kind>;
  force: boolean;
  dryRun: boolean;
};

function parseArgs(argv: readonly string[]): Options | { error: string } {
  let root: string | undefined;
  let limit: number | undefined;
  let only: Set<Kind> | undefined;
  let force = false;
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) continue;
    if (argument === '--help' || argument === '-h') return { error: 'help' };
    if (argument === '--force') {
      force = true;
      continue;
    }
    if (argument === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (argument === '--limit' || argument === '--only') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) return { error: `${argument} 后面需要一个值` };
      index += 1;
      if (argument === '--limit') {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed <= 0) return { error: `--limit 需要正整数，收到 ${value}` };
        limit = parsed;
      } else {
        const kinds = value.split(',').map((item) => item.trim()).filter((item) => item !== '');
        const unknown = kinds.filter((kind) => !HANDLED_KINDS.has(kind as Kind));
        if (unknown.length > 0) return { error: `--only 里有不支持的类型：${unknown.join('、')}` };
        only = new Set(kinds as Kind[]);
      }
      continue;
    }
    if (argument.startsWith('-')) return { error: `未知选项：${argument}` };
    if (root !== undefined) return { error: `只能处理一个目录，多出来的是：${argument}` };
    root = argument;
  }

  if (root === undefined) return { error: '缺少目录参数' };
  return {
    root,
    ...(limit === undefined ? {} : { limit }),
    ...(only === undefined ? {} : { only }),
    force,
    dryRun,
  };
}

function formatElapsed(ms: number): string {
  return ms < 1000 ? `${ms} 毫秒` : `${(ms / 1000).toFixed(1)} 秒`;
}

function printReport(report: StageReport): void {
  const kindLines = [...report.byKind.entries()].map(([kind, count]) => `${kind} ${count}`).join(' · ');

  if (report.dryRun) {
    console.log(`试运行：计划处理 ${report.planned} 个文件，其中 ${report.cached} 个命中缓存，${report.deferred} 个本次不处理。`);
    console.log('没写任何文件。去掉 --dry-run 才会真正生成素材。');
    return;
  }

  if (report.processed === 0 && report.cached > 0) {
    console.log(`全部命中缓存：${report.cached} 个文件无需重算（${formatElapsed(report.elapsedMs)}）。`);
  } else {
    console.log(
      `素材：处理 ${report.processed} 个文件，命中缓存 ${report.cached} 个，产出 ${report.products} 个产物（${formatElapsed(report.elapsedMs)}）。`,
    );
  }
  if (kindLines !== '') console.log(`  按类型：${kindLines}`);
  if (report.deferred > 0) console.log(`  本次未处理（受 --limit 限制）：${report.deferred} 个，下次继续`);
  console.log(`  回填解读：asset ${report.enrich.assetsSet} 处，preview ${report.enrich.previewsSet} 处`);

  if (report.failed > 0) {
    console.log(`  ${report.failed} 个文件失败（其余不受影响）：`);
    for (const failure of report.failures.slice(0, 10)) console.log(`    ${failure.path}：${failure.error}`);
    if (report.failures.length > 10) console.log(`    …另有 ${report.failures.length - 10} 个`);
  }
  console.log(`输出：${report.workRoot}/assets`);
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  if ('error' in options) {
    if (options.error === 'help') {
      console.log(USAGE);
      return 0;
    }
    console.error(`${options.error}\n\n${USAGE}`);
    return 1;
  }

  try {
    const report = await runAssetsStage({
      root: resolve(options.root),
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      ...(options.only === undefined ? {} : { only: options.only }),
      force: options.force,
      dryRun: options.dryRun,
    });
    printReport(report);
    return report.failed > 0 && report.processed === 0 && report.cached === 0 ? 1 : 0;
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
}

process.exitCode = await main();
