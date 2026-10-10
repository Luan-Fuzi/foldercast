/**
 * dsh-foldercast 的插件入口。
 *
 * 三件事：注册一个工具、注册一个 skill、声明一个（空的）`Config` schema。
 *
 * **三条硬约束**：
 * 1. `apply()` 里不做任何可能失败的重活（不探测环境、不读配置、不起进程）——插件绝不能
 *    成为 required 条目，它崩了不能带崩宿主。环境探测推迟到首次工具调用。
 * 2. **不 import 任何 `@deepseek-ai/dsh-*` 包**。工具的注册用 `ctx.tools.register()` 直传
 *    定义（参数与输出用原生 JSON Schema），因为 `dsh-tools` 作为插件依赖会把它的依赖装进
 *    profile，实测会让宿主的加载器起不来（`Cannot read properties of undefined (reading
 *    'prepare')`）。`@deepseek-ai/schemastery` 是插件自己的依赖，装在哪一侧都安全。
 * 3. 因此 `Context` 也**不 import `@deepseek-ai/cordis` 的类型**，只声明用得到的那一小块
 *    （结构类型，宿主传进来的对象本来就是这个形状）。少一个框架依赖，少一处版本漂移。
 */
import { cast } from './cast.ts';
import { Config, resolveSettings, type FoldercastSettings, type RawConfig } from './config.ts';
import { SKILL_CONTENT, SKILL_DESCRIPTION, SKILL_NAME, SKILL_WHEN_TO_USE } from './skill.ts';

/**
 * 插件用到的宿主上下文。**只是结构描述，不是框架类型**：`tools` 由工具注册表提供
 * （`inject: ['tools']` 保证它在），`skills` 是可选的。
 */
type Context = {
  tools: { register: (definition: Record<string, unknown>) => unknown };
  get: (serviceName: string) => unknown;
};

export const name = 'foldercast';

/** 等工具注册表与 skill 注册表就绪。缺 skill 服务时只是注册不上 skill，工具照常。 */
export const inject = ['tools'];

export { Config };

type ToolRegistration = {
  register: (definition: Record<string, unknown>) => unknown;
};

type SkillRegistration = {
  register: (skill: {
    name: string;
    description: string;
    whenToUse?: string;
    content: string;
    /** 注册表在**加载时**会用 `validateDefinition` 复查，这里必须给，否则读取报「source must be a string」。 */
    source: string;
  }) => unknown;
};

/**
 * 工具的输出契约。
 *
 * 只声明**实际会返回的字段**，且都非必需 —— 失败路径下很多字段没有意义，把「缺席」
 * 表达成字段不存在，比塞一堆空值更清楚。
 */
const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    target: { type: 'string', description: '被讲解目录的绝对路径' },
    label: { type: 'string' },
    workRoot: { type: 'string', description: '工作根：所有产物都在它下面（<目录>/.foldercast/）' },
    error: { type: 'string', description: '要求的步骤失败或环境不满足时的一句话说明' },
    ran: {
      type: 'array',
      description: '这次调用实际跑了哪些步骤，按执行顺序（check / page / voice / render）',
      items: { type: 'string' },
    },
    dependencies: {
      type: 'array',
      description: '不可用的外部依赖。都可用时为空数组。',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { name: { type: 'string' }, hint: { type: 'string' } },
      },
    },
    stages: {
      type: 'object',
      additionalProperties: false,
      properties: {
        page: {
          type: 'object',
          additionalProperties: false,
          properties: { ok: { type: 'boolean' }, ms: { type: 'number' }, exitCode: { type: 'integer' }, error: { type: 'string' }, detail: { type: 'string' } },
        },
        check: {
          type: 'object',
          additionalProperties: false,
          properties: { ok: { type: 'boolean' }, ms: { type: 'number' }, exitCode: { type: 'integer' }, error: { type: 'string' }, detail: { type: 'string' } },
        },
        voice: {
          type: 'object',
          additionalProperties: false,
          properties: { ok: { type: 'boolean' }, ms: { type: 'number' }, exitCode: { type: 'integer' }, error: { type: 'string' }, detail: { type: 'string' } },
        },
        render: {
          type: 'object',
          additionalProperties: false,
          properties: { ok: { type: 'boolean' }, ms: { type: 'number' }, exitCode: { type: 'integer' }, error: { type: 'string' }, detail: { type: 'string' } },
        },
      },
    },
    validation: {
      type: 'object',
      additionalProperties: false,
      properties: {
        blocker: { type: 'integer' },
        warning: { type: 'integer' },
        issues: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              code: { type: 'string' },
              severity: { type: 'string' },
              message: { type: 'string' },
              path: { type: 'string' },
              sceneId: { type: 'string' },
              fix: { type: 'string' },
            },
          },
        },
      },
    },
    voiceName: { type: 'string', description: '实际使用的音色（从时长表读，不是配置里写的）' },
    videoPath: { type: 'string', description: '成片落点' },
    pagePath: { type: 'string', description: '导览页落点（评审后显式要求的自包含 HTML 产物）' },
    revision: { type: 'string', description: '当前讲稿、digest 与引用材料的内容版本；评审通过后传 reviewRevision 绑定此版本' },
    reviewAccepted: { type: 'boolean' },
    artifacts: {
      type: 'array', items: { type: 'object', additionalProperties: false,
        properties: { kind: { type: 'string' }, state: { type: 'string' }, mode: { type: 'string' } } },
    },
    notes: {
      type: 'array',
      description: '给模型看的一句话说明（如「配置选了未实现的 provider」）',
      items: { type: 'string' },
    },
  },
};

