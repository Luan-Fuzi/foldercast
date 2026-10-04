/**
 * 引用依赖的提取与解析。
 *
 * 识别方式按 kind 分（SPEC-data-format.md 的 `graph` 一节）：
 * - `code` / `markup`：import / require / from 语句，按语言语法
 * - `text` / `data`：Markdown 链接与图片引用；JSON/YAML 里的相对路径字符串
 * - `office` / `pdf`：文档里出现的其他文件名（弱信号）—— 要读文档内容，属于 M2
 *
 * **解析只管相对引用**。裸标识符（`react`、`node:fs`）不是文件，一律忽略；
 * 相对引用解析失败才算 `dangling`（"指向不存在的路径，可能是坏引用"）。
 */
import { existsSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import type { Kind } from '../contracts/foldercast.ts';
import { maskCode, unmaskValue } from './mask.ts';

/** `#` 是行注释的语言。JS/TS 里 `#` 是私有字段，不能按注释处理。 */
const HASH_COMMENT_LANGUAGES: ReadonlySet<string> = new Set([
  'Python',
  'Shell',
  'Ruby',
  'Perl',
  'R',
  'Julia',
  'Elixir',
  'Makefile',
  'Dockerfile',
  'PowerShell',
]);

export type ImportsInput = {
  /** 相对 source.root 的路径。 */
  path: string;
  kind: Kind;
  language?: string;
  /** 文件内容（已按体积上限截断过读取）。 */
  text: string;
};

export type ImportEdge = { from: string; to: string };

export type ImportAnalysis = {
  edges: ImportEdge[];
  /** 指向不存在的路径。相对 source.root。 */
  dangling: string[];
};

/** 补全候选扩展名：不要用完整的 KNOWN_EXTENSIONS（两百多个），这里只要常见源码与文档。 */
const CANDIDATE_EXTENSIONS = [
  'ts',
  'tsx',
  'mts',
  'cts',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'json',
  'py',
  'md',
  'markdown',
  'css',
  'scss',
  'html',
  'yaml',
  'yml',
  'toml',
  'sh',
  'rs',
  'go',
  'rb',
  'java',
  'kt',
  'swift',
  'c',
  'h',
  'cpp',
  'hpp',
  'vue',
  'svelte',
  'astro',
  'tex',
  'txt',
  'csv',
];

const EXTERNAL_PREFIXES = ['http://', 'https://', 'mailto:', 'tel:', 'data:', '//'];

/**
 * Markdown 链接与图片：[文字](目标 "标题") / ![alt](目标)。
 * 分组 1 = 尖括号形式的目标（允许空格），分组 2 = 普通形式（允许一层括号）。
 */
const MARKDOWN_LINK =
  /!?\[[^\]]*\]\(\s*(?:<([^<>\n]*)>|((?:[^()\s]|\([^()]*\))+))(?:\s+["'][^"']*["'])?\s*\)/g;

