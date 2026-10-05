/**
 * 渲染阶段（M7）：`script.json` + `assets/` → **静音 mp4**。
 *
 * 用法：
 *   pnpm render <目录> [--out <文件>] [--style deck] [--still 3.5] [--frames 1-30]
 *                       [--browser <路径>] [--check] [--json]
 *
 * 这个脚本和别的阶段一样**独立可跑**（ADR 0008）：它不认识 DSH，只认工作根下的文件。
 * 主 agent 在编排时调它，CI 也能直接调它。
 *
 * 四件在别处看不见的事：
 *
 * 1. **讲稿在运行时加载**（`load.ts`），bundle 里没有讲稿 —— 加目录不改代码。
 * 2. **浏览器只在出片时要**（`browser.ts`）：缺了返回结构化引导，退出码 3，不静默下载。
 * 3. **`--check` 不碰浏览器**：算计划、报时长与警告，CI 与 fast feedback 走这条路。
 * 4. **素材走 `file://`**：由 `plan.ts` 拼出来，浏览器不需要文件系统访问。
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleProject } from './bundle.ts';
import { embedImage } from './embed-node.ts';
import { resolveBrowser } from './browser.ts';
import { summarizeDurations } from './estimate.ts';
import { findStylesDir, loadAssets, loadPreset, loadReading, loadScript, LoadError, sourceDirOf, workRootOf } from './load.ts';
import { buildPlan, type Plan } from './plan.ts';
import { renderStillFrame, renderVideo } from './render.ts';

const RENDERER_DIR = dirname(fileURLToPath(import.meta.url));
/**
 * 样式预设目录：仓库根的 `styles/`。**上溯找标记文件**，不按层级硬算 —— 这套代码有两套布局
 * （仓库内 `scripts/renderer/`、发布版 `lib/scripts/renderer/`），数层级在发布版里会算错。
 */
const STYLES_DIR = findStylesDir(RENDERER_DIR);

const USAGE = `把目录的讲稿渲染成静音 mp4。

用法：
  pnpm render <目录> [选项]

选项：
  --out <文件>      输出文件。默认 <目录>/.foldercast/out/video.mp4
  --script <文件>   讲稿路径。默认 <目录>/.foldercast/script.json
  --reading <文件>  解读路径。默认 <目录>/.foldercast/foldercast.json
  --style <名字>    样式预设名（styles/<名字>.json）。默认取讲稿的 style.preset，否则 deck
  --browser <路径>  浏览器可执行文件。也可用 FOLDERCAST_BROWSER 环境变量
  --frames <A-B>    只渲染这一段（1 起，含两端）。调画面用
  --still <秒>      只出一张静帧 PNG，不编码视频
  --concurrency <n> 渲染并发数。**默认 1**：多并发会让同一份讲稿渲出不同的帧
                    （实测三次的帧哈希互不相同），只在不在乎可复现时调大
  --no-embed        不把图片内联成 data URI（调试用；浏览器读不了 file:// 图片）
  --check           只算计划并报时长，不打包、不渲染（不需要浏览器）
  --json            以 JSON 输出结果（给 agent 与 CI 用）
  -h, --help        显示这段说明

退出码：0 成功；2 参数或讲稿有问题；3 需要浏览器但没找到。`;

type Options = {
  target: string;
  out?: string;
  script?: string;
  reading?: string;
  style?: string;
  browser?: string;
  frames?: [number, number];
  still?: number;
  concurrency?: number;
  check: boolean;
  json: boolean;
  /** 关掉图片内联（调试用）。 */
  noEmbed: boolean;
};

function parseArgs(argv: string[]): Options | { error: string } {
  const options: Options = { target: '', check: false, json: false, noEmbed: false };
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) break;
    switch (arg) {
      case '-h':
      case '--help':
        return { error: 'help' };
      case '--check':
        options.check = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--no-embed':
        options.noEmbed = true;
        break;
      case '--out':
      case '--script':
      case '--reading':
      case '--style':
      case '--browser':
      case '--frames':
      case '--still':
      case '--concurrency': {
        const value = argv[i + 1];
        if (value === undefined) return { error: `${arg} 后面缺一个值` };
        i += 1;
        if (arg === '--out') options.out = value;
        else if (arg === '--script') options.script = value;
        else if (arg === '--reading') options.reading = value;
        else if (arg === '--style') options.style = value;
        else if (arg === '--browser') options.browser = value;
        else if (arg === '--frames') {
          const range = parseRange(value);
          if (range === undefined) return { error: `--frames 要写成 A-B（帧号 1 起），收到 ${value}` };
          options.frames = range;
        } else if (arg === '--still') {
          const seconds = Number(value);
          if (!Number.isFinite(seconds) || seconds < 0) return { error: `--still 要一个非负秒数，收到 ${value}` };
          options.still = seconds;
        } else {
          const count = Number(value);
          if (!Number.isInteger(count) || count < 1) return { error: `--concurrency 要一个正整数，收到 ${value}` };
          options.concurrency = count;
        }
        break;
      }
      default:
        if (arg.startsWith('-')) return { error: `不认识的选项：${arg}` };
        rest.push(arg);
        break;
    }
  }

  if (rest.length > 1) return { error: `只接受一个目录，收到 ${rest.length} 个` };
  options.target = rest[0] ?? '';

  if (options.check && (options.still !== undefined || options.frames !== undefined)) {
    return { error: '--check 只算计划，不能和 --still / --frames 一起用' };
  }
  return options;
}

