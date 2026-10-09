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

  it('参数只有目录路径与五个开关', () => {
    expect(tool?.parameters.required).toEqual(['path']);
    expect(Object.keys(tool?.parameters.properties ?? {}).sort()).toEqual([
      'forceVoice',
      'page',
      'path',
      'render',
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
  it('目录存在、没有讲稿：ok，没有校验可跑、不渲染不配音', async () => {
    const value = await tool?.execute({ path: source }, { signal: new AbortController().signal });

    expect(value?.ok).toBe(true);
    expect(value?.target).toBe(source);
    expect(value?.label).toBe(source.split('/').pop());
    expect(value?.ran).toEqual([]);
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

  it('传 page 时产出导览页（只要 HTML 就只传它）', async () => {
    writeScript('src/index.ts');

    const value = await tool?.execute({ path: source, page: true }, { signal: new AbortController().signal });
    expect(value?.ok).toBe(true);
    expect(value?.ran).toEqual(['check', 'page']);
    const pagePath = value?.pagePath as string | undefined;
    expect(pagePath).toContain(join('.foldercast', 'out', 'page.html'));
    expect(existsSync(pagePath ?? '')).toBe(true);
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

  it('传 voice 但缺配音命令时，说明缺什么、别的话照常说', async () => {
    writeScript('src/index.ts');
    const value = await tool?.execute({ path: source, voice: true }, { signal: new AbortController().signal });
    // 本机有 ffmpeg 且能联网时会真的配音（默认 edge，云端合成，夹具只有三句），两条路径都算过
    if (value?.ok !== true) {
      expect(String(value?.error)).toMatch(/ffmpeg|ffprobe|edge/);
      return;
    }
    expect((value?.stages as Record<string, unknown>).voice).toBeDefined();
    expect(value?.voiceName).toBeTruthy();
  });
});
