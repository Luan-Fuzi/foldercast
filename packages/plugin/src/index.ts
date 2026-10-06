/**
 * dsh-foldercast 的插件入口。
 *
 * 三件事：注册一个工具、注册一个 skill、声明一个（空的）`Config` schema。
 *
 * **三条硬约束**：
 * 1. `apply()` 里不做任何可能失败的重活（不探测环境、不读配置、不起进程）——插件绝不能
 *    成为 required 条目，它崩了不能带崩 harness（INTEGRATION §3.6）。环境探测推迟到首次
 *    工具调用。
 * 2. **不 import 任何 `@deepseek-ai/dsh-*` 包**。工具的注册用 `ctx.tools.register()` 直传
 *    定义（参数与输出用原生 JSON Schema），因为 `dsh-tools` 作为插件依赖会把它的依赖装进
 *    profile，实测会让宿主的加载器起不来（`Cannot read properties of undefined (reading
 *    'prepare')`）。`@deepseek-ai/schemastery` 是插件自己的依赖，装在哪一侧都安全。
 * 3. 因此 `Context` 也**不 import `@deepseek-ai/cordis` 的类型**，只声明用得到的那一小块
 *    （结构类型，宿主传进来的对象本来就是这个形状）。少一个框架依赖，少一处版本漂移。
 */
import { cast } from './cast.ts';
import { Config } from './config.ts';
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

/** 单次调用的预算。素材阶段最慢（15 个 Office 文件实测 15 秒，大目录更久）。 */
const CAST_TIMEOUT_MS = 600_000;

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
 * 只声明**实际会返回的字段**，且都非必需 —— 失败路径下很多字段没有意义（比如目标目录
 * 不存在时没有解读可报），把「缺席」表达成字段不存在，比塞一堆空值更清楚。
 */
const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    target: { type: 'string', description: '被讲解目录的绝对路径' },
    label: { type: 'string' },
    workRoot: { type: 'string', description: '工作根：所有产物都在它下面（<目录>/.foldercast/）' },
    error: { type: 'string', description: '要求的阶段失败或环境不满足时的一句话说明' },
    ran: {
      type: 'array',
      description: '这次调用实际跑了哪些阶段，按执行顺序',
      items: { type: 'string' },
    },
    artifacts: {
      type: 'array',
      description:
        '磁盘上现在有什么：解读、素材清单、讲稿、评审、时长表、旁白音轨、成片。state: missing = 还没有；stale = 有但比讲稿旧（评审与成片要重做）；fresh = 有且不旧。下一步该做什么由调用方判断。',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          path: { type: 'string' },
          state: { type: 'string', enum: ['missing', 'stale', 'fresh'] },
          bytes: { type: 'integer' },
          note: { type: 'string' },
        },
      },
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
        analyze: {
          type: 'object',
          additionalProperties: false,
          properties: { ok: { type: 'boolean' }, ms: { type: 'number' }, exitCode: { type: 'integer' }, error: { type: 'string' }, detail: { type: 'string' } },
        },
        assets: {
          type: 'object',
          additionalProperties: false,
          properties: { ok: { type: 'boolean' }, ms: { type: 'number' }, exitCode: { type: 'integer' }, error: { type: 'string' }, detail: { type: 'string' } },
        },
        validate: {
          type: 'object',
          additionalProperties: false,
          properties: { ok: { type: 'boolean' }, ms: { type: 'number' }, exitCode: { type: 'integer' }, error: { type: 'string' }, detail: { type: 'string' } },
        },
        render: {
          type: 'object',
          additionalProperties: false,
          properties: { ok: { type: 'boolean' }, ms: { type: 'number' }, exitCode: { type: 'integer' }, error: { type: 'string' }, detail: { type: 'string' } },
        },
        voice: {
          type: 'object',
          additionalProperties: false,
          properties: { ok: { type: 'boolean' }, ms: { type: 'number' }, exitCode: { type: 'integer' }, error: { type: 'string' }, detail: { type: 'string' } },
        },
      },
    },
    reading: {
      type: 'object',
      additionalProperties: false,
      properties: {
        files: { type: 'integer', description: '进清单的文件数' },
        bytes: { type: 'integer' },
        kinds: { type: 'object', description: 'kind → 文件数（12 类都在，计数为 0 的也在）' },
        secretsSkipped: { type: 'array', items: { type: 'object' } },
        droppedByMaxFiles: { type: 'integer', description: '因为超量没有进清单的文件数；0 表示解读覆盖了全部通过筛选的文件' },
        skippedForSize: { type: 'integer', description: '因为超过单文件体积上限没有读内容的文件数（仍在清单里）' },
        assets: { type: 'integer' },
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
              line: { type: 'integer' },
              sceneId: { type: 'string' },
              fix: { type: 'string' },
            },
          },
        },
      },
    },
    voiceProvider: { type: 'string', description: '实际使用的 TTS provider（从时长表读，不是配置里写的）' },
    voiceName: { type: 'string' },
    voiceNote: { type: 'string', description: '配音这一步的说明：为什么没配（缺 ffmpeg / say / 密钥等）' },
  },
};

