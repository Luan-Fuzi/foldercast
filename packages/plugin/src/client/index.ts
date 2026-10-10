/** DSH 设置窗口的「目录放映」页。宿主模型管理保存，字段投影适配嵌套配置。 */
import { createElement as h, useState, useSyncExternalStore, type ReactNode } from 'react';
import { defaultVoiceFor, voicesFor } from '../../scripts/contracts/voices.ts';
import { CUSTOM_VISUAL_STYLE, DEFAULT_STYLE_NAME, normalizeVisualStyle, visualPreferencesFor, VISUAL_STYLE_NAMES } from '../../scripts/contracts/visual.ts';
import { CREATIVE_DEPTHS, DIALOGUE_MODES } from '../../scripts/contracts/creative.ts';
import { projectFields, settingsVoiceField } from './fields.ts';
import {
  SettingsForm,
  SettingsFormModel,
  settingsNumberField,
  settingsTextField,
} from '@deepseek-ai/dsh-client-ui-primitives';

/** 宿主页面提供的浏览器端上下文（结构类型，不 import cordis）。 */
interface ClientCtx {
  slots: {
    inject(name: string, register: () => (() => void) | undefined): void;
    register(options: Record<string, unknown>, component: unknown): () => void;
  };
  locale: {
    bind(ns: string): (key: string) => string;
    register(ns: string, dict: Record<string, Record<string, string>>): () => void;
  };
  configForms: ConfigForms;
  effect(fn: () => (() => void) | void, name?: string): void;
}

interface ConfigFormSnapshot {
  status: 'loading' | 'ready';
  value?: Record<string, unknown>;
  base?: Record<string, unknown>;
  user?: Record<string, unknown>;
  revision?: number;
  writable: boolean;
}

interface ConfigForm {
  getSnapshot(): ConfigFormSnapshot;
  subscribe(listener: () => void): () => void;
  mutate(ops: FormOp[], revision?: number): Promise<boolean>;
}

interface ConfigForms {
  get(id: string): ConfigForm;
  /** 共享的 describe 镜像：answer 哪些命名空间正被宿主服务（dsh-usage 用它定位行 id）。 */
  describe(): {
    getSnapshot(): { view?: { namespaces?: { ns: string }[] } };
    subscribe(listener: () => void): () => void;
  };
}

interface FormOp {
  op: 'set' | 'unset';
  path: string[];
  value?: unknown;
}

/** 命名空间候选：bundle patch 的行 id 优先，包名兜底。 */
const NS_CANDIDATES = ['foldercast', 'dsh-foldercast'] as const;
/** 词典命名空间。 */
const NS = 'foldercast.settings';

