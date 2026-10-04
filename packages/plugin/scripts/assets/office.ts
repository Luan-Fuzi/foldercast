/**
 * Office 与 PDF 的素材化：转图走 `dsoffice`，文本结构化提取走 `officeparser`。
 *
 * 为什么要两个工具（SYSTEM-DESIGN 2.1）：它们回答的是两个问题 —— `dsoffice` 把文档**画**
 * 出来（预编译 LibreOffice / pdfium 引擎，不需要系统装 LibreOffice），`officeparser` 把
 * 文档**读**成带层级的 AST（标题级别、表格、工作表、幻灯片）。一个都不能少。
 *
 * xlsx 先用 `dsoffice recalculate` 重算再解析：公式的缓存值可能是陈旧的，甚至没有缓存值
 * （实测夹具里 `SUM(B2:B3)` 就没有缓存值，重算后才有 4600）。
 */
import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseOffice } from 'officeparser';
import type { OutlineEntry } from '../contracts/assets.ts';
import { runJson, runCommand, type CommandOutcome } from './run.ts';

/** 大纲最多记这么多条：再多对写稿没有帮助，只会撑大清单。 */
const OUTLINE_LIMIT = 40;

export type OfficeExtraction = {
  /** 文档自带标题（元数据里的 Title，或首个标题）。 */
  title: string;
  /** 全文，Markdown。 */
  markdown: string;
  outline: OutlineEntry[];
  sheetNames: string[];
  slideTitles: string[];
  tableCount: number;
};

type AstNode = {
  type?: string;
  text?: string;
  children?: AstNode[];
  metadata?: Record<string, unknown>;
};

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/** 从 AST 里取标题级别：docx 的样式名是 `Heading1`，pptx 的题目没有级别。 */
function levelOf(style: string): number {
  const digits = /(\d+)/.exec(style)?.[1];
  if (digits !== undefined) return Math.min(6, Math.max(1, Number(digits)));
  return 1;
}

/**
 * 去掉正文开头的 YAML front matter。
 *
 * `officeparser` 会把文档属性一并写成 front matter，里面混着 WPS/Office 的内部字段
 * （`KSOProductBuildVer`、`ICV`、`KSOTemplateDocerSaveRecord`…）。真正有用的标题已经
 * 单独进 `outline` 与预览，正文里留着这些对写稿只有干扰。
 */
export function stripFrontMatter(markdown: string): string {
  if (!markdown.startsWith('---')) return markdown;
  const end = markdown.indexOf('\n---', 3);
  if (end === -1) return markdown;
  const afterMarker = markdown.indexOf('\n', end + 1);
  return afterMarker === -1 ? '' : markdown.slice(afterMarker + 1).replace(/^\n+/, '');
}

/**
 * 解析文档并抽取结构。
 *
 * 不开启 OCR：`officeparser` 的 OCR 只对提取出的图片生效，会引入模型下载与显著耗时；
 * 扫描版 PDF 没有文本层属于已知边界（SPEC-data-format.md 三）。
 */
export async function extractOfficeText(absolute: string): Promise<OfficeExtraction> {
  const ast = (await parseOffice(absolute)) as unknown as {
    content?: AstNode[];
    metadata?: Record<string, unknown>;
    to: (format: string) => Promise<{ value: unknown }>;
  };

  const outline: OutlineEntry[] = [];
  const sheetNames: string[] = [];
  const slideTitles: string[] = [];
  let tableCount = 0;

  const walk = (nodes: readonly AstNode[] | undefined, inSlide: boolean): void => {
    for (const node of nodes ?? []) {
      let slide = inSlide;

      switch (node.type) {
        case 'slide':
          slide = true;
          break;
        case 'sheet': {
          slide = false;
          const name = cleanText(node.metadata?.['sheetName']);
          if (name !== '' && !sheetNames.includes(name)) sheetNames.push(name);
          break;
        }
        case 'heading': {
          const text = cleanText(node.text);
          if (text !== '') {
            if (outline.length < OUTLINE_LIMIT) {
              outline.push({ level: levelOf(cleanText(node.metadata?.['style'])), text });
            }
            // pptx 的 heading 就是幻灯片标题
            if (inSlide && !slideTitles.includes(text)) slideTitles.push(text);
          }
          break;
        }
        case 'table':
          tableCount += 1;
          break;
        default:
          break;
      }

      walk(node.children, slide);
    }
  };

  walk(ast.content, false);

  let markdown = '';
  try {
    const { value } = await ast.to('md');
    markdown = typeof value === 'string' ? value : String(value ?? '');
  } catch {
    // Markdown 转换失败不影响结构信息：正文可以退回纯文本
    try {
      const { value } = await ast.to('text');
      markdown = typeof value === 'string' ? value : String(value ?? '');
    } catch {
      markdown = '';
    }
  }

  return { title: titleOf(ast.metadata, outline), markdown: stripFrontMatter(markdown), outline, sheetNames, slideTitles, tableCount };
}

