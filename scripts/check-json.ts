/**
 * 校验仓库内所有 JSON 文件的语法，并检出**重复键**。
 *
 * 为什么单独查重复键：`JSON.parse` 对同一个对象里出现两次的键静默保留最后一个，
 * 于是重复的那段变成没人会执行的死文本。schema 文件里就发生过一次
 * （顶层 `graph` 定义了两遍），靠人读是发现不了的。
 *
 * 用法：node scripts/check-json.ts
 */
import { parseTree, type Node } from 'jsonc-parser';
import { readText, rel, walkFiles } from './lib/repo.ts';

type Finding = { file: string; line: number; column: number; message: string };
type Position = { line: number; column: number };

/** jsonc-parser 的节点只给 offset，这里换成 1-based 行列号。 */
function positionOf(text: string, offset: number): Position {
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  const column = offset - (before.lastIndexOf('\n') + 1) + 1;
  return { line, column };
}

/** 收集一个 JSON 文件里重复出现的对象键。 */
function duplicateKeys(root: Node, text: string): Array<{ key: string; at: Position }> {
  const found: Array<{ key: string; at: Position }> = [];

  const visit = (node: Node): void => {
    if (node.type === 'object') {
      const seen = new Set<string>();
      for (const property of node.children ?? []) {
        const keyNode = property.children?.[0];
        const key = typeof keyNode?.value === 'string' ? keyNode.value : undefined;
        if (key !== undefined && keyNode !== undefined) {
          if (seen.has(key)) found.push({ key, at: positionOf(text, keyNode.offset) });
          seen.add(key);
        }
      }
    }
    for (const child of node.children ?? []) visit(child);
  };

  visit(root);
  return found;
}

function main(): number {
  const files = walkFiles('.json');
  const findings: Finding[] = [];

  for (const file of files) {
    const text = readText(file);
    const path = rel(file);

    try {
      JSON.parse(text);
    } catch (error) {
      findings.push({ file: path, line: 0, column: 0, message: `语法非法：${(error as Error).message}` });
      continue;
    }

    const root = parseTree(text);
    if (root === undefined) continue;
    for (const dup of duplicateKeys(root, text)) {
      findings.push({
        file: path,
        line: dup.at.line,
        column: dup.at.column,
        message: `键 "${dup.key}" 在同一对象里出现了多次；JSON.parse 只保留最后一个，前面的是死文本`,
      });
    }
  }

  console.log(`检查了 ${files.length} 个 JSON 文件的语法与重复键。`);
  if (findings.length > 0) {
    console.log(`\n发现 ${findings.length} 处问题：`);
    for (const item of findings) {
      const where = item.line > 0 ? `${item.file}:${item.line}:${item.column}` : item.file;
      console.log(`  ${where}  ${item.message}`);
    }
    return 1;
  }

  console.log('全部合法，无重复键 ✓');
  return 0;
}

process.exitCode = main();
