/**
 * 素材 prep：讲稿引用的源文件 → 可渲染的画面产物。
 *
 * **按需**：只转换讲稿点名的文件（`collectReferences`），没有全局清单 —— 讲稿就是清单。
 * **增量**：按 `mtime + size` 缓存在 `<工作根>/assets/cache.json`，第二次运行毫秒级命中。
 *
 * 之前有一个独立的素材阶段（先分析整个目录、再全量转换、manifest 登记、回填解读），
 * 收缩时删掉了：agent 自己探目录，引用什么转什么。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolveReference } from '../contracts/paths.ts';
import { join, resolve } from 'node:path';
import { prepKindOf, type Prepared, type PrepKind, type PrepProduct } from '../contracts/prep.ts';
import type { ScriptDocument } from '../contracts/script.ts';
import { extractPoster, makeThumbnail, probeVideo, readImageSize } from './media.ts';
import { collectPages, extractOfficeText, recalculateWorkbook, renderDocumentPages } from './office.ts';

/** 讲稿引用的、需要转换的源文件。 */
export type PrepRef = { source: string; kind: PrepKind };

/** 从讲稿里收集引用。`file` / `source` / `items` 都算；文本代码这类不认识，跳过。 */
export function collectReferences(script: ScriptDocument): PrepRef[] {
  const seen = new Set<string>();
  const refs: PrepRef[] = [];
  const push = (path: string | undefined): void => {
    if (path === undefined || path === '') return;
    const kind = prepKindOf(path);
    if (kind === undefined || seen.has(path)) return;
    seen.add(path);
    refs.push({ source: path, kind });
  };
  for (const scene of script.scenes) {
    push(scene.file);
    push(scene.source);
    for (const item of scene.items ?? []) push(item);
  }
  return refs;
}

/** 源路径 → 产物文件名的稳定映射（同一文件永远同一个名字，缓存才命中得了）。 */
export function slugOf(source: string): string {
  return source
    .split('/')
    .map((segment) => segment.replace(/[^\w.\u4e00-\u9fff-]+/g, '_'))
    .join('__');
}

/** 产物文件名的基底：去掉源扩展名 —— 目标格式由我们定（缩略图 png、封面 jpg），不跟着源走。 */
function slugBaseOf(source: string): string {
  const slug = slugOf(source);
  const dot = slug.lastIndexOf('.');
  return dot === -1 ? slug : slug.slice(0, dot);
}

type CacheEntry = { mtimeMs: number; size: number; prepared: Prepared };
type CacheFile = Record<string, CacheEntry>;

const CACHE_NAME = 'assets/cache.json';

function readCache(workRoot: string): CacheFile {
  try {
    return JSON.parse(readFileSync(join(workRoot, CACHE_NAME), 'utf8')) as CacheFile;
  } catch {
    return {};
  }
}

/** 缓存命中：指纹一致，且记着的产物都还在盘上。 */
function cacheHit(entry: CacheEntry | undefined, workRoot: string): Prepared | undefined {
  if (entry === undefined) return undefined;
  const paths = [entry.prepared.markdown, ...entry.prepared.products.map((product) => product.path)];
  for (const relative of paths) {
    if (relative === undefined) continue;
    if (!existsSync(resolveReference(workRoot, relative))) return undefined;
  }
  return entry.prepared;
}

export type PrepReport = {
  /** 源路径 → 结果（失败的也在里面，带 `error`）。 */
  prepared: Map<string, Prepared>;
  converted: number;
  cached: number;
  elapsedMs: number;
};

