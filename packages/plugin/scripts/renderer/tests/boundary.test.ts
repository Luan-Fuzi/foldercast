/**
 * **进浏览器 bundle 的模块不许 import `node:` 模块。**
 *
 * 这条踩过一次，代价是整片渲染直接失败：`plan.ts` 原来 `import { embedImage } from './embed.ts'`
 * 而 `embed.ts` 里要 `node:child_process` 调缩图工具，webpack 打包时报
 * `UnhandledSchemeError: Reading from "node:child_process" is not handled by plugins`。
 * 单测全绿（Node 里跑得动），只有真去打包才炸 —— 所以这里用静态检查把它钉死。
 *
 * 判据是「从入口出发的可达 import 图」：`entry.ts` 与它引到的一切都会进 bundle。
 * 类型导入（`import type`）在编译后消失，但为了不依赖这个细节，一律禁止。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';

const RENDERER_DIR = resolve(import.meta.dirname, '..');

/** 相对 import 的解析：`./x.ts`、`./x`、`../y.ts` 都认。 */
function resolveImport(fromFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [base, `${base}.ts`, resolve(base, 'index.ts')];
  for (const candidate of candidates) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}

function importsOf(file: string): { specifier: string; typeOnly: boolean }[] {
  const source = readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const found: { specifier: string; typeOnly: boolean }[] = [];

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      found.push({ specifier: statement.moduleSpecifier.text, typeOnly: statement.importClause?.isTypeOnly === true });
    }
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier)) {
      found.push({ specifier: statement.moduleSpecifier.text, typeOnly: statement.isTypeOnly });
    }
  }
  return found;
}

/** 从入口出发做一次可达性遍历，返回所有会被打进 bundle 的文件。 */
function reachableFrom(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    for (const { specifier } of importsOf(file)) {
      const next = resolveImport(file, specifier);
      if (next !== undefined && !seen.has(next)) queue.push(next);
    }
  }
  return [...seen];
}

describe('浏览器 bundle 的边界', () => {
  const entry = resolve(RENDERER_DIR, 'entry.ts');

  it('入口可达的文件里没有裸包依赖（只有 react 与 remotion）', () => {
    const bare = new Set<string>();
    for (const file of reachableFrom(entry)) {
      for (const { specifier } of importsOf(file)) {
        if (specifier.startsWith('.') || specifier.startsWith('node:')) continue;
        const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : (specifier.split('/')[0] ?? specifier);
        bare.add(name);
      }
    }
    expect([...bare].sort()).toEqual(['react', 'remotion']);
  });

  it('入口可达的文件里没有 node: 内建模块', () => {
    const offenders: string[] = [];
    for (const file of reachableFrom(entry)) {
      for (const { specifier } of importsOf(file)) {
        if (specifier.startsWith('node:')) offenders.push(`${file.replace(`${RENDERER_DIR}/`, '')} → ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('扫描本身有效：`main.ts`（CLI）**确实**会碰到 node 内建模块', () => {
    // 反证：如果解析器坏了，上面两条会毫无意义地通过。
    const cli = reachableFrom(resolve(RENDERER_DIR, 'main.ts'));
    const hasNode = cli.some((file) => importsOf(file).some(({ specifier }) => specifier.startsWith('node:')));
    expect(hasNode).toBe(true);
    expect(cli.length).toBeGreaterThan(5);
  });

  it('内联的实现在 CLI 侧而不在入口侧（这条边界是有意为之）', () => {
    const browserSide = reachableFrom(entry).map((file) => relative(RENDERER_DIR, file).replaceAll('\\', '/'));
    expect(browserSide).toContain('plan.ts');
    expect(browserSide).not.toContain('embed-node.ts');
    expect(browserSide).not.toContain('load.ts');
    expect(browserSide).not.toContain('browser.ts');
  });
});