/** Markdown 里代码块与行内代码中的方括号不是链接，先去掉再抽取。 */
function stripMarkdownCode(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/~~~[\s\S]*?~~~/g, '')
    .replace(/`[^`\n]*`/g, '');
}

/** 从一段文本里抽出所有「可能是文件」的引用。结果按首次出现去重。 */
export function extractSpecifiers(input: ImportsInput): string[] {
  const { text, kind, language } = input;
  const found: string[] = [];
  const seen = new Set<string>();

  const push = (...values: string[]): void => {
    for (const value of values) {
      if (value === '' || seen.has(value)) continue;
      seen.add(value);
      found.push(value);
    }
  };

  const collect = (regexp: RegExp, group = 1): void => {
    for (const match of text.matchAll(regexp)) push(match[group] ?? '');
  };

  if (kind === 'markup') {
    collect(/(?:src|href)\s*=\s*["']([^"']+)["']/gi);
    return found;
  }

  if (kind === 'text') {
    // Markdown 链接与图片。目标里允许一层括号 —— 文件名带括号很常见
    // （`[爬楼梯(一)](003_228_爬楼梯(一).md)`）；代码块与行内代码里的不算。
    for (const match of stripMarkdownCode(text).matchAll(MARKDOWN_LINK)) {
      push(match[1] ?? match[2] ?? '');
    }
    return found;
  }

  if (kind === 'data') {
    // 数据文件里的字符串没有统一语义：只认**明确的相对路径**（./ 或 ../ 开头）。
    // 裸文件名与根相对路径在 JSON 里太常见（`"file": "math00_taylor.png"`、
    // `"path": "src/index.ts"`），当成引用会产生大量假边与假坏引用。
    collect(/["']((?:\.\.?\/)[^"'\n]+)["']/g);
    return found;
  }

  if (kind !== 'code') return found;

  // 代码位置之外的字符串与注释要屏蔽掉：测试用例、示例片段里到处是「代码形状的字符串」
  const { masked, literals } = maskCode(text, { hashComments: HASH_COMMENT_LANGUAGES.has(language ?? '') });
  const code: string = masked;
  const collectFromCode = (regexp: RegExp, group = 1): void => {
    for (const match of code.matchAll(regexp)) push(unmaskValue(match[group] ?? '', literals));
  };

  switch (language) {
    case 'TypeScript':
    case 'TSX':
    case 'JavaScript':
    case 'JSX':
    case 'Vue':
    case 'Svelte':
    case 'Astro':
      // 副作用导入（没有 from）要先单独抓，否则会被下面的跨行匹配吞掉
      collectFromCode(/^\s*import\s+["']([^"']+)["']/gm);
      collectFromCode(/^\s*import\s+[\s\S]*?\sfrom\s+["']([^"']+)["']/gm);
      collectFromCode(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g);
      collectFromCode(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g);
      collectFromCode(/\bexport\s+[\s\S]*?\sfrom\s+["']([^"']+)["']/g);
      break;
    case 'Python':
      collectFromCode(/^\s*from\s+([.\w]+)\s+import\s/gm);
      collectFromCode(/^\s*import\s+([.\w]+)/gm);
      break;
    case 'Go':
      // import "x" 与 import ( ... ) 块里的字符串
      collectFromCode(/^\s*import\s+(?:\w+\s+)?["']([^"']+)["']/gm);
      collectFromCode(/^\s*_?\s*["']([^"']+)["']\s*$/gm);
      break;
    case 'Rust':
      collectFromCode(/^\s*(?:pub\s+)?mod\s+(\w+)\s*;/gm);
      collectFromCode(/^\s*use\s+crate::([\w:]+)/gm);
      break;
    case 'CSS':
    case 'SCSS':
    case 'Sass':
    case 'Less':
    case 'Stylus':
      collectFromCode(/@(?:import|use|forward)\s+["']([^"']+)["']/g);
      break;
    case 'Shell':
      collectFromCode(/^\s*(?:source|\.)\s+([^\s;]+)/gm);
      break;
    default:
      // 其他语言暂不识别（宁缺毋滥，避免假边）
      break;
  }

  return found;
}

/** 去掉查询串与锚点，并判断是否外部链接。 */
function normalizeSpecifier(specifier: string): string | undefined {
  const trimmed = specifier.trim();
  if (trimmed === '') return undefined;
  if (EXTERNAL_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) return undefined;

  const withoutHash = trimmed.split('#')[0] ?? '';
  const withoutQuery = withoutHash.split('?')[0] ?? '';
  if (withoutQuery === '') return undefined;
  return withoutQuery;
}

/** 从 importer 的路径与 specifier 推出候选目标路径（相对 source.root，posix）。 */
function candidatePaths(
  fromPath: string,
  specifier: string,
  assumeRelative: boolean,
): { bases: string[]; relative: boolean } {
  const fromDirectory = dirname(fromPath) === '.' ? '' : dirname(fromPath);

  if (specifier.startsWith('/')) {
    return { bases: [normalize(specifier.slice(1))], relative: false };
  }
  if (specifier.startsWith('.')) {
    // './x'、'../x'，以及 Python 的 '.pkg.mod'
    return { bases: [normalize(join(fromDirectory, specifier))], relative: true };
  }

  // 没有前导点：Markdown/HTML/数据文件里就是相对路径（`docs/guide.md`），
  // 代码里则是裸模块名（`react`），后者不是文件。
  return { bases: [normalize(join(fromDirectory, specifier))], relative: assumeRelative };
}

/** Python 的点分模块名 → 候选文件路径。 */
function pythonCandidates(fromPath: string, specifier: string): string[] {
  const withInit = (base: string): string[] => {
    const clean = normalize(base);
    return [clean, `${clean}/__init__`];
  };

  if (specifier.startsWith('.')) {
    const leading = /^\.+/.exec(specifier)?.[0].length ?? 1;
    const moduleName = specifier.slice(leading);
    let directory = dirname(fromPath) === '.' ? '' : dirname(fromPath);
    for (let index = 1; index < leading; index += 1) {
      directory = dirname(directory) === '.' ? '' : dirname(directory);
    }
    return withInit(moduleName === '' ? directory : join(directory, moduleName.split('.').join('/')));
  }

  return withInit(specifier.split('.').join('/'));
}

function withExtensions(candidate: string): string[] {
  const attempts = [candidate];
  for (const extension of CANDIDATE_EXTENSIONS) attempts.push(`${candidate}.${extension}`);
  for (const extension of CANDIDATE_EXTENSIONS) attempts.push(join(candidate, `index.${extension}`));
  attempts.push(join(candidate, '__init__.py'), join(candidate, 'mod.rs'), join(candidate, 'main.go'));
  return attempts;
}

/**
 * 解析一个 specifier。返回命中的分析内文件，或标记为坏引用。
 *
 * `analyzed` 是分析范围内所有文件的相对路径集合；`existsOnDisk` 用于区分
 * 「文件不存在」与「文件存在但被排除规则挡掉」—— 后者不是坏引用。
 */
export function resolveSpecifier(
  fromPath: string,
  specifier: string,
  analyzed: ReadonlySet<string>,
  existsOnDisk: (relativePath: string) => boolean,
  options: { assumeRelative?: boolean } = {},
): { target?: string; dangling?: string } {
  const specifierPath = normalizeSpecifier(specifier);
  if (specifierPath === undefined) return {};

  const assumeRelative = options.assumeRelative ?? false;
  const { bases, relative } = candidatePaths(fromPath, specifierPath, assumeRelative);

  // Python 的点分模块名（含相对导入 `.util`）要按模块路径找，不能当成文件名拼
  const isPythonSource = fromPath.endsWith('.py') || fromPath.endsWith('.pyi');
  const pythonStyle = isPythonSource && /^[.\w]+$/.test(specifierPath) && !specifierPath.includes('/');
  const moduleBases = pythonStyle ? pythonCandidates(fromPath, specifierPath) : [];
  const candidates = [...moduleBases, ...bases].flatMap(withExtensions);

  for (const candidate of candidates) {
    if (analyzed.has(candidate)) return { target: candidate };
  }

  // 分析范围外：磁盘上存在说明只是被排除，不存在才是坏引用
  if (!relative) return {};
  for (const candidate of candidates) {
    if (existsOnDisk(candidate)) return {};
  }

  const first = moduleBases[0] ?? bases[0];
  if (first === undefined) return {};
  // 跨出被讲解目录的引用（../sibling）不属于本目录的图：既不是边，也不算坏引用。
  // 判据只对「根目录之内但不存在」的引用报坏引用，才不会把外部链接算成坏引用。
  if (first.startsWith('..')) return {};
  return { dangling: first };
}

/** 汇总一批文件的引用关系。 */
export function analyzeImports(
  inputs: readonly ImportsInput[],
  root: string,
  analyzed: ReadonlySet<string>,
): ImportAnalysis {
  const existsOnDisk = (relativePath: string): boolean => {
    if (relativePath === '' || relativePath.startsWith('..')) return false;
    return existsSync(join(root, relativePath));
  };

  const edgeKeys = new Set<string>();
  const edges: ImportEdge[] = [];
  const dangling = new Set<string>();

  for (const input of inputs) {
    // 文本/标记/数据文件里的 `docs/guide.md` 就是相对路径；代码里的 `react` 不是文件
    const assumeRelative = input.kind !== 'code';
    for (const specifier of extractSpecifiers(input)) {
      const resolved = resolveSpecifier(input.path, specifier, analyzed, existsOnDisk, { assumeRelative });
      if (resolved.target !== undefined && resolved.target !== input.path) {
        const key = `${input.path}\u0000${resolved.target}`;
        if (!edgeKeys.has(key)) {
          edgeKeys.add(key);
          edges.push({ from: input.path, to: resolved.target });
        }
      } else if (resolved.dangling !== undefined) {
        dangling.add(resolved.dangling);
      }
    }
  }

  return { edges, dangling: [...dangling].sort() };
}
