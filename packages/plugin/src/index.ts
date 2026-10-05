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
    next: {
      type: 'string',
      enum: ['needsScript', 'needsReview', 'validated', 'fixScript', 'blocked'],
      description:
        'needsScript = 该写讲稿了；needsReview = 讲稿通过校验、该评审了；validated = 讲稿与评审都齐了；fixScript = 讲稿有问题；blocked = 环境或目标有问题',
    },
    nextHint: { type: 'string' },
    readingPath: { type: 'string' },
    scriptPath: { type: 'string' },
    reviewPath: { type: 'string', description: '评审结论的落点（M5，skill 第六步写到这里）' },
    review: {
      type: 'string',
      enum: ['missing', 'stale', 'fresh'],
      description: 'missing = 还没评审；stale = 现有结论早于当前讲稿；fresh = 审的是当前这版',
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
      },
    },
    reading: {
      type: 'object',
      additionalProperties: false,
      properties: {
        files: { type: 'integer' },
        bytes: { type: 'integer' },
        kinds: { type: 'object' },
        languages: { type: 'object' },
        topDirs: { type: 'array', items: { type: 'object' } },
        roots: { type: 'array', items: { type: 'string' } },
        hubs: { type: 'array', items: { type: 'object' } },
        secretsSkipped: { type: 'array', items: { type: 'object' } },
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
  },
};

type CastLike = {
  ok: boolean;
  target: string;
  label: string;
  next: string;
  nextHint: string;
  readingPath: string;
  scriptPath: string;
  dependencies: { name: string; ok: boolean; hint: string }[];
  stages: Record<string, { ok: boolean; ms: number; exitCode?: number; error?: string; detail?: string } | undefined>;
  reading?: {
    files: number;
    bytes: number;
    kinds: Record<string, number>;
    topDirs: { path: string; files: number }[];
    roots: string[];
    hubs: { path: string; in: number }[];
    secretsSkipped: { path: string }[];
    assets: number;
  };
  validation?: { blocker: number; warning: number; issues: { code: string; severity: string; message: string; line?: number; sceneId?: string }[] };
};

/**
 * 把结果压成给模型看的几句话。
 *
 * 与结构化输出**不重复**：输出里已经有的字段不在这里复述，这里只说「发生了什么」与
 * 「下一步做什么」——模型读这段决定动作，读结构化字段决定细节。
 */
function renderResult(value: CastLike): string {
  const lines: string[] = [];

  if (!value.ok && value.next === 'blocked') {
    lines.push(`没能处理 ${value.target}：${value.nextHint}`);
  } else if (value.reading !== undefined) {
    const kinds = Object.entries(value.reading.kinds)
      .filter(([, count]) => count > 0)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([kind, count]) => `${kind} ${String(count)}`)
      .join(' · ');
    lines.push(`${value.label}：${String(value.reading.files)} 个文件（${kinds}）→ ${value.readingPath}`);

    if (value.reading.topDirs.length > 0) {
      lines.push(`主要目录：${value.reading.topDirs.slice(0, 5).map((dir) => `${dir.path}(${String(dir.files)})`).join(' · ')}`);
    }
    if (value.reading.roots.length > 0) {
      lines.push(`入口：${value.reading.roots.slice(0, 6).join('、')}`);
    }
    if (value.reading.hubs.length > 0) {
      lines.push(`枢纽（最该先讲）：${value.reading.hubs.slice(0, 6).map((hub) => `${hub.path}(入 ${String(hub.in)})`).join('、')}`);
    }
    if (value.reading.secretsSkipped.length > 0) {
      lines.push(`跳过的密钥类文件（只按文件名命中，内容未读）：${value.reading.secretsSkipped.map((hit) => hit.path).join('、')}`);
    }
    if (value.reading.assets > 0) {
      lines.push(`素材：${String(value.reading.assets)} 个文件已有素材（逐页图/关键帧/高亮图/提取文本）`);
    }
  }

  const failed = Object.entries(value.stages).filter(([, stage]) => stage !== undefined && !stage.ok);
  for (const [stageName, stage] of failed) {
    if (stage?.error !== undefined) lines.push(`${stageName} 阶段失败：${stage.error}`);
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

  lines.push(value.nextHint);
  return lines.join('\n');
}

function registerTool(ctx: Context): void {
  const tools = (ctx as unknown as { tools: ToolRegistration }).tools;

  tools.register({
    name: 'foldercast_cast',
    description: 'Cast a folder into an explainer video: analyze it, build assets, validate the script.',
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
      },
      required: ['path'],
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: renderResult(value as CastLike) }],
    },
    async execute(args: { path: string; skipAssets?: boolean }, exec: { signal: AbortSignal }) {
      const result = await cast({
        target: args.path,
        signal: exec.signal,
        skipAssets: args.skipAssets === true,
      });

      // 只报不可用的依赖：都正常时这个数组是空的，模型不必读四条「没问题」
      const unavailable = result.dependencies
        .filter((dependency) => !dependency.ok)
        .map((dependency) => ({ name: dependency.name, hint: dependency.hint }));

      const value: Record<string, unknown> = {
        ok: result.ok,
        target: result.target,
        label: result.label,
        next: result.next,
        nextHint: result.nextHint,
        readingPath: result.readingPath,
        scriptPath: result.scriptPath,
        reviewPath: result.reviewPath,
        review: result.review,
        dependencies: unavailable,
        stages: result.stages,
      };
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
