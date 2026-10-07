/**
 * foldercast 的浏览器半侧：把 Config 设置表单画在插件管理器的行详情页上。
 *
 * 宿主半侧（src/index.ts）只声明 Config schema —— 那让 settings 服务**能**生成表单，
 * 但表单要由插件自己的客户端模块认领 `plugins.row.config` slot 才会被画出来
 * （插件管理器只渲染注册了这个 slot 的行）。本文件就是那个模块。
 *
 * 结构照抄官方伴生包 `@deepseek-ai/dsh-client-ui-settings-shell`：
 * `inject: ['slots', 'locale', 'configForms']` → `SettingsFormModel` 管暂存与保存 →
 * 组件用 `SettingsForm` / `SettingsValueField` 渲染。唯一的偏差是我们的字段在
 * Config 里是**嵌套的**（`voice.voice` / `render.concurrency`），而模型只认扁平键
 * （`snapshot.value[field]`），所以 `configForms.get(ns)` 外面包了一层**扁平投影**
 * （`flattenScope`）：读时把嵌套值摊平，写时把扁平 op 的路径还原成嵌套数组。
 *
 * 构建产物是 `window.__ModuleLoader__.load({ id, factory })` 格式（`lib/client.js`），
 * react 与 `@deepseek-ai/dsh-client-ui-*` 由宿主页面提供（factory 的 `require`），
 * **不是**本包的依赖 —— 见 scripts/tools/build-client.mjs 与 dependencies.test 的豁免。
 */
import { createElement as h, useSyncExternalStore, type ReactNode } from 'react';
import {
  SettingsForm,
  SettingsFormModel,
  SettingsValueField,
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
  description: '配音、渲染与导览页的默认参数。',
  provider: '配音引擎',
  providerHint: '都要网络。edge 免密钥（默认）；mimo 中文更自然，需要 MIMO_API_KEY。',
  voice: '音色',
  voiceHint: 'provider 各自的叫法（edge 如 zh-CN-XiaoxiaoNeural）。留空自动挑中文音色。',
  style: '怎么读',
  styleHint: '自然语描述（如「自然、清晰的讲解语气」）。mimo 用作风格指令；edge 表达不了。',
  browserPath: '浏览器路径',
  browserPathHint: '渲染用的 Chrome / Chromium 可执行文件。留空自动找系统 Chrome。',
  concurrency: '渲染并发数',
  concurrencyHint: '默认 1：多并发会让同一份讲稿渲不出逐帧一致的画面。',
  pageStyle: '导览页风格',
  pageStyleHint: '素稿（纸面白底，默认）/ 杂志（暖纸衬线）/ 夜幕（深底，与成片同色）。',
  overridden: '已覆盖',
  reset: '恢复默认',
  readOnly: '本部署的设置为只读。',
  unavailable: '该插件当前未加载，暂时无法配置。',
  save: '保存',
  saving: '保存中…',
  saveFailed: '本部署没有接受这些值，已保留供你修改。',
  invalidNumber: '请填数字；留空表示使用默认值。',
};

const en = {
  title: 'Foldercast',
  description: 'Default voice-over, render and page parameters.',
  provider: 'Voice engine',
  providerHint: 'Both need network. edge is key-free (default); mimo sounds more natural in Chinese and needs MIMO_API_KEY.',
  voice: 'Voice',
  voiceHint: 'A voice name in the provider\'s namespace (e.g. zh-CN-XiaoxiaoNeural for edge). Left blank, a Chinese voice is picked automatically.',
  style: 'How to read',
  styleHint: 'Natural-language style (e.g. "natural, clear narration"). mimo uses it as an instruction; edge cannot express it.',
  browserPath: 'Browser path',
  browserPathHint: 'Chrome / Chromium executable for rendering. Left blank, the system Chrome is used.',
  concurrency: 'Render concurrency',
  concurrencyHint: 'Defaults to 1: higher values break frame-for-frame reproducibility.',
  pageStyle: 'Page style',
  pageStyleHint: '素稿 (plain, default) / 杂志 (editorial) / 夜幕 (dark, same palette as the film).',
  overridden: 'Overridden',
  reset: 'Reset to default',
  readOnly: 'This deployment stores settings read-only.',
  unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
  save: 'Save',
  saving: 'Saving…',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  invalidNumber: 'Enter a number, or leave blank to use the default.',
};

