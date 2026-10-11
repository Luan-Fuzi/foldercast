#!/usr/bin/env node
/**
 * 页面渲染入口：`script.json` → 一个自包含的静态 HTML 页。
 *
 * 用法：
 *   pnpm page <目录> [--style <名>] [--out <文件>] [--script <文件>] [--json]
 *
 * 这个脚本**独立可跑**：它不认识 DSH，只认工作根下的文件。讲稿是唯一的创作产物，
 * 页面只是它的另一个出口（一份创作、多个出口：视频 / 页面）。
 *
 * 页面自包含：零 JavaScript、零外部资源（不引 CDN、无外部字体），图片缩到页面尺寸后
 * 内联成 data URI，超预算的退回相对路径并在页脚说明。
 *
 * 退出码：0 成功；2 参数、讲稿有 blocker 或风格名不认识。
 */
import { withExecutionLock } from '../contracts/execution.ts';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { checkScript } from '../renderer/check.ts';
import { loadScript, LoadError, sourceDirOf, workRootOf } from '../renderer/load.ts';
import { collectPlanModel, countSections } from './collect.ts';
import { createPageEmbedder } from './embed.ts';
import { collectReferences, prepare } from '../assets/prep.ts';
import { buildPlan } from '../renderer/plan.ts';
import { highlightExcerpts } from '../renderer/highlight.ts';
import { renderPage } from './render.ts';
import { DEFAULT_STYLE_NAME, STYLE_NAMES, styleByName } from './styles.ts';
import { beginOutput, finishOutput, hashFile, type OutputContext } from '../contracts/revisions.ts';
import { renderStyleFor, type VisualStyleName } from '../contracts/visual.ts';

const USAGE = `把目录的讲稿渲染成一个自包含的静态 HTML 页（零 JavaScript、零外部资源）。

用法：
  pnpm page <目录> [选项]

选项：
  --style <名>   风格预设：${STYLE_NAMES.join(' / ')}。缺省读讲稿 visual.style，无则 ${DEFAULT_STYLE_NAME}
  --out <文件>   输出文件。默认 <目录>/.foldercast/out/page.html
  --script <文件> 讲稿路径。默认 <目录>/.foldercast/script.json
  --approved     正式产出：要求当前输入的评审回执；缺省生成工作草稿
  --json         以 JSON 输出报告（给 agent 与 CI 用）
  -h, --help     显示这段说明

退出码：0 成功；2 参数、讲稿有 blocker 或风格名不认识。`;

type Options = {
  target: string;
  style?: string;
  out?: string;
  script?: string;
  json: boolean;
  approved?: boolean;
};

function parseArgs(argv: readonly string[]): Options | { error: string } {
  const options: Options = { target: '', json: false };
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) break;
    switch (arg) {
      case '-h':
      case '--help':
        return { error: 'help' };
      case '--json':
        options.json = true;
        break;
      case '--approved':
        options.approved = true;
        break;
      case '--style':
      case '--out':
      case '--script': {
        const value = argv[i + 1];
        if (value === undefined || value.startsWith('--')) return { error: `${arg} 后面缺一个值` };
        i += 1;
        if (arg === '--style') options.style = value;
        else if (arg === '--out') options.out = value;
        else options.script = value;
        break;
      }
      default:
        if (arg.startsWith('-')) return { error: `不认识的选项：${arg}` };
        rest.push(arg);
        break;
    }
  }

  if (rest.length > 1) return { error: `只接受一个目录，收到 ${String(rest.length)} 个` };
  options.target = rest[0] ?? '';
  if (options.target === '') return { error: '缺少目录参数' };
  return options;
}

