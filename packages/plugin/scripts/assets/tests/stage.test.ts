import { describe, expect, it } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { analyzeDirectory } from '../../analyzer/analyze.ts';
import type { AssetManifest } from '../../contracts/assets.ts';
import type { FoldercastDocument } from '../../contracts/foldercast.ts';
import { hasCommand, runCommand } from '../run.ts';
import { runAssetsStage } from '../stage.ts';

const OFFICE_FIXTURES = resolve(import.meta.dirname, 'fixtures/office');
const ANALYZER_FIXTURES = resolve(import.meta.dirname, '../../analyzer/tests/fixtures/sample');

const hasDsoffice = hasCommand('dsoffice');
const hasFfmpeg = hasCommand('ffmpeg');
const hasSips = hasCommand('sips');

/** 造一个临时被讲解目录，并写好解读（分析器只产出文档，写盘由 CLI 做）。 */
function makeSourceDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'foldercast-assets-'));

  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/index.ts'), '// 示例入口\nexport function main(): number {\n  return 42;\n}\n');
  writeFileSync(join(root, 'README.md'), '# 素材阶段夹具\n\n用来验证素材生成与增量重算。\n');

  // 一张真实的小 PNG（分析器夹具里那张 3×2）
  mkdirSync(join(root, 'img'), { recursive: true });
  copyFileSync(join(ANALYZER_FIXTURES, 'assets/logo.png'), join(root, 'img/logo.png'));

  if (hasFfmpeg) {
    const clip = join(root, 'clip.mp4');
    runCommand('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=size=128x96:rate=10', '-t', '1', '-pix_fmt', 'yuv420p', clip]);
  }

  if (hasDsoffice) {
    for (const name of ['report.docx', 'budget.xlsx', 'slides.pptx', 'report.pdf']) {
      copyFileSync(join(OFFICE_FIXTURES, name), join(root, name));
    }
  }

  const { document } = analyzeDirectory({ root });
  mkdirSync(join(root, '.foldercast'), { recursive: true });
  writeFileSync(join(root, '.foldercast/foldercast.json'), `${JSON.stringify(document, null, 2)}\n`);
  return root;
}

function readReading(root: string): FoldercastDocument {
  return JSON.parse(readFileSync(join(root, '.foldercast/foldercast.json'), 'utf8')) as FoldercastDocument;
}

function readManifest(root: string): AssetManifest {
  return JSON.parse(readFileSync(join(root, '.foldercast/assets/manifest.json'), 'utf8')) as AssetManifest;
}

