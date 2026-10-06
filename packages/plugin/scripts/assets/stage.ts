/**
 * 素材阶段的编排：解读 → `assets/`。
 *
 * 与 CLI（`main.ts`）分开，是为了让测试能直接调用 —— CLI 在 import 时就会跑起来，
 * 没法在测试里复用。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  ASSET_MANIFEST_VERSION,
  type AssetEntry,
  type AssetManifest,
  type AssetProduct,
} from '../contracts/assets.ts';
import type { FoldercastDocument, Kind, ManifestEntry } from '../contracts/foldercast.ts';
import { applyAssetsToReading, type EnrichReport } from './enrich.ts';
import {
  assetManifestPathFor,
  hashFile,
  isReusable,
  loadAssetManifest,
  readingPathFor,
  statSource,
  workRootFor,
  writeAssetManifest,
} from './manifest.ts';
import { FRAME_RATIOS, extractFrames, extractPoster, makeThumbnail, probeVideo, readImageSize } from './media.ts';
import { collectPages, extractOfficeText, recalculateWorkbook, renderDocumentPages } from './office.ts';
import { uniqueSlug } from './slug.ts';

/** 本阶段会产出素材的类型。文本/数据/音频等不需要素材（SPEC-data-format.md 三）。 */
export const HANDLED_KINDS: ReadonlySet<Kind> = new Set<Kind>(['image', 'video', 'office', 'pdf']);

/** 代码高亮图最多读这么多字节，避免把超大文件读进内存。 */

export type StageOptions = {
  /** 被讲解目录（绝对路径）。 */
  root: string;
  /** 本次最多处理多少个文件（不含命中缓存的）。 */
  limit?: number;
  /** 只处理这些类型。 */
  only?: ReadonlySet<Kind>;
  /** 忽略缓存，全部重算。 */
  force?: boolean;
  /** 只报告会做什么，不写任何文件。 */
  dryRun?: boolean;
};

export type StageFailure = { path: string; error: string };

export type StageReport = {
  /** 计划处理的总数（含命中缓存）。 */
  planned: number;
  processed: number;
  cached: number;
  failed: number;
  products: number;
  /** 本次实际处理的文件按类型计数。 */
  byKind: Map<Kind, number>;
  failures: StageFailure[];
  enrich: EnrichReport;
  elapsedMs: number;
  dryRun: boolean;
  workRoot: string;
  /** 超时或上限导致本次没轮到、下次继续的文件数。 */
  deferred: number;
};

type ProcessContext = {
  root: string;
  workRoot: string;
  slug: string;
  entry: ManifestEntry;
};

type ProcessOutcome =
  | { ok: true; products: AssetProduct[]; text?: AssetEntry['text']; meta?: AssetEntry['meta'] }
  | { ok: false; error: string };

/** 产物都写在 `<工作根>/assets/` 下；清单里记的是**相对工作根**的路径，所以带 assets/ 前缀。 */
function assetFile(workRoot: string, relative: string): { absolute: string; relative: string } {
  return { absolute: join(workRoot, 'assets', relative), relative: `assets/${relative}` };
}

