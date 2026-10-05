/**
 * 契约校验的编排：载入解读与讲稿 → schema → 内部自洽 → 跨文件引用。
 *
 * 三层顺序是有意的：**前一层的 blocker 会让后一层失去意义**。JSON 坏了就谈不上 schema；
 * 解读的统计对不上时，拿它去核对讲稿的路径会引出一串假问题。所以每层都看前一层的结论，
 * 不继续往下堆。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AssetManifest } from '../contracts/assets.ts';
import type { FoldercastDocument } from '../contracts/foldercast.ts';
import type { ScriptDocument } from '../contracts/script.ts';
import { checkReading } from './check-reading.ts';
import { checkScript } from './check-script.ts';
import { createValidator, validateAgainstSchema } from './ajv.ts';
import { createLocator } from './locate.ts';
import { IssueCollector, type Issue, type SeverityCounts } from './issue.ts';
import { loadAssetsSchema, loadSchemas } from './schema.ts';

export type ValidateOptions = {
  /** 被讲解的目录。`readingPath` 不给时，解读取 `<目录>/.foldercast/foldercast.json`。 */
  target: string;
  /** 显式指定解读文件，这时 `target` 只用来推导工作根。 */
  readingPath?: string;
  /** 讲稿路径；不给则取 `<工作根>/script.json`。 */
  scriptPath?: string;
  /** 显式指定工作根，默认 `<源目录>/.foldercast`。 */
  workRoot?: string;
  /** 素材清单，默认从工作根里读。 */
  assets?: AssetManifest;
  /** schema 所在目录，默认从仓库布局找。 */
  specsDir?: string;
  /** 覆盖报告里的时间戳，测试用。 */
  now?: Date;
};

export type CheckedFile = {
  /** 文件路径（报告里显示的写法）。 */
  path: string;
  pointer: string;
  severity: 'blocker' | 'warning';
  code: string;
  message: string;
  fix?: string;
  sceneId?: string;
  field?: string;
  line?: number;
  column?: number;
};

export type ValidateReport = {
  root: string;
  workRoot: string;
  /** 实际检查了哪些文件，以及它们各自的问题数。没找到的文件不在里面。 */
  checked: { reading?: string; script?: string; assets?: string };
  issues: CheckedFile[];
  counts: SeverityCounts;
  /** blocker 为 0 即通过；warning 不判定失败。 */
  ok: boolean;
  /** 素材清单的 schema 校验是否跑了（没有清单或没有 schema 时为 false）。 */
  assetsValidated: boolean;
  /** 这次校验的时间。 */
  validatedAt: string;
};

