/**
 * 渲染入口：`script.json` →（按需转换引用的素材）→ mp4。
 *
 * 用法：
 *   pnpm render <目录> [--out <文件>] [--still 3.5] [--frames 1-30]
 *                       [--browser <路径>] [--check] [--json]
 *
 * 这个脚本**独立可跑**：它不认识 DSH，只认工作根下的文件。主 agent 在编排时调它，
 * CI 也能直接调它。
 *
 * 校验（原 validate 阶段）并在这里：加载讲稿后先跑 `checkScript`，有 blocker 就退出 2，
 * 不进入渲染。`--check` 到校验与计划为止，不打包、不渲染、不需要浏览器。
 *
 * 素材是**按需**的：讲稿引用什么就转换什么（缩略图 / 封面 / 逐页图），按 mtime 缓存。
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleProject } from './bundle.ts';
import { checkScript, type CheckReport } from './check.ts';
import { embedImage } from './embed-node.ts';
import { resolveBrowser } from './browser.ts';
import { summarizeDurations } from './estimate.ts';
import { loadDurations, loadScript, LoadError, sourceDirOf, workRootOf } from './load.ts';
import { buildPlan, type Plan } from './plan.ts';
import { renderStillFrame, renderVideo } from './render.ts';
import { collectReferences, prepare, type PrepReport } from '../assets/prep.ts';

const RENDERER_DIR = dirname(fileURLToPath(import.meta.url));

const USAGE = `把目录的讲稿渲染成 mp4（默认静音；配音产物存在时自动带上旁白）。

用法：
  pnpm render <目录> [选项]

选项：
  --out <文件>      输出文件。默认 <目录>/.foldercast/out/video.mp4
  --script <文件>   讲稿路径。默认 <目录>/.foldercast/script.json
  --browser <路径>  浏览器可执行文件。也可用 FOLDERCAST_BROWSER 环境变量
  --frames <A-B>    只渲染这一段（1 起，含两端）。调画面用
  --still <秒>      只出一张静帧 PNG，不编码视频
  --concurrency <n> 渲染并发数。**默认 1**：多并发会让同一份讲稿渲出不同的帧
                    （实测三次的帧哈希互不相同），只在不在乎可复现时调大
  --no-embed        不把图片内联成 data URI（调试用；浏览器读不了 file:// 图片）
  --audio <文件>    旁白音轨（配音产物）。不给就用 durations.json 记的那条
  --durations <文件> 配音时长表。默认 <工作根>/durations.json（有就用实测时长）
  --check           校验讲稿并算计划报时长，不打包、不渲染（不需要浏览器）
  --json            以 JSON 输出结果（给 agent 与 CI 用）
  -h, --help        显示这段说明

退出码：0 成功；2 讲稿有 blocker 或参数有问题；3 需要浏览器但没找到。`;

type Options = {
  target: string;
  out?: string;
  script?: string;
  browser?: string;
  frames?: [number, number];
  still?: number;
  concurrency?: number;
  check: boolean;
  json: boolean;
  noEmbed: boolean;
  audio?: string;
  durations?: string;
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
      case '--browser':
      case '--frames':
      case '--still':
      case '--concurrency': {
        const value = argv[i + 1];
        if (value === undefined) return { error: `${arg} 后面缺一个值` };
        i += 1;
        if (arg === '--out') options.out = value;
        else if (arg === '--script') options.script = value;
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
  outputPath?: string;
  stillPath?: string;
  width: number;
  height: number;
  fps: number;
  scenes: number;
  durationInFrames: number;
  durationSec: number;
  /** 按字数预估的时长（有 targetDurationSec 时才有比较意义）。 */
  estimatedSec: number;
  browser: { kind: string; path?: string; name?: string };
  bundleMs?: number;
  renderMs?: number;
  warnings: string[];
  /** 讲稿校验的摘要；有 blocker 时 `ok` 为 false 且不渲染。 */
  check?: CheckReport;
  /** 按需素材转换：新转了几个、缓存命中几个。 */
  prep?: { converted: number; cached: number; ms: number };
  /** 内联进画面的图片字节数。 */
  inlineBytes: number;
  /** 内联的图片张数。 */
  inlineImages: number;
  /** 时长来源：`measured`（配音实测）或 `estimated`（按字数）。 */
  timing: 'measured' | 'estimated';
  /** 旁白音轨的落点（有音轨时）。 */
  audioPath?: string;
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
  try {
    script = loadScript(workRoot, parsed.script);
  } catch (error) {
    if (error instanceof LoadError) {
      console.error(error.message);
      return 2;
    }
    throw error;
  }

  // ── 校验：有 blocker 就到此为止 ────────────────────────
  const check = await checkScript(script.value, target);
  if (check.blocker > 0) {
    if (parsed.json) {
      console.log(JSON.stringify({ ok: false, target, scriptPath: script.path, check }, null, 2));
    } else {
      console.error(`讲稿有 ${String(check.blocker)} 个必须修的问题：`);
      for (const issue of check.issues) {
        if (issue.severity !== 'blocker') continue;
        const where = issue.path === undefined ? '' : ` ${issue.path}`;
        console.error(`  × [${issue.sceneId ?? '-'}] ${issue.message}${where}`);
        if (issue.fix !== undefined) console.error(`    → ${issue.fix}`);
      }
    }
    return 2;
  }

  // ── 素材按需转换（--check 不碰转换，保持快） ────────────
  let prep: PrepReport | undefined;
  if (!parsed.check) {
    const refs = collectReferences(script.value);
    if (refs.length > 0) {
      prep = await prepare(target, workRoot, refs);
    }
  }

  const durations = loadDurations(workRoot, parsed.durations);

  let plan: Plan;
  try {
    plan = buildPlan({
      script: script.value,
      ...(prep === undefined ? {} : { prep: prep.prepared }),
      // 图片在这里内联成 data URI：浏览器里读不了 `file://`，见 `embed.ts`。
      workRoot,
      embed: parsed.noEmbed ? undefined : embedImage,
      ...(durations === undefined ? {} : { durations }),
    });
  } catch (error) {
    console.error(`算不出渲染计划：${(error as Error).message}`);
    return 2;
  }

  const warnings = plan.warnings;
  const estimate = summarizeDurations(
    plan.scenes.map((scene) => ({ id: scene.id, type: scene.type, narration: scene.narration })),
    plan.composition.fps,
  );
  const estimatedFrames = estimate.totalFrames;
  const estimatedSec = Math.round(estimate.totalSeconds * 10) / 10;

  const browser = resolveBrowser(parsed.browser);
  const inlined = collectInline(plan);

  const scaled = durations === undefined && estimatedFrames !== plan.composition.durationInFrames;

  const report: RenderReport = {
    ok: true,
    target,
    scriptPath: script.path,
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
    check: { blocker: check.blocker, warning: check.warning, issues: check.issues },
    ...(prep === undefined ? {} : { prep: { converted: prep.converted, cached: prep.cached, ms: prep.elapsedMs } }),
    inlineBytes: inlined.bytes,
    inlineImages: inlined.images,
    timing: durations === undefined ? 'estimated' : 'measured',
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
    printReport(report, parsed.json, scaled);
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

  // 音轨内联成 data URI：Remotion 取资源只认 http(s) 与 data（`file://` 会被拒）。
  const audioFile =
    parsed.audio !== undefined
      ? resolve(parsed.audio)
      : durations?.track !== undefined && durations.track !== ''
        ? resolve(workRoot, durations.track)
        : undefined;
  let audio: string | undefined;
  if (audioFile !== undefined && existsSync(audioFile)) {
    audio = inlineAudio(audioFile);
    report.audioPath = audioFile;
  } else if (parsed.audio !== undefined) {
    console.error(`找不到音轨：${audioFile ?? parsed.audio}`);
    return 2;
  }
  const bundle = await bundleProject({
    rendererDir: RENDERER_DIR,
    onProgress: (percent) => {
      if (!parsed.json && process.stderr.isTTY) process.stderr.write(`\r打包 ${Math.round(percent)}%   `);
    },
  });
  report.bundleMs = bundle.ms;

  // 输出目录可能还不存在（`--out` 指到别处时尤其常见）。
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
        ...(audio === undefined ? {} : { audio }),
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
        ...(audio === undefined ? {} : { audio }),
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
  printReport(report, parsed.json, scaled);
  return 0;
}