const zh = {
  title: '目录放映',
  description: '视频与导览页的美术、创作和配音默认值。讲稿中的设置优先。',
  visualStyle: '整体美术风格',
  visualStyleHint: '用于视频与默认导览页。风格名称和下面的创作指导会一起交给 Agent。',
  styleDirection: '查看当前风格的创作指导',
  customStyle: '自定义风格',
  customName: '自定义风格名称（可选）',
  customNameHint: '名称会和效果描述一起交给 Agent；留空使用“自定义风格”。',
  customNamePlaceholder: '例如：水墨风格、复古海报风格',
  customBaseStyle: '基础视觉预设',
  customBaseStyleHint: '控制实际配色、字体和卡片观感；Agent 按你的效果描述创作，不附加这套预设的创作指导。',
  customPrompt: '想要的效果',
  customPromptHint: '自由描述视觉气质、场景组织、素材和节奏。文字会交给 Agent；当前画面仍使用基础预设和已有场景模板。',
  customPromptPlaceholder: '例如：希望有水墨画的留白感，用少量代表性图片和简洁流程讲解，节奏舒缓，避免密集代码。',
  missingCustomPrompt: '请填写想要的效果；也可以选择已有风格。',
  visualPrompt: '自定义美术提示词',
  visualPromptHint: '引导场景设计、选材和节拍；需重新写稿并评审后生效，不直接生成 CSS。',
  artGroup: '美术风格',
  creativeGroup: '创作与沟通',
  creativeMore: '深度、时长与提示词',
  dialogue: '创作前沟通方式',
  dialogueHint: '只询问影响创作取舍的问题；已经说明或填写的内容不重复追问。',
  dialogueNeeded: '按需询问',
  dialogueFirst: '先沟通目标',
  dialogueDirect: '直接规划',
  audience: '默认受众',
  audienceHint: '说明观众是谁、已经了解什么；留空由 Agent 判断。',
  audiencePlaceholder: '例如：熟悉 TypeScript，但不了解这个项目的开发者',
  focus: '默认讲述重点',
  focusHint: '希望回答的问题或优先讲解的内容；本次对话中的要求优先。',
  focusPlaceholder: '例如：主要用途、核心流程和关键设计取舍',
  depth: '讲述深度参考',
  depthHint: '作为规划起点，Agent 可结合内容复杂性调整并说明理由。',
  depthAuto: '自动判断',
  depthQuick: '快速导览',
  depthStandard: '标准讲解',
  depthDeep: '深入讲解',
  videoMinutes: '视频目标时长（分钟）',
  videoMinutesHint: '内容预算参考；留空自动规划。不会直接缩放画面或截断音频。',
  pageMinutes: '导览页目标阅读时间（分钟）',
  pageMinutesHint: '预期阅读量参考；留空自动规划。实际阅读时间因人而异。',
  creativePrompt: '创作沟通提示词',
  creativePromptHint: '补充如何提问和取舍的指导；已有讲稿不会自动改写。',
  creativePromptPlaceholder: '例如：先问清观众和最想了解的问题，再推荐讲解范围；规模统计仅供参考，不按代码行数机械决定时长。',
  autoPlaceholder: '自动规划',
  invalidMinutes: '请填不少于 0.01 的分钟数；留空自动规划。',
  voiceGroup: '配音',
  advancedGroup: '高级设置',
  customVoice: '自定义音色…',
  defaultVoice: '默认音色',
  voicePlaceholder: '输入当前引擎支持的音色名',
  visualPromptPlaceholder: '例如：多用流程图和左右对比，减少长代码摘录；先展示结论，再逐步解释。',
  swiss: '瑞士风格',
  editorial: '编辑设计风格',
  tech: '科技风格',
  followStyle: '跟随整体美术风格',
  browserPlaceholder: '自动检测浏览器',
  concurrencyPlaceholder: '默认 1',
  styleDisabled: '当前 edge 不支持朗读风格；切换到 mimo 后可填写。',
  provider: '配音引擎',
  providerHint: '都要网络。edge 免密钥（默认）；mimo 中文更自然，需要 MIMO_API_KEY。',
  mimoKeyHint: 'MiMo 密钥不填在这张表单。可在被讲解目录的 .env 或 $DSH_HOME/.env（默认 ~/.dsh/.env）配置 MIMO_API_KEY；进程环境变量优先。',
  voice: '音色',
  voiceHint: 'provider 各自的叫法（edge 如 zh-CN-XiaoxiaoNeural）。留空自动挑中文音色。',
  style: '朗读风格',
  styleHint: '自然语描述（如「自然、清晰的讲解语气」）。mimo 用作风格指令；edge 表达不了。',
  browserPath: '浏览器路径',
  browserPathHint: '渲染用的 Chrome / Chromium 可执行文件。留空自动找系统 Chrome。',
  concurrency: '渲染并发数',
  concurrencyHint: '默认 1：多并发会让同一份讲稿渲不出逐帧一致的画面。',
  pageStyle: '导览页单独风格',
  pageStyleHint: '默认跟随整体美术风格；只有需要 HTML 与视频风格不同时才单独设置。',
  overridden: '已覆盖',
  reset: '恢复默认',
  readOnly: '本部署的设置为只读。',
  unavailable: '该插件当前未加载，暂时无法配置。',
  save: '保存',
  saving: '保存中…',
  saveFailed: '本部署没有接受这些值，已保留供你修改。',
  invalidConcurrency: '请填 1–8 的整数；留空表示使用默认值。',
};

