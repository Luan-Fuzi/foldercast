/** 本地版本与产物记录。只核对输入身份，不判断评审的内容是否正确。 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { countSourceFiles, type DigestDocument } from './digest.ts';
import type { ScriptDocument } from './script.ts';
import { realPath, resolveReference, withinPath } from './paths.ts';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

export function hashValue(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temp, path);
}

/** 引用目录的文件名、大小与修改时间。排除本插件产物与依赖，不读文件正文。 */
function directoryIdentity(path: string, sourceRoot: string): unknown[] {
  const entries: unknown[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
      if (['.foldercast', '.git', 'node_modules'].includes(entry.name)) continue;
      const child = join(dir, entry.name);
      resolveReference(sourceRoot, relative(resolve(sourceRoot), child));
      if (entry.isDirectory()) walk(child);
      else {
        const stats = statSync(child);
        entries.push([relative(path, child).replaceAll('\\', '/'), stats.size, stats.mtimeMs]);
      }
    }
  };
  walk(path);
  return entries;
}

function referencedPaths(script: ScriptDocument, digest?: DigestDocument): Set<string> {
  const paths = new Set<string>();
  for (const scene of script.scenes) {
    if (scene.file !== undefined) paths.add(scene.file);
    if (scene.source !== undefined) paths.add(scene.source);
    for (const item of scene.items ?? []) paths.add(item);
    for (const entry of scene.entries ?? []) paths.add(entry.path);
  }
  for (const excerpt of digest?.excerpts ?? []) paths.add(excerpt.file);
  for (const module of digest?.modules ?? []) {
    paths.add(module.path);
    for (const file of module.keyFiles ?? []) paths.add(file);
  }
  return paths;
}

export type Revision = { revision: string; scriptHash: string; digestHash?: string };

/** 绑定讲稿、在场的 digest、引用证据/素材，以及 digest 的文件总数抽查口径。 */
export function captureRevision(target: string, scriptPath = join(target, '.foldercast', 'script.json')): Revision {
  const script = readJson<ScriptDocument>(scriptPath);
  if (script === undefined) throw new Error(`还没有讲稿：${scriptPath}。先写稿再校验。`);
  const digest = readJson<DigestDocument>(join(target, '.foldercast', 'digest.json'));
  const paths = referencedPaths(script, digest);
  const sources = [...paths].sort().map((path) => {
    const absolute = resolveReference(target, path);
    const stats = statSync(absolute, { throwIfNoEntry: false });
    return [path, stats === undefined ? 'missing' : stats.isDirectory()
      ? hashValue(directoryIdentity(absolute, realPath(target))) : hashFile(absolute)];
  });
  const scriptHash = hashValue(script);
  const digestHash = digest === undefined ? undefined : hashValue(digest);
  return {
    scriptHash,
    ...(digestHash === undefined ? {} : { digestHash }),
    revision: hashValue({ scriptHash, digestHash, sources, totalFiles: digest === undefined ? undefined : countSourceFiles(target) }),
  };
}

type ReviewReceipt = { review: 1; revision: string; verdict: 'passed'; reportHash: string; generatedAt: string };

/** 调用方声明已通过独立评审；回执记录这项声明与报告版本，不从 Markdown 猜结论。 */
export function acceptReview(target: string, revision: string): void {
  const current = captureRevision(target);
  if (current.revision !== revision) throw new Error('评审版本已过期。重新校验与评审当前输入，再传 reviewRevision。');
  const reportPath = join(target, '.foldercast', 'review.md');
  if (!existsSync(reportPath) || readFileSync(reportPath, 'utf8').trim() === '') {
    throw new Error('缺少评审报告 review.md。先完成独立评审并写入通过的结论。');
  }
  const receipt: ReviewReceipt = { review: 1, revision, verdict: 'passed', reportHash: hashFile(reportPath), generatedAt: new Date().toISOString() };
  writeJson(join(target, '.foldercast', 'review.json'), receipt);
}

export function requireReview(target: string, revision: string): void {
  let receipt: ReviewReceipt | undefined;
  try { receipt = readJson<ReviewReceipt>(join(target, '.foldercast', 'review.json')); } catch { /* 损坏的回执不能放行。 */ }
  const report = join(target, '.foldercast', 'review.md');
  if (receipt?.review !== 1 || receipt.verdict !== 'passed' || receipt.revision !== revision ||
      !existsSync(report) || hashFile(report) !== receipt.reportHash) {
    throw new Error('当前版本没有有效的评审回执。完成独立评审后传 reviewRevision；工作草稿可传 draft: true（CLI 默认草稿）。');
  }
}

export type OutputContext = {
  target: string;
  scriptPath: string;
  revision: string;
  mode: 'draft' | 'approved';
  options: Record<string, unknown>;
  dependencies: { path: string; hash: string }[];
};

