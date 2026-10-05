/**
 * 工具定义的形状与编排结果。
 *
 * 用假的 ctx 调真实 `apply()`，再把拿到的定义当真的用（`execute` 真跑）—— 这样测的是
 * **插件交付的那个东西**，不是一份复制品。工具定义写错在这里就暴露，不必先装进 DSH。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { apply } from '../index.ts';

const SAMPLE = resolve(import.meta.dirname, '../../scripts/analyzer/tests/fixtures/sample');

type ToolDefinition = {
  name: string;
  description: string;
  parameters: { required: string[]; properties: Record<string, unknown>; additionalProperties: boolean };
  output: { schema: Record<string, unknown>; render: (args: unknown, value: unknown) => { type: string; text: string }[] };
  timeoutMs?: number;
  execute: (args: Record<string, unknown>, exec: { signal: AbortSignal }) => Promise<Record<string, unknown>>;
};

let tool: ToolDefinition | undefined;
let registeredSkill: { name: string; description: string; content: string; source?: string } | undefined;
let source = '';

/**
 * 把文件的 mtime 设到 N 秒前。
 *
 * 评审是否作废靠 mtime 比较，而**测试不能靠「谁后写」制造时间差** —— 文件系统时间戳精度不够时，
 * 两次写入会落在同一毫秒，`review >= script` 直接判成「新」，用例就随机红（CI 上踩过）。
 */
function setMtimeAgo(path: string, seconds: number): void {
  const when = new Date(Date.now() - seconds * 1000);
  utimesSync(path, when, when);
}

/** 假 ctx：只提供插件用到的两个能力（工具注册表与 skill 注册表）。 */
function fakeContext(): { ctx: unknown; tool: () => ToolDefinition; skill: () => typeof registeredSkill } {
  let captured: ToolDefinition | undefined;
  let skill: { name: string; description: string; content: string; source?: string } | undefined;

  const ctx = {
    tools: {
      register: (definition: ToolDefinition) => {
        captured = definition;
        return () => undefined;
      },
    },
    get: (serviceName: string) =>
      serviceName === 'skills'
        ? {
            register: (definition: { name: string; description: string; content: string; source?: string }) => {
              skill = definition;
              return () => undefined;
            },
          }
        : undefined,
  };

  return {
    ctx,
    tool: () => {
      if (captured === undefined) throw new Error('apply() 没有注册工具');
      return captured;
    },
    skill: () => skill,
  };
}

beforeAll(() => {
  const fake = fakeContext();
  apply(fake.ctx as never);
  tool = fake.tool();
  registeredSkill = fake.skill();

  // 目标目录用夹具的副本：分析会往里写 .foldercast/，不污染仓库
  source = mkdtempSync(join(tmpdir(), 'foldercast-plugin-'));
  cpSync(SAMPLE, source, { recursive: true });
});

afterAll(() => {
  if (source !== '') rmSync(source, { recursive: true, force: true });
});

describe('注册的形状符合 DSH 的工具契约', () => {
  it('名字、描述与主动语态', () => {
    expect(tool?.name).toBe('foldercast_cast');
    expect(tool?.description).toMatch(/^[A-Z]/);
    expect(tool?.description.split(' ').length).toBeGreaterThanOrEqual(5);
  });

  it('只有一个必需参数：目录路径', () => {
    expect(tool?.parameters.required).toEqual(['path']);
    expect(Object.keys(tool?.parameters.properties ?? {}).sort()).toEqual(['path', 'skipAssets', 'skipRender', 'skipVoice', 'ttsProvider', 'ttsVoice']);
    expect(tool?.parameters.additionalProperties).toBe(false);
  });

  it('声明输出 schema 与 render（注册表强制要求）', () => {
    expect(typeof tool?.output.render).toBe('function');
    expect((tool?.output.schema as { type?: string }).type).toBe('object');
  });

  it('声明自己的时间预算', () => {
    expect(tool?.timeoutMs).toBeGreaterThan(0);
  });

  it('skill 已注册，名字是 kebab-case 且带描述', () => {
    expect(registeredSkill?.name).toBe('foldercast');
    expect(registeredSkill?.description.length).toBeGreaterThan(0);
    expect(registeredSkill?.content).toContain('foldercast_cast');
  });

  it('skill 带 source —— 注册表加载时会复查，缺了读取直接失败', () => {
    // 踩过一次：只给 name/description/content，读取报 `loaded skill "foldercast" source must be a string`
    expect(registeredSkill?.source).toBe('foldercast');
  });
});

