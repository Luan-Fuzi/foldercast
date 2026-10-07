/**
 * 端到端：真目录、真 `script.json`、真图片 → `node main.ts` 子进程 → 断言产物页面。
 *
 * 与渲染器/配音的端到端同一手法：入口当黑盒跑，页面当字符串验。夹具图片不往仓库塞
 * 二进制 —— 没有外部工具的机器上用一段内嵌的 1×1 PNG；有 ffmpeg 时再造一张真的大图，
 * 顺带验证「缩小后内联成 JPEG」这条真链路（sips / ffmpeg 至少有一个时才跑那条）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { hasCommand } from '../../assets/run.ts';
import { pickScaler, resetScalerCache } from '../../renderer/embed-node.ts';
import { checkScript } from '../../renderer/check.ts';
import { fullScript, TINY_PNG } from './fixture.ts';

const PAGE_MAIN = resolve(import.meta.dirname, '../main.ts');
const hasFfmpeg = hasCommand('ffmpeg');
/** 缩图工具探测会缓存，先重置再取（同一个进程里别的用例可能已经探测过）。 */
resetScalerCache();
const scaler = pickScaler();

let root = '';
let workRoot = '';

function runPage(args: readonly string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('node', [PAGE_MAIN, ...args], { encoding: 'utf8', timeout: 120_000 });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** 一张高细节的 PNG（1920×1080 测试卡）：缩到 560 后仍是几十 KB 的 JPEG。 */
function makeDetailPng(path: string): void {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080', '-frames:v', '1', path]);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'foldercast-page-'));
  workRoot = join(root, '.foldercast');
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'assets'), { recursive: true });
  mkdirSync(join(root, 'docs'), { recursive: true });
  mkdirSync(workRoot, { recursive: true });

  writeFileSync(join(root, 'src', 'main.ts'), 'export const main = () => 0;\n');
  writeFileSync(join(root, 'assets', 'architecture.png'), TINY_PNG);
  writeFileSync(join(root, 'assets', 'ui.png'), TINY_PNG);
  // mp4 / pdf 在页面阶段只出卡片，内容从不读 —— 占位字节就够（存在性由校验器查）
  writeFileSync(join(root, 'assets', 'demo.mp4'), 'placeholder, page stage never reads it');
  writeFileSync(join(root, 'docs', 'spec.pdf'), 'placeholder, page stage never reads it');

  writeFileSync(join(workRoot, 'script.json'), `${JSON.stringify(fullScript(root), null, 2)}\n`);
});

afterAll(() => {
  if (root !== '') rmSync(root, { recursive: true, force: true });
});

describe('夹具', () => {
  it('夹具讲稿必须过契约校验（否则验的不是真讲稿）', async () => {
    const script = JSON.parse(readFileSync(join(workRoot, 'script.json'), 'utf8')) as Parameters<typeof checkScript>[0];
    const report = await checkScript(script, root);
    expect(report.issues, JSON.stringify(report.issues, null, 2)).toEqual([]);
  });
});