const en = {
  title: 'Foldercast',
  description: 'Default visual, creative and voice settings. Script settings take precedence.',
  visualStyle: 'Visual style',
  visualStyleHint: 'For video and the default HTML guide. The agent receives both the style name and its creative guidance.',
  styleDirection: 'View creative guidance for this style',
  customStyle: 'Custom style',
  customName: 'Custom style name (optional)',
  customNameHint: 'The agent receives this name with your description. Leave blank to use “Custom style”.',
  customNamePlaceholder: 'For example: ink wash or vintage poster',
  customBaseStyle: 'Base visual preset',
  customBaseStyleHint: 'Controls colors, fonts and cards. The agent follows your description without adding the base preset’s creative guidance.',
  customPrompt: 'Desired effect',
  customPromptHint: 'Describe the mood, scene organization, materials and pacing. The agent receives your text; visuals still use the base preset and existing scene templates.',
  customPromptPlaceholder: 'For example: ink-wash-inspired negative space, representative images and simple flows, calm pacing and less dense code.',
  missingCustomPrompt: 'Describe the desired effect, or select a built-in style.',
  visualPrompt: 'Custom art direction',
  visualPromptHint: 'Guides scene design, selection and beats. Rewrite and review the script to apply; not direct CSS.',
  artGroup: 'Visual style',
  creativeGroup: 'Creative planning and dialogue',
  creativeMore: 'Depth, duration and instructions',
  dialogue: 'Before authoring',
  dialogueHint: 'Ask only questions that affect creative choices. Do not repeat answered questions.',
  dialogueNeeded: 'Ask when needed',
  dialogueFirst: 'Discuss goals first',
  dialogueDirect: 'Plan directly',
  audience: 'Default audience',
  audienceHint: 'Who is watching and what do they already know? Leave blank for the agent to infer.',
  audiencePlaceholder: 'For example: developers who know TypeScript but not this project',
  focus: 'Default focus',
  focusHint: 'Questions or topics to prioritize. Current conversation instructions take precedence.',
  focusPlaceholder: 'For example: purpose, core flow and key design tradeoffs',
  depth: 'Suggested depth',
  depthHint: 'A starting point; the agent may adjust it for the content and explain why.',
  depthAuto: 'Infer from context',
  depthQuick: 'Quick tour',
  depthStandard: 'Standard explanation',
  depthDeep: 'Deep explanation',
  videoMinutes: 'Video target duration (minutes)',
  videoMinutesHint: 'A content budget. Leave blank for automatic planning; no direct timeline scaling or audio truncation.',
  pageMinutes: 'Guide target reading time (minutes)',
  pageMinutesHint: 'A reading-content budget. Leave blank for automatic planning; actual reading time varies.',
  creativePrompt: 'Creative dialogue instructions',
  creativePromptHint: 'Guide questions and content choices. Existing scripts are not rewritten automatically.',
  creativePromptPlaceholder: 'For example: ask about the audience and their main question, then recommend a scope. Do not decide duration mechanically from line counts.',
  autoPlaceholder: 'Plan automatically',
  invalidMinutes: 'Enter at least 0.01 minutes, or leave blank for automatic planning.',
  voiceGroup: 'Voice-over',
  advancedGroup: 'Advanced settings',
  customVoice: 'Custom voice…',
  defaultVoice: 'Default voice',
  voicePlaceholder: 'A voice supported by this provider',
  visualPromptPlaceholder: 'For example: use more flows and comparisons, less code; reveal the conclusion before the explanation.',
  swiss: 'Swiss style',
  editorial: 'Editorial Design',
  tech: 'Tech-inspired Design',
  followStyle: 'Follow the visual style',
  browserPlaceholder: 'Detect browser automatically',
  concurrencyPlaceholder: 'Default: 1',
  styleDisabled: 'edge does not support voice instructions. Select mimo to configure them.',
  provider: 'Voice engine',
  providerHint: 'Both need network. edge is key-free (default); mimo sounds more natural in Chinese and needs MIMO_API_KEY.',
  mimoKeyHint: 'Configure MIMO_API_KEY in the source directory’s .env or $DSH_HOME/.env (default: ~/.dsh/.env). Process environment takes priority; this form does not store keys.',
  voice: 'Voice',
  voiceHint: 'A voice name in the provider\'s namespace (e.g. zh-CN-XiaoxiaoNeural for edge). Left blank, a Chinese voice is picked automatically.',
  style: 'How to read',
  styleHint: 'Natural-language style (e.g. "natural, clear narration"). mimo uses it as an instruction; edge cannot express it.',
  browserPath: 'Browser path',
  browserPathHint: 'Chrome / Chromium executable for rendering. Left blank, the system Chrome is used.',
  concurrency: 'Render concurrency',
  concurrencyHint: 'Defaults to 1: higher values break frame-for-frame reproducibility.',
  pageStyle: 'Page style',
  pageStyleHint: 'Follow the visual style by default; override only when the HTML guide should differ from the video.',
  overridden: 'Overridden',
  reset: 'Reset to default',
  readOnly: 'This deployment stores settings read-only.',
  unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
  save: 'Save',
  saving: 'Saving…',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  invalidConcurrency: 'Enter an integer from 1 to 8, or leave blank to use the default.',
};

