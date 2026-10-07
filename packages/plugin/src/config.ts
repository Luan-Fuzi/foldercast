/**
 * 插件配置（设置页）。
 *
 * 在 DSH 的设置模型里，这份 schema **就是**插件的设置页：宿主按它逐 profile 生成表单。
 * 字段标了 `.volatile()`：改设置保存时宿主不重挂载插件，而是把新值写进字段的引用里 ——
 * 解析出来的 volatile 字段是「带 `get()` 的对象」，不是普通值，`resolveSettings` 负责解包
 * （普通值与缺省也认，那是 profile patch 与测试的形状）。
 *
 * 两个 provider 都是云端（配音需要网络，见 docs/decisions/0002）：`edge` 免密钥（默认），
 * `mimo` 要 `MIMO_API_KEY`。provider 名经 `--provider` 透传给配音阶段。
 */
import z from '@deepseek-ai/schemastery';

export const Config = z.object({
  voice: z
    .object({
      provider: z
        .union(['edge', 'mimo'])
        .default('edge')
        .volatile()
        .description(
          '配音引擎（都要网络）。edge 免密钥（默认）；mimo 中文更自然，需要 MIMO_API_KEY（缺密钥时配音以退出码 4 结束）',
        ),
      voice: z.string().volatile().description('音色名（provider 各自的叫法，如 edge 的 zh-CN-XiaoxiaoNeural）。留空用默认中文音色'),
      style: z
        .string()
        .volatile()
        .description('「怎么读」的自然语描述（如「自然、清晰的讲解语气」）。mimo 落在风格指令；edge 表达不了，忽略'),
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
      // 三个名字与 scripts/page/styles.ts 的 PAGE_STYLES 键一致（src 不 import scripts，
      // 编译产物的目录结构不同）；src/tests/config.test.ts 钉住两边不漂移
      style: z
        .union(['素稿', '杂志', '夜幕'])
        .default('素稿')
        .volatile()
        .description('导览页风格：素稿（纸面白底）/ 杂志（暖纸衬线）/ 夜幕（深底，与成片同色）'),
    })
    .description('页面'),
});

/** 解析后的设置（全部可选：没配就是现在的默认行为）。 */
export type FoldercastSettings = {
  /** 配置里选的引擎。默认 `edge`（免密钥）；`mimo` 要 `MIMO_API_KEY`。 */
  provider?: 'edge' | 'mimo';
  voiceName?: string;
  voiceStyle?: string;
  browserPath?: string;
  concurrency?: number;
  pageStyle?: string;
};

/** 宿主递进来的原始配置：字段可能是 volatile 引用、普通值或缺省。 */
export type RawConfig = {
  voice?: { provider?: unknown; voice?: unknown; style?: unknown };
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
  const browserPath = read(config?.render?.browserPath);
  const concurrency = read(config?.render?.concurrency);
  const pageStyle = read(config?.page?.style);

  return {
    ...(provider === 'edge' || provider === 'mimo' ? { provider } : {}),
    ...(typeof voiceName === 'string' && voiceName.trim() !== '' ? { voiceName } : {}),
    ...(typeof voiceStyle === 'string' && voiceStyle.trim() !== '' ? { voiceStyle } : {}),
    ...(typeof browserPath === 'string' && browserPath.trim() !== '' ? { browserPath } : {}),
    ...(typeof concurrency === 'number' && Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 8
      ? { concurrency }
      : {}),
    ...(typeof pageStyle === 'string' && pageStyle.trim() !== '' ? { pageStyle } : {}),
  };
}