describe('默认渲染', () => {
  let html = '';

  it('入口退出码 0，报告落在默认输出路径', () => {
    const result = runPage([root, '--json']);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as { ok: boolean; outputPath: string; style: string; sections: number; references: number; imagesInlined: number };
    expect(report.ok).toBe(true);
    expect(report.style).toBe('素稿');
    expect(report.sections).toBe(9);
    expect(report.references).toBe(5);
    expect(report.imagesInlined).toBeGreaterThan(0);
    expect(report.outputPath).toBe(join(workRoot, 'out', 'page.html'));
    expect(existsSync(report.outputPath)).toBe(true);
    html = readFileSync(report.outputPath, 'utf8');
  });

  it('页面自包含：无 <script>、无外部资源引用', () => {
    expect(html).not.toMatch(/<script[\s>]/i);
    expect(html).not.toMatch(/(?:src|href)\s*=\s*["']\s*(?:https?:)?\/\//i);
    expect(html).not.toMatch(/@import/i);
  });

  it('图片内联成 data URI（缩图工具在则是缩小后的 JPEG）', () => {
    expect(html).toMatch(/data:image\/(?:jpeg|png);base64,/);
  });

  it('页脚交代来源与引用清单；视频/文档引用只出卡片', () => {
    expect(html).toContain('本页由讲稿');
    expect(html).toContain('.foldercast/script.json');
    expect(html).toContain('引用的文件（5）');
    expect(html).toContain('assets/demo.mp4');
    expect(html).toContain('本阶段不转封面');
    expect(html).toContain('翻第 2、4 页');
  });
});

describe.skipIf(scaler === 'none')('真实缩放链路（需要 sips 或 ffmpeg）', () => {
  it.skipIf(!hasFfmpeg)('大图缩到页面尺寸后以 JPEG 内联，mime 跟实际字节走', () => {
    makeDetailPng(join(root, 'assets', 'big.png'));
    const script = JSON.parse(readFileSync(join(workRoot, 'script.json'), 'utf8')) as ReturnType<typeof fullScript>;
    script.scenes.push({ id: 'big', type: 'gallery', title: '大图', items: ['assets/big.png'], narration: '一张大图。' });
    writeFileSync(join(workRoot, 'script.json'), `${JSON.stringify(script, null, 2)}\n`);

    const result = runPage([root, '--json']);
    expect(result.status).toBe(0);
    const html = readFileSync(join(workRoot, 'out', 'page.html'), 'utf8');
    // 源是 PNG，内联的必须是 JPEG：缩放产物是 JPEG，data URI 的 mime 跟字节走
    const match = /data:image\/jpeg;base64,([A-Za-z0-9+/=]+)/.exec(html);
    expect(match).not.toBeNull();
    const bytes = Buffer.from(match?.[1] ?? '', 'base64');
    // JPEG 魔数 FF D8 FF —— 声明与字节一致
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    // 缩过之后远小于原图（testsrc2 的 1920×1080 PNG 约 30 KB，560 的 JPEG 应当更小）
    expect(bytes.length).toBeLessThan(readFileSync(join(root, 'assets', 'big.png')).length + 20 * 1024);
  });
});

describe('CLI 边界', () => {
  it('--style 杂志 生效；--out 指到别处也落盘', () => {
    const custom = join(root, 'custom', 'intro.html');
    const result = runPage([root, '--style', '杂志', '--out', custom, '--json']);
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as { style: string; outputPath: string };
    expect(report.style).toBe('杂志');
    expect(report.outputPath).toBe(custom);
    const html = readFileSync(custom, 'utf8');
    expect(html).toContain('Songti SC');
  });

  it('不认识的风格 → 退出码 2，报错列出可用名单', () => {
    const result = runPage([root, '--style', '不存在']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('不认识的风格');
    expect(result.stderr).toContain('素稿 / 杂志 / 夜幕');
  });

  it('讲稿引用了不存在的文件 → 退出码 2（契约校验拦住，不生成页面）', () => {
    const script = JSON.parse(readFileSync(join(workRoot, 'script.json'), 'utf8')) as ReturnType<typeof fullScript>;
    script.scenes.push({ id: 'ghost', type: 'file', title: '幽灵', file: 'does/not/exist.ts', narration: '引用不存在。' });
    const broken = mkdtempSync(join(tmpdir(), 'foldercast-page-broken-'));
    try {
      mkdirSync(join(broken, '.foldercast'), { recursive: true });
      writeFileSync(join(broken, '.foldercast', 'script.json'), `${JSON.stringify(script, null, 2)}\n`);
      const result = runPage([broken]);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('引用的文件不存在');
      expect(existsSync(join(broken, '.foldercast', 'out', 'page.html'))).toBe(false);
    } finally {
      rmSync(broken, { recursive: true, force: true });
    }
  });

  it('缺少目录参数 → 退出码 2', () => {
    const result = runPage([]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('缺少目录参数');
  });
});