type CastLike = {
  ok: boolean;
  target: string;
  label: string;
  workRoot: string;
  error?: string;
  ran: string[];
  artifacts: { name: string; path: string; state: string; bytes?: number; note?: string }[];
  dependencies: { name: string; ok: boolean; hint: string }[];
  stages: Record<string, { ok: boolean; ms: number; exitCode?: number; error?: string; detail?: string } | undefined>;
  reading?: {
    files: number;
    bytes: number;
    kinds: Record<string, number>;
    secretsSkipped: { path: string }[];
    droppedByMaxFiles: number;
    skippedForSize: number;
    assets: number;
  };
  validation?: { blocker: number; warning: number; issues: { code: string; severity: string; message: string; line?: number; sceneId?: string }[] };
  voiceProvider?: string;
  voiceName?: string;
  voiceNote?: string;
};

/**
 * 把结果压成给模型看的几句话。
 *
 * 与结构化输出**不重复**：这里只说「发生了什么」——跑了哪些阶段、读到了什么、哪些产物在、
 * 哪一步失败。**不说「下一步做什么」**：该走哪一步由 skill 与模型判断。
 */
function renderResult(value: CastLike): string {
  const lines: string[] = [];

  if (!value.ok && value.reading === undefined) {
    lines.push(`没能处理 ${value.target}：${value.error ?? '见下'}`);
  } else if (value.reading !== undefined) {
    const kinds = Object.entries(value.reading.kinds)
      .filter(([, count]) => count > 0)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 6)
      .map(([kind, count]) => `${kind} ${String(count)}`)
      .join(' · ');
    lines.push(`${value.label}：${String(value.reading.files)} 个文件（${kinds}）`);
    if (value.reading.secretsSkipped.length > 0) {
      lines.push(`跳过的密钥类文件（只按文件名命中，内容未读）：${value.reading.secretsSkipped.map((hit) => hit.path).join('、')}`);
    }
    if (value.reading.droppedByMaxFiles > 0) {
      lines.push(`注意：还有 ${String(value.reading.droppedByMaxFiles)} 个文件因为超出清单上限没有进来，解读不覆盖它们。`);
    }
    if (value.reading.skippedForSize > 0) {
      lines.push(`注意：${String(value.reading.skippedForSize)} 个文件超过单文件体积上限，没有读内容（仍在清单里）。`);
    }
    if (value.reading.assets > 0) {
      lines.push(`素材：${String(value.reading.assets)} 个文件已有素材（页图 / 缩略图 / 关键帧 / 提取文本）`);
    }
  }

  if (value.error !== undefined && value.reading !== undefined) lines.push(value.error);

  for (const [stageName, stage] of Object.entries(value.stages)) {
    if (stage !== undefined && !stage.ok && stage.error !== undefined) {
      lines.push(`${stageName} 阶段失败：${stage.error}`);
    }
  }

  if (value.validation !== undefined) {
    lines.push(`校验：${String(value.validation.blocker)} 个必须修，${String(value.validation.warning)} 个待确认`);
    for (const issue of value.validation.issues.slice(0, 8)) {
      const where = issue.line === undefined ? '' : `:${String(issue.line)}`;
      const scene = issue.sceneId === undefined ? '' : `[${issue.sceneId}] `;
      lines.push(`  ${issue.severity === 'blocker' ? '×' : '!'} ${scene}${issue.message}${where}`);
    }
    if (value.validation.issues.length > 8) {
      lines.push(`  …另有 ${String(value.validation.issues.length - 8)} 条，见结构化输出`);
    }
  }

  const missing = value.dependencies.filter((dependency) => !dependency.ok);
  for (const dependency of missing) lines.push(`缺依赖 ${dependency.name}：${dependency.hint}`);

  for (const artifact of value.artifacts) {
    const size = artifact.bytes === undefined ? '' : `（${String(Math.round(artifact.bytes / 1024))} KB）`;
    const note = artifact.note === undefined ? '' : ` ${artifact.note}`;
    lines.push(`  ${artifact.name}：${artifact.state}${size}${note} → ${artifact.path}`);
  }

  if (value.voiceProvider !== undefined) {
    lines.push(`配音用的是 ${value.voiceProvider}${value.voiceName === undefined ? '' : ` · ${value.voiceName}`}`);
  }
  if (value.voiceNote !== undefined) lines.push(value.voiceNote);

  return lines.join('\n');
}

