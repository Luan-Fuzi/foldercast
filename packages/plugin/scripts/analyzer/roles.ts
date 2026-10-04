/**
 * 角色识别：一个文件最多一个角色，无法判定则缺省。
 *
 * 判据只看**路径与文件名**，不读内容 —— 与分类同理，内容可能因超限或密钥判据没读。
 * 规则按优先级从上到下匹配，先命中者胜（见 SPEC-data-format.md 的 8 个角色）。
 */
import type { Kind, Role } from '../contracts/foldercast.ts';
import { extensionOf } from './classify.ts';

/** 路径里的目录段与文件名。 */
type Parts = {
  /** 小写文件名，含扩展名。 */
  basename: string;
  /** 不含扩展名的小写文件名。 */
  stem: string;
  /** 小写目录段。 */
  dirs: readonly string[];
  /** 小写扩展名，不含点。 */
  extension: string;
};

function split(relativePath: string): Parts {
  const segments = relativePath.split('/');
  const basename = (segments.at(-1) ?? '').toLowerCase();
  const dirs = segments.slice(0, -1).map((part) => part.toLowerCase());
  const extension = extensionOf(basename);
  const stem = extension === '' ? basename : basename.slice(0, -(extension.length + 1));
  return { basename, stem, dirs, extension };
}

const hasDir = (parts: Parts, names: readonly string[]): boolean =>
  parts.dirs.some((dir) => names.includes(dir));

/** 说明文件：README 及其变体，任意层级。 */
const isReadme = (p: Parts): boolean => /^readme(\..+)?$/.test(p.basename);

const LICENSE_STEMS = new Set(['license', 'licence', 'copying', 'notice', 'unlicense', 'copyright']);
const isLicense = (p: Parts): boolean => LICENSE_STEMS.has(p.stem);

/** 入口：常见入口文件名，以及项目清单文件。 */
const ENTRY_STEMS = new Set(['index', 'main', 'app', 'server', 'cli', 'entry', 'program', 'root', 'mod', 'lib']);
const ENTRY_MANIFESTS = new Set([
  'package.json',
  'pyproject.toml',
  'setup.py',
  'cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'composer.json',
  'gemfile',
]);

const isEntry = (p: Parts): boolean => {
  if (ENTRY_MANIFESTS.has(p.basename)) return true;
  // 清单文件之外，只有代码类文件才可能是入口（避免把 index.md 当入口）
  if (!['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'rb', 'java', 'kt', 'swift', 'php', 'c', 'cpp'].includes(p.extension)) {
    return false;
  }
  return ENTRY_STEMS.has(p.stem);
};

/** 配置：*.config.*、.*rc、以及一批具名配置文件。 */
const CONFIG_BASENAMES = new Set([
  '.editorconfig',
  '.gitattributes',
  '.npmrc',
  '.nvmrc',
  '.prettierignore',
  '.eslintignore',
  '.dockerignore',
  'nginx.conf',
  'procfile',
  'tsconfig.json',
  'jsconfig.json',
  'deno.json',
  'deno.jsonc',
  'requirements.txt',
  'environment.yml',
  'environment.yaml',
]);

const isConfig = (p: Parts): boolean => {
  if (CONFIG_BASENAMES.has(p.basename)) return true;
  if (/\.config\.(ts|tsx|js|mjs|cjs|json|ya?ml|toml)$/.test(p.basename)) return true;
  if (/^\.[a-z0-9-]*rc(\..+)?$/.test(p.basename)) return true;
  if (/^tsconfig(\..+)?\.json$/.test(p.basename)) return true;
  return false;
};

/** 测试：文件名约定，或位于测试目录下。 */
const TEST_DIRS = ['test', 'tests', '__tests__', '__mocks__', 'spec', 'specs', 'e2e', 'testing'];
const isTest = (p: Parts): boolean => {
  // docs/ 下面没有测试：docs/specs/ 放的是规格文档，不是 Ruby 那种 spec/ 测试目录
  if (p.dirs[0] === 'docs') return false;
  if (/\.(test|spec)\.[a-z0-9]+$/.test(p.basename)) return true;
  if (/^test_.+\.py$/.test(p.basename)) return true;
  if (/_test\.go$/.test(p.basename)) return true;
  if (p.basename === 'conftest.py') return true;
  return hasDir(p, TEST_DIRS);
};

/** 构建：构建脚本、CI、以及产物目录（默认已被排除规则挡掉，这里是兜底）。 */
const BUILD_DIRS = ['dist', 'build', 'out', 'target', 'coverage', 'release'];
const BUILD_BASENAMES = new Set([
  'makefile',
  'gnumakefile',
  'cmakelists.txt',
  'dockerfile',
  'justfile',
  'taskfile.yml',
  'taskfile.yaml',
  'build.sh',
  'build.py',
]);
const isBuild = (p: Parts): boolean => {
  if (BUILD_BASENAMES.has(p.basename)) return true;
  if (/\.(mk|cmake)$/.test(p.basename)) return true;
  if (p.dirs[0] === '.github' && p.dirs[1] === 'workflows') return true;
  return hasDir(p, BUILD_DIRS);
};

/** 素材：媒体文件，或 public/static/assets 下的东西。 */
const ASSET_DIRS = ['public', 'static', 'assets', 'media', 'images', 'img', 'fonts'];
const ASSET_KINDS: ReadonlySet<Kind> = new Set<Kind>(['image', 'video', 'audio']);

/** 文档：文档类内容，或 docs/ 下的东西。 */
const DOC_KINDS: ReadonlySet<Kind> = new Set<Kind>(['text', 'office', 'pdf']);
const isDoc = (p: Parts, kind: Kind): boolean => DOC_KINDS.has(kind) || hasDir(p, ['docs', 'doc', 'documentation']);

/** 按优先级判定角色。 */
export function detectRole(relativePath: string, kind: Kind): Role | undefined {
  const parts = split(relativePath);

  if (isReadme(parts)) return 'readme';
  if (isLicense(parts)) return 'license';
  // 素材目录里的东西就是素材，即使文件名像入口（public/app.js）或扩展名像代码
  if (hasDir(parts, ASSET_DIRS)) return 'asset';
  if (isEntry(parts)) return 'entry';
  if (isConfig(parts)) return 'config';
  if (isTest(parts)) return 'test';
  if (isBuild(parts)) return 'build';
  if (isDoc(parts, kind)) return 'doc';
  if (ASSET_KINDS.has(kind)) return 'asset';

  return undefined;
}