/** 文档标题：优先元数据里的 Title，其次第一个标题，最后空串。 */
function titleOf(metadata: Record<string, unknown> | undefined, outline: readonly OutlineEntry[]): string {
  const native = metadata?.['nativeProperties'];
  const fromNative = native !== null && typeof native === 'object' ? (native as Record<string, unknown>)['Title'] : undefined;
  const candidates = [metadata?.['title'], fromNative, outline[0]?.text];
  for (const candidate of candidates) {
    const text = cleanText(candidate);
    if (text !== '') return text;
  }
  return '';
}

export type RenderedPage = { path: string; width: number; height: number; page: number };

export type RenderOutcome =
  | { ok: true; pages: RenderedPage[]; pageCount: number; missingFonts: string[] }
  | { ok: false; error: string };

type DsofficeRenderOutput = {
  pageCount?: number;
  images?: Array<{ path?: string; width?: number; height?: number; page?: number }>;
  missingFonts?: string[];
};

/**
 * 用 dsoffice 把文档逐页渲染成 PNG，落在 `outputDir`（调用方给一个临时目录）。
 *
 * 返回的是 dsoffice 自己写出的路径与尺寸 —— 不猜分页，也不承诺与 Microsoft Office 一致
 * （官方声明字体度量差异会改变换行，见 SPEC-data-format.md 三）。
 */
export function renderDocumentPages(source: string, outputDir: string): RenderOutcome {
  // 只建父目录：dsoffice 自己会建输出目录，抢先建好会让它 EEXIST 失败
  mkdirSync(dirname(outputDir), { recursive: true });
  const result = runJson<DsofficeRenderOutput>('dsoffice', ['render', '--input', source, '--output-dir', outputDir]);

  if (!result.ok) return { ok: false, error: result.error };

  const pages: RenderedPage[] = [];
  for (const image of result.value.images ?? []) {
    if (image.path === undefined) continue;
    pages.push({
      path: image.path,
      width: image.width ?? 0,
      height: image.height ?? 0,
      page: image.page ?? pages.length + 1,
    });
  }

  if (pages.length === 0) return { ok: false, error: 'dsoffice 没有产出任何页面' };
  return { ok: true, pages, pageCount: result.value.pageCount ?? pages.length, missingFonts: result.value.missingFonts ?? [] };
}

/** xlsx 公式重算。 */
export function recalculateWorkbook(source: string, target: string): { ok: true } | { ok: false; error: string } {
  mkdirSync(dirname(target), { recursive: true });
  const outcome: CommandOutcome = runCommand('dsoffice', ['recalculate', '--input', source, '--output', target]);
  return outcome.ok ? { ok: true } : { ok: false, error: outcome.error };
}

/**
 * 把 dsoffice 的输出搬成我们的命名，并删掉临时目录。
 *
 * dsoffice 会往输出目录里写自己的 `manifest.json`，也用它自己的 `page-0001.png` 名字；
 * 产物路径必须由我们决定（讲稿里写下的路径要长期有效）。
 *
 * `targetFor` 必须同时给出**绝对路径**（搬运目标）与**相对工作根的路径**（写进清单）：
 * 只给相对路径会让 `renameSync` 按进程当前目录解析，产物就跑到工作根外面去了。
 */
export function collectPages(
  pages: readonly RenderedPage[],
  tempDir: string,
  targetFor: (pageNumber: number) => { absolute: string; relative: string },
): Array<{ role: 'page'; path: string; width: number; height: number }> {
  const collected: Array<{ role: 'page'; path: string; width: number; height: number }> = [];
  const sorted = [...pages].sort((left, right) => left.page - right.page);

  for (const [index, page] of sorted.entries()) {
    const target = targetFor(index + 1);
    mkdirSync(dirname(target.absolute), { recursive: true });
    renameSync(page.path, target.absolute);
    collected.push({ role: 'page', path: target.relative, width: page.width, height: page.height });
  }

  rmSync(tempDir, { recursive: true, force: true });
  return collected;
}

/** 临时目录里是否还留着 dsoffice 写的清单（搬运完应当没有）。 */
export function leftoverFiles(directory: string): string[] {
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
}

/** 文件是否像个正常的产物（非空）。 */
export function isNonEmptyFile(path: string): boolean {
  try {
    return statSync(path).size > 0;
  } catch {
    return false;
  }
}