type CastLike = {
  ok: boolean;
  target: string;
  label: string;
  workRoot: string;
  error?: string;
  ran: string[];
  dependencies: { name: string; ok: boolean; hint: string }[];
  stages: Record<string, { ok: boolean; ms: number; exitCode?: number; error?: string; detail?: string } | undefined>;
  validation?: { blocker: number; warning: number; issues: { code: string; severity: string; message: string; path?: string; sceneId?: string }[] };
  voiceName?: string;
  videoPath?: string;
  pagePath?: string;
  notes?: string[];
  revision?: string;
  reviewAccepted?: boolean;
};

/**
 * 把结果压成给模型看的几句话。只说「发生了什么」，**不说「下一步做什么」**：
 * 该走哪一步由 skill 与模型判断。
 */
function renderResult(value: CastLike): string {
  const lines: string[] = [];

  if (!value.ok) lines.push(`没成功：${value.error ?? '见 stages'}`);

  for (const [stageName, stage] of Object.entries(value.stages)) {
    if (stage !== undefined && !stage.ok && stage.error !== undefined) {
      lines.push(`${stageName} 步骤失败：${stage.error}`);
    }
  }

  if (value.validation !== undefined) {
    lines.push(`校验：${String(value.validation.blocker)} 个必须修，${String(value.validation.warning)} 个待确认`);
    for (const issue of value.validation.issues.slice(0, 8)) {
      const where = issue.path === undefined ? '' : ` ${issue.path}`;
      const scene = issue.sceneId === undefined ? '' : `[${issue.sceneId}] `;
      lines.push(`  ${issue.severity === 'blocker' ? '×' : '!'} ${scene}${issue.message}${where}`);
    }
    if (value.validation.issues.length > 8) {
      lines.push(`  …另有 ${String(value.validation.issues.length - 8)} 条，见结构化输出`);
    }
  }

  const missing = value.dependencies.filter((dependency) => !dependency.ok);
  for (const dependency of missing) lines.push(`缺依赖 ${dependency.name}：${dependency.hint}`);

  for (const note of value.notes ?? []) lines.push(note);
  if (value.voiceName !== undefined) lines.push(`配音音色：${value.voiceName}`);
  if (value.videoPath !== undefined) lines.push(`成片落点：${value.videoPath}`);
  if (value.pagePath !== undefined) lines.push(`导览页落点：${value.pagePath}`);
  if (value.revision !== undefined) lines.push(`当前版本：${value.revision}`);
  if (value.reviewAccepted === true) lines.push('评审回执已绑定当前版本（程序只核对版本，不判断评审内容）。');

  return lines.join('\n');
}

