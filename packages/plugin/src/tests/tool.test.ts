/**
 * 工具定义的形状与编排结果。
 *
 * 用假的 ctx 调真实 `apply()`，再把拿到的定义当真的用（`execute` 真跑）—— 这样测的是
 * **插件交付的那个东西**，不是一份复制品。工具定义写错在这里就暴露，不必先装进 DSH。
 *
 * MVP 之后的判据：
 * 1. **默认不出片、不配音**：不传 `render` / `voice` 时，这两步一次也不跑。
 * 2. **报事实**：`artifacts` 说清磁盘上有什么、各自什么状态；`ran` 说清这次跑了什么。
 * 3. 结果里**没有「下一步做什么」** —— 那是 skill 与模型的判断。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { apply } from '../index.ts';

const SAMPLE = resolve(import.meta.dirname, '../../scripts/analyzer/tests/fixtures/sample');

type Artifact = { name: string; path: string; state: string; bytes?: number };

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
 * 评审与成片是否作废靠 mtime 比较，而**测试不能靠「谁后写」制造时间差** —— 文件系统时间戳精度
 * 不够时，两次写入会落在同一毫秒，`>=` 直接判成「新」，用例就随机红（CI 上踩过）。
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

/** 写一份合法讲稿。`entry` 传一个不存在的路径就制造 blocker。 */
function writeScript(entryPath: string): void {
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
          { id: 'entry', type: 'file', title: '入口', narration: '这是入口。', file: entryPath },
          { id: 'outro', type: 'outro', title: '完', narration: '就这些。' },
        ],
      },
      null,
      2,
    )}\n`,
  );
}

function artifactsOf(value: Record<string, unknown> | undefined): Map<string, Artifact> {
  const list = (value?.artifacts ?? []) as Artifact[];
  return new Map(list.map((artifact) => [artifact.name, artifact]));
}

describe('注册的形状符合 DSH 的工具契约', () => {
  it('名字、描述与主动语态', () => {
    expect(tool?.name).toBe('foldercast_cast');
    expect(tool?.description).toMatch(/^[A-Z]/);
    expect(tool?.description.split(' ').length).toBeGreaterThanOrEqual(5);
  });

  it('参数只有目录路径与三个开关', () => {
    expect(tool?.parameters.required).toEqual(['path']);
    expect(Object.keys(tool?.parameters.properties ?? {}).sort()).toEqual([
      'path',
      'render',
      'skipAssets',
      'ttsProvider',
      'ttsVoice',
      'voice',
    ]);
    expect(tool?.parameters.additionalProperties).toBe(false);
  });

  it('声明输出 schema 与 render（注册表强制要求）', () => {
    expect(typeof tool?.output.render).toBe('function');
    expect((tool?.output.schema as { type?: string }).type).toBe('object');
    // 「下一步做什么」不该出现在输出契约里
    const properties = (tool?.output.schema as { properties?: Record<string, unknown> }).properties ?? {};
    expect(Object.keys(properties)).not.toContain('next');
    expect(Object.keys(properties)).toContain('artifacts');
  });

  it('声明自己的时间预算', () => {
    expect(tool?.timeoutMs).toBeGreaterThan(0);
  });

  it('skill 已注册，名字是 kebab-case 且带描述与 source', () => {
    expect(registeredSkill?.name).toBe('foldercast');
    expect(registeredSkill?.description.length).toBeGreaterThan(0);
    expect(registeredSkill?.content).toContain('foldercast_cast');
    // 踩过一次：只给 name/description/content，读取报 `loaded skill "foldercast" source must be a string`
    expect(registeredSkill?.source).toBe('foldercast');
  });
});

describe('execute 真跑一遍（分析 + 跳过素材）', () => {
  it('返回解读与产物清单，且默认不出片、不配音', async () => {
    const value = await tool?.execute({ path: source, skipAssets: true }, { signal: new AbortController().signal });

    expect(value?.ok).toBe(true);
    expect(value?.target).toBe(source);
    expect(value?.label).toBe(source.split('/').pop());
    expect(value?.ran).toEqual(['analyze']);

    const stages = value?.stages as Record<string, unknown>;
    expect(stages.render).toBeUndefined();
    expect(stages.voice).toBeUndefined();

    const reading = value?.reading as { files: number; secretsSkipped: { path: string }[]; droppedByMaxFiles: number };
    expect(reading.files).toBeGreaterThan(0);
    expect(reading.droppedByMaxFiles).toBe(0);
    // 密钥类文件仍进清单与审计，但内容没被读
    expect(reading.secretsSkipped.map((hit) => hit.path)).toContain('.env');

    // 结果必须能过 JSON 序列化（注册表要求无损 JSON）
    expect(() => JSON.stringify(value)).not.toThrow();
  });

  it('产物清单说清「现在磁盘上有什么」', async () => {
    const value = await tool?.execute({ path: source, skipAssets: true }, { signal: new AbortController().signal });
    const artifacts = artifactsOf(value);

    expect(artifacts.get('解读')?.state).toBe('fresh');
    expect(artifacts.get('解读')?.path).toBe(join(source, '.foldercast', 'foldercast.json'));
    // 还没写稿、没评审、没配音、没出片
    expect(artifacts.get('讲稿')?.state).toBe('missing');
    expect(artifacts.get('评审')?.state).toBe('missing');
    expect(artifacts.get('成片')?.state).toBe('missing');
    expect(artifacts.has('HTML')).toBe(false);
  });

  it('render 输出能读的几句话，且不空', async () => {
    const value = await tool?.execute({ path: source, skipAssets: true }, { signal: new AbortController().signal });
    const blocks = tool?.output.render({ path: source }, value);
    expect(blocks).toHaveLength(1);
    const text = blocks?.[0]?.text ?? '';
    expect(text.length).toBeGreaterThan(40);
    expect(text).toContain('解读');
  });

  it('目录不存在时给出可操作的结论，而不是抛异常', async () => {
    const value = await tool?.execute({ path: join(tmpdir(), 'foldercast-does-not-exist') }, { signal: new AbortController().signal });
    expect(value?.ok).toBe(false);
    expect(String(value?.error)).toContain('目录不存在');
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
    writeScript('src/does-not-exist.ts');

    const value = await tool?.execute({ path: source, skipAssets: true }, { signal: new AbortController().signal });
    expect(value?.ok).toBe(false);
    expect(String(value?.error)).toContain('必须修');

    const validation = value?.validation as { blocker: number; issues: { code: string; line?: number; sceneId?: string }[] };
    expect(validation.blocker).toBeGreaterThan(0);
    const hallucinated = validation.issues.filter((issue) => issue.code === 'path-hallucinated');
    expect(hallucinated.length).toBeGreaterThan(0);
    expect(hallucinated[0]?.sceneId).toBe('entry');
    expect(hallucinated[0]?.line).toBeGreaterThan(0);
  });

  it('讲稿通过时 ok，并且把讲稿报成 fresh', async () => {
    writeScript('src/index.ts');

    const value = await tool?.execute({ path: source, skipAssets: true }, { signal: new AbortController().signal });
    expect(value?.ok).toBe(true);
    expect((value?.validation as { blocker: number }).blocker).toBe(0);
    expect(artifactsOf(value).get('讲稿')?.state).toBe('fresh');
    // 校验只管机器能判的；「有没有讲错重点」要靠评审，而评审在不在是产物清单说了算
    expect(artifactsOf(value).get('评审')?.state).toBe('missing');
  });

  it('评审比讲稿新时，评审报 fresh；讲稿再改就变 stale', async () => {
    const workRoot = join(source, '.foldercast');
    writeFileSync(join(workRoot, 'review.md'), '# 评审：通过\n');
    setMtimeAgo(join(workRoot, 'script.json'), 60);
    setMtimeAgo(join(workRoot, 'review.md'), 1);

    const fresh = await tool?.execute({ path: source, skipAssets: true }, { signal: new AbortController().signal });
    expect(artifactsOf(fresh).get('评审')?.state).toBe('fresh');

    // 讲稿更新 → 旧结论作废
    writeScript('src/index.ts');
    const stale = await tool?.execute({ path: source, skipAssets: true }, { signal: new AbortController().signal });
    expect(artifactsOf(stale).get('评审')?.state).toBe('stale');
  });

  it('不传 render 时一次也不渲染（哪怕成片不存在）', async () => {
    const value = await tool?.execute({ path: source, skipAssets: true }, { signal: new AbortController().signal });
    expect((value?.stages as Record<string, unknown>).render).toBeUndefined();
    expect(existsSync(join(source, '.foldercast', 'out', 'video.mp4'))).toBe(false);
    expect(artifactsOf(value).get('成片')?.state).toBe('missing');
  });

  it('传 render 但没有讲稿时，给出可操作的结论而不是渲染', async () => {
    rmSync(join(source, '.foldercast', 'script.json'), { force: true });
    const value = await tool?.execute({ path: source, skipAssets: true, render: true }, { signal: new AbortController().signal });
    expect(value?.ok).toBe(false);
    expect(String(value?.error)).toContain('还没有讲稿');
    expect((value?.stages as Record<string, unknown>).render).toBeUndefined();
    // 写完再体检那几条用例要用讲稿
    writeScript('src/index.ts');
  });
});

describe('显式要求出片时才走渲染', () => {
  it(
    'render: true 时渲染并报成片状态；随后不传 render 不再重渲',
    { timeout: 240_000 },
    async () => {
      const value = await tool?.execute({ path: source, skipAssets: true, render: true }, { signal: new AbortController().signal });

      const videoPath = join(source, '.foldercast', 'out', 'video.mp4');
      const render = (value?.stages as Record<string, { ok?: boolean }>).render;

      if (render?.ok === true) {
        expect(existsSync(videoPath)).toBe(true);
        expect(statSync(videoPath).size).toBeGreaterThan(20_000);
        expect(artifactsOf(value).get('成片')?.state).toBe('fresh');
        expect(artifactsOf(value).get('成片')?.bytes).toBe(statSync(videoPath).size);

        // 再调一次**不传 render**：一次渲染都不该发生
        const again = await tool?.execute({ path: source, skipAssets: true }, { signal: new AbortController().signal });
        expect((again?.stages as Record<string, unknown>).render).toBeUndefined();
        expect(artifactsOf(again).get('成片')?.state).toBe('fresh');
        return;
      }

      // 没有浏览器的机器：**必须**给出结构化说明，而不是一句失败。这条分支在 CI 上有意义。
      expect(value?.ok).toBe(false);
      expect(String(value?.error)).toContain('browser');
      expect(String(value?.error)).toContain('remotion browser ensure');
    },
  );
});