describe('HTML 视图（M6）', () => {
  it('一次调用顺手把页面也生成出来，并报出落点与体积', async () => {
    const value = await tool?.execute({ path: source, skipAssets: true }, { signal: new AbortController().signal });

    const htmlPath = String(value?.htmlPath);
    expect(htmlPath.endsWith(join('.foldercast', 'out', 'index.html'))).toBe(true);
    expect(existsSync(htmlPath)).toBe(true);
    expect(value?.htmlBytes as number).toBeGreaterThan(2000);

    const html = readFileSync(htmlPath, 'utf8');
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/https?:\/\//);

    const stages = value?.stages as { html?: { ok: boolean } };
    expect(stages.html?.ok).toBe(true);
  });
});

describe('execute 真跑一遍（分析 + 跳过素材）', () => {
  it('返回结构化结果：读到解读，下一步是写讲稿', async () => {
    const value = await tool?.execute({ path: source, skipAssets: true }, { signal: new AbortController().signal });

    expect(value?.ok).toBe(true);
    expect(value?.next).toBe('needsScript');
    expect(value?.target).toBe(source);
    expect(value?.label).toBe(source.split('/').pop());

    const reading = value?.reading as { files: number; roots: string[]; secretsSkipped: { path: string }[] };
    expect(reading.files).toBeGreaterThan(0);
    expect(reading.roots).toContain('README.md');
    // 密钥类文件仍进清单与审计，但内容没被读
    expect(reading.secretsSkipped.map((hit) => hit.path)).toContain('.env');

    // 结果必须能过 JSON 序列化（注册表要求无损 JSON）
    expect(() => JSON.stringify(value)).not.toThrow();
  });

  it('没有讲稿时不跑校验，也不会把「没有讲稿」当成错误', async () => {
    const value = await tool?.execute({ path: source, skipAssets: true }, { signal: new AbortController().signal });
    const stages = value?.stages as Record<string, unknown>;
    expect(stages.validate).toBeUndefined();
    expect(stages.analyze).toBeDefined();
  });

  it('render 输出能读的几句话，且不空', async () => {
    const value = await tool?.execute({ path: source, skipAssets: true }, { signal: new AbortController().signal });
    const blocks = tool?.output.render({ path: source }, value);
    expect(blocks).toHaveLength(1);
    const text = blocks?.[0]?.text ?? '';
    expect(text).toContain('README.md');
    expect(text.length).toBeGreaterThan(40);
  });

  it('目录不存在时给出可操作的结论，而不是抛异常', async () => {
    const value = await tool?.execute({ path: join(tmpdir(), 'foldercast-does-not-exist') }, { signal: new AbortController().signal });
    expect(value?.ok).toBe(false);
    expect(value?.next).toBe('blocked');
    expect(String(value?.nextHint)).toContain('目录不存在');
  });

  it('取消后立刻返回，不留下跑着的子进程', async () => {
    const controller = new AbortController();
    controller.abort();
    const value = await tool?.execute({ path: source, skipAssets: true }, { signal: controller.signal });
    expect(value?.ok).toBe(false);
  });
});