function registerTool(ctx: Context, config: RawConfig | undefined): void {
  const tools = (ctx as unknown as { tools: ToolRegistration }).tools;

  tools.register({
    name: 'foldercast_cast',
    description:
      'Validate the foldercast script.json and return its revision. After independent review passes and review.md is written, pass reviewRevision to bind the verdict to that revision. Explicit page/voice/render outputs require a matching receipt; draft: true produces a work draft. Exploring, authoring and judging content remain the agent\'s job. Use for explicitly requested foldercast videos or HTML guides, not ordinary directory Q&A.',
    timeoutMs: 2_400_000,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path of the folder to cast.',
        },
        reviewRevision: { type: 'string', description: 'Declare the independent review passed for this revision (returned by validation). Requires review.md. Records review.json; does not judge the report content.' },
        draft: { type: 'boolean', description: 'Produce a work draft without a matching review receipt. Artifacts are recorded as draft, not approved.' },
        page: {
          type: 'boolean',
          description:
            'Produce the self-contained HTML guide page (out/page.html). Off by default: outputs come after the agent review, so they are requested explicitly. HTML-only means passing just this flag. Requires an existing script.json.',
        },
        render: {
          type: 'boolean',
          description:
            'Render the film. Off by default: it needs a browser and takes minutes to tens of minutes. Requires an existing script.json.',
        },
        voice: {
          type: 'boolean',
          description:
            'Synthesise the narration before rendering. Off by default. Provider comes from settings (edge: key-free cloud; mimo: needs MIMO_API_KEY). Requires network. Requires an existing script.json.',
        },
        voiceName: {
          type: 'string',
          description: 'Voice name in the provider\'s own namespace (e.g. zh-CN-XiaoxiaoNeural for edge). Left out, a Chinese voice is picked automatically.',
        },
        forceVoice: {
          type: 'boolean',
          description: 'Re-synthesise even matching audio. Changed narration or synthesis settings automatically invalidate cached audio.',
        },
      },
      required: ['path'],
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: renderResult(value as CastLike) }],
    },
    async execute(
      args: { path: string; page?: boolean; render?: boolean; voice?: boolean; voiceName?: string; forceVoice?: boolean; reviewRevision?: string; draft?: boolean },
      exec: { signal: AbortSignal },
    ) {
      // 每次调用时重新解包设置：volatile 字段是活的引用，设置页保存后立即生效、不用重挂载
      const settings: FoldercastSettings = resolveSettings(config);
      const result = await cast({
        target: args.path,
        signal: exec.signal,
        page: args.page === true,
        render: args.render === true,
        voice: args.voice === true,
        draft: args.draft === true,
        ...(args.reviewRevision === undefined ? {} : { reviewRevision: args.reviewRevision }),
        ...(args.voiceName === undefined ? {} : { voiceName: args.voiceName }),
        ...(args.forceVoice === undefined ? {} : { forceVoice: args.forceVoice }),
        ...(Object.keys(settings).length === 0 ? {} : { settings }),
      });

      // 只报不可用的依赖：都正常时这个数组是空的，模型不必读几条「没问题」
      const unavailable = result.dependencies
        .filter((dependency) => !dependency.ok)
        .map((dependency) => ({ name: dependency.name, hint: dependency.hint }));

      const value: Record<string, unknown> = {
        ok: result.ok,
        target: result.target,
        label: result.label,
        workRoot: result.workRoot,
        ran: result.ran,
        dependencies: unavailable,
        stages: result.stages,
      };
      if (result.error !== undefined) value.error = result.error;
      if (result.voiceName !== undefined) value.voiceName = result.voiceName;
      if (result.videoPath !== undefined) value.videoPath = result.videoPath;
      if (result.pagePath !== undefined) value.pagePath = result.pagePath;
      if (result.validation !== undefined) value.validation = result.validation;
      if (result.notes !== undefined) value.notes = result.notes;
      if (result.revision !== undefined) value.revision = result.revision;
      if (result.reviewAccepted !== undefined) value.reviewAccepted = result.reviewAccepted;
      if (result.artifacts !== undefined) value.artifacts = result.artifacts;

      return value;
    },
  });
}

/**
 * 注册 skill。
 *
 * `skills` 不在 `inject` 里：它缺席时工具仍然可用，skill 只是没注册上。所以用 `ctx.get`
 * 取，取不到就跳过 —— 为了一个可选的消费方让整个插件不激活是不划算的。
 */
function registerSkill(ctx: Context): void {
  const skills = ctx.get('skills') as SkillRegistration | undefined;
  if (skills === undefined) return;

  skills.register({
    name: SKILL_NAME,
    description: SKILL_DESCRIPTION,
    whenToUse: SKILL_WHEN_TO_USE,
    content: SKILL_CONTENT,
    source: name,
  });
}

/** 设置在每次工具调用时经 `resolveSettings` 解包（volatile 字段是活的引用）。 */
export function apply(ctx: Context, config?: RawConfig): void {
  registerTool(ctx, config);
  registerSkill(ctx);
}
