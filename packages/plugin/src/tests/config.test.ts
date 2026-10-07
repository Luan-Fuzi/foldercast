/**
 * 设置页（Config schema）与设置解析。
 *
 * schema 是宿主生成设置页的唯一依据，这里钉住它的结构（配音/渲染/页面三组、provider
 * 枚举含 edge 与 mimo 预留位）；`resolveSettings` 要认三种形态 —— volatile 引用
 * （设置页保存后的活值）、普通值（profile patch 与测试）、缺省 —— 并把类型不对的值当没配。
 */
import { describe, expect, it } from 'vitest';
import { Config, resolveSettings, type RawConfig } from '../config.ts';

/** volatile 字段解析后的形态：带 get() 的引用（宿主保存设置后往里写新值）。 */
function ref<T>(value: T): { get(): T } {
  let current = value;
  return {
    get: () => current,
  };
}

describe('Config schema（设置页的形状）', () => {
  it('声明了配音、渲染、页面三组', () => {
    const text = String(Config);
    expect(text).toContain('voice');
    expect(text).toContain('render');
    expect(text).toContain('page');
  });

  it('provider 是 say/edge/mimo 枚举（edge 与 mimo 是预留位）', () => {
    expect(String(Config)).toContain('"say" | "edge" | "mimo"');
  });

  it('解析后的 volatile 字段是引用（get 的值跟着走）', () => {
    const resolved = Config({ voice: { voice: 'Tingting' } }) as unknown as RawConfig & {
      voice?: { voice?: { get(): unknown } };
    };
    const field = resolved.voice?.voice;
    expect(typeof (field as { get?: unknown })?.get).toBe('function');
    expect(ref(1).get()).toBe(1);
  });
});

describe('resolveSettings（三种形态都认）', () => {
  it('缺省与空对象：没有设置就是默认行为', () => {
    expect(resolveSettings(undefined)).toEqual({});
    expect(resolveSettings({})).toEqual({});
    expect(resolveSettings({ voice: {}, render: {} })).toEqual({});
  });

  it('普通值（profile patch / 测试的形状）', () => {
    expect(
      resolveSettings({
        voice: { provider: 'edge', voice: 'Tingting', style: '自然讲解语气', rate: 200 },
        render: { browserPath: '/usr/bin/chromium', concurrency: 2 },
        page: { style: 'plain' },
      }),
    ).toEqual({
      provider: 'edge',
      voiceName: 'Tingting',
      voiceStyle: '自然讲解语气',
      voiceRate: 200,
      browserPath: '/usr/bin/chromium',
      concurrency: 2,
      pageStyle: 'plain',
    });
  });

  it('volatile 引用：读 get()，且读到的是当前值', () => {
    const voice = ref('Tingting');
    const config: RawConfig = { voice: { voice } };
    expect(resolveSettings(config).voiceName).toBe('Tingting');
    // 模拟设置页保存了新值：同一个引用，下一次工具调用读到新的
    (config.voice as { voice: unknown }).voice = {
      get: () => 'Meijia',
    };
    expect(resolveSettings(config).voiceName).toBe('Meijia');
  });

  it('类型不对、空串、越界的值一律当没配', () => {
    expect(
      resolveSettings({
        voice: { provider: 'elevenlabs', voice: '   ', rate: 9999 },
        render: { browserPath: '', concurrency: 1.5 },
      }),
    ).toEqual({});
  });
});