describe('有讲稿时跑校验', () => {
  it('讲稿里有编造的路径时，报出 blocker 并给出位置', async () => {
    const workRoot = join(source, '.foldercast');
    const reading = JSON.parse(readFileSync(join(workRoot, 'foldercast.json'), 'utf8')) as {
      source: { root: string };
    };
    writeFileSync(
      join(workRoot, 'script.json'),
      `${JSON.stringify(
        {
          foldercast: 1,
          source: { root: reading.source.root },
          scenes: [
            { id: 'cover', type: 'cover', title: '封面', narration: '封面场景。' },
            { id: 'entry', type: 'file', title: '入口', narration: '这是入口。', file: 'src/does-not-exist.ts' },
            { id: 'outro', type: 'outro', title: '完', narration: '就这些。' },
          ],
        },
        null,
        2,
      )}\n`,
    );

    const value = await tool?.execute({ path: source, skipAssets: true }, { signal: new AbortController().signal });
    expect(value?.ok).toBe(false);
    expect(value?.next).toBe('fixScript');

    const validation = value?.validation as { blocker: number; issues: { code: string; line?: number; sceneId?: string }[] };
    expect(validation.blocker).toBeGreaterThan(0);
    const hallucinated = validation.issues.filter((issue) => issue.code === 'path-hallucinated');
    expect(hallucinated.length).toBeGreaterThan(0);
    expect(hallucinated[0]?.sceneId).toBe('entry');
    expect(hallucinated[0]?.line).toBeGreaterThan(0);
  });

  it('讲稿通过时进入 needsReview，并指出该把评审写到哪里', async () => {
    const workRoot = join(source, '.foldercast');
    const reading = JSON.parse(readFileSync(join(workRoot, 'foldercast.json'), 'utf8')) as {
      source: { root: string };
    };
    writeFileSync(
      join(workRoot, 'script.json'),
      `${JSON.stringify(
        {
          foldercast: 1,
          source: { root: reading.source.root },
          scenes: [
            { id: 'cover', type: 'cover', title: '封面', narration: '封面场景。' },
            { id: 'entry', type: 'file', title: '入口', narration: '这是入口。', file: 'src/index.ts' },
            { id: 'outro', type: 'outro', title: '完', narration: '就这些。' },
          ],
        },
        null,
        2,
      )}\n`,
    );

    const value = await tool?.execute({ path: source, skipAssets: true }, { signal: new AbortController().signal });
    expect(value?.ok).toBe(true);
    // 校验只管机器能判的，「有没有讲错重点」要靠评审（M5）—— 所以通过了也还不能算完成
    expect(value?.next).toBe('needsReview');
    expect(value?.review).toBe('missing');
    expect(value?.reviewPath).toBe(join(workRoot, 'review.md'));
    expect(String(value?.nextHint)).toContain('review.md');
    expect((value?.validation as { blocker: number }).blocker).toBe(0);
  });

  // 评审通过之后**默认就出片**（`foldercast_cast` 的 `render` 默认 true），所以这两条要
  // 真的起浏览器渲一遍。渲染夹具（3 个场景、约 30 秒片子）本机 5 秒左右，CI 上更慢，
  // 所以给足 4 分钟：这不是「慢测试」，这是**出片这条路径确实要跑一遍**。
  it('评审比讲稿新：validated（按 skipRender 只报状态，不出片）', async () => {
    const workRoot = join(source, '.foldercast');
    writeFileSync(join(workRoot, 'review.md'), '# 评审：通过\n');
    // 显式设 mtime：靠「谁后写」制造时间差，在文件系统时间戳精度粗的机器上会翻车（CI 上踩过：
    // 两次写入落在同一毫秒，`>=` 判成 fresh，这条用例就红了）
    setMtimeAgo(join(workRoot, 'script.json'), 60);
    setMtimeAgo(join(workRoot, 'review.md'), 1);

    const value = await tool?.execute(
      { path: source, skipAssets: true, skipRender: true },
      { signal: new AbortController().signal },
    );

    expect(value?.next).toBe('validated');
    expect(value?.review).toBe('fresh');
    expect((value?.stages as Record<string, unknown>).render).toBeUndefined();
  });

  it(
    '评审比讲稿新：默认出片（rendered，成片落在 out/video.mp4）',
    { timeout: 240_000 },
    async () => {
      const workRoot = join(source, '.foldercast');
      writeFileSync(join(workRoot, 'review.md'), '# 评审：通过\n');
      setMtimeAgo(join(workRoot, 'script.json'), 60);
      setMtimeAgo(join(workRoot, 'review.md'), 1);

      const value = await tool?.execute({ path: source, skipAssets: true }, { signal: new AbortController().signal });

      const videoPath = join(workRoot, 'out', 'video.mp4');
      const render = (value?.stages as Record<string, { ok?: boolean }>).render;

      if (value?.next === 'rendered') {
        expect(existsSync(videoPath)).toBe(true);
        expect(statSync(videoPath).size).toBeGreaterThan(20_000);
        expect(value?.videoPath).toBe(videoPath);
        expect(value?.video).toBe('fresh');
        expect(render?.ok).toBe(true);

        // 再调一次**不许重渲**：成片比讲稿新，直接报现状（渲染是最贵的一步）
        const again = await tool?.execute({ path: source, skipAssets: true }, { signal: new AbortController().signal });
        expect(again?.next).toBe('rendered');
        expect((again?.stages as Record<string, unknown>).render).toBeUndefined();
        expect(Number(again?.videoBytes)).toBe(statSync(videoPath).size);
        return;
      }

      // 没有浏览器（或没有 ffmpeg，所以配音那一步被跳过）的机器：**必须**给出结构化说明，
      // 而不是一句失败。这两条分支在 CI 上是有意义的覆盖，不是「跳过」。
      expect(value?.next).toBe('blocked');
      expect(String(value?.nextHint)).toContain('渲染需要浏览器');
      expect(String(value?.nextHint)).toContain('remotion browser ensure');
    },
  );

  it('评审比讲稿旧：当作没审（讲稿改了，旧结论作废）', async () => {
    const workRoot = join(source, '.foldercast');
    // 先写评审、再改讲稿 —— 讲稿更新，评审作废
    writeFileSync(join(workRoot, 'review.md'), '# 评审：通过（针对上一版）\n');
    const script = JSON.parse(readFileSync(join(workRoot, 'script.json'), 'utf8')) as Record<string, unknown>;
    writeFileSync(join(workRoot, 'script.json'), `${JSON.stringify(script, null, 2)}\n`);
    setMtimeAgo(join(workRoot, 'review.md'), 60);
    setMtimeAgo(join(workRoot, 'script.json'), 1);

    const value = await tool?.execute({ path: source, skipAssets: true }, { signal: new AbortController().signal });

    expect(value?.next).toBe('needsReview');
    expect(value?.review).toBe('stale');
    expect(String(value?.nextHint)).toContain('作废');
  });
});
