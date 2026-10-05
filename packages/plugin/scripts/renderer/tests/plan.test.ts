/**
 * 渲染计划：讲稿 + 解读 + 素材 → 浏览器要的那份纯数据。
 *
 * 这是 M7 里唯一「可以完全离线断言」的一层，所以判据都钉在这里：
 *
 * 1. **讲稿里的路径必须变成画面上的东西**：`file` 场景拿到素材、`items` 拿到图片墙、
 *    `pages` 拿到逐页图；解不开的素材变成一条 `warning` 而不是崩溃。
 * 2. **不认识的场景类型跳过并警告**（schema 说它是开放枚举）。
 * 3. **时长来自 `video`**，`targetDurationSec` 是软约束：写了就按比例缩放。
 * 4. **计划里没有时钟**：两次构建逐字段相同（有 `generatedAt` 之类的字段就会破坏逐帧一致）。
 */
import { describe, expect, it } from 'vitest';
import { buildPlan } from '../plan.ts';
import type { AssetManifest } from '../../contracts/assets.ts';
import type { FoldercastDocument } from '../../contracts/foldercast.ts';
import type { ScriptDocument } from '../../contracts/script.ts';

function reading(over: Partial<FoldercastDocument> = {}): FoldercastDocument {
  return {
    foldercast: 1,
    generatedAt: '2026-10-05T00:00:00.000Z',
    source: { root: '/tmp/demo' },
    sources: { maxFiles: 500, maxDepth: 6, exclude: ['node_modules/**'] },
    stats: {
      totalFiles: 4,
      totalBytes: 4096,
      maxDepth: 2,
      kindCounts: { code: 2, text: 1, image: 1 },
      languages: { TypeScript: 120 },
      topDirs: [{ path: 'src', files: 3 }],
      roles: { entry: ['src/index.ts'], readme: ['README.md'] },
      secrets: { excluded: [{ path: '.env', match: '.env' }], rescanned: [] },
    },
    manifest: [
      { path: 'README.md', kind: 'text', bytes: 900, lines: 20, title: '说明', preview: '这个项目做一件事。' },
      { path: 'src/index.ts', kind: 'code', role: 'entry', bytes: 300, lines: 12, language: 'TypeScript', importsCount: 1, importedByCount: 12 },
      { path: 'src/util.ts', kind: 'code', bytes: 200, lines: 8, language: 'TypeScript' },
      { path: 'docs/graph.png', kind: 'image', bytes: 1024 },
    ],
    graph: { nodes: 4, edges: 1, roots: ['src/index.ts'], hubs: [{ path: 'src/index.ts', in: 12 }], leaves: [], dangling: [] },
    ...over,
  };
}

function assets(): AssetManifest {
  return {
    assets: 1,
    generatedAt: '2026-10-05T00:00:00.000Z',
    source: { root: '/tmp/demo' },
    entries: [
      {
        path: 'src/index.ts',
        kind: 'code',
        mtimeMs: 1,
        size: 300,
        hash: 'sha256:aa',
        products: [{ role: 'code', path: 'assets/code/src_index.ts.svg' }],
      },
      {
        path: 'docs/graph.png',
        kind: 'image',
        mtimeMs: 2,
        size: 1024,
        hash: 'sha256:bb',
        products: [{ role: 'thumb', path: 'assets/thumbs/docs_graph.png.png', width: 640, height: 360 }],
      },
    ],
  };
}

function script(over: Partial<ScriptDocument> = {}): ScriptDocument {
  return {
    foldercast: 1,
    source: { root: '/tmp/demo' },
    title: '演示目录',
    scenes: [
      { id: 'cover', type: 'cover', title: '演示目录', subtitle: '一句话说明', narration: '这是封面，交代目录是什么。' },
      { id: 'layout', type: 'tree', title: '结构', highlight: ['src', 'docs'], narration: '结构分三块。' },
      { id: 'kinds', type: 'inventory', title: '构成', groups: [{ kind: 'code', count: 2, note: '两个源文件' }, { kind: 'text', count: 1 }], narration: '内容以代码为主。' },
      { id: 'entry', type: 'file', title: '入口', file: 'src/index.ts', asset: 'assets/code/src_index.ts.svg', focusLines: [1, 8], narration: '这是入口，被引用十二次。' },
      { id: 'figures', type: 'gallery', title: '图', items: ['assets/thumbs/docs_graph.png.png'], narration: '这里有一张图。' },
      { id: 'outro', type: 'outro', title: '小结', narration: '就这些。' },
    ],
    ...over,
  };
}

