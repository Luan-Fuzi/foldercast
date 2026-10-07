/**
 * 随包分发的代码，**运行时用到的每个包都必须声明在插件自己的 `dependencies` 里**。
 *
 * 为什么单独测这一条：开发时这些包能从仓库根的 `node_modules` 解析到（它们也是仓库工具的
 * 依赖），所以漏声明**在本机完全正常**——只有装到别处才会以 `ERR_MODULE_NOT_FOUND` 炸。
 * 踩过两次：`ignore`（分析器的 glob 库）与 `ajv` / `ajv-formats` / `jsonc-parser`
 * （校验器的 schema 校验与定位）。
 *
 * 判据：把 `scripts/` 与 `src/` 下所有源文件的 import 扫一遍，裸包名（不以 `.` 或 `node:` 开头）
 * 必须在 `dependencies`（或 `optionalDependencies`）里出现。
 */
import { describe, expect, it } from 'vitest';
import { globSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';

const PACKAGE_ROOT = resolve(import.meta.dirname, '../..');
const MANIFEST = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

/**
 * 用 TypeScript 自己的解析器取模块标识。
 *
 * 不自己写正则扫源码：源码里会出现**长得像 import 的字符串与正则字面量**（本文件就踩过，
 * `imports.ts` 里有一句示例注释与一个匹配 import 的正则），正则扫法会被它们带偏。
 * `typescript` 本来就是仓库的 devDependency，用它比维护一个小词法器便宜。
 */
function specifiersIn(source: string, fileName: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const found: string[] = [];

  const record = (node: ts.Node): void => {
    // 静态 import / export ... from
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined) {
      if (ts.isStringLiteral(node.moduleSpecifier)) found.push(node.moduleSpecifier.text);
    }
    // 动态 import('x')
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [first] = node.arguments;
      if (first !== undefined && ts.isStringLiteral(first)) found.push(first.text);
    }
    ts.forEachChild(node, record);
  };

  record(sourceFile);
  return found;
}

/** 裸包名：`a` / `@scope/a`；子路径（`a/b`）归到 `a`。 */
function packageNameOf(specifier: string): string | undefined {
  if (specifier.startsWith('.') || specifier.startsWith('node:') || specifier.startsWith('/')) return undefined;
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

describe('随包代码的依赖都已声明', () => {
  const declared = new Set([
    ...Object.keys(MANIFEST.dependencies ?? {}),
    ...Object.keys(MANIFEST.optionalDependencies ?? {}),
    // Node 内建模块前缀在 packageNameOf 里已排除；这里再排除 Node 自己的名字空间
    'node',
  ]);

  const files = [
    ...globSync('scripts/**/*.ts', { cwd: PACKAGE_ROOT }),
    ...globSync('src/**/*.ts', { cwd: PACKAGE_ROOT }),
  ].filter((file) => !file.includes('/tests/'));

  it('扫到了源文件（不是空跑）', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('客户端半侧的依赖由宿主页面提供，不在扫描范围', () => {
    // src/client/ 打成 `window.__ModuleLoader__` 模块（lib/client.js），react 与
    // `@deepseek-ai/dsh-client-ui-*` 由宿主的 require 注册表在运行时解析 ——
    // 故意**不是**本包的 dependencies（装进用户 profile 也解析不到，声明了反而误导）。
    // 所以依赖判据不扫这个目录，但要保证它真的存在（豁免不能静默失效）。
    expect(globSync('src/client/*.ts', { cwd: PACKAGE_ROOT }).length).toBeGreaterThan(0);
  });

  it('没有未声明的裸包依赖', () => {
    const undeclared = new Map<string, string[]>();
    for (const file of files) {
      if (file.startsWith('src/client/')) continue;
      const source = readFileSync(join(PACKAGE_ROOT, file), 'utf8');
      for (const specifier of specifiersIn(source, file)) {
        const name = packageNameOf(specifier);
        if (name === undefined || declared.has(name)) continue;
        const hits = undeclared.get(name) ?? [];
        hits.push(file);
        undeclared.set(name, hits);
      }
    }

    const report = [...undeclared.entries()].map(([name, hits]) => `${name} ← ${hits.slice(0, 3).join(', ')}`);
    expect(report).toEqual([]);
  });
});