/**
 * 把音轨读成 `data:` URI。**必须内联**：Remotion 取资源只认 http(s) 与 `data:`，
 * `file://` 会被拒。代价是内存，所以配音阶段产出的是 16 位单声道 44.1k。
 */
function inlineAudio(path: string): string {
  const bytes = readFileSync(path);
  return `data:${sniffAudioMime(bytes)};base64,${bytes.toString('base64')}`;
}

/** 按魔数认音频类型：wav 的头部是 `RIFF....WAVE`。**不按后缀猜**（say 的产物就骗过后缀）。 */
function sniffAudioMime(bytes: Buffer): string {
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WAVE') {
    return 'audio/wav';
  }
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString('latin1') === 'fLaC') return 'audio/flac';
  if (bytes.length >= 3 && bytes.subarray(0, 3).toString('latin1') === 'ID3') return 'audio/mpeg';
  if (bytes.length >= 2 && bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0) return 'audio/mpeg';
  return 'application/octet-stream';
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
    else if (scene.type === 'clip') visit(scene.poster);
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
    `  时长    ${report.durationSec} 秒（${report.durationInFrames} 帧，${report.timing === 'measured' ? '取自实测音频' : `按字数预估 ${report.estimatedSec} 秒`}${scaled ? '，已按 targetDurationSec 缩放' : ''}）`,
    `  内联图片 ${report.inlineImages} 张（${Math.round(report.inlineBytes / 1024)} KB）`,
  ];
  if (report.prep !== undefined) {
    lines.push(`  素材    新转 ${String(report.prep.converted)} 个 · 缓存命中 ${String(report.prep.cached)} 个（${String(Math.round(report.prep.ms))}ms）`);
  }
  if (report.check !== undefined && report.check.warning > 0) {
    lines.push(`  校验    ${String(report.check.warning)} 个待确认（见 warnings）`);
  }
  if (report.audioPath !== undefined) lines.push(`  音轨    ${report.audioPath}`);
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