export function beginOutput(target: string, options: {
  scriptPath?: string; expectedScript?: ScriptDocument; outputPaths?: string[]; approved?: boolean; settings?: Record<string, unknown>; dependencies?: string[];
} = {}): OutputContext {
  const scriptPath = resolve(options.scriptPath ?? join(target, '.foldercast', 'script.json'));
  const script = readJson<ScriptDocument>(scriptPath);
  const digest = readJson<DigestDocument>(join(target, '.foldercast', 'digest.json'));
  for (const output of options.outputPaths ?? []) {
    const within = (parent: string): boolean => {
      return withinPath(realPath(parent), realPath(output));
    };
    const touchesSource = script !== undefined && [...referencedPaths(script, digest)].some((path) => {
      const absolute = resolveReference(target, path);
      const excluded = relative(absolute, realPath(output)).split(/[\\/]/).some((part) => ['.foldercast', '.git', 'node_modules'].includes(part));
      return realPath(output) === absolute || (statSync(absolute, { throwIfNoEntry: false })?.isDirectory() && within(absolute) && !excluded);
    });
    if (realPath(output) === realPath(scriptPath) || touchesSource ||
        (digest !== undefined && within(target) && !within(join(target, '.foldercast')))) {
      throw new Error('输出路径覆盖引用证据或改变源目录清单。请放在 .foldercast/out 中或源目录之外。');
    }
  }
  const { revision, scriptHash } = captureRevision(target, scriptPath);
  if (options.expectedScript !== undefined && hashValue(options.expectedScript) !== scriptHash) {
    throw new Error('校验期间讲稿发生变化。请重新校验当前讲稿。');
  }
  if (options.approved === true) requireReview(target, revision);
  return {
    target, scriptPath, revision, mode: options.approved === true ? 'approved' : 'draft',
    options: options.settings ?? {},
    dependencies: (options.dependencies ?? []).map((path) => ({ path: resolve(path), hash: hashFile(path) })),
  };
}

type Artifact = {
  scriptPath: string;
  revision: string; mode: OutputContext['mode']; inputHash: string;
  options: Record<string, unknown>; dependencies: OutputContext['dependencies'];
  outputs: { path: string; hash: string }[]; generatedAt: string;
};
type Artifacts = { artifacts: 1; entries: Record<string, Artifact> };

/** 仅在输入与评审仍匹配、输出已成功写出时记录；失败不把旧产物标为当前。 */
export function finishOutput(context: OutputContext, kind: string, paths: string[]): void {
  if (captureRevision(context.target, context.scriptPath).revision !== context.revision ||
      context.dependencies.some(({ path, hash }) => !existsSync(path) || hashFile(path) !== hash)) {
    throw new Error('生成期间输入发生变化，结果未登记为当前产物。请用新版本重新生成。');
  }
  if (context.mode === 'approved') requireReview(context.target, context.revision);
  const workRoot = join(context.target, '.foldercast');
  const recordPath = join(workRoot, 'artifacts.json');
  let record: Artifacts | undefined;
  try { record = readJson<Artifacts>(recordPath); } catch { /* 可重算的记录损坏时重建。 */ }
  if (record?.artifacts !== 1) record = { artifacts: 1, entries: {} };
  record.entries[kind] = {
    scriptPath: relative(workRoot, context.scriptPath).replaceAll('\\', '/'),
    revision: context.revision, mode: context.mode,
    inputHash: hashValue({ revision: context.revision, options: context.options, dependencies: context.dependencies }),
    options: context.options, dependencies: context.dependencies,
    outputs: paths.map((path) => ({ path: relative(workRoot, resolve(path)).replaceAll('\\', '/'), hash: hashFile(path) })),
    generatedAt: new Date().toISOString(),
  };
  writeJson(recordPath, record);
}

export type ArtifactState = { kind: string; state: 'current' | 'stale' | 'missing'; mode: 'draft' | 'approved' };

/** current 表示按记录中的参数生成且输入/输出未变；不表示适合新的设置或内容正确。 */
export function artifactStates(target: string): ArtifactState[] {
  let record: Artifacts | undefined;
  try { record = readJson<Artifacts>(join(target, '.foldercast', 'artifacts.json')); } catch { return []; }
  if (record?.artifacts !== 1) return [];
  return Object.entries(record.entries).map(([kind, entry]) => {
    let current: string | undefined;
    try { current = captureRevision(target, resolve(target, '.foldercast', entry.scriptPath)).revision; } catch { /* 旧输入缺失或损坏时仅标记该产物过期。 */ }
    const outputs = entry.outputs.map(({ path, hash }) => ({ path: resolve(target, '.foldercast', path), hash }));
    let state: ArtifactState['state'] = 'current';
    if (outputs.some(({ path }) => !existsSync(path))) state = 'missing';
    else if (entry.revision !== current || outputs.some(({ path, hash }) => hashFile(path) !== hash) ||
      entry.dependencies.some(({ path, hash }) => !existsSync(path) || hashFile(path) !== hash)) state = 'stale';
    if (state === 'current' && entry.mode === 'approved') {
      try { requireReview(target, current!); } catch { state = 'stale'; }
    }
    return { kind, state, mode: entry.mode };
  });
}
