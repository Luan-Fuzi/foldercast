#!/usr/bin/env node
/**
 * 分析器入口：目录 → `foldercast.json`。
 *
 * 脱离 DSH 直接跑（ROADMAP M1 验收 3）：
 *
 *     node packages/plugin/scripts/analyzer/main.ts <目录> [选项]
 *
 * 选项：
 *     --out <文件>    输出路径，默认 <目录>/.foldercast/foldercast.json
 *     --label <名称>  展示用名称，默认取目录名
 *     --stdout        只打印到标准输出，不写文件
 *     --help          显示用法
 *
 * 退出码：0 成功；1 失败（参数错、目录不存在）。面向用户的错误必须可操作，
 * 不打印裸 stack trace（docs/conventions/coding.md 五）。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { analyzeDirectory, type AnalyzeResult } from './analyze.ts';
import { KIND_VALUES } from '../contracts/foldercast.ts';

const USAGE = `用法：node packages/plugin/scripts/analyzer/main.ts <目录> [选项]

选项：
  --out <文件>     输出路径，默认 <目录>/.foldercast/foldercast.json
  --label <名称>   展示用名称，默认取目录名
  --stdout         只打印到标准输出，不写文件
  --help           显示本说明`;

type Options = {
  root: string;
  out?: string;
  label?: string;
  toStdout: boolean;
};

function parseArgs(argv: readonly string[]): Options | { error: string } {
  let root: string | undefined;
  let out: string | undefined;
  let label: string | undefined;
  let toStdout = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) continue;
    if (argument === '--help' || argument === '-h') return { error: 'help' };
    if (argument === '--stdout') {
      toStdout = true;
      continue;
    }
    if (argument === '--out' || argument === '--label') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) return { error: `${argument} 后面需要一个值` };
      if (argument === '--out') out = value;
      else label = value;
      index += 1;
      continue;
    }
    if (argument.startsWith('-')) return { error: `未知选项：${argument}` };
    if (root !== undefined) return { error: `只能分析一个目录，多出来的是：${argument}` };
    root = argument;
  }

  if (root === undefined) return { error: '缺少目录参数' };
  return { root, ...(out === undefined ? {} : { out }), ...(label === undefined ? {} : { label }), toStdout };
}

/** 数字对齐，方便在终端里读。 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function printSummary(result: AnalyzeResult, outPath: string | undefined): void {
  const { document, report, graphDetail } = result;
  const { stats, graph } = document;
  const line = (text: string): void => console.log(text);

  line(`目录：${document.source.root}（${document.source.label ?? ''}）`);
  line(
    `文件：${stats.totalFiles} 个进清单 / ${report.discovered} 个通过排除规则 / 扫描 ${report.scanned} 个条目，` +
      `${formatBytes(stats.totalBytes)}，最深 ${stats.maxDepth} 层`,
  );

  const kinds = KIND_VALUES.map((kind) => `${kind} ${stats.kindCounts[kind] ?? 0}`).join(' · ');
  line(`类型：${kinds}`);

  const languages = Object.entries(stats.languages);
  if (languages.length > 0) {
    line(`语言：${languages.map(([name, count]) => `${name} ${count} 行`).join(' · ')}`);
  }

  const roles = Object.entries(stats.roles);
  if (roles.length > 0) {
    line(`角色：${roles.map(([role, paths]) => `${role} ${paths.length}`).join(' · ')}`);
  }

  if (stats.topDirs.length > 0) {
    line(`子目录：${stats.topDirs.map((dir) => `${dir.path} ${dir.files}`).join(' · ')}`);
  }

  line(
    `依赖：节点 ${graph.nodes}，边 ${graph.edges}；入口 ${graph.roots.length}，枢纽 ${graph.hubs.length}，` +
      `末端 ${graph.leaves.length}，坏引用 ${graph.dangling.length}`,
  );
  if (graph.roots.length > 0) line(`  入口：${graph.roots.slice(0, 8).join('、')}${graph.roots.length > 8 ? ' …' : ''}`);
  if (graph.hubs.length > 0) {
    line(`  枢纽：${graph.hubs.slice(0, 5).map((hub) => `${hub.path}（入 ${hub.in}）`).join('、')}`);
  }
  if (graph.dangling.length > 0) {
    const shown = graph.dangling.slice(0, 10).join('、');
    line(`  坏引用：${shown}${graph.dangling.length > 10 ? ` …共 ${graph.dangling.length} 处` : ''}`);
  }
  void graphDetail;

  // ── 密钥审计：必须打印（SPEC-data-format.md / ADR 0007）──
  line('密钥排除审计（只按文件名匹配，不可能完备；误拦时用 sources.rescan 放回）：');
  if (report.secrets.length === 0) {
    line('  未命中任何密钥类文件名。注意：这不等于目录里没有密钥。');
  } else {
    for (const hit of report.secrets) line(`  已排除 ${hit.path}（匹配 ${hit.match}）`);
  }
  if (report.rescanned.length > 0) line(`  被 rescan 放回：${report.rescanned.join('、')}`);
  line('  边界：硬编码在源码里的密钥、自定义命名的密钥文件都会被读到。');

  // ── 规模保护的实际动作 ────────────────────────────────
  if (report.droppedByMaxFiles > 0) {
    line(`规模：maxFiles=${result.sources.maxFiles}，按重要性丢弃 ${report.droppedByMaxFiles} 个文件（未进清单）`);
  }
  if (report.skippedForSize > 0) {
    line(`规模：${report.skippedForSize} 个文件超过 maxFileSizeMb=${result.sources.maxFileSizeMb}，未读内容（仍在清单里）`);
  }
  if (report.prunedByDepth > 0) {
    line(`规模：${report.prunedByDepth} 个目录超过 maxDepth=${result.sources.maxDepth}，未进入`);
  }
  if (report.scanTruncated) {
    line('警告：扫描条目触到内部上限，结果不完整。请用 sources.exclude 缩小范围。');
  }

  if (outPath !== undefined) line(`输出：${outPath}`);
}

function main(): number {
  const options = parseArgs(process.argv.slice(2));
  if ('error' in options) {
    if (options.error === 'help') {
      console.log(USAGE);
      return 0;
    }
    console.error(`${options.error}\n\n${USAGE}`);
    return 1;
  }

  let result: AnalyzeResult;
  try {
    result = analyzeDirectory({
      root: options.root,
      ...(options.label === undefined ? {} : { label: options.label }),
    });
  } catch (error) {
    console.error(`分析失败：${(error as Error).message}`);
    return 1;
  }

  const root = resolve(options.root);
  const outPath = options.toStdout ? undefined : resolve(options.out ?? `${root}/.foldercast/foldercast.json`);
  const text = `${JSON.stringify(result.document, null, 2)}\n`;

  if (options.toStdout) {
    process.stdout.write(text);
    return 0;
  }

  try {
    mkdirSync(dirname(outPath ?? ''), { recursive: true });
    writeFileSync(outPath ?? '', text);
  } catch (error) {
    console.error(`写入失败：${(error as Error).message}\n目标：${outPath ?? ''}`);
    return 1;
  }

  printSummary(result, outPath);
  return 0;
}

process.exitCode = main();