describe.skipIf(!hasSips && !hasFfmpeg)('素材阶段（图片，纯 JS 部分）', () => {
  it('生成缩略图、写清单、回填解读；第二次运行全部命中缓存', async () => {
    const root = makeSourceDir();

    const first = await runAssetsStage({ root, only: new Set(['image']) });
    expect(first.processed).toBeGreaterThan(0);
    expect(first.failed).toBe(0);

    const manifest = readManifest(root);
    const imageEntry = manifest.entries.find((entry) => entry.path === 'img/logo.png');
    expect(imageEntry?.products[0]?.role).toBe('thumb');

    // 回填：解读里的 asset 指向缩略图。**代码文件不再是处理对象**（MVP 删掉了高亮图），
    // 所以它没有 asset，preview 保持分析器的结果
    const reading = readReading(root);
    const image = reading.manifest.find((entry) => entry.path === 'img/logo.png');
    expect(image?.asset).toBe('assets/thumbs/img_logo.png.png');
    const code = reading.manifest.find((entry) => entry.path === 'src/index.ts');
    expect(code?.asset).toBeUndefined();

    // 第二次：全部命中缓存，不重算
    const second = await runAssetsStage({ root, only: new Set(['image']) });
    expect(second.processed).toBe(0);
    expect(second.cached).toBe(first.processed);
    expect(second.failed).toBe(0);
  });

  it('源文件改了 mtime 才重算（增量判据是 mtime + size）', async () => {
    const root = makeSourceDir();
    await runAssetsStage({ root, only: new Set(['image']) });

    // 只改 mtime，不改内容：size 没变但 mtime 变了 → 重算
    const target = join(root, 'img/logo.png');
    const future = new Date(Date.now() + 10_000);
    utimesSync(target, future, future);

    const again = await runAssetsStage({ root, only: new Set(['image']) });
    expect(again.processed).toBe(1);

    // 再跑一次（这次 mtime 稳定了）→ 命中缓存
    const third = await runAssetsStage({ root, only: new Set(['image']) });
    expect(third.processed).toBe(0);
    expect(third.cached).toBe(1);
  });

  it('--dry-run 不写任何文件', async () => {
    const root = makeSourceDir();
    const report = await runAssetsStage({ root, only: new Set(['image']), dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.processed).toBeGreaterThan(0);
    expect(existsSync(join(root, '.foldercast/assets/manifest.json'))).toBe(false);
    expect(existsSync(join(root, '.foldercast/assets/thumbs'))).toBe(false);
  });

  it('缺少解读时给出可操作的错误', async () => {
    const root = mkdtempSync(join(tmpdir(), 'foldercast-no-reading-'));
    await expect(runAssetsStage({ root })).rejects.toThrow(/先跑分析器/);
  });
});

describe.skipIf(!hasFfmpeg)('素材阶段（视频）', () => {
  it('抽封面与关键帧，并把时长/分辨率写进预览', async () => {
    const root = makeSourceDir();
    const report = await runAssetsStage({ root, only: new Set(['video']) });
    expect(report.failed).toBe(0);
    expect(report.processed).toBe(1);

    const entry = readManifest(root).entries.find((item) => item.path === 'clip.mp4');
    expect(entry?.products.filter((product) => product.role === 'poster')).toHaveLength(1);
    expect(entry?.products.filter((product) => product.role === 'frame')).toHaveLength(3);
    expect(entry?.meta?.durationSec).toBeGreaterThan(0.5);
    expect(entry?.meta?.width).toBe(128);

    for (const product of entry?.products ?? []) {
      expect(existsSync(join(root, '.foldercast', product.path)), product.path).toBe(true);
    }

    const preview = readReading(root).manifest.find((item) => item.path === 'clip.mp4')?.preview ?? '';
    expect(preview).toMatch(/^\d{2}:\d{2} · 128×96/);
    expect(preview).toContain('h264');
  });
});

describe.skipIf(!hasSips && !hasFfmpeg)('素材阶段（图片）', () => {
  it('生成缩略图并记录尺寸', async () => {
    const root = makeSourceDir();
    const report = await runAssetsStage({ root, only: new Set(['image']) });
    expect(report.failed).toBe(0);

    const entry = readManifest(root).entries.find((item) => item.path === 'img/logo.png');
    expect(entry?.products[0]?.role).toBe('thumb');
    expect(entry?.meta).toEqual({ width: 3, height: 2 });
    expect(existsSync(join(root, '.foldercast', entry?.products[0]?.path ?? ''))).toBe(true);
  });
});

describe.skipIf(!hasDsoffice)('素材阶段（office / pdf）', () => {
  // 每个 Office/PDF 都要起一次 LibreOffice/pdfium 引擎，实测四个文件十几秒
  it('逐页转图 + 结构化提取 + xlsx 公式重算', { timeout: 120_000 }, async () => {
    const root = makeSourceDir();
    const report = await runAssetsStage({ root, only: new Set(['office', 'pdf']) });
    expect(report.failed).toBe(0);
    expect(report.processed).toBe(4);

    const entries = new Map(readManifest(root).entries.map((entry) => [entry.path, entry]));

    // docx：2 页，抽到标题与表格
    const docx = entries.get('report.docx');
    expect(docx?.products.filter((product) => product.role === 'page').length).toBeGreaterThanOrEqual(1);
    expect(docx?.meta?.pageCount).toBeGreaterThanOrEqual(1);
    expect(docx?.text?.outline?.map((item) => item.text)).toContain('季度汇报');
    expect(docx?.text?.tableCount).toBe(1);
    // 提取的全文落在 assets/text/，且不带 front matter（那里是 WPS/Office 内部字段）
    expect(docx?.text?.markdown).toBe('assets/text/report.docx.md');
    const body = readFileSync(join(root, '.foldercast', docx?.text?.markdown ?? ''), 'utf8');
    expect(existsSync(join(root, '.foldercast', docx?.text?.markdown ?? ''))).toBe(true);
    expect(body.startsWith('---')).toBe(false);
    expect(body).toContain('季度汇报');

    // pptx：两张幻灯片，标题可读
    const pptx = entries.get('slides.pptx');
    expect(pptx?.text?.slideTitles).toEqual(['项目概述', '架构分层']);

    // xlsx：工作表名 + 公式重算后的值（夹具里 B4 本来没有缓存值）
    const xlsx = entries.get('budget.xlsx');
    expect(xlsx?.text?.sheetNames).toEqual(['Summary']);
    const markdown = readFileSync(join(root, '.foldercast', xlsx?.text?.markdown ?? ''), 'utf8');
    expect(markdown).toContain('4600');

    // pdf：文本层提取
    const pdf = entries.get('report.pdf');
    expect(pdf?.text?.markdown).toBeDefined();

    // 回填解读：office/pdf 的预览补上了
    const reading = readReading(root);
    const docxEntry = reading.manifest.find((item) => item.path === 'report.docx');
    expect(docxEntry?.asset).toMatch(/^assets\/pages\/report\.docx_p1\.png$/);
    expect(docxEntry?.preview).toContain('季度汇报');
  });

  it('单文件失败不影响其他文件', { timeout: 120_000 }, async () => {
    const root = makeSourceDir();
    // 伪造一个坏掉的 docx：内容不是 zip
    writeFileSync(join(root, 'broken.docx'), '这不是一个 docx');
    const { document } = analyzeDirectory({ root });
    writeFileSync(join(root, '.foldercast/foldercast.json'), `${JSON.stringify(document, null, 2)}\n`);

    const report = await runAssetsStage({ root, only: new Set(['office', 'pdf']) });
    expect(report.failed).toBe(1);
    expect(report.failures[0]?.path).toBe('broken.docx');
    expect(report.processed).toBeGreaterThan(0);

    const broken = readManifest(root).entries.find((entry) => entry.path === 'broken.docx');
    expect(broken?.error).toBeDefined();
    expect(broken?.products).toEqual([]);
  });
});

describe('临时目录清理', () => {
  it.skipIf(!hasDsoffice)('dsoffice 的临时目录不留在工作根里', { timeout: 120_000 }, async () => {
    const root = makeSourceDir();
    await runAssetsStage({ root, only: new Set(['office']) });
    expect(existsSync(join(root, '.foldercast/tmp'))).toBe(false);
  });

  it('工作根之外不写任何东西', async () => {
    const root = makeSourceDir();
    await runAssetsStage({ root, only: new Set(['code']) });
    const unexpected = ['assets', 'thumbs', 'pages', 'code', 'text'].filter((name) => existsSync(join(root, name)));
    expect(unexpected).toEqual([]);
    // 解读与素材清单都在 .foldercast 下
    expect(existsSync(join(root, '.foldercast/foldercast.json'))).toBe(true);
    expect(existsSync(join(root, '.foldercast/assets/manifest.json'))).toBe(true);
    void dirname;
  });
});