/** 表单字段：扁平键（模型与控件用）→ Config 里的嵌套路径（读写用）。 */
const FIELDS = [
  { key: 'dialogue', path: ['creative', 'dialogue'], numeric: false },
  { key: 'audience', path: ['creative', 'audience'], numeric: false },
  { key: 'focus', path: ['creative', 'focus'], numeric: false },
  { key: 'depth', path: ['creative', 'depth'], numeric: false },
  { key: 'videoMinutes', path: ['creative', 'videoMinutes'], numeric: true },
  { key: 'pageMinutes', path: ['creative', 'pageMinutes'], numeric: true },
  { key: 'creativePrompt', path: ['creative', 'prompt'], numeric: false },
  { key: 'visualStyle', path: ['visual', 'style'], numeric: false },
  { key: 'visualPrompt', path: ['visual', 'prompt'], numeric: false },
  { key: 'customName', path: ['visual', 'customName'], numeric: false },
  { key: 'customBaseStyle', path: ['visual', 'customBaseStyle'], numeric: false },
  { key: 'provider', path: ['voice', 'provider'], numeric: false },
  { key: 'voice', path: ['voice', 'voice'], numeric: false },
  { key: 'style', path: ['voice', 'style'], numeric: false },
  { key: 'browserPath', path: ['render', 'browserPath'], numeric: false },
  { key: 'concurrency', path: ['render', 'concurrency'], numeric: true },
  { key: 'pageStyle', path: ['page', 'style'], numeric: false },
] as const;

type FieldKey = (typeof FIELDS)[number]['key'];

/**
 * 把 `configForms.get(ns)` 包成**扁平**作用域：SettingsFormModel 只认
 * `snapshot.value[field]` 顶层键与 `path: [field]` 的单段 op，而我们的字段嵌套在配置分组之下。
 * 读：摊平；写：把 `[key]` 还原成注册时的嵌套路径。
 */
function flattenScope(scope: ConfigForm): ConfigForm {
  return {
    getSnapshot: () => {
      const snap = scope.getSnapshot();
      return {
        ...snap,
        value: projectFields(snap.value, FIELDS),
        base: projectFields(snap.base, FIELDS),
        user: projectFields(snap.user, FIELDS, true),
      };
    },
    subscribe: (listener) => scope.subscribe(listener),
    mutate: (ops, revision) =>
      scope.mutate(
        ops.map((op) => {
          const field = FIELDS.find((item) => item.key === op.path[0]);
          return field === undefined ? op : { ...op, path: [...field.path] };
        }),
        revision,
      ),
  };
}

/**
 * 绑定宿主正在服务的命名空间。多数部署答 `foldercast`（bundle patch 的行 id），
 * 但 id 归宿主编排所有，所以按 describe 镜像解析、镜像换答案时重绑
 * （dsh-usage 的 createServedEntryForm 的紧凑版）。id 没变的镜像更新**不**通知 ——
 * 那种更新只是 revision 变了，重建模型会把用户暂存的草稿丢掉。
 */
