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
  --json           机器可读报告（解读 + 规模审计），给工具与 CI 用
  --help           显示本说明`;

type Options = {
  root: string;
  out?: string;
  label?: string;
  toStdout: boolean;
  json: boolean;
};

function parseArgs(argv: readonly string[]): Options | { error: string } {
  let root: string | undefined;
  let out: string | undefined;
  let label: string | undefined;
  let toStdout = false;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) continue;
    if (argument === '--help' || argument === '-h') return { error: 'help' };
    if (argument === '--stdout') {
      toStdout = true;
      continue;
    }
    if (argument === '--json') {
      json = true;
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
  return { root, ...(out === undefined ? {} : { out }), ...(label === undefined ? {} : { label }), toStdout, json };
}

/** 数字对齐，方便在终端里读。 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function printSummary(result: AnalyzeResult, outPath: string | undefined): void {
  const { document, report } = result;
  const { stats } = document;
  const line = (text: string): void => console.log(text);

  line(`目录：${document.source.root}（${document.source.label ?? ''}）`);
  line(
    `文件：${stats.totalFiles} 个进清单 / ${report.discovered} 个通过排除规则 / 扫描 ${report.scanned} 个条目，` +
      `${formatBytes(stats.totalBytes)}，最深 ${stats.maxDepth} 层`,
  );

  const kinds = KIND_VALUES.map((kind) => `${kind} ${stats.kindCounts[kind] ?? 0}`).join(' · ');
  line(`类型：${kinds}`);

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
    line(`规模：maxFiles=${result.sources.maxFiles}，按类型与深度丢弃 ${report.droppedByMaxFiles} 个文件（未进清单）`);
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

  // 先落盘：`--json` 改的是**输出格式**，不是「别写文件」。工具既需要那份文件，
  // 也需要规模审计 —— 之前把它写成提前 return，工具就拿到了空解读（实测踩过）。
  if (!options.toStdout) {
    try {
      mkdirSync(dirname(outPath ?? ''), { recursive: true });
      writeFileSync(outPath ?? '', text);
    } catch (error) {
      console.error(`写入失败：${(error as Error).message}\n目标：${outPath ?? ''}`);
      return 1;
    }
  }

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          reading: result.document,
          report: result.report,
          sources: result.sources,
          path: outPath,
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  if (options.toStdout) {
    process.stdout.write(text);
    return 0;
  }

  printSummary(result, outPath);
  return 0;
}

process.exitCode = main();
