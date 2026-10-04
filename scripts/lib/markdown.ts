/**
 * Markdown 链接抽取。被仓库工具 `scripts/check-links.ts` 使用。
 *
 * 两个必须处理的细节（分析器侧有同一类判据，见
 * packages/plugin/scripts/analyzer/imports.ts）：
 * 1. **代码块与行内代码里的方括号不是链接** —— 文档里经常出现 `[name](arg)`
 *    这种代码片段，按链接去检查会报出假的失效链接。
 * 2. **链接目标里允许一层括号** —— 文件名带括号很常见，`[爬楼梯(一)](003_228_爬楼梯(一).md)`
 *    不能用 `[^)]+` 去截。
 */

/**
 * 链接语法：`[文字](目标 "标题")` 与 `![alt](目标)`。
 * 目标两种写法：普通形式允许一层括号；尖括号形式 `<...>` 允许空格。
 * 分组 1 = 尖括号内的目标，分组 2 = 普通目标。
 */
const LINK_PATTERN =
  /\[[^\]]*\]\(\s*(?:<([^<>\n]*)>|((?:[^()\s]|\([^()]*\))+))(?:\s+["'][^"']*["'])?\s*\)/g;

export type MarkdownLink = {
  /** 1-based 行号。 */
  line: number;
  /** 目标原文（未去锚点）。 */
  target: string;
};

/**
 * 把围栏代码块与行内代码抹成空格，保留行数与行号。
 */
export function blankCode(text: string): string {
  let inFence = false;

  return text
    .split('\n')
    .map((line) => {
      if (/^\s*(?:```|~~~)/.test(line)) {
        inFence = !inFence;
        return '';
      }
      if (inFence) return '';
      return line.replace(/`[^`]*`/g, (match) => ' '.repeat(match.length));
    })
    .join('\n');
}

/** 抽取文档里的全部链接（含图片），跳过代码区域。 */
export function extractLinks(text: string): MarkdownLink[] {
  const links: MarkdownLink[] = [];
  const lines = blankCode(text).split('\n');

  lines.forEach((line, index) => {
    for (const match of line.matchAll(LINK_PATTERN)) {
      const target = match[1] ?? match[2];
      if (target !== undefined) links.push({ line: index + 1, target });
    }
  });

  return links;
}