function bindServedScope(ctx: ClientCtx, onRetarget: () => void): { current: () => ConfigForm } {
  let current: ConfigForm = ctx.configForms.get(NS_CANDIDATES[0]);
  let boundId: string = NS_CANDIDATES[0];
  const resolve = (): string => {
    let served: readonly string[] | undefined;
    try {
      served = ctx.configForms.describe().getSnapshot().view?.namespaces?.map((row) => row.ns);
    } catch {
      served = undefined;
    }
    if (served === undefined || served.length === 0) return NS_CANDIDATES[0];
    const list = served;
    return NS_CANDIDATES.find((id) => list.includes(id)) ?? NS_CANDIDATES[0];
  };
  const rebind = (): void => {
    const target = resolve();
    if (target === boundId) return;
    boundId = target;
    try {
      current = ctx.configForms.get(target);
    } catch {
      // 服务拒绝该 id：保持原绑定，镜像的下一次回答会重试
    }
    onRetarget();
  };
  try {
    ctx.configForms.describe().subscribe(() => {
      rebind();
    });
  } catch {
    // 镜像拒绝订阅：保留初始绑定
  }
  return { current: () => current };
}

/** 表单框文案（SettingsForm 的 labels）。 */
function formLabels(t: (key: string) => string): Record<string, string> {
  return {
    unavailable: t('unavailable'),
    readOnly: t('readOnly'),
    saveFailed: t('saveFailed'),
    save: t('save'),
    saving: t('saving'),
  };
}

type CardState = Record<FieldKey, FieldState> & {
  available: boolean;
  writable: boolean;
  invalid: boolean;
};

interface FieldState {
  text: string;
  overridden: boolean;
  invalid: boolean;
}

interface CardStore {
  getSnapshot(): CardState;
  subscribe(listener: () => void): () => void;
}

interface FormActions {
  save(): void;
  discard(): void;
  edit(field: string, text: string): void;
  resetField(field: string): void;
}

/**
 * 表单主体。SettingsForm 自带保存/放弃控件；每个字段一次注册
 * （label、hint、覆盖标记与重置）。
 */
