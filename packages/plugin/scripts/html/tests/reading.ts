/**
 * 测试用的合成解读。
 *
 * 用合成数据而不是夹具，是因为 HTML 这一层要覆盖的是**形状**：深度嵌套、坏路径、密钥、
 * 环、超长图。夹具里恰好没有这些东西。
 */
import type { FoldercastDocument, ManifestEntry } from '../../contracts/foldercast.ts';
import type { AssetManifest } from '../../contracts/assets.ts';

/** 造一条 manifest 记录，只给关心的字段。 */
export function entry(path: string, extra: Partial<ManifestEntry> = {}): ManifestEntry {
  const cut = path.lastIndexOf('/');
  return {
    path,
    kind: path.endsWith('.json') ? 'data' : path.endsWith('.wav') ? 'audio' : path.endsWith('.ts') ? 'code' : 'text',
    bytes: 100,
    ...(cut === -1 ? {} : {}),
    ...extra,
  };
}

export function reading(overrides: Partial<FoldercastDocument> = {}): FoldercastDocument {
  const manifest: ManifestEntry[] = [
    entry('README.md', { role: 'readme', preview: '目录说明', lines: 10 }),
    entry('src/index.ts', { role: 'entry', imports: ['src/util.ts', 'src/missing.ts'], importsCount: 2 }),
    entry('src/util.ts', { importedBy: ['src/index.ts'], importedByCount: 1, preview: '工具函数' }),
    entry('.env', { kind: 'other' }),
    entry('public/clip.wav', { role: 'asset' }),
  ];

  return {
    foldercast: 1,
    generatedAt: '2026-10-05T00:00:00+08:00',
    source: { root: '/tmp/sample', label: 'sample' },
    sources: { maxFiles: 200, exclude: ['.git/**', 'node_modules/**'], maxDepth: 6 },
    stats: {
      totalFiles: manifest.length,
      totalBytes: 500,
      maxDepth: 2,
      kindCounts: { code: 2, text: 1, audio: 1, other: 1 },
      languages: { TypeScript: 20, Markdown: 10 },
      topDirs: [
        { path: 'src', files: 2 },
        { path: 'public', files: 1 },
      ],
      roles: { readme: ['README.md'], entry: ['src/index.ts'], asset: ['public/clip.wav'] },
      secrets: { excluded: [{ path: '.env', match: '.env' }], rescanned: [] },
    },
    graph: {
      nodes: manifest.length,
      edges: 2,
      roots: ['README.md', 'src/index.ts'],
      hubs: [{ path: 'src/util.ts', in: 1, out: 0 }],
      leaves: ['src/util.ts'],
      dangling: ['src/missing.ts'],
    },
    manifest,
    ...overrides,
  };
}

/** 素材清单：只给 `src/index.ts` 一张代码高亮图，用来验内联与卡片过滤。 */
export function assets(): AssetManifest {
  return {
    assets: 1,
    generatedAt: '2026-10-05T00:00:00+08:00',
    source: { root: '/tmp/sample' },
    entries: [
      {
        path: 'src/index.ts',
        kind: 'code',
        mtimeMs: 0,
        size: 100,
        hash: 'sha256:0',
        products: [{ role: 'code', path: 'assets/code/src_index.ts.svg' }],
      },
    ],
  } as AssetManifest;
}