export type PageReport = {
  ok: boolean;
  target: string;
  scriptPath: string;
  outputPath: string;
  /** 实际使用的风格预设名。 */
  style: string;
  bytes: number;
  /** 渲染出的区块数（含页头 hero）。 */
  sections: number;
  /** 页面不认识而被跳过的场景。 */
  skipped: { id: string; type: string }[];
  imagesInlined: number;
  imagesLinked: number;
  /** 内联图片的总字节。 */
  inlineBytes: number;
  /** 引用的文件数（去重后）。 */
  references: number;
  /** 页脚说明（图片没内联的原因等）。 */
  notes: string[];
  revision: string;
  mode: 'draft' | 'approved';
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

  const target = resolve(parsed.target);
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

  // ── 契约校验：与渲染入口同一套判据（编造路径、字段笔误、字幕切不开都拦在这） ──
  const check = await checkScript(script.value, target);
  if (check.blocker > 0) {
    console.error(`讲稿有 ${String(check.blocker)} 个必须修的问题：`);
    for (const issue of check.issues) {
      if (issue.severity !== 'blocker') continue;
      const where = issue.path === undefined ? '' : ` ${issue.path}`;
      console.error(`  × [${issue.sceneId ?? '-'}] ${issue.message}${where}`);
      if (issue.fix !== undefined) console.error(`    → ${issue.fix}`);
    }
    return 2;
  }

  const requestedStyle = parsed.style ?? renderStyleFor(script.value.visual);
  const style = styleByName(requestedStyle);
  if (style === undefined) {
    console.error(`不认识的风格：${requestedStyle}。可用：${STYLE_NAMES.join(' / ')}`);
    return 2;
  }
  const styleName = style.name;

  const outputPath = resolve(parsed.out ?? join(workRoot, 'out', 'page.html'));
  let context: OutputContext;
  try {
    context = beginOutput(target, { scriptPath: script.path, expectedScript: script.value,
      approved: parsed.approved, outputPaths: [outputPath], settings: { style: styleName } });
  } catch (error) {
    console.error((error as Error).message);
    return 2;
  }

  // 与视频相同的素材准备和计划；页面在解析素材地址时执行自己的内联预算。
  const prep = await prepare(target, workRoot, collectReferences(script.value));
  const pageEmbedder = createPageEmbedder({ sourceDir, outDir: dirname(outputPath) });
  const plan = buildPlan({ script: script.value, style: style.name as VisualStyleName,
    prep: prep.prepared, workRoot, embed: pageEmbedder.embed });
  plan.highlight = await highlightExcerpts(script.value, styleName === '科技风格');
  const model = collectPlanModel(script.value, plan);
  const embedded = pageEmbedder.report;
  embedded.notes.push(...plan.warnings);

  // 讲稿路径的展示写法：能相对被讲解目录写就相对写，页脚更可读。
  // 分隔符统一成正斜杠：这是 HTML 里的展示文本，不是文件系统路径（Windows 上
  // relative() 给反斜杠，页脚会出现 .foldercast\script.json 这种写法）
  const scriptRef = (relative(target, script.path) || script.path).replaceAll('\\', '/');
  const html = renderPage({
    model,
    style,
    images: embedded.images,
    notes: embedded.notes,
    // 生成时间在这里取一次并传进去：render 是纯函数，不能自己看表
    generatedAt: new Date().toISOString(),
    scriptRef,
  });

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, html, 'utf8');
  const bytes = statSync(outputPath).size;
  // 相对路径引用的准备产物也属于交付依赖，修改或删除后页面不再是当前结果。
  context.dependencies = [...embedded.images.values()].filter((image) => !image.inlined).map((image) => {
    const path = resolve(dirname(outputPath), image.src);
    return { path, hash: hashFile(path) };
  });
  try { finishOutput(context, 'page', [outputPath]); }
  catch (error) { console.error((error as Error).message); return 2; }

  const report: PageReport = {
    ok: true,
    target,
    scriptPath: script.path,
    outputPath,
    style: styleName,
    bytes,
    sections: countSections(model),
    skipped: model.skipped,
    imagesInlined: embedded.inlined,
    imagesLinked: embedded.linked,
    inlineBytes: embedded.inlineBytes,
    references: model.references.length,
    notes: embedded.notes,
    revision: context.revision,
    mode: context.mode,
  };

  if (parsed.json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }

  const lines = [
    `${report.target} → ${report.outputPath}`,
    `  讲稿    ${report.scriptPath}（契约校验通过）`,
    `  页面    ${String(Math.round(bytes / 1024))} KB · 风格「${report.style}」· ${String(report.sections)} 个区块 · 引用文件 ${String(report.references)} 个`,
    `  图片    内联 ${String(report.imagesInlined)} 张（${String(Math.round(report.inlineBytes / 1024))} KB）· 相对路径 ${String(report.imagesLinked)} 张`,
  ];
  for (const note of report.notes) lines.push(`  注意    ${note}`);
  lines.push('  用浏览器打开即可；未内联图片需连同引用文件一起转发。');
  console.log(lines.join('\n'));
  return 0;
}

const exitCode = await (async (): Promise<number> => {
  const parsed = parseArgs(process.argv.slice(2));
  if ('error' in parsed || ('check' in parsed && parsed.check)) return main();
  try { return await withExecutionLock(resolve(parsed.target || process.cwd()), main); }
  catch (error) {
    const message = (error as Error).message;
    if (parsed.json) console.log(JSON.stringify({ ok: false, error: message }));
    else console.error(message);
    return 2;
  }
})();
process.exitCode = exitCode;