function renderForm(
  t: (key: string) => string,
  state: CardState,
  actions: Pick<FormActions, 'save' | 'discard' | 'edit' | 'resetField'>,
): ReactNode {
  const disabled = !state.writable;
  const provider = state.provider.text || 'edge';
  const customStyle = state.visualStyle.text === CUSTOM_VISUAL_STYLE;
  const invalidFor = (key: FieldKey): boolean => {
    if (state[key].invalid) return true;
    if (key === 'visualPrompt') return customStyle && state[key].text.trim() === '';
    if (key === 'concurrency') {
      const value = state[key].text.trim();
      return value !== '' && (!Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 8);
    }
    if (key !== 'videoMinutes' && key !== 'pageMinutes') return false;
    const value = state[key].text.trim();
    return value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0.01);
  };
  const invalidBudget = invalidFor('videoMinutes') || invalidFor('pageMinutes');
  const invalidForm = invalidBudget || invalidFor('visualPrompt') || invalidFor('concurrency');
  const id = (key: string): string => `plugin-config-foldercast-${key}`;
  const baseStyleOptions = VISUAL_STYLE_NAMES.map((name, index) => h('option', { key: name, value: name },
    t(['swiss', 'editorial', 'tech'][index]!)));
  const styleOptions = [...baseStyleOptions, h('option', { key: CUSTOM_VISUAL_STYLE, value: CUSTOM_VISUAL_STYLE }, t('customStyle'))];
  const preferences = visualPreferencesFor(state.visualStyle.text, state.visualPrompt.text,
    { name: state.customName.text, baseStyle: normalizeVisualStyle(state.customBaseStyle.text) });
  const field = (key: FieldKey, control: ReactNode, hint = t(`${key}Hint`), label = t(key)): ReactNode => h('div',
    { key, className: 'fc-setting' },
    h('div', { className: 'fc-setting-label' },
      h('label', { htmlFor: id(key) }, label),
      state[key].overridden ? h('span', { className: 'fc-setting-status' }, t('overridden')) : null,
      state[key].overridden ? h('button', { type: 'button', disabled, className: 'fc-setting-reset',
        onClick: () => actions.resetField(key) }, t('reset')) : null),
    control,
    h('div', { id: `${id(key)}-hint`, className: 'fc-setting-hint' }, hint));
  const propsFor = (key: FieldKey) => ({ id: id(key), disabled,
    'aria-describedby': `${id(key)}-hint`, 'aria-invalid': invalidFor(key) });
  const select = (key: FieldKey, fallback: string, options: ReactNode): ReactNode => h('select', {
    ...propsFor(key), value: (key === 'visualStyle' || key === 'pageStyle' || key === 'customBaseStyle'
      ? normalizeVisualStyle(state[key].text) ?? state[key].text : state[key].text) || fallback,
    onChange: (event: { currentTarget: { value: string } }) => actions.edit(key, event.currentTarget.value),
  }, options);
  const text = (key: FieldKey, placeholder?: string, blocked = false): ReactNode => h('input', {
    ...propsFor(key), disabled: disabled || blocked, value: state[key].text, placeholder,
    type: FIELDS.find((field) => field.key === key)?.numeric ? 'number' : 'text',
    ...(key === 'concurrency' ? { min: 1, max: 8, step: 1 } : {}),
    ...(key === 'videoMinutes' || key === 'pageMinutes' ? { min: 0.01, step: 'any' } : {}),
    onChange: (event: { currentTarget: { value: string } }) => actions.edit(key, event.currentTarget.value),
  });
  const textarea = (key: FieldKey, placeholder: string): ReactNode => h('textarea', {
    ...propsFor(key), rows: 3, value: state[key].text, placeholder,
    onChange: (event: { currentTarget: { value: string } }) => actions.edit(key, event.currentTarget.value),
  });
  const options = (values: readonly string[], labels: readonly string[]): ReactNode[] => values.map((value, index) =>
    h('option', { key: value, value }, t(labels[index]!)));
  return h(
    SettingsForm as never,
    {
      labels: formLabels(t),
      state: { ...state, invalid: state.invalid || invalidForm },
      onSave: () => { if (!invalidForm) actions.save(); },
      onDiscard: actions.discard,
    },
    h('section', { className: 'fc-setting-group' }, h('h3', null, t('creativeGroup')),
      field('dialogue', select('dialogue', '按需询问', options(DIALOGUE_MODES,
        ['dialogueNeeded', 'dialogueFirst', 'dialogueDirect']))),
      field('audience', text('audience', t('audiencePlaceholder'))),
      field('focus', text('focus', t('focusPlaceholder'))),
      h('details', { className: 'fc-creative-more' }, h('summary', null, t('creativeMore')),
        field('depth', select('depth', '自动判断', options(CREATIVE_DEPTHS,
          ['depthAuto', 'depthQuick', 'depthStandard', 'depthDeep']))),
        field('videoMinutes', text('videoMinutes', t('autoPlaceholder')),
          invalidFor('videoMinutes') ? t('invalidMinutes') : t('videoMinutesHint')),
        field('pageMinutes', text('pageMinutes', t('autoPlaceholder')),
          invalidFor('pageMinutes') ? t('invalidMinutes') : t('pageMinutesHint')),
        field('creativePrompt', textarea('creativePrompt', t('creativePromptPlaceholder'))))),
    h('section', { className: 'fc-setting-group' }, h('h3', null, t('artGroup')),
      field('visualStyle', select('visualStyle', DEFAULT_STYLE_NAME, styleOptions)),
      customStyle ? field('customName', text('customName', t('customNamePlaceholder'))) : null,
      customStyle ? field('customBaseStyle', select('customBaseStyle', DEFAULT_STYLE_NAME, baseStyleOptions)) : null,
      h('details', null, h('summary', null, t('styleDirection')),
        h('p', { className: 'fc-style-direction' }, preferences.stylePrompt)),
      field('visualPrompt', textarea('visualPrompt', t(customStyle ? 'customPromptPlaceholder' : 'visualPromptPlaceholder')),
        t(invalidFor('visualPrompt') ? 'missingCustomPrompt' : customStyle ? 'customPromptHint' : 'visualPromptHint'),
        t(customStyle ? 'customPrompt' : 'visualPrompt'))),
    h('section', { className: 'fc-setting-group' }, h('h3', null, t('voiceGroup')),
      field('provider', h('select', { ...propsFor('provider'), value: provider,
        onChange: (event: { currentTarget: { value: string } }) => {
          actions.edit('provider', event.currentTarget.value);
          // 显式留空，避免继承配置中另一个引擎的音色名。
          actions.edit('voice', '');
        } }, h('option', { value: 'edge' }, 'edge'), h('option', { value: 'mimo' }, 'mimo'))),
      provider === 'mimo' ? h('p', { className: 'fc-setting-hint' }, t('mimoKeyHint')) : null,
      field('voice', h(VoiceControl, { key: provider, id: id('voice'), provider, value: state.voice.text,
        disabled, t, onEdit: (value: string) => actions.edit('voice', value) })),
      field('style', text('style', undefined, provider === 'edge'),
        provider === 'edge' ? t('styleDisabled') : t('styleHint'))),
    h('details', { className: 'fc-setting-group' }, h('summary', null, t('advancedGroup')),
      field('browserPath', text('browserPath', t('browserPlaceholder'))),
      field('concurrency', text('concurrency', t('concurrencyPlaceholder')),
        invalidFor('concurrency') ? t('invalidConcurrency') : t('concurrencyHint')),
      field('pageStyle', select('pageStyle', '跟随美术风格', [
        h('option', { key: 'follow', value: '跟随美术风格' }, t('followStyle')), ...baseStyleOptions,
      ]))),
  );
}