describe('计划构建', () => {
  it('把六种场景都变成可渲染的形状', () => {
    const plan = buildPlan({ script: script(), reading: reading(), assets: assets() });
    expect(plan.scenes.map((scene) => scene.type)).toEqual(['cover', 'tree', 'inventory', 'file', 'gallery', 'outro']);
    expect(plan.composition.durationInFrames).toBeGreaterThan(0);
    expect(plan.scenes.reduce((sum, scene) => sum + scene.durationInFrames, 0)).toBe(plan.composition.durationInFrames);
    expect(plan.css['--accent']).toBeTypeOf('string');
  });

  it('file 场景拿到素材，gallery 拿到图片尺寸', () => {
    const plan = buildPlan({ script: script(), reading: reading(), assets: assets() });
    const file = plan.scenes.find((scene) => scene.type === 'file');
    const gallery = plan.scenes.find((scene) => scene.type === 'gallery');

    expect(file?.type === 'file' && file.media?.path).toBe('assets/code/src_index.ts.svg');
    expect(file?.type === 'file' && file.media?.file).toBe('src/index.ts');
    expect(file?.type === 'file' && file.code?.focusLines).toEqual([1, 8]);
    expect(gallery?.type === 'gallery' && gallery.items[0]?.width).toBe(640);
  });

  it('没有素材时不崩：给一条可操作的提醒，画面照出', () => {
    const plan = buildPlan({
      script: script({
        scenes: [{ id: 'entry', type: 'file', title: '入口', file: 'src/util.ts', narration: '这个文件没有素材。' }],
      }),
      reading: reading(),
    });
    const file = plan.scenes[0];
    expect(file?.type === 'file' && file.media).toBeUndefined();
    expect(plan.warnings.some((warning) => warning.includes('src/util.ts'))).toBe(true);
  });

  it('不认识的场景类型跳过并警告，其余照常渲染', () => {
    const plan = buildPlan({
      script: script({
        scenes: [
          { id: 'cover', type: 'cover', title: '封面', narration: '开头。' },
          { id: 'weird', type: 'timeline' as never, narration: '未来才有的类型。' },
          { id: 'outro', type: 'outro', title: '完', narration: '结尾。' },
        ],
      }),
      reading: reading(),
    });
    expect(plan.scenes.map((scene) => scene.id)).toEqual(['cover', 'outro']);
    expect(plan.warnings.some((warning) => warning.includes('timeline'))).toBe(true);
  });

  it('全部场景都不认识时明确报错，而不是渲染一个空片', () => {
    expect(() =>
      buildPlan({
        script: script({ scenes: [{ id: 'x', type: 'nope' as never, narration: '空。' }] }),
        reading: reading(),
      }),
    ).toThrow(/没有可渲染的场景/);
  });

  it('video 规格进 plan，targetDurationSec 按比例缩放', () => {
    const plan = buildPlan({
      script: script({ video: { width: 1280, height: 720, fps: 24, targetDurationSec: 60 } }),
      reading: reading(),
      assets: assets(),
    });
    expect(plan.composition.width).toBe(1280);
    expect(plan.composition.height).toBe(720);
    expect(plan.composition.fps).toBe(24);
    expect(plan.composition.durationInFrames).toBe(60 * 24);
  });

  it('讲稿没写 video 时用 1920×1080 / 30fps', () => {
    const plan = buildPlan({ script: script(), reading: reading(), assets: assets() });
    expect(plan.composition).toMatchObject({ width: 1920, height: 1080, fps: 30 });
  });

  it('样式预设：预设进 token，覆盖生效，认不出的键报警告', () => {
    const plan = buildPlan({
      script: script({ style: { preset: 'deck', overrides: { 'palette.accent': '#FF0000', 'nosuch.key': 1 } } }),
      reading: reading(),
      assets: assets(),
      preset: { name: 'deck', palette: { accent: '#4D9EFF', bg: '#0F1420' } },
      presetName: 'deck',
    });
    expect(plan.tokens.accent).toBe('#FF0000');
    expect(plan.css['--accent']).toBe('#FF0000');
    expect(plan.warnings.some((warning) => warning.includes('nosuch.key'))).toBe(true);
  });

  it('没有预设文件时用兜底 token，照常出片', () => {
    const plan = buildPlan({ script: script(), reading: reading(), assets: assets(), presetName: 'deck' });
    expect(plan.tokens.bg).toBeTruthy();
    expect(plan.warnings.some((warning) => warning.includes('兜底'))).toBe(true);
  });

  it('确定性：两次构建逐字段相同', () => {
    const first = buildPlan({ script: script(), reading: reading(), assets: assets() });
    const second = buildPlan({ script: script(), reading: reading(), assets: assets() });
    expect(second).toEqual(first);
  });

  it('内联函数被调用在每件图片素材上，且 src 落进计划', () => {
    const calls: string[] = [];
    const plan = buildPlan({
      script: script(),
      reading: reading(),
      assets: assets(),
      workRoot: '/tmp/demo/.foldercast',
      embed: (target) => {
        calls.push(target.path);
        return { src: `data:image/png;base64,AAAA`, bytes: 3, scaled: true };
      },
    });
    expect(calls.sort()).toEqual(['assets/code/src_index.ts.svg', 'assets/thumbs/docs_graph.png.png']);
    const gallery = plan.scenes.find((scene) => scene.type === 'gallery');
    expect(gallery?.type === 'gallery' && gallery.items[0]?.src).toContain('data:image/png');
    expect(gallery?.type === 'gallery' && gallery.items[0]?.inlineBytes).toBe(3);
  });

  it('没有内联函数时只留路径（浏览器那一侧会落到占位说明）', () => {
    const plan = buildPlan({ script: script(), reading: reading(), assets: assets() });
    const gallery = plan.scenes.find((scene) => scene.type === 'gallery');
    expect(gallery?.type === 'gallery' && gallery.items[0]?.src).toBeUndefined();
  });

  it('讲稿写的素材路径（素材清单里没有）照样引用', () => {
    const plan = buildPlan({
      script: script({
        scenes: [{ id: 'figures', type: 'gallery', title: '图', items: ['assets/thumbs/other.png'], narration: '一张图。' }],
      }),
      reading: reading(),
    });
    const gallery = plan.scenes[0];
    expect(gallery?.type === 'gallery' && gallery.items[0]?.path).toBe('assets/thumbs/other.png');
  });

  it('clip 场景拿到封面图与片段区间（画面不播活动画面）', () => {
    const plan = buildPlan({
      script: script({
        scenes: [
          {
            id: 'clip',
            type: 'clip',
            title: '片段',
            source: 'demo.mp4',
            poster: 'assets/posters/demo.mp4.jpg',
            clipRange: [0, 2],
            narration: '这是一段测试片段。',
          },
        ],
      }),
      reading: reading(),
      assets: {
        assets: 1,
        generatedAt: '2026-10-05T00:00:00.000Z',
        source: { root: '/tmp/demo' },
        entries: [
          {
            path: 'demo.mp4',
            kind: 'video',
            mtimeMs: 3,
            size: 40_000,
            hash: 'sha256:cc',
            products: [
              { role: 'poster', path: 'assets/posters/demo.mp4.jpg', width: 640, height: 360 },
              { role: 'frame', path: 'assets/frames/demo_f2.jpg' },
            ],
          },
        ],
      },
    });
    const scene = plan.scenes[0];
    // 主产物是封面图（poster 在 file 场景的偏好顺序里排在 frame 前面），视频路径本身进不了画面
    expect(scene?.type === 'clip' && scene.video.path).toBe('assets/posters/demo.mp4.jpg');
    expect(scene?.type === 'clip' && scene.video.file).toBe('demo.mp4');
    expect(scene?.type === 'clip' && scene.range).toEqual([0, 2]);
    // 唯一的提醒应当只是「没给预设」，而不是「没有素材」
    expect(plan.warnings.filter((warning) => warning.includes('素材'))).toEqual([]);
  });

  it('document 场景逐页取图，页数写进页脚', () => {
    const plan = buildPlan({
      script: script({
        scenes: [
          {
            id: 'doc',
            type: 'document',
            title: '文档',
            source: 'docs/graph.png',
            pages: ['assets/pages/doc_p1.png', 'assets/pages/doc_p2.png'],
            narration: '这份文档两页。',
          },
        ],
      }),
      reading: reading(),
    });
    const scene = plan.scenes[0];
    expect(scene?.type === 'document' && scene.pages).toHaveLength(2);
    expect(scene?.type === 'document' && scene.footer).toBe('2 页');
  });

  it('场景没写 title 时按类型给一个，不留空标题栏', () => {
    const plan = buildPlan({
      script: script({
        scenes: [{ id: 'entry', type: 'file', file: 'src/util.ts', narration: '这个文件没写标题。' }],
      }),
      reading: reading(),
    });
    expect(plan.scenes[0]?.title).toBe('util.ts');
  });

  it('outro 的片长与文件数来自计划本身', () => {
    const plan = buildPlan({ script: script(), reading: reading(), assets: assets() });
    const outro = plan.scenes.find((scene) => scene.type === 'outro');
    expect(outro?.type === 'outro' && outro.facts.map((fact) => fact.label)).toEqual(['场景', '片长', '文件']);
    expect(outro?.type === 'outro' && outro.facts[2]?.value).toBe('4 个');
  });
});