async function processEntry(context: ProcessContext): Promise<ProcessOutcome> {
  const { root, workRoot, slug, entry } = context;
  const absolute = join(root, entry.path);
  const products: AssetProduct[] = [];

  switch (entry.kind) {
    case 'image': {
      const target = assetFile(workRoot, `thumbs/${slug}.png`);
      const thumb = makeThumbnail(absolute, target.absolute);
      if (!thumb.ok) return { ok: false, error: thumb.error };
      const size = readImageSize(absolute);
      products.push({ role: 'thumb', path: target.relative, ...(size ?? {}) });
      return { ok: true, products, ...(size === undefined ? {} : { meta: size }) };
    }

    case 'video': {
      const info = probeVideo(absolute);
      const poster = assetFile(workRoot, `posters/${slug}.jpg`);
      const posterResult = extractPoster(absolute, poster.absolute);
      if (!posterResult.ok) return { ok: false, error: posterResult.error };
      products.push({
        role: 'poster',
        path: poster.relative,
        ...(info?.width === undefined ? {} : { width: info.width }),
        ...(info?.height === undefined ? {} : { height: info.height }),
      });

      const frameFiles = FRAME_RATIOS.map((_, index) => assetFile(workRoot, `frames/${slug}_f${index + 1}.jpg`));
      const frames = extractFrames(absolute, frameFiles.map((file) => file.absolute), info?.durationSec);
      if (!frames.ok) return { ok: false, error: frames.error };
      for (const file of frameFiles) products.push({ role: 'frame', path: file.relative });

      return { ok: true, products, ...(info === undefined ? {} : { meta: info }) };
    }

    case 'office':
    case 'pdf': {
      const tempDir = join(workRoot, 'tmp', slug);

      // xlsx 先重算公式，再拿重算结果去转图与提取：画面与文本必须一致，
      // 而且原始文件里公式可能连缓存值都没有（实测 SUM 就没缓存）。
      let analysisSource = absolute;
      if (entry.kind === 'office' && entry.path.toLowerCase().endsWith('.xlsx')) {
        const recalculated = join(tempDir, 'recalculated.xlsx');
        const result = recalculateWorkbook(absolute, recalculated);
        if (result.ok && existsSync(recalculated)) analysisSource = recalculated;
      }

      const rendered = renderDocumentPages(analysisSource, join(tempDir, 'pages'));
      if (!rendered.ok) {
        rmSync(tempDir, { recursive: true, force: true });
        return { ok: false, error: rendered.error };
      }

      const pageProducts = collectPages(rendered.pages, join(tempDir, 'pages'), (page) =>
        assetFile(workRoot, `pages/${slug}_p${page}.png`),
      );
      for (const page of pageProducts) {
        products.push({ role: page.role, path: page.path, width: page.width, height: page.height });
      }

      const extracted = await extractOfficeText(analysisSource);
      const text: AssetEntry['text'] = {
        outline: extracted.outline,
        sheetNames: extracted.sheetNames,
        slideTitles: extracted.slideTitles,
        tableCount: extracted.tableCount,
      };

      if (extracted.markdown.trim() !== '') {
        const markdown = assetFile(workRoot, `text/${slug}.md`);
        mkdirSync(dirname(markdown.absolute), { recursive: true });
        writeFileSync(markdown.absolute, extracted.markdown);
        text.markdown = markdown.relative;
      }

      rmSync(tempDir, { recursive: true, force: true });
      return { ok: true, products, text, meta: { pageCount: rendered.pageCount } };
    }

    default:
      return { ok: false, error: `不处理这种类型：${entry.kind}` };
  }
}

