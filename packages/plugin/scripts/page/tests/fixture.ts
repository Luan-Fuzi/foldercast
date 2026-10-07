/**
 * 测试共用的讲稿夹具：覆盖全部八种场景，且**过得了契约校验**（端到端用例直接拿它跑
 * 真入口，字段形状错了验的就不是页面而是校验器）。
 *
 * 引用的文件路径由调用方负责落盘（端到端用例会真的造出它们）。
 */
import type { ScriptDocument } from '../../contracts/script.ts';

export function fullScript(root: string): ScriptDocument {
  return {
    foldercast: 1,
    source: { root, label: '示例目录' },
    title: '示例目录 · 导览',
    video: { width: 1920, height: 1080, fps: 30 },
    scenes: [
      {
        id: 'cover',
        type: 'cover',
        title: '示例目录',
        subtitle: '一份夹具',
        narration: '这是示例目录的导览页夹具。',
      },
      {
        id: 'layout',
        type: 'tree',
        title: '结构',
        entries: [
          { path: 'src', files: 9, bytes: 40000, highlight: true },
          { path: 'docs', files: 3, bytes: 180000 },
          { path: '(根目录)', files: 3 },
        ],
        narration: '代码在 src，文档在 docs。',
      },
      {
        id: 'kinds',
        type: 'inventory',
        title: '构成',
        groups: [
          { label: '代码', count: 9, note: 'TypeScript 为主' },
          { label: '文档', count: 3 },
          { label: '图片', count: 2 },
        ],
        narration: '代码占了大半。',
      },
      {
        id: 'entry',
        type: 'file',
        title: '渲染入口',
        file: 'src/main.ts',
        note: 'TypeScript · 约 40 行',
        excerpt: ['export const main = () => {', '  return 0;', '}'],
        narration: '入口在这里。',
      },
      {
        id: 'shot',
        type: 'file',
        file: 'assets/architecture.png',
        narration: '一张架构图。',
      },
      {
        id: 'shots',
        type: 'gallery',
        title: '截图',
        items: ['assets/architecture.png', 'assets/ui.png', 'assets/demo.mp4'],
        narration: '几张截图。',
      },
      {
        id: 'tour',
        type: 'clip',
        title: '演示',
        source: 'assets/demo.mp4',
        clipRange: [12, 18.5],
        narration: '演示片段。',
      },
      {
        id: 'spec',
        type: 'document',
        title: '规格',
        source: 'docs/spec.pdf',
        pages: [2, 4],
        narration: '规格文档。',
      },
      {
        id: 'outro',
        type: 'outro',
        title: '小结',
        subtitle: '就这些',
        lines: ['结构：src + docs', '构成：代码 · 文档 · 图片'],
        narration: '就这些，谢谢观看。',
      },
    ],
  };
}

/** 1×1 透明 PNG 的字节。端到端用例在没有 ffmpeg 的机器上也能造一张「真的图片」。 */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
