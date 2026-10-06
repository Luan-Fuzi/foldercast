import { describe, expect, it } from 'vitest';
import type { AssetEntry, AssetManifest } from '../../contracts/assets.ts';
import type { FoldercastDocument } from '../../contracts/foldercast.ts';
import { applyAssetsToReading, previewFor } from '../enrich.ts';

function assetEntry(overrides: Partial<AssetEntry>): AssetEntry {
  return {
    path: 'a.bin',
    kind: 'office',
    mtimeMs: 1,
    size: 1,
    hash: 'sha256:x',
    products: [],
    ...overrides,
  };
}

function readingWith(entries: Array<Partial<FoldercastDocument['manifest'][number]>>): FoldercastDocument {
  return {
    foldercast: 1,
    generatedAt: '2026-10-04T00:00:00+08:00',
    source: { root: '/tmp/x' },
    sources: {},
    stats: {
      totalFiles: entries.length,
      totalBytes: 0,
      maxDepth: 1,
      kindCounts: {},
      secrets: { excluded: [], rescanned: [] },
    },
    manifest: entries.map((entry) => ({ path: 'a.bin', kind: 'office', ...entry })),
  };
}

describe('预览生成', () => {
  it('视频：时长 · 分辨率 · 编码', () => {
    const preview = previewFor(assetEntry({ kind: 'video', meta: { durationSec: 12.48, width: 1920, height: 1080, codec: 'h264' } }));
    expect(preview).toBe('00:12 · 1920×1080 · h264');
  });

  it('office：页数 + 大纲 + 表格数', () => {
    const preview = previewFor(
      assetEntry({
        kind: 'office',
        meta: { pageCount: 2 },
        text: { outline: [{ level: 1, text: '季度汇报' }, { level: 2, text: '关键指标' }], tableCount: 3 },
      }),
    );
    expect(preview).toBe('2 页 · 季度汇报 / 关键指标 · 3 个表格');
  });

  it('xlsx 用工作表名，pptx 用幻灯片标题', () => {
    expect(previewFor(assetEntry({ kind: 'office', text: { sheetNames: ['Summary', 'Detail'] } }))).toBe('工作表 Summary、Detail');
    expect(previewFor(assetEntry({ kind: 'office', text: { slideTitles: ['项目概述', '架构分层'] } }))).toBe('项目概述 / 架构分层');
  });

  it('没有结构信息时（如扫描版 PDF）退回正文开头，且不超过 200 字', () => {
    const preview = previewFor(assetEntry({ kind: 'pdf', text: {} }), '正文'.repeat(300));
    expect(preview).toBeDefined();
    expect([...(preview ?? '')].length).toBeLessThanOrEqual(200);
    expect(preview?.endsWith('…')).toBe(true);
  });

  it('图片：宽×高', () => {
    expect(previewFor(assetEntry({ kind: 'image', meta: { width: 640, height: 480 } }))).toBe('640×480');
  });
});

describe('回填解读', () => {
  const manifest: AssetManifest = {
    assets: 1,
    generatedAt: '2026-10-04T00:00:00+08:00',
    source: { root: '/tmp/x' },
    entries: [
      // 代码文件在 MVP 里不再产出素材（高亮图已删）：没有产物，回填时就不该给它编一个
      assetEntry({ path: 'src/index.ts', kind: 'code', products: [] }),
      assetEntry({
        path: 'report.docx',
        kind: 'office',
        products: [
          { role: 'page', path: 'assets/pages/report.docx_p1.png', width: 1191, height: 1684 },
          { role: 'page', path: 'assets/pages/report.docx_p2.png', width: 1191, height: 1684 },
        ],
        meta: { pageCount: 2 },
        text: { outline: [{ level: 1, text: '季度汇报' }], tableCount: 1 },
      }),
      assetEntry({ path: 'broken.pdf', kind: 'pdf', products: [], error: 'dsoffice 退出码 1' }),
    ],
  };

  it('主素材按角色优先级取：缩略图 / 封面 / 页图；没有素材的类别不编一个', () => {
    const reading = readingWith([
      { path: 'src/index.ts', kind: 'code' },
      { path: 'report.docx', kind: 'office' },
    ]);
    const report = applyAssetsToReading(reading, manifest, () => '');

    // 代码高亮图已从 MVP 删掉，所以 code 类文件没有素材；office 取逐页图
    expect(reading.manifest[0]?.asset).toBeUndefined();
    expect(reading.manifest[1]?.asset).toBe('assets/pages/report.docx_p1.png');
    expect(report.assetsSet).toBe(1);
  });

  it('office/pdf 的预览被补上，代码的预览保持分析器的结果', () => {
    const reading = readingWith([
      { path: 'src/index.ts', kind: 'code', preview: '// 示例入口' },
      { path: 'report.docx', kind: 'office' },
    ]);
    const report = applyAssetsToReading(reading, manifest, () => '');

    expect(reading.manifest[0]?.preview).toBe('// 示例入口');
    expect(reading.manifest[1]?.preview).toContain('2 页');
    expect(report.previewsSet).toBe(1);
  });

  it('失败的条目不回填（不给出用不了的路径）', () => {
    const reading = readingWith([{ path: 'broken.pdf', kind: 'pdf' }]);
    const report = applyAssetsToReading(reading, manifest, () => '');
    expect(reading.manifest[0]?.asset).toBeUndefined();
    expect(report.assetsSet).toBe(0);
  });
});