function parseRange(value: string): [number, number] | undefined {
  const match = /^(\d+)-(\d+)$/.exec(value);
  if (match === null) return undefined;
  const from = Number(match[1]);
  const to = Number(match[2]);
  if (from < 1 || to < from) return undefined;
  return [from, to];
}

export type RenderReport = {
  ok: boolean;
  target: string;
  scriptPath: string;
  readingPath: string;
  outputPath?: string;
  stillPath?: string;
  style: string;
  width: number;
  height: number;
  fps: number;
  scenes: number;
  durationInFrames: number;
  durationSec: number;
  /** 预估时长与目标时长的差（讲稿写了 targetDurationSec 时才有意义）。 */
  estimatedSec: number;
  browser: { kind: string; path?: string; name?: string };
  bundleMs?: number;
  renderMs?: number;
  warnings: string[];
  /** 内联进画面的图片字节数（原始文件大小的合计，压缩后通常更小）。 */
  inlineBytes: number;
  /** 内联的图片张数。 */
  inlineImages: number;
  /** `--check` 时给出每个场景的时长，方便写稿阶段对齐字数。 */
  timings?: { id: string; type: string; seconds: number; frames: number }[];
};

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if ('error' in parsed) {
    if (parsed.error === 'help') {
      console.log(USAGE);
      return 0;
    }
    console.error(`${parsed.error}\n\n${USAGE}`);
    return 2;
  }

  const target = resolve(parsed.target === '' ? process.cwd() : parsed.target);
  const workRoot = workRootOf(target);
  const sourceDir = sourceDirOf(workRoot);

  let script;
  let reading;
  try {
    script = loadScript(workRoot, parsed.script);
    reading = loadReading(workRoot, parsed.reading);
  } catch (error) {
    if (error instanceof LoadError) {
      console.error(error.message);
      return 2;
    }
    throw error;
  }

  if (resolve(reading.value.source.root) !== resolve(script.value.source.root)) {
    console.error(
      `讲稿与解读指向的目录不一致：\n  讲稿：${script.value.source.root}\n  解读：${reading.value.source.root}\n先跑校验：pnpm validate ${target}`,
    );
    return 2;
  }

  const presetName = parsed.style ?? script.value.style?.preset ?? reading.value.style?.preset ?? 'deck';
  const preset = loadPreset(STYLES_DIR ?? resolve(RENDERER_DIR, 'styles'), presetName);

  let plan: Plan;
  try {
    plan = buildPlan({
      script: script.value,
      reading: reading.value,
      assets: loadAssets(workRoot),
      preset: preset.value,
      presetName,
      // 图片在这里内联成 data URI：浏览器里读不了 `file://`，见 `embed.ts`。
      workRoot,
      embed: parsed.noEmbed ? undefined : embedImage,
    });
  } catch (error) {
    console.error(`算不出渲染计划：${(error as Error).message}`);
    return 2;
  }

  const warnings = [...(preset.warning === undefined ? [] : [preset.warning]), ...plan.warnings];
  const estimate = summarizeDurations(
    plan.scenes.map((scene) => ({ id: scene.id, type: scene.type, narration: scene.narration })),
    plan.composition.fps,
  );
  const estimatedFrames = estimate.totalFrames;
  const estimatedSec = Math.round(estimate.totalSeconds * 10) / 10;

  const browser = resolveBrowser(parsed.browser);
  const inlined = collectInline(plan);

  const report: RenderReport = {
    ok: true,
    target,
    scriptPath: script.path,
    readingPath: reading.path,
    style: preset.name,
    width: plan.composition.width,
    height: plan.composition.height,
    fps: plan.composition.fps,
    scenes: plan.scenes.length,
    durationInFrames: plan.composition.durationInFrames,
    durationSec: Math.round((plan.composition.durationInFrames / plan.composition.fps) * 10) / 10,
    estimatedSec,
    browser:
      browser.kind === 'found'
        ? { kind: browser.origin, path: browser.path, name: browser.name }
        : { kind: 'missing' },
    warnings,
    inlineBytes: inlined.bytes,
    inlineImages: inlined.images,
  };
  if (parsed.check) {
    report.timings = estimate.scenes.map((scene) => ({
      id: scene.id,
      type: scene.type,
      seconds: Math.round(scene.seconds * 10) / 10,
      frames: scene.frames,
    }));
  }

  if (parsed.check) {
    printReport(report, parsed.json, estimate.totalFrames !== plan.composition.durationInFrames);
    return 0;
  }

  if (browser.kind === 'missing') {
    report.ok = false;
    if (parsed.json) {
      console.log(JSON.stringify({ ...report, guidance: browser.guidance }, null, 2));
    } else {
      console.error(browser.guidance);
    }
    return 3;
  }

  const outputPath = resolve(parsed.out ?? join(workRoot, 'out', parsed.still === undefined ? 'video.mp4' : 'still.png'));
  const bundle = await bundleProject({
    rendererDir: RENDERER_DIR,
    onProgress: (percent) => {
      if (!parsed.json && process.stderr.isTTY) process.stderr.write(`\r打包 ${Math.round(percent)}%   `);
    },
  });
  report.bundleMs = bundle.ms;

  // 输出目录可能还不存在（`--out` 指到别处时尤其常见）。渲染器自己会建，但 CLI 先建一次
  // 更稳：`--check` 之外的分支都要写文件。
  mkdirSync(dirname(outputPath), { recursive: true });

  try {
    if (parsed.still !== undefined) {
      const frame = Math.min(
        plan.composition.durationInFrames - 1,
        Math.max(0, Math.round(parsed.still * plan.composition.fps)),
      );
      await renderStillFrame({
        serveUrl: bundle.serveUrl,
        plan,
        base: sourceDir,
        browserPath: browser.path,
        frame,
        outputPath,
      });
      report.stillPath = outputPath;
      report.renderMs = bundle.ms;
    } else {
      const result = await renderVideo({
        serveUrl: bundle.serveUrl,
        plan,
        base: sourceDir,
        outputPath,
        browserPath: browser.path,
        ...(parsed.frames === undefined ? {} : { frameRange: parsed.frames }),
        ...(parsed.concurrency === undefined ? {} : { concurrency: parsed.concurrency }),
        onProgress: ({ rendered, total }) => {
          if (!parsed.json && process.stderr.isTTY) {
            process.stderr.write(`\r渲染 ${rendered}/${total} 帧   `);
          }
        },
        onLog: (message) => process.stderr.write(`${message}\n`),
      });
      report.outputPath = result.outputPath;
      report.renderMs = result.ms;
    }
  } catch (error) {
    report.ok = false;
    const message = (error as Error).message;
    if (parsed.json) console.log(JSON.stringify({ ...report, error: message }, null, 2));
    else console.error(`渲染失败：${message}`);
    return 2;
  }

  if (!parsed.json && process.stderr.isTTY) process.stderr.write('\r');
  printReport(report, parsed.json, estimatedFrames !== plan.composition.durationInFrames);
  return 0;
}