function VoiceControl(props: { id: string; provider: string; value: string; disabled: boolean;
  t: (key: string) => string; onEdit: (value: string) => void }): ReactNode {
  const [custom, setCustom] = useState(false);
  const voices = voicesFor(props.provider);
  const isCustom = custom || (props.value !== '' && !voices.includes(props.value));
  return h('div', { className: 'fc-voice-control' },
    h('select', { id: props.id, disabled: props.disabled, value: isCustom ? '__custom__' : props.value,
      'aria-describedby': `${props.id}-hint`,
      onChange: (event: { currentTarget: { value: string } }) => {
        const value = event.currentTarget.value;
        setCustom(value === '__custom__');
        if (value !== '__custom__') props.onEdit(value);
      } },
    h('option', { value: '' }, `${props.t('defaultVoice')} · ${defaultVoiceFor(props.provider)}`),
    ...voices.map((voice) => h('option', { key: voice, value: voice }, voice)),
    h('option', { value: '__custom__' }, props.t('customVoice'))),
    isCustom ? h('input', { 'aria-label': props.t('customVoice'), disabled: props.disabled,
      value: props.value, placeholder: props.t('voicePlaceholder'),
      onChange: (event: { currentTarget: { value: string } }) => props.onEdit(event.currentTarget.value) }) : null);
}

