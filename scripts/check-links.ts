/**
 * 检查 Markdown 文档里的相对链接是否指向存在的文件。
 *
 * 用法：
 *   node scripts/check-links.ts        # 检查，有失效则退出码 1
 *   node scripts/check-links.ts -v     # 打印所有检查过的链接
 *
 * 这是 docs/conventions/docs.md 里那条规范的可执行版本：文档重组后必须跑。
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readText, rel, walkFiles } from './lib/repo.ts';

/** 不检查的目标：外链、纯锚点、mailto。 */
const EXTERNAL_PREFIXES = ['http://', 'https://', '#', 'mailto:'] as const;

type BrokenLink = { doc: string; line: number; target: string };

function main(): number {
  const verbose = process.argv.includes('-v');
  const docs = walkFiles('.md');
  const broken: BrokenLink[] = [];
  let total = 0;

  for (const doc of docs) {
    const lines = readText(doc).split('\n');
    lines.forEach((text, index) => {
      for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        const target = (match[1] ?? '').trim();
        if (EXTERNAL_PREFIXES.some((prefix) => target.startsWith(prefix))) continue;

        const pathPart = target.split('#')[0] ?? '';
        if (pathPart === '') continue;

        total += 1;
        if (existsSync(join(dirname(doc), pathPart))) {
          if (verbose) console.log(`  ok   ${rel(doc)}:${index + 1}  ->  ${target}`);
        } else {
          broken.push({ doc: rel(doc), line: index + 1, target });
        }
      }
    });
  }

  console.log(`检查了 ${total} 条相对链接，覆盖 ${docs.length} 个文档。`);
  if (broken.length > 0) {
    console.log(`\n发现 ${broken.length} 条失效链接：`);
    for (const item of broken) console.log(`  ${item.doc}:${item.line}  ->  ${item.target}`);
    return 1;
  }

  console.log('全部有效 ✓');
  return 0;
}

process.exitCode = main();