/** 计划里内联了多少图片。`--check` 报出来，让人知道 props 有多大。 */
function collectInline(plan: Plan): { images: number; bytes: number } {
  const seen = new Set<string>();
  let bytes = 0;
  const visit = (media: { path: string; inlineBytes?: number } | undefined): void => {
    if (media?.inlineBytes === undefined || seen.has(media.path)) return;
    seen.add(media.path);
    bytes += media.inlineBytes;
  };
  for (const scene of plan.scenes) {
    if (scene.type === 'file') visit(scene.media);
    else if (scene.type === 'gallery') for (const item of scene.items) visit(item);
    else if (scene.type === 'document') for (const page of scene.pages) visit(page);
    else if (scene.type === 'clip') {
      visit(scene.poster);
      visit(scene.video);
    }
  }
  return { images: seen.size, bytes };
}

function printReport(report: RenderReport, json: boolean, scaled: boolean): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const lines = [
    `${report.target}`,
    `  讲稿    ${report.scriptPath}`,
    `  规格    ${report.width}×${report.height} @ ${report.fps}fps · ${report.scenes} 个场景`,
    `  时长    ${report.durationSec} 秒（${report.durationInFrames} 帧，预估 ${report.estimatedSec} 秒${scaled ? '，已按 targetDurationSec 缩放' : ''}）`,
    `  样式    ${report.style} · 内联图片 ${report.inlineImages} 张（${Math.round(report.inlineBytes / 1024)} KB）`,
  ];
  if (report.stillPath !== undefined) lines.push(`  静帧    ${report.stillPath}`);
  if (report.outputPath !== undefined) {
    lines.push(`  成片    ${report.outputPath}`);
    lines.push(`  耗时    打包 ${Math.round((report.bundleMs ?? 0) / 100) / 10}s · 渲染 ${Math.round((report.renderMs ?? 0) / 100) / 10}s`);
  }
  if (report.timings !== undefined) {
    lines.push('  分镜');
    for (const timing of report.timings) {
      lines.push(`    ${timing.id.padEnd(20)} ${timing.type.padEnd(10)} ${timing.seconds}s (${timing.frames} 帧)`);
    }
  }
  for (const warning of report.warnings) lines.push(`  提醒    ${warning}`);
  console.log(lines.join('\n'));
}

const exitCode = await main();
process.exitCode = exitCode;

export { buildPlan, workRootOf, sourceDirOf };
export type { Plan };