/** 跑一次素材阶段。 */
export async function runAssetsStage(options: StageOptions): Promise<StageReport> {
  const root = options.root;
  const workRoot = workRootFor(root);
  const readingPath = readingPathFor(workRoot);
  const dryRun = options.dryRun ?? false;
  const force = options.force ?? false;

  if (!existsSync(readingPath)) {
    throw new Error(
      `没找到解读文件：${readingPath}\n先跑分析器：node packages/plugin/scripts/analyzer/main.ts ${root}`,
    );
  }

  const reading = JSON.parse(readFileSync(readingPath, 'utf8')) as FoldercastDocument;
  const previous = loadAssetManifest(workRoot);
  const previousByPath = new Map((previous?.entries ?? []).map((entry) => [entry.path, entry]));

  // 密钥文件永不读内容（ADR 0007）：素材阶段同样不碰
  const secretPaths = new Set(reading.stats.secrets.excluded.map((hit) => hit.path));
  for (const rescanned of reading.stats.secrets.rescanned) secretPaths.delete(rescanned);

  // slug 一次性分配完（含命中缓存的），保证路径在不同运行之间稳定
  const taken = new Set<string>();
  const plan = reading.manifest
    .filter((entry) => HANDLED_KINDS.has(entry.kind) && !secretPaths.has(entry.path))
    .filter((entry) => options.only === undefined || options.only.has(entry.kind))
    .map((entry) => ({ entry, slug: uniqueSlug(entry.path, taken) }));

  const byKind = new Map<Kind, number>();
  const failures: StageFailure[] = [];
  const entries: AssetEntry[] = [];
  const startedAt = Date.now();

  let processed = 0;
  let cached = 0;
  let failed = 0;
  let products = 0;
  let deferred = 0;

  for (const { entry, slug } of plan) {
    const absolute = join(root, entry.path);
    const source = statSource(absolute);
    if (source === undefined) {
      failed += 1;
      failures.push({ path: entry.path, error: '源文件读不到了（可能刚被删除）' });
      continue;
    }

    const cachedEntry = previousByPath.get(entry.path);
    if (isReusable(cachedEntry, source, workRoot, force)) {
      entries.push(cachedEntry as AssetEntry);
      cached += 1;
      products += (cachedEntry as AssetEntry).products.length;
      continue;
    }

    // 超出本次上限：保留上次结果（如果有），剩下的下次再处理
    if (options.limit !== undefined && processed >= options.limit) {
      deferred += 1;
      if (cachedEntry !== undefined) entries.push(cachedEntry);
      continue;
    }
    processed += 1;

    // --dry-run 只数一遍要做的事，**不碰文件**：产物也不写
    if (dryRun) {
      byKind.set(entry.kind, (byKind.get(entry.kind) ?? 0) + 1);
      continue;
    }

    try {
      const outcome = await processEntry({ root, workRoot, slug, entry });
      if (!outcome.ok) {
        failed += 1;
        failures.push({ path: entry.path, error: outcome.error });
        if (!dryRun) {
          entries.push({
            path: entry.path,
            kind: entry.kind,
            mtimeMs: source.mtimeMs,
            size: source.size,
            hash: await hashFile(absolute),
            products: [],
            error: outcome.error,
          });
        }
        continue;
      }

      products += outcome.products.length;
      byKind.set(entry.kind, (byKind.get(entry.kind) ?? 0) + 1);

      if (!dryRun) {
        entries.push({
          path: entry.path,
          kind: entry.kind,
          mtimeMs: source.mtimeMs,
          size: source.size,
          hash: await hashFile(absolute),
          products: outcome.products,
          ...(outcome.text === undefined ? {} : { text: outcome.text }),
          ...(outcome.meta === undefined ? {} : { meta: outcome.meta }),
        });
      }
    } catch (error) {
      failed += 1;
      failures.push({ path: entry.path, error: (error as Error).message });
    }
  }

  const elapsedMs = Date.now() - startedAt;
  let enrich: EnrichReport = { assetsSet: 0, previewsSet: 0 };

  if (!dryRun) {
    // 临时目录只服务于单次转换，收尾必须清干净（里面还留着 dsoffice 自己的清单）
    rmSync(join(workRoot, 'tmp'), { recursive: true, force: true });

    const manifest: AssetManifest = {
      assets: ASSET_MANIFEST_VERSION,
      generatedAt: reading.generatedAt,
      source: { root },
      entries: entries.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)),
    };
    writeAssetManifest(workRoot, manifest);

    const before = JSON.stringify(reading.manifest);
    enrich = applyAssetsToReading(reading, manifest, (relativePath) => {
      try {
        return readFileSync(join(workRoot, relativePath), 'utf8');
      } catch {
        return '';
      }
    });
    if (JSON.stringify(reading.manifest) !== before) {
      writeFileSync(readingPath, `${JSON.stringify(reading, null, 2)}\n`);
    }
  } else {
    enrich = applyAssetsToReading(
      reading,
      { assets: ASSET_MANIFEST_VERSION, generatedAt: reading.generatedAt, source: { root }, entries: previous?.entries ?? [] },
      () => '',
    );
  }

  return {
    planned: plan.length,
    processed,
    cached,
    failed,
    products,
    byKind,
    failures,
    enrich,
    elapsedMs,
    dryRun,
    workRoot,
    deferred,
  };
}