const SETTINGS_CSS = `
.foldercast-settings .fc-setting-group { margin: 20px 0; padding-top: 16px; border-top: 1px solid rgba(128,128,128,.25); }
.foldercast-settings h3, .foldercast-settings summary { margin: 0 0 14px; font-size: 14px; font-weight: 600; }
.foldercast-settings summary { cursor: pointer; }
.foldercast-settings .fc-setting { margin: 14px 0; }
.foldercast-settings .fc-setting-label { display: flex; gap: 10px; align-items: center; margin-bottom: 7px; }
.foldercast-settings label { font-size: 13px; font-weight: 500; flex: 1; }
.foldercast-settings .fc-setting-status, .foldercast-settings .fc-setting-reset { font-size: 11px; opacity: .65; }
.foldercast-settings .fc-setting-reset { cursor: pointer; background: transparent; border: 0; color: inherit; }
.foldercast-settings input, .foldercast-settings select, .foldercast-settings textarea {
  box-sizing: border-box; width: 100%; padding: 9px 12px; border: 1px solid rgba(128,128,128,.4);
  border-radius: 8px; color: inherit; background: transparent; font: inherit; font-size: 13px;
}
.foldercast-settings select option { color: initial; background: initial; }
.foldercast-settings textarea { resize: vertical; line-height: 1.5; }
.foldercast-settings input:disabled { opacity: .45; }
.foldercast-settings .fc-setting-hint { margin-top: 6px; font-size: 12px; line-height: 1.5; opacity: .65; }
.foldercast-settings .fc-style-direction { font-size: 13px; line-height: 1.7; opacity: .8; }
.foldercast-settings .fc-voice-control input { margin-top: 8px; }
.foldercast-settings [aria-invalid=true] { border-color: #D66B60; }
`;

/**
 * 设置窗侧栏页组件（`settings.section`）。face 原样透传（不转 hooks），
 * 状态自己用 `useSyncExternalStore` 读 —— 与 dsh-usage 的 UsageSectionCard 同法。
 */
function SectionCard(props: {
  t: (key: string) => string;
  store: CardStore;
  save: () => void;
  discard: () => void;
  edit: (field: string, text: string) => void;
  resetField: (field: string) => void;
}) {
  const state = useSyncExternalStore(props.store.subscribe, props.store.getSnapshot);
  return h(
    'div',
    { className: 'foldercast-settings', style: { padding: '8px 4px', maxWidth: 760 } },
    h('style', null, SETTINGS_CSS),
    h('div', { style: { fontSize: 15, fontWeight: 600 } }, props.t('title')),
    h('div', { style: { fontSize: 13, opacity: 0.7 } }, props.t('description')),
    renderForm(props.t, state, props),
  );
}

/** 浏览器端插件体：注册词典与设置窗侧栏页（`settings.section`）。 */
export function apply(ctx: ClientCtx): void {
  const t = ctx.locale.bind(NS);
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'foldercast: dictionaries');

  const served = bindServedScope(ctx, () => {
    rebuild();
  });
  let model: InstanceType<typeof SettingsFormModel> | undefined;
  let store: { getSnapshot(): CardState; subscribe(listener: () => void): () => void } | undefined;

  // 命名空间重绑（describe 镜像换答案）时模型重建；平常的 revision 更新不重建，
  // 用户暂存的草稿得以保留。
  const rebuild = (): void => {
    model?.dispose();
    const flat = flattenScope(served.current());
    const next = new SettingsFormModel(flat as never,
      FIELDS.map((field) => field.key === 'voice' ? settingsVoiceField(field.key)
        : field.numeric ? settingsNumberField(field.key) : settingsTextField(field.key)) as never);
    store = next.bind(() => ({
      ...next.shell(),
      ...Object.fromEntries(FIELDS.map((field) => [field.key, next.field(field.key)])),
    })) as never;
    model = next as never;
  };
  rebuild();
  // 命名空间重绑的触发在 bindServedScope 里（只有 id 真的变了才 rebuild）。

  ctx.effect(
    () => () => {
      model?.dispose();
    },
    'foldercast: form subscription',
  );

  // 设置窗口左侧栏自己的页（「使用统计」同款）：face 原样透传，
  // 组件自己 useSyncExternalStore 读状态。
  const actions = (): FormActions =>
    (model?.actions() ?? {
      save: () => {},
      discard: () => {},
      edit: () => {},
      resetField: () => {},
    }) as FormActions;
  const sectionFace = (): Record<string, unknown> => ({
    t,
    store,
    ...actions(),
  });

  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'foldercast',
        order: 160,
        label: () => t('title'),
        locale: NS,
        inject: sectionFace,
      },
      SectionCard,
    ),
  );
}

/** 模块面：ModuleLoader 的 factory 返回它，客户端按 cordis 插件激活。 */
export const inject = ['slots', 'locale', 'configForms'];
