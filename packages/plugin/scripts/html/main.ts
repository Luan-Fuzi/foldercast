#!/usr/bin/env node
/**
 * HTML 视图入口：解读 → 一个自包含的静态页面（ROADMAP M6）。
 *
 * 用法：
 *     node packages/plugin/scripts/html/main.ts <目录> [选项]
 *
 * 选项：
 *     --reading <文件>   显式指定解读（默认 `<目录>/.foldercast/foldercast.json`）
 *     --out <文件>       输出文件（默认 `<工作根>/out/index.html`）
 *     --no-images        不内联图片：页面更小，文件卡片不配图
 *     --limit <n>        依赖图最多画几个节点（默认 60）
 *     --json             以 JSON 输出报告（给工具与 CI 用）
 *
 * 退出码：0 = 生成成功；2 = 参数或环境有误。
 *
 * **只读解读，不写解读**：这一步不产出新事实，只是把 `foldercast.json` 换个形状给人看。
 * 素材清单缺席也能跑 —— 那样只是没有缩略图。
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { FoldercastDocument } from '../contracts/foldercast.ts';
import type { AssetManifest } from '../contracts/assets.ts';
import { collectViewModel } from './collect.ts';
import { embedImages } from './embed.ts';
import { hasSomethingToShow, renderPage } from './render.ts';

const USAGE = `用法：node packages/plugin/scripts/html/main.ts <目录> [选项]

选项：
  --reading <文件>   显式指定解读（默认 <目录>/.foldercast/foldercast.json）
  --out <文件>       输出文件（默认 <工作根>/out/index.html）
  --no-images        不内联图片：页面更小，文件卡片不配图
  --limit <n>        依赖图最多画几个节点（默认 60）
  --json             以 JSON 输出报告

退出码：0 = 生成成功；2 = 参数或环境有误。

前置：该目录已经跑过分析器（存在 .foldercast/foldercast.json）。
素材阶段没跑也能生成，只是没有缩略图与页数。`;

type Options = {
  target?: string;
  reading?: string;
  out?: string;
  images: boolean;
  limit: number;
  json: boolean;
};

function parseArgs(argv: readonly string[]): Options | { error: string } {
  let target: string | undefined;
  let reading: string | undefined;
  let out: string | undefined;
  let images = true;
  let limit = 60;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) continue;
    if (argument === '--help' || argument === '-h') return { error: 'help' };
    if (argument === '--json') {
      json = true;
      continue;
    }
    if (argument === '--no-images') {
      images = false;
      continue;
    }
    if (argument === '--reading' || argument === '--out' || argument === '--limit') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) return { error: `${argument} 后面需要一个值` };
      index += 1;
      if (argument === '--reading') reading = value;
      else if (argument === '--out') out = value;
      else {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed <= 0) return { error: `--limit 需要一个正整数，收到 ${value}` };
        limit = parsed;
      }
      continue;
    }
    if (argument.startsWith('-')) return { error: `未知选项：${argument}` };
    if (target !== undefined) return { error: `只能给一个目录，多出来的是：${argument}` };
    target = argument;
  }

  if (target === undefined && reading === undefined) return { error: '缺少目录参数' };
  if (target !== undefined && reading !== undefined) {
    return { error: '--reading 与目录参数只能给一个' };
  }
  return {
    ...(target === undefined ? {} : { target }),
    ...(reading === undefined ? {} : { reading }),
    ...(out === undefined ? {} : { out }),
    images,
    limit,
    json,
  };
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** 正文开头一小段：够看出这是什么文件，又不至于把页面变成文档阅读器。 */
function firstLines(text: string, limit = 220): string {
  const flat = text
    .replace(/\r/g, '')
    .split('\n')
    .filter((line) => !/^\s*$/.test(line))
    .join(' ')
    .replace(/[|#*`>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit)}…`;
}

export type HtmlReport = {
  ok: boolean;
  target: string;
  readingPath: string;
  outputPath: string;
  bytes: number;
  files: number;
  /** 实际列出卡片的文件数（没有摘要也没有配图的不单独列）。 */
  cards: number;
  imagesInlined: number;
  graphNodes: number;
  graphEdges: number;
  secrets: number;
  notes: string[];
};

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  if ('error' in options) {
    if (options.error === 'help') {
      console.log(USAGE);
      return 0;
    }
    console.error(`${options.error}\n\n${USAGE}`);
    return 2;
  }

  const target = resolve(options.target ?? dirname(dirname(resolve(options.reading as string))));
  const workRoot = resolve(target, '.foldercast');
  const readingPath = options.reading === undefined ? join(workRoot, 'foldercast.json') : resolve(options.reading);
  const outputPath = resolve(options.out ?? join(workRoot, 'out', 'index.html'));
  const assetsPath = join(workRoot, 'assets', 'manifest.json');

  if (!existsSync(readingPath)) {
    console.error(
      `找不到解读：${readingPath}\n先跑分析器：pnpm analyze ${target}`,
    );
    return 2;
  }

  let document: FoldercastDocument;
  try {
    document = readJson<FoldercastDocument>(readingPath);
  } catch (error) {
    console.error(`解读不是合法 JSON：${readingPath}\n${(error as Error).message}`);
    return 2;
  }
  if (document.foldercast !== 1) {
    console.error(`这个解读的格式版本是 ${String(document.foldercast)}，这个版本只认 1。重跑分析器。`);
    return 2;
  }

  const assets = existsSync(assetsPath) ? readJson<AssetManifest>(assetsPath) : undefined;

  // Office / PDF 的正文已经由素材阶段提取到 `assets/text/*.md`：卡片给个开头。
  // 否则这类文件的摘要只有「几页、几个表格」，读者从卡片上看不出它写了什么
  const texts = new Map<string, string>();
  for (const entry of assets?.entries ?? []) {
    const markdown = entry.text?.markdown;
    if (markdown === undefined) continue;
    const path = resolve(workRoot, markdown);
    if (!existsSync(path)) continue;
    const snippet = firstLines(readFileSync(path, 'utf8'));
    if (snippet !== '') texts.set(entry.path, snippet);
  }

  const model = collectViewModel(document, assets, { graphLimit: options.limit, texts });

  const assetPaths = options.images
    ? model.cards.flatMap((card) => (card.asset === undefined ? [] : [card.asset.path]))
    : [];
  const embedded = options.images
    ? await embedImages(assetPaths, { workRoot, outDir: dirname(outputPath) })
    : { images: new Map<string, string>(), notes: [] };

  const html = renderPage(model, {
    images: embedded.images,
    notes: embedded.notes,
    pageGeneratedAt: new Date().toISOString(),
  });

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, html, 'utf8');
  const bytes = statSync(outputPath).size;

  const shownCards = model.cards.filter((card) => hasSomethingToShow(card, embedded.images)).length;
  const report: HtmlReport = {
    ok: true,
    target,
    readingPath,
    outputPath,
    bytes,
    files: model.stats.totalFiles,
    cards: shownCards,
    imagesInlined: [...embedded.images.values()].filter((source) => source.startsWith('data:')).length,
    graphNodes: model.graph.nodes.length,
    graphEdges: model.graph.edges.length,
    secrets: model.secrets.excluded.length,
    notes: embedded.notes,
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }

  const lines = [
    `${model.label}：${String(model.stats.totalFiles)} 个文件 → ${outputPath}`,
    `页面 ${String(Math.round(bytes / 1024))} KB · 图 ${String(model.graph.nodes.length)} 点 ${String(model.graph.edges.length)} 边 · 卡片 ${String(shownCards)}/${String(model.cards.length)} 张 · 内联图片 ${String(report.imagesInlined)} 张`,
  ];
  if (model.secrets.excluded.length > 0) {
    lines.push(`密钥审计：排除 ${String(model.secrets.excluded.length)} 个（只按文件名命中，内容未读）`);
  }
  for (const note of embedded.notes) lines.push(`注意：${note}`);
  if (model.graph.omitted > 0) {
    lines.push(`注意：依赖图只画了连接最多的 ${String(model.graph.nodes.length)} 个文件，另有 ${String(model.graph.omitted)} 个未画。`);
  }
  lines.push('用浏览器打开即可；页面没有 JavaScript，也没有外部资源。');
  console.log(lines.join('\n'));

  return 0;
}

process.exitCode = await main();