function registerTool(ctx: Context): void {
  const tools = (ctx as unknown as { tools: ToolRegistration }).tools;
  // 凭据 seam 是**可选**的：缺席时免密钥的 say 照常工作，只是云端 provider 用不了
  const credentials = ctx.get('credentials') as
    | { describe: (ref: string) => Promise<{ configured: boolean; writable: boolean }>; resolve: (ref: string) => Promise<{ value: string; source: string } | undefined> }
    | undefined;

  tools.register({
    name: 'foldercast_cast',
    description:
      'Cast a folder: build the deterministic reading (file list, kinds, sizes, line counts, truncated previews, secret audit) and, unless skipped, its assets (page images, thumbnails, keyframes, extracted text). Also reports what already exists on disk (script, review, durations, film) and validates the script when there is one. Rendering and voice-over are NOT automatic: ask for them explicitly with render / voice.',
    timeoutMs: CAST_TIMEOUT_MS,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path of the folder to cast.',
        },
        skipAssets: {
          type: 'boolean',
          description: 'Skip the asset stage (faster; the script then cannot reference page images or keyframes).',
        },
        render: {
          type: 'boolean',
          description:
            'Render the film. Off by default: it needs a browser and takes minutes to tens of minutes. Requires an existing script.json.',
        },
        voice: {
          type: 'boolean',
          description:
            'Synthesise the narration before rendering. Off by default: it calls TTS (the default provider is the key-free macOS "say"). Requires an existing script.json.',
        },
        ttsProvider: {
          type: 'string',
          description: 'TTS provider for the voice-over: "say" (default, no key) or "mimo" (needs MIMO_API_KEY).',
        },
        ttsVoice: {
          type: 'string',
          description: 'Voice within that provider. Left out, "say" picks a Chinese system voice automatically.',
        },
      },
      required: ['path'],
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: renderResult(value as CastLike) }],
    },
    async execute(
      args: { path: string; skipAssets?: boolean; render?: boolean; voice?: boolean; ttsProvider?: string; ttsVoice?: string },
      exec: { signal: AbortSignal },
    ) {
      const result = await cast({
        target: args.path,
        signal: exec.signal,
        skipAssets: args.skipAssets === true,
        render: args.render === true,
        voice: args.voice === true,
        ...(args.ttsProvider === undefined ? {} : { ttsProvider: args.ttsProvider }),
        ...(args.ttsVoice === undefined ? {} : { ttsVoice: args.ttsVoice }),
        // 凭据只在宿主提供了 seam 时查（缺了不影响免密钥的 say）
        ...(credentials === undefined ? {} : { credentials }),
      });

      // 只报不可用的依赖：都正常时这个数组是空的，模型不必读四条「没问题」
      const unavailable = result.dependencies
        .filter((dependency) => !dependency.ok)
        .map((dependency) => ({ name: dependency.name, hint: dependency.hint }));

      const value: Record<string, unknown> = {
        ok: result.ok,
        target: result.target,
        label: result.label,
        workRoot: result.workRoot,
        ran: result.ran,
        artifacts: result.artifacts,
        dependencies: unavailable,
        stages: result.stages,
      };
      if (result.error !== undefined) value.error = result.error;
      if (result.voiceProvider !== undefined) value.voiceProvider = result.voiceProvider;
      if (result.voiceName !== undefined) value.voiceName = result.voiceName;
      if (result.voiceNote !== undefined) value.voiceNote = result.voiceNote;
      if (result.reading !== undefined) value.reading = result.reading;
      if (result.validation !== undefined) value.validation = result.validation;

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

export function apply(ctx: Context): void {
  registerTool(ctx);
  registerSkill(ctx);
}
