/**
 * 工具注册用的 JSON Schema 必须落在宿主支持的子集内。
 *
 * 注册表在注册时校验 schema，**不合法就直接不激活**（实测的失败长相是一条
 * `JsonSchemaError: unsupported JSON schema` 警告 + 工具不存在）。踩过一次：
 * `exitCode` 写成 `type: ['integer','null']`，而宿主不支持类型数组。
 *
 * 这份测试把那条白名单钉住（来源：宿主 `assertSupportedJsonSchema` 的约束与注解关键字表）。
 * 它是**近似的复刻**，不是宿主的实现；它能拦住同类错误，不能替代真的一次安装。
 */
import { describe, expect, it } from 'vitest';
import { apply } from '../index.ts';

/** 宿主支持的约束关键字。 */
const CONSTRAINT_KEYWORDS = new Set([
  'type',
  'oneOf',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'const',
]);

/** 宿主支持的注解关键字（只影响展示，不影响校验）。 */
const ANNOTATION_KEYWORDS = new Set(['description', 'title', 'default', 'examples']);

/** 宿主支持的标量类型。**没有数组形式**。 */
const SCHEMA_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);

/** 和 `oneOf` 并列时不允许出现的关键字。 */
const ONE_OF_SIBLINGS = ['properties', 'required', 'additionalProperties', 'items', 'enum', 'const'];

type Json = unknown;

function isRecord(value: Json): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 走一遍 schema，收集违规。`path` 只用于报错信息。 */
function violationsIn(node: Json, path: string, found: string[]): void {
  if (Array.isArray(node)) {
    node.forEach((item, index) => violationsIn(item, `${path}[${String(index)}]`, found));
    return;
  }
  if (!isRecord(node)) return;

  for (const key of Object.keys(node)) {
    if (!CONSTRAINT_KEYWORDS.has(key) && !ANNOTATION_KEYWORDS.has(key)) {
      found.push(`${path}.${key} 不在宿主支持的关键字里`);
    }
  }

  if (Object.hasOwn(node, 'type')) {
    const type = node.type;
    if (typeof type !== 'string' || !SCHEMA_TYPES.has(type)) {
      found.push(`${path}.type 必须是单个字符串（不支持类型数组）：${JSON.stringify(type)}`);
    }
  }

  if (Object.hasOwn(node, 'oneOf')) {
    for (const sibling of ONE_OF_SIBLINGS) {
      if (Object.hasOwn(node, sibling)) found.push(`${path}.${sibling} 不能与 oneOf 并列`);
    }
  }

  if (node.properties !== undefined) {
    if (!isRecord(node.properties)) found.push(`${path}.properties 必须是对象`);
    else for (const [key, child] of Object.entries(node.properties)) violationsIn(child, `${path}.properties.${key}`, found);
  }
  if (node.items !== undefined) violationsIn(node.items, `${path}.items`, found);
  if (node.oneOf !== undefined) violationsIn(node.oneOf, `${path}.oneOf`, found);
}

/** 用假 ctx 取到工具定义（与 tool.test.ts 同样的办法：测交付的那份东西）。 */
function toolDefinition(): { parameters: Json; output: { schema: Json; render: unknown } } {
  let captured: { parameters: Json; output: { schema: Json; render: unknown } } | undefined;
  const ctx = {
    tools: {
      register: (definition: { parameters: Json; output: { schema: Json; render: unknown } }) => {
        captured = definition;
        return () => undefined;
      },
    },
    get: () => undefined,
  };
  apply(ctx as never);
  if (captured === undefined) throw new Error('apply() 没有注册工具');
  return captured;
}

describe('工具 schema 落在宿主支持的子集内', () => {
  const tool = toolDefinition();

  it('参数 schema 没有违规', () => {
    const found: string[] = [];
    violationsIn(tool.parameters, 'parameters', found);
    expect(found).toEqual([]);
  });

  it('输出 schema 没有违规', () => {
    const found: string[] = [];
    violationsIn(tool.output.schema, 'output.schema', found);
    expect(found).toEqual([]);
  });

  it('确实走完了整棵树（不是空跑）', () => {
    const found: string[] = [];
    violationsIn(tool.output.schema, 'output.schema', found);
    const stages = (tool.output.schema as { properties: { stages: { properties: Record<string, unknown> } } }).properties.stages;
    expect(Object.keys(stages.properties)).toEqual(['analyze', 'assets', 'validate', 'render', 'voice']);
  });

  it('白名单本身能拦住类型数组（负向用例）', () => {
    const found: string[] = [];
    violationsIn({ type: ['integer', 'null'] }, 'probe', found);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('不支持类型数组');
  });

  it('白名单能拦住不认识的关键字', () => {
    const found: string[] = [];
    violationsIn({ type: 'string', pattern: '^a' }, 'probe', found);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('pattern');
  });
});
