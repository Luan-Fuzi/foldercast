/**
 * 检查 Markdown 文档里的相对链接是否指向存在的文件。
 *
 * 用法：
 *   node scripts/check-links.ts        # 检查，有失效则退出码 1
 *   node scripts/check-links.ts -v     # 打印所有检查过的链接
 *
 * 这是 docs/conventions/docs.md 里那条规范的可执行版本：文档重组后必须跑。
 * 链接抽取（跳过代码块、目标含括号）在 ./lib/markdown.ts 里，单独有测试。
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { extractLinks } from './lib/markdown.ts';
import { isInsideRepo, readText, rel, walkFiles } from './lib/repo.ts';

/** 不检查的目标：外链、纯锚点、mailto。 */
const EXTERNAL_PREFIXES = ['http://', 'https://', '#', 'mailto:'] as const;

type BrokenLink = { doc: string; line: number; target: string };

function main(): number {
  const verbose = process.argv.includes('-v');
  const docs = walkFiles('.md');
  const broken: BrokenLink[] = [];
  let total = 0;
  let outside = 0;

  for (const doc of docs) {
    for (const link of extractLinks(readText(doc))) {
      const target = link.target.trim();
      if (EXTERNAL_PREFIXES.some((prefix) => target.startsWith(prefix))) continue;

      const pathPart = target.split('#')[0] ?? '';
      if (pathPart === '') continue;

      // 指向仓库之外的链接（兄弟目录等）在 CI 的全新检出里必然不存在，不按失效处理
      const resolved = resolve(dirname(doc), pathPart);
      if (!isInsideRepo(resolved)) {
        outside += 1;
        if (verbose) console.log(`  skip ${rel(doc)}:${link.line}  ->  ${target}（仓库之外）`);
        continue;
      }

      total += 1;
      if (existsSync(join(dirname(doc), pathPart))) {
        if (verbose) console.log(`  ok   ${rel(doc)}:${link.line}  ->  ${target}`);
      } else {
        broken.push({ doc: rel(doc), line: link.line, target });
      }
    }
  }

  console.log(`检查了 ${total} 条仓库内的相对链接，覆盖 ${docs.length} 个文档。`);
  if (outside > 0) console.log(`跳过 ${outside} 条指向仓库之外的链接（CI 检出里不存在，属预期）。`);
  if (broken.length > 0) {
    console.log(`\n发现 ${broken.length} 条失效链接：`);
    for (const item of broken) console.log(`  ${item.doc}:${item.line}  ->  ${item.target}`);
    return 1;
  }

  console.log('全部有效 ✓');
  return 0;
}

process.exitCode = main();
