/**
 * 测试共用的讲稿夹具：覆盖全部八种场景，且**过得了契约校验**（端到端用例直接拿它跑
 * 真入口，字段形状错了验的就不是页面而是校验器）。
 *
 * 引用的文件路径由调用方负责落盘（端到端用例会真的造出它们）。
 */
import type { ScriptDocument } from '../../contracts/script.ts';

export function fullScript(root: string): ScriptDocument {
  return {
    foldercast: 2,
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
        narration: '代码在 src，文档在 docs，根目录还有一点配置。',
        beats: [{ points: ['src 是主体，九个文件', 'docs 三份文档，占了大头体积'], enter: 'reveal' }],
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
        narration: '十四个文件里，代码占了大半，文档其次。',
        beats: [
          { points: ['代码 9 · 文档 3 · 图片 2', '以 TypeScript 为主'], enter: 'reveal' },
          { graphic: 'proportion', enter: 'grow' },
        ],
      },
      {
        id: 'entry',
        type: 'file',
        title: '渲染入口',
        file: 'src/main.ts',
        note: 'TypeScript · 约 40 行',
        excerpt: ['export const main = () => {', '  const plan = buildPlan(root);', '  const page = renderPage(plan);', '  writeFileSync(out, page);', '  return 0;', '}'],
        narration: '入口只有四十行上下。它把构建计划、页面渲染与写盘这三步串成一条线，没有全局状态。',
        beats: [{ points: ['buildPlan → renderPage → 写盘', '纯函数串联，无全局状态'], enter: 'slide' }],
      },
      {
        id: 'shot',
        type: 'file',
        title: '架构图',
        file: 'assets/architecture.png',
        note: 'PNG · 分层示意',
        narration: '一张架构图，画出分层关系。',
        beats: [{ points: ['自上而下：入口 → 渲染 → 产物'], enter: 'fade' }],
      },
      {
        id: 'shots',
        type: 'gallery',
        title: '截图',
        items: ['assets/architecture.png', 'assets/ui.png', 'assets/demo.mp4'],
        narration: '几张截图，架构、界面与演示。',
        beats: [{ points: ['assets 下三份素材', '其中 demo.mp4 用视频封面'], enter: 'reveal' }],
      },
      {
        id: 'tour',
        type: 'clip',
        title: '演示',
        source: 'assets/demo.mp4',
        clipRange: [12, 18.5],
        narration: '演示片段，十二秒到十八秒半。',
        beats: [{ points: ['画面用封面，不播活动画面', '区间来自讲稿的 clipRange'], enter: 'fade' }],
      },
      {
        id: 'spec',
        type: 'document',
        title: '规格',
        source: 'docs/spec.pdf',
        pages: [2, 4],
        narration: '规格文档，翻第二和第四页。',
        beats: [{ points: ['LibreOffice 转页图', '页码与 Word 分页可能不同'], enter: 'reveal' }],
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
