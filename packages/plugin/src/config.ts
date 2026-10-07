/**
 * 插件配置（设置页）。
 *
 * 在 DSH 的设置模型里，这份 schema **就是**插件的设置页：宿主按它逐 profile 生成表单。
 * 字段标了 `.volatile()`：改设置保存时宿主不重挂载插件，而是把新值写进字段的引用里 ——
 * 解析出来的 volatile 字段是「带 `get()` 的对象」，不是普通值，`resolveSettings` 负责解包
 * （普通值与缺省也认，那是 profile patch 与测试的形状）。
 *
 * 现在的字段是**骨架**：`voice.provider` 里的 `mimo` 是预留（描述里写明未生效，代码里
 * 不接它）。真要接第二个 TTS 时，在这里补字段、在 `cast.ts` 接线即可，机制不用再动。
 */
import z from '@deepseek-ai/schemastery';

export const Config = z.object({
  voice: z
    .object({
      provider: z
        .union(['say', 'mimo'])
        .default('say')
        .volatile()
        .description('配音引擎。当前只实现了 say（macOS 自带、免密钥）；mimo 为预留，选了也仍用 say'),
      voice: z.string().volatile().description('say 的系统音色名。留空自动挑一个中文音色'),
      rate: z.number().min(60).max(400).volatile().description('语速（字/分）。留空用讲稿里的或系统默认'),
    })
    .description('配音'),
  render: z
    .object({
      browserPath: z
        .string()
        .volatile()
        .description('浏览器可执行文件路径。留空自动找系统 Chrome；也可用环境变量 FOLDERCAST_BROWSER'),
      concurrency: z
        .number()
        .min(1)
        .max(8)
        .volatile()
        .description('渲染并发数。默认 1：多并发会破坏「同一讲稿两次渲染逐帧一致」'),
    })
    .description('渲染'),
});

/** 解析后的设置（全部可选：没配就是现在的默认行为）。 */
export type FoldercastSettings = {
  /** 配置里选的引擎。现在只有 say 一个实现；'mimo' 表示「用户选了预留项」。 */
  provider?: 'say' | 'mimo';
  voiceName?: string;
  voiceRate?: number;
  browserPath?: string;
  concurrency?: number;
};

/** 宿主递进来的原始配置：字段可能是 volatile 引用、普通值或缺省。 */
export type RawConfig = {
  voice?: { provider?: unknown; voice?: unknown; rate?: unknown };
  render?: { browserPath?: unknown; concurrency?: unknown };
};

/** 读一个字段，解包 volatile 引用。 */
function read<T>(field: T | { get(): T | undefined } | undefined): T | undefined {
  if (field === undefined) return undefined;
  if (typeof field === 'object' && field !== null && typeof (field as { get?: unknown }).get === 'function') {
    return (field as { get(): T | undefined }).get();
  }
  return field as T;
}

/** 把任意形状的配置收敛成可用的设置：类型不对、空串、越界的值一律当没配。 */
export function resolveSettings(config?: RawConfig): FoldercastSettings {
  const provider = read(config?.voice?.provider);
  const voiceName = read(config?.voice?.voice);
  const rate = read(config?.voice?.rate);
  const browserPath = read(config?.render?.browserPath);
  const concurrency = read(config?.render?.concurrency);

  return {
    ...(provider === 'say' || provider === 'mimo' ? { provider } : {}),
    ...(typeof voiceName === 'string' && voiceName.trim() !== '' ? { voiceName } : {}),
    ...(typeof rate === 'number' && Number.isFinite(rate) && rate >= 60 && rate <= 400 ? { voiceRate: rate } : {}),
    ...(typeof browserPath === 'string' && browserPath.trim() !== '' ? { browserPath } : {}),
    ...(typeof concurrency === 'number' && Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 8
      ? { concurrency }
      : {}),
  };
}
