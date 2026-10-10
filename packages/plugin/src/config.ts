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
import { CUSTOM_VISUAL_STYLE, normalizeVisualStyle, VISUAL_STYLE_INPUT_NAMES, type VisualSelectionName, type VisualStyleName } from '../scripts/contracts/visual.ts';
import { CREATIVE_DEPTHS, DIALOGUE_MODES, type CreativePreferences } from '../scripts/contracts/creative.ts';

export const Config = z.object({
  creative: z.object({
    dialogue: z.union([...DIALOGUE_MODES]).default('按需询问').volatile()
      .description('创作前沟通方式：按需询问 / 先沟通目标 / 直接规划。已有回答不重复追问'),
    audience: z.string().volatile().description('默认受众及已有知识。留空由 Agent 结合上下文判断'),
    focus: z.string().volatile().description('默认讲述重点或希望回答的问题，作为创作参考'),
    depth: z.union([...CREATIVE_DEPTHS]).default('自动判断').volatile()
      .description('讲述深度参考：自动判断 / 快速导览 / 标准讲解 / 深入讲解'),
    videoMinutes: z.number().min(0.01).volatile()
      .description('视频目标时长（分钟）。留空自动规划；是内容预算参考，不强制缩放或截断音频'),
    pageMinutes: z.number().min(0.01).volatile()
      .description('导览页目标阅读时间（分钟）。留空自动规划；不是实际阅读计时或播放时长'),
    prompt: z.string().volatile()
      .description('创作沟通提示词：指导 Agent 如何提问、推荐方案和取舍。用户本次要求优先'),
  }).description('创作与沟通'),
  visual: z.object({
    style: z.union([...VISUAL_STYLE_INPUT_NAMES, CUSTOM_VISUAL_STYLE]).default('瑞士风格').volatile()
      .description('整体美术风格：瑞士风格（默认）/ 编辑设计风格 / 科技风格 / 自定义风格；旧名称仅兼容已有配置'),
    customName: z.string().volatile().description('自定义风格名称，例如水墨风格；留空显示自定义风格'),
    customBaseStyle: z.union([...VISUAL_STYLE_INPUT_NAMES]).default('瑞士风格').volatile()
      .description('自定义风格的基础视觉预设，控制实际配色与字体；名称和效果描述用于模型创作'),
    prompt: z.string().volatile()
      .description('自定义美术提示词，引导写稿模型的场景设计、选材与节拍。需重新创作并评审讲稿后生效；不直接执行为 CSS'),
  }).description('美术风格'),
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
        .step(1)
        .volatile()
        .description('渲染并发数。默认 1：多并发会破坏「同一讲稿两次渲染逐帧一致」'),
    })
    .description('渲染'),
  page: z
    .object({
      // 页面可单独覆盖共用预设；跟随时不传独立的 --style。
      style: z
        .union(['跟随美术风格', ...VISUAL_STYLE_INPUT_NAMES])
        .default('跟随美术风格')
        .volatile()
        .description('导览页默认跟随整体美术风格；也可单独选择瑞士风格 / 编辑设计风格 / 科技风格'),
    })
    .description('页面'),
});

/** 解析后的设置（全部可选：没配就是现在的默认行为）。 */
export type FoldercastSettings = {
  creative?: CreativePreferences;
  visualStyle?: VisualSelectionName;
  visualPrompt?: string;
  customVisualName?: string;
  customVisualBaseStyle?: VisualStyleName;
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
  creative?: { [K in keyof CreativePreferences]?: unknown };
  visual?: { style?: unknown; prompt?: unknown; customName?: unknown; customBaseStyle?: unknown };
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
  const creative: CreativePreferences = {};
  const dialogue = read(config?.creative?.dialogue);
  const depth = read(config?.creative?.depth);
  if (DIALOGUE_MODES.some((value) => value === dialogue)) creative.dialogue = dialogue as CreativePreferences['dialogue'];
  if (CREATIVE_DEPTHS.some((value) => value === depth)) creative.depth = depth as CreativePreferences['depth'];
  for (const key of ['audience', 'focus', 'prompt'] as const) {
    const value = read(config?.creative?.[key]);
    if (typeof value === 'string' && value.trim() !== '') creative[key] = value;
  }
  for (const key of ['videoMinutes', 'pageMinutes'] as const) {
    const value = read(config?.creative?.[key]);
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0.01) creative[key] = value;
  }
  const visualSelection = read(config?.visual?.style);
  const visualStyle = visualSelection === CUSTOM_VISUAL_STYLE ? CUSTOM_VISUAL_STYLE : normalizeVisualStyle(visualSelection);
  const visualPrompt = read(config?.visual?.prompt);
  const customVisualName = read(config?.visual?.customName);
  const customVisualBaseStyle = normalizeVisualStyle(read(config?.visual?.customBaseStyle));
  const provider = read(config?.voice?.provider);
  const voiceName = read(config?.voice?.voice);
  const voiceStyle = read(config?.voice?.style);
  const browserPath = read(config?.render?.browserPath);
  const concurrency = read(config?.render?.concurrency);
  const pageStyle = normalizeVisualStyle(read(config?.page?.style));

  return {
    ...(Object.keys(creative).length === 0 ? {} : { creative }),
    ...(visualStyle === undefined ? {} : { visualStyle }),
    ...(typeof visualPrompt === 'string' && visualPrompt.trim() !== '' ? { visualPrompt } : {}),
    ...(typeof customVisualName === 'string' && customVisualName.trim() !== '' ? { customVisualName } : {}),
    ...(customVisualBaseStyle === undefined ? {} : { customVisualBaseStyle }),
    ...(provider === 'edge' || provider === 'mimo' ? { provider } : {}),
    ...(typeof voiceName === 'string' && voiceName.trim() !== '' ? { voiceName } : {}),
    ...(typeof voiceStyle === 'string' && voiceStyle.trim() !== '' ? { voiceStyle } : {}),
    ...(typeof browserPath === 'string' && browserPath.trim() !== '' ? { browserPath } : {}),
    ...(typeof concurrency === 'number' && Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 8
      ? { concurrency }
      : {}),
    ...(pageStyle === undefined ? {} : { pageStyle }),
  };
}
