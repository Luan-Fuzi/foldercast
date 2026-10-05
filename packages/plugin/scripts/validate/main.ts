#!/usr/bin/env node
/**
 * 契约校验入口：解读与讲稿是否成立。
 *
 * 用法：
 *     node packages/plugin/scripts/validate/main.ts <目录> [选项]
 *
 * 选项：
 *     --reading <文件>   显式指定解读（默认 `<目录>/.foldercast/foldercast.json`）
 *     --script <文件>    显式指定讲稿（默认 `<工作根>/script.json`）
 *     --specs <目录>     显式指定 schema 目录（默认按仓库布局查找）
 *     --json             以 JSON 输出报告（给工具与 CI 用）
 *
 * 退出码：0 = 通过（可能有 warning）；1 = 有 blocker；2 = 参数或环境有误。
 *
 * 它查机器能判断的：schema、解读内部自洽、讲稿的引用是否存在于解读、场景字段、
 * 字幕能不能切成 ≤ 24 字。**「有没有讲错重点」不在这里**，那是写稿后的评审 agent（M5）。
 */
import { validateContracts, type CheckedFile, type ValidateReport } from './validate.ts';

const USAGE = `用法：node packages/plugin/scripts/validate/main.ts <目录> [选项]

选项：
  --reading <文件>   显式指定解读（默认 <目录>/.foldercast/foldercast.json）
  --script <文件>    显式指定讲稿（默认 <工作根>/script.json）
  --specs <目录>     显式指定 schema 目录（默认按仓库布局查找）
  --json             以 JSON 输出报告

退出码：0 = 通过（可能有 warning）；1 = 有 blocker；2 = 参数或环境有误。

也接受直接给解读文件：node .../main.ts <目录>/.foldercast/foldercast.json`;

type Options = {
  target: string;
  reading?: string;
  script?: string;
  specs?: string;
  json: boolean;
};

function parseArgs(argv: readonly string[]): Options | { error: string } {
  let target: string | undefined;
  let reading: string | undefined;
  let script: string | undefined;
  let specs: string | undefined;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) continue;
    if (argument === '--help' || argument === '-h') return { error: 'help' };
    if (argument === '--json') {
      json = true;
      continue;
    }
    if (argument === '--reading' || argument === '--script' || argument === '--specs') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) return { error: `${argument} 后面需要一个值` };
      index += 1;
      if (argument === '--reading') reading = value;
      else if (argument === '--script') script = value;
      else specs = value;
      continue;
    }
    if (argument.startsWith('-')) return { error: `未知选项：${argument}` };
    if (target !== undefined) return { error: `只能给一个目录或文件，多出来的是：${argument}` };
    target = argument;
  }

  if (target === undefined && reading === undefined) return { error: '缺少目录参数' };
  // 给了解读文件就不需要再校验源目录：两者同时给会让人以为两个都生效
  if (target !== undefined && reading !== undefined) {
    return { error: '--reading 与目录参数只能给一个：给了 --reading 就只校验这个文件' };
  }
  return {
    target: target ?? (reading as string),
    ...(reading === undefined ? {} : { reading }),
    ...(script === undefined ? {} : { script }),
    ...(specs === undefined ? {} : { specs }),
    json,
  };
}

const MARK: Record<CheckedFile['severity'], string> = { blocker: '×', warning: '!' };

function formatIssue(issue: CheckedFile): string[] {
  const where = `${issue.path}${issue.line === undefined ? '' : `:${String(issue.line)}:${String(issue.column ?? 1)}`}`;
  const scene = issue.sceneId === undefined ? '' : ` [场景 ${issue.sceneId}]`;
  const lines = [`${MARK[issue.severity]} ${where}  ${issue.code}${scene}`, `    ${issue.message}`];
  if (issue.fix !== undefined) lines.push(`    → ${issue.fix}`);
  return lines;
}

function printReport(report: ValidateReport): void {
  const lines: string[] = [];
  const total = report.issues.length;

  if (total === 0) {
    lines.push('契约校验通过：解读与讲稿都成立，没有问题。');
  } else {
    for (const issue of report.issues) lines.push(...formatIssue(issue));
    lines.push('');
    lines.push(
      `共 ${String(total)} 条：${String(report.counts.blocker)} 个必须修，${String(report.counts.warning)} 个待确认。`,
    );
  }

  const checkedList = [report.checked.reading, report.checked.script, report.checked.assets].filter(
    (item): item is string => item !== undefined,
  );
  lines.push(`检查了 ${String(checkedList.length)} 个文件：`);
  for (const path of checkedList) lines.push(`  ${path}`);

  if (report.counts.blocker > 0) lines.push('有必须修的问题，退出码 1。');

  console.log(lines.join('\n'));
}

function main(): number {
  const options = parseArgs(process.argv.slice(2));
  if ('error' in options) {
    if (options.error === 'help') {
      console.log(USAGE);
      return 0;
    }
    console.error(`${options.error}\n\n${USAGE}`);
    return 2;
  }

  let report: ValidateReport;
  try {
    report = validateContracts({
      target: options.target,
      ...(options.reading === undefined ? {} : { readingPath: options.reading }),
      ...(options.script === undefined ? {} : { scriptPath: options.script }),
      ...(options.specs === undefined ? {} : { specsDir: options.specs }),
    });
  } catch (error) {
    console.error((error as Error).message);
    return 2;
  }

  if (options.json) console.log(JSON.stringify(report, null, 2));
  else printReport(report);

  return report.counts.blocker > 0 ? 1 : 0;
}

process.exitCode = main();