/** 读一个 JSON 文件；不存在返回 undefined，坏 JSON 返回错误说明。 */
function readJsonFile(path: string): { value?: unknown; text: string; error?: string } | undefined {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }

  try {
    return { value: JSON.parse(text) as unknown, text };
  } catch (error) {
    return { text, error: (error as Error).message };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 本地时区的 ISO 8601，带偏移量（与解读的 `generatedAt` 同一写法）。 */
function localIsoString(date: Date): string {
  const pad = (value: number): string => String(Math.abs(value)).padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const offset = `${sign}${pad(Math.trunc(Math.abs(offsetMinutes) / 60))}:${pad(Math.abs(offsetMinutes) % 60)}`;
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${offset}`
  );
}

/** 把内部的 Issue 转成报告里的一行。 */
function toCheckedFile(issue: Issue): CheckedFile {
  return {
    path: issue.path,
    pointer: issue.pointer,
    severity: issue.severity,
    code: issue.code,
    message: issue.message,
    ...(issue.fix === undefined ? {} : { fix: issue.fix }),
    ...(issue.sceneId === undefined ? {} : { sceneId: issue.sceneId }),
    ...(issue.field === undefined ? {} : { field: issue.field }),
    ...(issue.at === undefined ? {} : { line: issue.at.line, column: issue.at.column }),
  };
}

export function validateContracts(options: ValidateOptions): ValidateReport {
  const schemas = loadSchemas(options.specsDir);
  const readingValidator = createValidator(schemas.reading);
  const scriptValidator = createValidator(schemas.script);

  // 解读的位置：显式给了就用它，否则取 `<源目录>/.foldercast/foldercast.json`。
  // 工作根默认是解读所在目录 —— 所有产物都在那里（SPEC-data-format.md「工作目录」）。
  // 只有显式给了 workRoot 时才允许两者分家（测试与打包后的布局）。
  const root = resolve(options.target);
  const readingPath =
    options.readingPath === undefined ? resolve(root, '.foldercast/foldercast.json') : resolve(options.readingPath);
  const workRoot = options.workRoot === undefined ? resolve(readingPath, '..') : resolve(options.workRoot);

  const scriptPath = options.scriptPath === undefined ? resolve(workRoot, 'script.json') : resolve(options.scriptPath);
  const collect = new IssueCollector();
  const checked: ValidateReport['checked'] = {};

  const readingFile = readJsonFile(readingPath);
  let reading: FoldercastDocument | undefined;
  let readingIssues: IssueCollector | undefined;

  if (readingFile === undefined) {
    collect.add({
      path: readingPath,
      pointer: '/',
      severity: 'blocker',
      code: 'missing-file',
      message: `解读文件不存在：${readingPath}`,
      fix: `先跑分析器：pnpm analyze ${root}`,
    });
    checked.reading = readingPath;
  } else {
    checked.reading = readingPath;
    const locator = createLocator(readingFile.text);

    if (readingFile.error !== undefined) {
      const at = locator.at('/');
      collect.add({
        path: readingPath,
        pointer: '/',
        severity: 'blocker',
        code: 'json-invalid',
        message: `解读不是合法 JSON：${readingFile.error}`,
        fix: '重新跑分析器生成；手改过的文件要先用 pnpm run check:json 查语法。',
        ...(at === undefined ? {} : { at }),
      });
    } else if (!isRecord(readingFile.value)) {
      collect.add({
        path: readingPath,
        pointer: '/',
        severity: 'blocker',
        code: 'schema',
        message: '解读的顶层不是对象。',
        fix: '重新跑分析器生成。',
      });
    } else {
      const candidate = readingFile.value as unknown as FoldercastDocument;
      readingIssues = checkReading({
        document: candidate,
        path: readingPath,
        text: readingFile.text,
        validateSchema: readingValidator,
      });
      for (const issue of readingIssues.all()) collect.add(issue);
      // 解读统计对不上时，拿它核对讲稿的路径会引出一串假问题，所以只在解读可信时才核对
      if (readingIssues.counts().blocker === 0) reading = candidate;
    }
  }

  // 素材清单：没有它也能校验，只是查不了素材产物是否存在
  let assets = options.assets;
  const assetPath = resolve(workRoot, 'assets/manifest.json');
  if (assets === undefined) {
    const assetFile = readJsonFile(assetPath);
    if (assetFile !== undefined && assetFile.error === undefined && isRecord(assetFile.value)) {
      assets = assetFile.value as unknown as AssetManifest;
      checked.assets = assetPath;
    }
  } else {
    checked.assets = assetPath;
  }

  // 素材清单的形状本身也要校验（契约第三份的 schema 是 M4 补的）
  let assetsValidated = false;
  if (assets !== undefined && checked.assets !== undefined) {
    const assetsSchema = loadAssetsSchema(options.specsDir);
    if (assetsSchema !== undefined) {
      const assetFile = readJsonFile(checked.assets);
      if (assetFile !== undefined) {
        for (const issue of validateAgainstSchema(
          createValidator(assetsSchema),
          assets,
          checked.assets,
          createLocator(assetFile.text),
        )) {
          collect.add(issue);
        }
        assetsValidated = true;
      }
    }
  }

  const scriptFile = readJsonFile(scriptPath);
  if (scriptFile === undefined) {
    collect.add({
      path: scriptPath,
      pointer: '/',
      severity: 'warning',
      code: 'missing-file',
      message: `还没有讲稿：${scriptPath}`,
      fix: '写稿阶段（M5）会产出它；先跑此命令可确认解读本身是否可用。',
    });
  } else {
    checked.script = scriptPath;
    const locator = createLocator(scriptFile.text);

    if (scriptFile.error !== undefined) {
      collect.add({
        path: scriptPath,
        pointer: '/',
        severity: 'blocker',
        code: 'json-invalid',
        message: `讲稿不是合法 JSON：${scriptFile.error}`,
        fix: '按 docs/specs/script.schema.json 修正；解析失败时无法指出字段位置。',
      });
    } else if (!isRecord(scriptFile.value)) {
      collect.add({
        path: scriptPath,
        pointer: '/',
        severity: 'blocker',
        code: 'schema',
        message: '讲稿的顶层不是对象。',
        fix: '按 docs/specs/script.schema.json 修正。',
      });
    } else if (reading === undefined) {
      collect.add({
        path: scriptPath,
        pointer: '/',
        severity: 'warning',
        code: 'missing-file',
        message: '解读不可用，跳过了讲稿的引用核对（只跑了 schema 校验）。',
        fix: '先修好解读，再校验讲稿；幻觉路径拦截依赖解读的 manifest。',
      });
    } else {
      const found = checkScript({
        document: scriptFile.value as unknown as ScriptDocument,
        path: scriptPath,
        text: scriptFile.text,
        validateSchema: scriptValidator,
        reading,
        ...(assets === undefined ? {} : { assets }),
        workRoot,
      });
      for (const issue of found.all()) collect.add(issue);
    }
  }

  const counts = collect.counts();
  return {
    root,
    workRoot,
    checked,
    issues: collect.sorted().map(toCheckedFile),
    counts,
    ok: counts.blocker === 0,
    assetsValidated,
    validatedAt: localIsoString(options.now ?? new Date()),
  };
}
