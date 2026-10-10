/**
 * 工具定义的形状与编排结果。
 *
 * 用假的 ctx 调真实 `apply()`，再把拿到的定义当真的用（`execute` 真跑）—— 这样测的是
 * **插件交付的那个东西**，不是一份复制品。工具定义写错在这里就暴露，不必先装进 DSH。
 *
 * 判据：
 * 1. **默认不出片、不配音**：不传 `render` / `voice` 时，这两步一次也不跑。
 * 2. **有讲稿才校验**，校验结论（含 blocker 明细）原样交回。
 * 3. 结果里**没有「下一步做什么」** —— 那是 skill 与模型的判断。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../index.ts';

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

  source = mkdtempSync(join(tmpdir(), 'foldercast-plugin-'));
  mkdirSync(join(source, 'src'), { recursive: true });
  writeFileSync(join(source, 'src/index.ts'), 'export const value = 1;\n');
  writeFileSync(join(source, 'README.md'), '# 夹具\n');
});

afterAll(() => {
  if (source !== '') rmSync(source, { recursive: true, force: true });
});

/** 写一份合法讲稿。`entryPath` 传一个不存在的路径就制造 blocker。 */
function writeScript(entryPath: string): void {
  mkdirSync(join(source, '.foldercast'), { recursive: true });
  writeFileSync(
    join(source, '.foldercast', 'script.json'),
    `${JSON.stringify(
      {
        foldercast: 2,
        source: { root: source },
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

describe('注册的形状符合 DSH 的工具契约', () => {
  it('名字、描述与主动语态', () => {
    expect(tool?.name).toBe('foldercast_cast');
    expect(tool?.description).toMatch(/^[A-Z]/);
    expect(tool?.description.split(' ').length).toBeGreaterThanOrEqual(5);
  });

  it('参数包括路径、显式输出、评审版本与草稿开关', () => {
    expect(tool?.parameters.required).toEqual(['path']);
    expect(Object.keys(tool?.parameters.properties ?? {}).sort()).toEqual([
      'draft',
      'forceVoice',
      'page',
      'path',
      'render',
      'reviewRevision',
      'voice',
      'voiceName',
    ]);
    expect(tool?.parameters.additionalProperties).toBe(false);
  });

  it('声明输出 schema 与 render（注册表强制要求）', () => {
    expect(typeof tool?.output.render).toBe('function');
    expect((tool?.output.schema as { type?: string }).type).toBe('object');
    // 「下一步做什么」不该出现在输出契约里
    const properties = (tool?.output.schema as { properties?: Record<string, unknown> }).properties ?? {};
    expect(Object.keys(properties)).not.toContain('next');
    expect(Object.keys(properties)).toContain('validation');
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

describe('execute：没有讲稿时只报环境与目录', () => {
  it('自定义效果与名称进入创作指导，基础预设不覆盖它们', async () => {
    const fake = fakeContext();
    apply(fake.ctx as never, { visual: { style: '自定义风格', customName: '水墨风格',
      customBaseStyle: '科技风格', prompt: '留白、简洁流程，节奏舒缓。' } });
    const value = await fake.tool().execute({ path: source }, { signal: new AbortController().signal });
    expect(value.visualPreferences).toMatchObject({ style: '自定义风格', name: '水墨风格', baseStyle: '科技风格',
      prompt: '留白、简洁流程，节奏舒缓。', stylePrompt: expect.stringContaining('水墨风格') });
    const text = fake.tool().output.render({}, value).map((block) => block.text).join('\n');
    expect(text).toContain('留白、简洁流程，节奏舒缓。');
    expect((value.visualPreferences as { stylePrompt: string }).stylePrompt).not.toContain('Tech-inspired Design');
    expect(value.ran).toEqual([]);
  });
  it('写稿前返回可调整的创作指导，分钟值不触发产出', async () => {
    const fake = fakeContext();
    let minutes = 5;
    apply(fake.ctx as never, { creative: { dialogue: '先沟通目标', depth: '标准讲解',
      audience: '初次接触项目的开发者', focus: '核心流程', prompt: '先推荐范围再问重点。',
      videoMinutes: { get: () => minutes }, pageMinutes: 2.5 } });
    const value = await fake.tool().execute({ path: source }, { signal: new AbortController().signal });
    expect(value.creativePreferences).toEqual({ dialogue: '先沟通目标', depth: '标准讲解',
      audience: '初次接触项目的开发者', focus: '核心流程', prompt: '先推荐范围再问重点。',
      videoMinutes: 5, pageMinutes: 2.5 });
    expect(fake.tool().output.render({}, value)[0]?.text).toContain('5 分钟');
    expect(fake.tool().output.render({}, value)[0]?.text).toContain('非实际阅读计时');
    expect(value.ran).toEqual([]);
    minutes = 3.5;
    const next = await fake.tool().execute({ path: source }, { signal: new AbortController().signal });
    expect((next.creativePreferences as { videoMinutes: number }).videoMinutes).toBe(3.5);
  });

  it('写稿前读取美术设置；volatile 设置变化后下一次调用返回新值', async () => {
    const fake = fakeContext();
    let prompt = '少代码，多流程。';
    apply(fake.ctx as never, { visual: { style: '杂志', prompt: { get: () => prompt } } });
    const value = await fake.tool().execute({ path: source }, { signal: new AbortController().signal });
    expect(value.visualPreferences).toMatchObject({ style: '编辑设计风格', prompt,
      stylePrompt: expect.stringContaining('编辑设计风格（Editorial Design）') });
    expect(fake.tool().output.render({}, value)[0]?.text).toContain(prompt);
    prompt = '先结论后解释。';
    const next = await fake.tool().execute({ path: source }, { signal: new AbortController().signal });
    expect(next.visualPreferences).toMatchObject({ style: '编辑设计风格', prompt });
    expect(next.ran).toEqual([]);
  });
  it('目录存在、没有讲稿：ok，没有校验可跑、不渲染不配音', async () => {
    const value = await tool?.execute({ path: source }, { signal: new AbortController().signal });

    expect(value?.ok).toBe(true);
    expect(value?.target).toBe(source);
    expect(value?.label).toBe(source.split('/').pop());
    expect(value?.ran).toEqual([]);
    expect(value?.creativePreferences).toEqual({ dialogue: '按需询问', depth: '自动判断' });
    expect(value?.visualPreferences).toMatchObject({ style: '瑞士风格',
      stylePrompt: expect.stringContaining('Swiss Style / International Typographic Style') });
    const displayed = tool?.output.render({}, value).map((block) => block.text).join('\n');
    expect(displayed).toContain('瑞士风格');
    expect(displayed).not.toContain('素稿');
    expect((value?.stages as Record<string, unknown>).render).toBeUndefined();
    expect((value?.stages as Record<string, unknown>).voice).toBeUndefined();

    // 结果必须能过 JSON 序列化（注册表要求无损 JSON）
    expect(() => JSON.stringify(value)).not.toThrow();
  });

  it('目录不存在时给出可操作的结论，而不是抛异常', async () => {
    const value = await tool?.execute({ path: join(tmpdir(), 'foldercast-does-not-exist') }, { signal: new AbortController().signal });
    expect(value?.ok).toBe(false);
    expect(String(value?.error)).toContain('目录不存在');
  });

  it('取消后立刻返回，不留下跑着的子进程', async () => {
    writeScript('src/index.ts');
    const controller = new AbortController();
    controller.abort();
    const value = await tool?.execute({ path: source }, { signal: controller.signal });
    expect(value?.ok).toBe(false);
  });
});

describe('execute：有讲稿时跑校验', () => {
  it('讲稿里有编造的路径时，报出 blocker 与场景 id', async () => {
    writeScript('src/does-not-exist.ts');

    const value = await tool?.execute({ path: source }, { signal: new AbortController().signal });
    expect(value?.ok).toBe(false);
    expect(String(value?.error)).toContain('必须修');

    const validation = value?.validation as { blocker: number; issues: { code: string; sceneId?: string }[] };
    expect(validation.blocker).toBeGreaterThan(0);
    const hallucinated = validation.issues.filter((issue) => issue.code === 'path-missing');
    expect(hallucinated.length).toBeGreaterThan(0);
    expect(hallucinated[0]?.sceneId).toBe('entry');
  });

  it('讲稿通过时 ok：只校验不产出（产物等评审后显式要，0007）', async () => {
    writeScript('src/index.ts');

    const value = await tool?.execute({ path: source }, { signal: new AbortController().signal });
    expect(value?.ok).toBe(true);
    expect(value?.ran).toEqual(['check']);
    expect((value?.validation as { blocker: number }).blocker).toBe(0);
    expect((value?.stages as Record<string, unknown>).render).toBeUndefined();
    expect(value?.pagePath).toBeUndefined();
    expect(existsSync(join(source, '.foldercast', 'out', 'video.mp4'))).toBe(false);
    expect(existsSync(join(source, '.foldercast', 'out', 'page.html'))).toBe(false);
  });

  it('未评审时正式产出被阻止，草稿可生成且记录为草稿', async () => {
    writeScript('src/index.ts');
    const value = await tool?.execute({ path: source, page: true }, { signal: new AbortController().signal });
    expect(value?.ok).toBe(false);
    expect(String(value?.error)).toContain('评审回执');
    expect(value?.ran).toEqual(['check']);
    const draft = await tool?.execute({ path: source, page: true, draft: true }, { signal: new AbortController().signal });
    expect(draft?.ok).toBe(true);
    expect(draft?.artifacts).toContainEqual({ kind: 'page', state: 'current', mode: 'draft' });
  });

  it('评审绑定当前版本后产出；改证据后旧回执失效', async () => {
    writeScript('src/index.ts');
    const check = await tool?.execute({ path: source }, { signal: new AbortController().signal });
    writeFileSync(join(source, '.foldercast', 'review.md'), `第 1 轮：通过\nrevision: ${String(check?.revision)}\n证据：src/index.ts L1。`);
    const value = await tool?.execute({ path: source, reviewRevision: check?.revision, page: true }, { signal: new AbortController().signal });
    expect(value?.ok).toBe(true);
    expect(value?.ran).toEqual(['check', 'page']);
    const pagePath = value?.pagePath as string | undefined;
    expect(pagePath).toContain(join('.foldercast', 'out', 'page.html'));
    expect(existsSync(pagePath ?? '')).toBe(true);
    expect(value?.reviewAccepted).toBe(true);
    expect(value?.artifacts).toContainEqual({ kind: 'page', state: 'current', mode: 'approved' });
    writeFileSync(join(source, 'src/index.ts'), 'export const value = 2;\n');
    const stale = await tool?.execute({ path: source, page: true }, { signal: new AbortController().signal });
    expect(stale?.ok).toBe(false);
    expect(String(stale?.error)).toContain('评审回执');
  });

  it('render 输出能读的几句话，且不空', async () => {
    const value = await tool?.execute({ path: source }, { signal: new AbortController().signal });
    const blocks = tool?.output.render({ path: source }, value);
    expect(blocks).toHaveLength(1);
    const text = blocks?.[0]?.text ?? '';
    expect(text.length).toBeGreaterThan(10);
  });

  it('传 render 但没有讲稿时，给出可操作的结论而不是渲染', async () => {
    rmSync(join(source, '.foldercast', 'script.json'), { force: true });
    const value = await tool?.execute({ path: source, render: true }, { signal: new AbortController().signal });
    expect(value?.ok).toBe(false);
    expect(String(value?.error)).toContain('还没有讲稿');
    expect((value?.stages as Record<string, unknown>).render).toBeUndefined();
  });

  it('配音在版本未通过评审时不启动（测试不调用真实 TTS）', async () => {
    writeScript('src/index.ts');
    const value = await tool?.execute({ path: source, voice: true }, { signal: new AbortController().signal });
    expect(value?.ok).toBe(false);
    expect(String(value?.error)).toContain('评审回执');
    expect((value?.stages as Record<string, unknown>).voice).toBeUndefined();
  });
});