/** 表单字段：扁平键（模型与控件用）→ Config 里的嵌套路径（读写用）。 */
const FIELDS = [
  { key: 'provider', path: ['voice', 'provider'], numeric: false },
  { key: 'voice', path: ['voice', 'voice'], numeric: false },
  { key: 'style', path: ['voice', 'style'], numeric: false },
  { key: 'browserPath', path: ['render', 'browserPath'], numeric: false },
  { key: 'concurrency', path: ['render', 'concurrency'], numeric: true },
  { key: 'pageStyle', path: ['page', 'style'], numeric: false },
] as const;

type FieldKey = (typeof FIELDS)[number]['key'];

/** 沿路径取嵌套对象的值；任一层不是对象就返回 undefined。 */
function at(obj: Record<string, unknown> | undefined, path: readonly string[]): unknown {
  let current: unknown = obj;
  for (const segment of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * 把 `configForms.get(ns)` 包成**扁平**作用域：SettingsFormModel 只认
 * `snapshot.value[field]` 顶层键与 `path: [field]` 的单段 op，而我们的字段嵌套两组之下。
 * 读：摊平；写：把 `[key]` 还原成注册时的嵌套路径。
 */
function flattenScope(scope: ConfigForm): ConfigForm {
  const value = (layer: Record<string, unknown> | undefined, pickUser: boolean): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const field of FIELDS) {
      const nested = at(layer, field.path);
      // user 层只回答「有没有覆盖」（模型用 Object.hasOwn 判断），有路径就记一个键
      out[field.key] = pickUser ? (nested === undefined ? undefined : true) : nested;
    }
    return out;
  };
  return {
    getSnapshot: () => {
      const snap = scope.getSnapshot();
      return {
        ...snap,
        value: value(snap.value, false),
        base: value(snap.base, false),
        user: value(snap.user, true),
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

interface CardState extends Record<string, unknown> {
  available: boolean;
  writable: boolean;
  provider: FieldState;
  voice: FieldState;
  style: FieldState;
  browserPath: FieldState;
  concurrency: FieldState;
  pageStyle: FieldState;
}

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
  return h(
    SettingsForm as never,
    {
      labels: formLabels(t),
      state,
      onSave: actions.save,
      onDiscard: actions.discard,
    },
    FIELDS.map((field) =>
      h(SettingsValueField as never, {
        key: field.key,
        id: `plugin-config-foldercast-${field.key}`,
        label: t(field.key),
        hint: t(`${field.key}Hint`),
        overriddenLabel: t('overridden'),
        resetLabel: t('reset'),
        invalidLabel: field.numeric ? t('invalidNumber') : '',
        numeric: field.numeric,
        disabled,
        ...state[field.key],
        onEdit: (text: string) => {
          actions.edit(field.key, text);
        },
        onReset: () => {
          actions.resetField(field.key);
        },
      }),
    ),
  );
}

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
    { style: { padding: '8px 4px', maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 12 } },
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
    const next = new SettingsFormModel(flat as never, [
      settingsTextField('provider'),
      settingsTextField('voice'),
      settingsTextField('style'),
      settingsTextField('browserPath'),
      settingsNumberField('concurrency'),
      settingsTextField('pageStyle'),
    ] as never);
    store = next.bind(() => ({
      ...next.shell(),
      provider: next.field('provider'),
      voice: next.field('voice'),
      style: next.field('style'),
      browserPath: next.field('browserPath'),
      concurrency: next.field('concurrency'),
      pageStyle: next.field('pageStyle'),
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
