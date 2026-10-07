/**
 * 插件配置（设置页）。
 *
 * 在 DSH 的设置模型里，这份 schema **就是**插件的设置页：宿主按它逐 profile 生成表单。
 * 字段标了 `.volatile()`：改设置保存时宿主不重挂载插件，而是把新值写进字段的引用里 ——
 * 解析出来的 volatile 字段是「带 `get()` 的对象」，不是普通值，`resolveSettings` 负责解包
 * （普通值与缺省也认，那是 profile patch 与测试的形状）。
 *
 * `edge` / `mimo` 在这里是**已定接口、未接实现**的枚举位（P0 seam，见 docs/decisions/0002）：
 * voice-engine 分支把实现装进 `voice/providers/` 后，`cast.ts` 无需再改 —— provider 名
 * 经 `--provider` 透传给配音阶段。
 */
import z from '@deepseek-ai/schemastery';

export const Config = z.object({
  voice: z
    .object({
      provider: z
        .union(['say', 'edge', 'mimo'])
        .default('say')
        .volatile()
        .description(
          '配音引擎。当前只实现了 say（macOS 自带、免密钥）；edge / mimo 由 voice-engine 分支接入，选了会提示未实现',
        ),
      voice: z.string().volatile().description('音色名（provider 各自的叫法）。留空用默认（say 自动挑中文音色）'),
      style: z
        .string()
        .volatile()
        .description('「怎么读」的自然语描述（如「自然、清晰的讲解语气」）。mimo 落在风格指令，say 只认语速数字'),
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
  page: z
    .object({
      style: z
        .string()
        .volatile()
        .description('HTML 页面的风格预设名（page 分支接入后收窄为枚举，先留字符串占位）'),
    })
    .description('页面'),
});

/** 解析后的设置（全部可选：没配就是现在的默认行为）。 */
export type FoldercastSettings = {
  /** 配置里选的引擎。'say' 是当前唯一实现；'edge' / 'mimo' 是已定接口的预留位。 */
  provider?: 'say' | 'edge' | 'mimo';
  voiceName?: string;
  voiceStyle?: string;
  voiceRate?: number;
  browserPath?: string;
  concurrency?: number;
  pageStyle?: string;
};

/** 宿主递进来的原始配置：字段可能是 volatile 引用、普通值或缺省。 */
export type RawConfig = {
  voice?: { provider?: unknown; voice?: unknown; style?: unknown; rate?: unknown };
  render?: { browserPath?: unknown; concurrency?: unknown };
  page?: { style?: unknown };
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
  const voiceStyle = read(config?.voice?.style);
  const rate = read(config?.voice?.rate);
  const browserPath = read(config?.render?.browserPath);
  const concurrency = read(config?.render?.concurrency);
  const pageStyle = read(config?.page?.style);

  return {
    ...(provider === 'say' || provider === 'edge' || provider === 'mimo' ? { provider } : {}),
    ...(typeof voiceName === 'string' && voiceName.trim() !== '' ? { voiceName } : {}),
    ...(typeof voiceStyle === 'string' && voiceStyle.trim() !== '' ? { voiceStyle } : {}),
    ...(typeof rate === 'number' && Number.isFinite(rate) && rate >= 60 && rate <= 400 ? { voiceRate: rate } : {}),
    ...(typeof browserPath === 'string' && browserPath.trim() !== '' ? { browserPath } : {}),
    ...(typeof concurrency === 'number' && Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 8
      ? { concurrency }
      : {}),
    ...(typeof pageStyle === 'string' && pageStyle.trim() !== '' ? { pageStyle } : {}),
  };
}
