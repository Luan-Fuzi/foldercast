/**
 * JSON 指针 → 文件里的行列。
 *
 * 报错必须指到行，否则「/scenes/7/narration 有问题」还得让人自己数。schema 校验器（ajv）
 * 给的是 JSON 指针，所以这里把指针映射回行号。用 `jsonc-parser` 的语法树：它保留每个节点
 * 的 offset，且**对不合法 JSON 也给树**（容错解析），坏文件也能指出位置。
 */
import { findNodeAtLocation, parseTree, type Node as JsonNode } from 'jsonc-parser';

export type Position = { line: number; column: number };

export type Locator = {
  /** 指针在文件里的位置，1 起。指针不存在（如数组越界）时返回 undefined。 */
  at(pointer: string): Position | undefined;
};

/** 把 JSON 指针切成各层。`/a/0/b` → `['a', '0', 'b']`，`/` 与 `''` → `[]`。 */
export function pointerSegments(pointer: string): string[] {
  if (pointer === '' || pointer === '/') return [];
  return pointer
    .split('/')
    .slice(1)
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
}

/** 把 `jsonc-parser` 的 offset 换算成 1 起的行列。 */
export function positionAt(text: string, offset: number): Position {
  let line = 1;
  let lineStart = 0;

  for (let index = 0; index < offset && index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) {
      line += 1;
      lineStart = index + 1;
    }
  }

  return { line, column: offset - lineStart + 1 };
}

export function createLocator(text: string): Locator {
  const tree: JsonNode | undefined = parseTree(text, [], { allowTrailingComma: true, disallowComments: false });

  return {
    at(pointer: string): Position | undefined {
      if (tree === undefined) return undefined;
      const segments = pointerSegments(pointer);

      if (segments.length === 0) return positionAt(text, tree.offset);

      // 数组下标要按数字查：`findNodeAtLocation` 不做隐式转换，传 '1' 匹配不到数组的第 2 项
      const path = cursorPath(tree, segments);
      if (path === undefined) return undefined;

      const node = findNodeAtLocation(tree, path);
      if (node === undefined) return undefined;

      // 值节点的 offset 指向值本身，行列随之落在值上，正是想让人看到的那一行
      return positionAt(text, node.offset);
    },
  };
}

/** 沿指针逐层走，把数组下标转成数字。指针不存在时返回 undefined。 */
function cursorPath(tree: JsonNode, segments: readonly string[]): (string | number)[] | undefined {
  const path: (string | number)[] = [];
  let node: JsonNode | undefined = tree;

  for (const segment of segments) {
    if (node === undefined) return undefined;

    if (node.type === 'array') {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0) return undefined;
      path.push(index);
      node = node.children?.[index];
      continue;
    }

    if (node.type !== 'object') return undefined;
    // 对象的属性节点是 children[0] = 键、children[1] = 值，往里走要跳过键那一层
    const property = node.children?.find((child) => child.children?.[0]?.value === segment);
    const value = property?.children?.[1];
    if (value === undefined) return undefined;
    path.push(segment);
    node = value;
  }

  return path;
}

/** 打印用的位置后缀，没有位置时为空串。 */
export function formatPosition(at: Position | undefined): string {
  return at === undefined ? '' : `:${String(at.line)}:${String(at.column)}`;
}
