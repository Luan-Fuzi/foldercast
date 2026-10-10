/**
 * 设置页（Config schema）与设置解析。
 *
 * schema 是配置解析的依据，这里钉住它的结构（创作/美术/配音/渲染/页面五组、provider
 * 枚举 edge 与 mimo、没有 say 也没有语速字段）；`resolveSettings` 要认三种形态 ——
 * volatile 引用（设置页保存后的活值）、普通值（profile patch 与测试）、缺省 ——
 * 并把类型不对的值当没配。
 */
import { describe, expect, it } from 'vitest';
import { Config, resolveSettings, type RawConfig } from '../config.ts';
import { DEFAULT_STYLE_NAME, STYLE_NAMES } from '../../scripts/page/styles.ts';

/** volatile 字段解析后的形态：带 get() 的引用（宿主保存设置后往里写新值）。 */
function ref<T>(value: T): { get(): T } {
  let current = value;
  return {
    get: () => current,
  };
}

describe('Config schema（设置页的形状）', () => {
  it('声明了创作、美术、配音、渲染、页面五组', () => {
    const text = String(Config);
    expect(text).toContain('creative');
    expect(text).toContain('visual');
    expect(text).toContain('voice');
    expect(text).toContain('render');
    expect(text).toContain('page');
  });

  it('provider 是 edge/mimo 枚举（默认 edge），没有 say 也没有语速字段', () => {
    expect(String(Config)).toContain('"edge" | "mimo"');
    expect(String(Config)).not.toContain('say');
    expect(String(Config)).not.toContain('rate');
  });

  it('page.style 的独立预设与页面阶段的三套预设一致', () => {
    const text = String(Config);
    for (const name of STYLE_NAMES) expect(text).toContain(`"${name}"`);
    expect(STYLE_NAMES).toContain(DEFAULT_STYLE_NAME);
    expect(text).toContain(DEFAULT_STYLE_NAME);
  });

  it('解析后的 volatile 字段是引用（get 的值跟着走）', () => {
    const resolved = Config({ voice: { voice: 'zh-CN-XiaoxiaoNeural' } }) as unknown as RawConfig & {
      voice?: { voice?: { get(): unknown } };
    };
    const field = resolved.voice?.voice;
    expect(typeof (field as { get?: unknown })?.get).toBe('function');
    expect(ref(1).get()).toBe(1);
  });

  it('配置入口拒绝小数或越界并发数，不在保存后悄悄丢弃', () => {
    for (const concurrency of [0, 1.5, 9]) {
      expect(() => Config({ render: { concurrency } })).toThrow();
    }
    expect(resolveSettings(Config({ render: { concurrency: 2 } }) as RawConfig).concurrency).toBe(2);
  });
});

describe('resolveSettings（三种形态都认）', () => {
  it('自定义名称、效果与基础预设可读取活值，旧基础名称归一', () => {
    let prompt = '留白、简洁流程，节奏舒缓。';
    const config: RawConfig = { visual: { style: ref('自定义风格'), customName: ref('水墨风格'),
      customBaseStyle: ref('杂志'), prompt: { get: () => prompt } } };
    expect(resolveSettings(config)).toMatchObject({ visualStyle: '自定义风格', customVisualName: '水墨风格',
      customVisualBaseStyle: '编辑设计风格', visualPrompt: prompt });
    prompt = '少量图像，优先讲清流程。';
    expect(resolveSettings(config).visualPrompt).toBe(prompt);
  });
  it('创作偏好保留分钟单位与自由文本，读取 volatile 活值', () => {
    let minutes = 5;
    const config: RawConfig = { creative: { dialogue: ref('先沟通目标'), depth: ref('深入讲解'),
      audience: ref('了解 TypeScript 的开发者'), focus: '关键流程', prompt: '先问最关心的问题。',
      videoMinutes: { get: () => minutes }, pageMinutes: 2.5 } };
    expect(resolveSettings(config).creative).toEqual({ dialogue: '先沟通目标', depth: '深入讲解',
      audience: '了解 TypeScript 的开发者', focus: '关键流程', prompt: '先问最关心的问题。',
      videoMinutes: 5, pageMinutes: 2.5 });
    minutes = 3.5;
    expect(resolveSettings(config).creative?.videoMinutes).toBe(3.5);
  });

  it('缺失或无效创作偏好不制造默认覆盖；空白与非有限分钟值忽略', () => {
    for (const value of [0, -1, NaN, Infinity, '5']) {
      expect(resolveSettings({ creative: { videoMinutes: value, pageMinutes: value,
        audience: '  ', focus: '', prompt: 5, dialogue: '无效', depth: '无效' } })).toEqual({});
    }
    expect(resolveSettings({ creative: {} })).toEqual({});
  });

  it('缺省与空对象：没有设置就是默认行为', () => {
    expect(resolveSettings(undefined)).toEqual({});
    expect(resolveSettings({})).toEqual({});
    expect(resolveSettings({ voice: {}, render: {} })).toEqual({});
  });

  it('普通值（profile patch / 测试的形状）', () => {
    expect(
      resolveSettings({
        voice: { provider: 'mimo', voice: '茉莉', style: '自然讲解语气' },
        render: { browserPath: '/usr/bin/chromium', concurrency: 2 },
        page: { style: '杂志' },
      }),
    ).toEqual({
      provider: 'mimo',
      voiceName: '茉莉',
      voiceStyle: '自然讲解语气',
      browserPath: '/usr/bin/chromium',
      concurrency: 2,
      pageStyle: '编辑设计风格',
    });
  });

  it('美术提示词可读取活值，页面跟随选项不作为独立覆盖透传', () => {
    const config: RawConfig = { visual: { style: ref('夜幕'), prompt: ref('少代码，多流程。') },
      page: { style: '跟随美术风格' } };
    expect(resolveSettings(config)).toEqual({ visualStyle: '科技风格', visualPrompt: '少代码，多流程。' });
    expect(resolveSettings({ visual: { style: '不存在', prompt: '  ' }, page: { style: '不存在' } })).toEqual({});
  });

  it('volatile 引用：读 get()，且读到的是当前值', () => {
    const voice = ref('zh-CN-XiaoxiaoNeural');
    const config: RawConfig = { voice: { voice } };
    expect(resolveSettings(config).voiceName).toBe('zh-CN-XiaoxiaoNeural');
    // 模拟设置页保存了新值：同一个引用，下一次工具调用读到新的
    (config.voice as { voice: unknown }).voice = {
      get: () => 'zh-CN-YunjianNeural',
    };
    expect(resolveSettings(config).voiceName).toBe('zh-CN-YunjianNeural');
  });

  it('类型不对、空串、越界的值一律当没配（say 已删，选了它也当没配）', () => {
    expect(
      resolveSettings({
        voice: { provider: 'say', voice: '   ' },
        render: { browserPath: '', concurrency: 1.5 },
      }),
    ).toEqual({});
  });
});
