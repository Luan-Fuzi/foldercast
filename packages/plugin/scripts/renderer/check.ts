/**
 * 讲稿的契约校验 —— 原来的独立 validate 阶段收缩成了渲染入口的一个模块。
 *
 * 只查**机器能判的**：形状（schema）、字段（按场景类型的必需/允许表）、路径存在、
 * 场景 id 唯一、字幕切得开、盘点数字自洽。「有没有讲错重点」不是它能管的，那是评审
 * subagent 的事。
 *
 * blocker 必须修（编了路径、字段用错、字幕切不开）；warning 是「可能是笔误，自己确认」。
 */
import { existsSync, statSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SCENE_ALLOWED_FIELDS,
  SCENE_REQUIRED_FIELDS,
  isSceneType,
  type ScriptDocument,
  type Scene,
} from '../contracts/script.ts';
import { prepKindOf } from '../contracts/prep.ts';
import { validateSubtitles } from '../contracts/subtitles.ts';

export type Issue = {
  code: string;
  severity: 'blocker' | 'warning';
  message: string;
  /** 讲稿里的 JSON 指针（`/scenes/0/title`）。 */
  path?: string;
  sceneId?: string;
  fix?: string;
};

export type CheckReport = {
  blocker: number;
  warning: number;
  issues: Issue[];
};

/**
 * 找 `script.schema.json`：包内 `schemas/`（发布版）优先，仓库 `docs/specs/` 兜底。
 * 上溯找而不是数层级 —— 源码与编译产物深度不同（旧版实测踩过）。
 */