/** 转换讲稿引用的全部源文件。失败不抛：记进 `prepared.error`，渲染器报警告、画面落到占位。 */
export async function prepare(
  root: string,
  workRoot: string,
  refs: readonly PrepRef[],
): Promise<PrepReport> {
  const cache = readCache(workRoot);
  const prepared = new Map<string, Prepared>();
  const startedAt = Date.now();
  let converted = 0;
  let cached = 0;

  for (const ref of refs) {
    const absolute = resolveReference(root, ref.source);
    const stats = statSync(absolute, { throwIfNoEntry: false });
    if (stats === undefined) {
      prepared.set(ref.source, { kind: ref.kind, source: ref.source, products: [], error: '源文件不存在' });
      continue;
    }

    const entry = cache[ref.source];
    const reusable =
      entry !== undefined && entry.mtimeMs === stats.mtimeMs && entry.size === stats.size
        ? cacheHit(entry, workRoot)
        : undefined;
    if (reusable !== undefined) {
      prepared.set(ref.source, reusable);
      cached += 1;
      continue;
    }

    const outcome = await convert(ref, absolute, workRoot);
    prepared.set(ref.source, outcome);
    converted += 1;
    cache[ref.source] = { mtimeMs: stats.mtimeMs, size: stats.size, prepared: outcome };
  }

  if (converted > 0) {
    mkdirSync(join(workRoot, 'assets'), { recursive: true });
    writeFileSync(join(workRoot, CACHE_NAME), `${JSON.stringify(cache, null, 2)}\n`);
  }
  return { prepared, converted, cached, elapsedMs: Date.now() - startedAt };
}

/** 产物路径：相对工作根（`assets/…`），与渲染计划里 `Media.path` 同一基准。 */
function productPath(kind: PrepKind, base: string, ext: string): string {
  const dir = kind === 'image' ? 'thumbs' : kind === 'video' ? 'posters' : 'pages';
  return `assets/${dir}/${base}${ext}`;
}

async function convert(ref: PrepRef, absolute: string, workRoot: string): Promise<Prepared> {
  const base = slugBaseOf(ref.source);

  if (ref.kind === 'image') {
    const path = productPath('image', base, '.png');
    const thumb = makeThumbnail(absolute, resolve(workRoot, path));
    if (!thumb.ok) {
      return { kind: ref.kind, source: ref.source, products: [], error: `缩略图转不出来：${thumb.error}` };
    }
    const size = readImageSize(absolute);
    return {
      kind: ref.kind,
      source: ref.source,
      products: [{ role: 'thumb', path, ...(size ?? {}) }],
    };
  }

  if (ref.kind === 'video') {
    const path = productPath('video', base, '.jpg');
    const poster = extractPoster(absolute, resolve(workRoot, path));
    if (!poster.ok) {
      return { kind: ref.kind, source: ref.source, products: [], error: `封面抽不出来：${poster.error}` };
    }
    const info = probeVideo(absolute);
    return {
      kind: ref.kind,
      source: ref.source,
      products: [
        {
          role: 'poster',
          path,
          ...(info?.width === undefined ? {} : { width: info.width }),
          ...(info?.height === undefined ? {} : { height: info.height }),
        },
      ],
    };
  }

  // office / pdf：页图（要 dsoffice）+ 全文 Markdown（officeparser，不依赖 dsoffice）
  const tempDir = join(workRoot, 'tmp', base);
  let analysisSource = absolute;
  if (ref.kind === 'office' && ref.source.toLowerCase().endsWith('.xlsx')) {
    const recalculated = join(tempDir, 'recalculated.xlsx');
    const result = recalculateWorkbook(absolute, recalculated);
    if (result.ok && existsSync(recalculated)) analysisSource = recalculated;
  }

  const products: PrepProduct[] = [];
  let pageError: string | undefined;
  const rendered = renderDocumentPages(analysisSource, join(tempDir, 'pages'));
  if (rendered.ok) {
    const pages = collectPages(rendered.pages, join(tempDir, 'pages'), (page) => {
      const name = productPath('pdf', `${base}_p${String(page)}`, '.png');
      return { absolute: resolve(workRoot, name), relative: name };
    });
    for (const page of pages) {
      products.push({ role: 'page', path: page.path, width: page.width, height: page.height });
    }
  } else {
    pageError = rendered.error;
  }

  let markdown: string | undefined;
  try {
    const extracted = await extractOfficeText(analysisSource);
    if (extracted.markdown.trim() !== '') {
      markdown = `assets/text/${base}.md`;
      mkdirSync(join(workRoot, 'assets', 'text'), { recursive: true });
      writeFileSync(resolve(workRoot, markdown), extracted.markdown);
    }
  } catch {
    // 文本提取失败不是致命的：页图可能已经转出来了
  }

  rmSync(tempDir, { recursive: true, force: true });
  return {
    kind: ref.kind,
    source: ref.source,
    products,
    ...(products.length === 0 ? {} : { pageCount: products.length }),
    ...(markdown === undefined ? {} : { markdown }),
    ...(pageError === undefined || products.length > 0 ? {} : { error: pageError }),
  };
}