export function findSchemaDir(start: string): string | undefined {
  let current = resolve(start);
  const { root } = parse(current);
  for (;;) {
    if (existsSync(join(current, 'schemas', 'script.schema.json'))) return join(current, 'schemas');
    if (existsSync(join(current, 'docs', 'specs', 'script.schema.json'))) return join(current, 'docs', 'specs');
    if (current === root) return undefined;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

type SchemaLike = { $defs?: Record<string, unknown> } & Record<string, unknown>;

async function loadSchema(): Promise<SchemaLike | undefined> {
  const dir = findSchemaDir(MODULE_DIR);
  if (dir === undefined) return undefined;
  try {
    const { readFileSync } = await import('node:fs');
    return JSON.parse(readFileSync(join(dir, 'script.schema.json'), 'utf8')) as SchemaLike;
  } catch {
    return undefined;
  }
}

/**
 * 校验讲稿。`root` 是被讲解目录（路径存在性按它查）。
 *
 * schema 读不到时跳过那一层（字段表与语义检查仍然全跑）—— 校验不该因为一个数据文件
 * 的摆放问题整体失效。
 */
export async function checkScript(script: ScriptDocument, root: string): Promise<CheckReport> {
  const issues: Issue[] = [];
  const push = (issue: Issue): void => {
    issues.push(issue);
  };

  const schema = await loadSchema();
  if (schema !== undefined) {
    // schema 是 draft 2020-12，要用 Ajv2020（经典 Ajv 不认这份元 schema）。
    // ESM/CJS 互操作在两套 tsconfig 下表现不同，这里只声明用到的最小形状。
    type AjvLike = {
      compile: (schema: unknown) => ((data: unknown) => boolean) & { errors?: Array<{ instancePath?: string; message?: string }> };
    };
    const module = (await import('ajv/dist/2020.js')) as unknown as { default: new (options?: Record<string, unknown>) => AjvLike };
    const ajv = new module.default({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);
    if (!validate(script)) {
      for (const error of validate.errors ?? []) {
        const where = error.instancePath === '' ? '' : error.instancePath;
        push({
          code: 'schema-invalid',
          severity: 'blocker',
          message: `${where === '' ? '讲稿' : where}：${error.message ?? '不符合 schema'}`,
          path: where,
        });
      }
    }
  }

  const seen = new Map<string, number>();
  for (const [index, scene] of script.scenes.entries()) {
    const at = (field: string): string => `/scenes/${String(index)}/${field}`;

    if (!isSceneType(scene.type)) {
      push({
        code: 'scene-type-unknown',
        severity: 'blocker',
        message: `场景类型 ${String(scene.type)} 不认识。可用：${Object.keys(SCENE_ALLOWED_FIELDS).join(' / ')}`,
        sceneId: scene.id,
        path: at('type'),
      });
      continue;
    }

    // 同 id 的第二次出现才报（第一次是对的）
    const first = seen.get(scene.id);
    if (first !== undefined) {
      push({
        code: 'scene-id-duplicate',
        severity: 'blocker',
        message: `场景 id 重复：${scene.id}（第一次在 /scenes/${String(first)}）`,
        sceneId: scene.id,
        path: at('id'),
        fix: '场景 id 用于配音产物命名与对齐，必须唯一。',
      });
    } else {
      seen.set(scene.id, index);
    }

    for (const field of SCENE_REQUIRED_FIELDS[scene.type]) {
      if (scene[field as keyof Scene] === undefined) {
        push({
          code: 'scene-field-missing',
          severity: 'blocker',
          message: `${scene.type} 场景缺必需字段 ${field}`,
          sceneId: scene.id,
          path: at(field),
        });
      }
    }
    for (const field of Object.keys(scene)) {
      if (!SCENE_ALLOWED_FIELDS[scene.type].includes(field)) {
        push({
          code: 'scene-field-unused',
          severity: 'blocker',
          message: `${scene.type} 场景里出现 ${field}（这个类型没有这个字段，多半是笔误）`,
          sceneId: scene.id,
          path: at(field),
        });
      }
    }

    pushPathChecks(scene, root, push);
    pushSubtitleCheck(scene, push);
  }

  return {
    blocker: issues.filter((issue) => issue.severity === 'blocker').length,
    warning: issues.filter((issue) => issue.severity === 'warning').length,
    issues,
  };
}

function pushPathChecks(scene: Scene, root: string, push: (issue: Issue) => void): void {
  const exists = (relative: string | undefined): boolean => {
    if (relative === undefined) return false;
    const stats = statSync(resolve(root, relative), { throwIfNoEntry: false });
    return stats !== undefined && stats.isFile();
  };
  const missing = (relative: string, where: string): void => {
    push({
      code: 'path-missing',
      severity: 'blocker',
      message: `${where} 引用的文件不存在：${relative}`,
      sceneId: scene.id,
      fix: '讲稿只能引用源目录里真实存在的文件；要讲它就先确认它在（或改路径）。',
    });
  };

  if (scene.file !== undefined && !exists(scene.file)) missing(scene.file, 'file');
  if (scene.source !== undefined && !exists(scene.source)) missing(scene.source, scene.type);
  for (const item of scene.items ?? []) {
    if (!exists(item)) missing(item, 'gallery');
  }

  if (scene.type === 'gallery') {
    for (const item of scene.items ?? []) {
      const kind = prepKindOf(item);
      if (kind !== undefined && kind !== 'image' && kind !== 'video') {
        push({
          code: 'gallery-item-kind',
          severity: 'warning',
          message: `gallery 里的 ${item} 不是图片（${kind}）—— 画面会用它的主产物，观感可能不如图片`,
          sceneId: scene.id,
        });
      }
    }
  }

  if (scene.type === 'inventory' && scene.groups !== undefined && scene.total !== undefined) {
    const sum = scene.groups.reduce((total, group) => total + group.count, 0);
    if (sum > scene.total) {
      push({
        code: 'inventory-total-mismatch',
        severity: 'warning',
        message: `各组 count 之和 ${String(sum)} 大于 total ${String(scene.total)} —— 盘点数字自相矛盾`,
        sceneId: scene.id,
        fix: 'total 应当是各组之和，或大于它（有没列出的「其余」）。',
      });
    }
  }
}

function pushSubtitleCheck(scene: Scene, push: (issue: Issue) => void): void {
  const oversized = validateSubtitles(scene.narration);
  for (const piece of oversized) {
    push({
      code: 'subtitle-too-long',
      severity: 'blocker',
      message: `这段没有可切点，切不出 ≤24 显示宽度的字幕块（最长一块 ${String(piece.width)} 宽）：${piece.text}`,
      sceneId: scene.id,
      fix: '加标点或拆句 —— 字幕先按句末标点切、超长在逗号处再切，一句没有任何标点就切不开。',
    });
  }
}
