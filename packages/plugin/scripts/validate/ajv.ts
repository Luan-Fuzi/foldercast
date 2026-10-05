/**
 * JSON Schema 校验（schema 由调用方载入，见 schema.ts）。
 *
 * 三条 strict 规则要放开，都是契约里**有意**的写法，不是 schema 缺陷：
 * - `strictRequired`：`narration` 这类字段是「有则必须是字符串」，不必在每个 `$defs` 分支里重复声明；
 * - `strictTuples`：`prefixItems` 不声明 `items: false`；
 * - `allowUnionTypes`：`durationSec` 是 `["number", "null"]`，JSON Schema 允许的联合类型。
 * 其余 strict 规则保留（拼错关键字、类型写错仍会报出来）。
 */
import { createRequire } from 'node:module';
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import type { FormatsPlugin } from 'ajv-formats';
import type { Issue } from './issue.ts';
import type { Locator } from './locate.ts';

// ajv 与 ajv-formats 都是 CJS 包：ajv 在 module.exports 上挂了同名属性，可以具名导入；
// ajv-formats 只有 default，经 require 取（与 scripts/check-examples.ts 同样的办法）。
const require = createRequire(import.meta.url);
const addFormats = require('ajv-formats') as FormatsPlugin;

export type SchemaValidator = ValidateFunction;

/** 编译一份 schema。schema 自身有问题时会抛，说明契约坏了，应当立刻暴露。 */
export function createValidator(schema: object): SchemaValidator {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    strictTuples: false,
    allowUnionTypes: true,
  });
  addFormats(ajv);
  return ajv.compile(schema);
}

/** 把 ajv 的错误转成带位置的问题。 */
export function validateAgainstSchema(
  validate: SchemaValidator,
  value: unknown,
  path: string,
  locator: Locator,
  pointerPrefix = '',
): Issue[] {
  if (validate(value)) return [];

  return (validate.errors ?? []).map((error: ErrorObject) => {
    const pointer = `${pointerPrefix}${error.instancePath === '' ? '' : error.instancePath}` || '/';
    const at = locator.at(pointer);

    return {
      path,
      pointer,
      severity: 'blocker' as const,
      code: 'schema' as const,
      message: describeError(error),
      fix: '按 docs/specs 下的 schema 修正该字段。',
      ...(at === undefined ? {} : { at }),
    };
  });
}

/** ajv 的英文提示换成能直接读的一句，并带上允许值（枚举错误最常见）。 */
function describeError(error: ErrorObject): string {
  const where = error.instancePath === '' ? '根对象' : error.instancePath;

  if (error.keyword === 'additionalProperties') {
    const extra = (error.params as { additionalProperty?: string }).additionalProperty ?? '';
    return `${where} 出现了契约里没有的字段 "${extra}"（拼错键名会走到这里）。`;
  }
  if (error.keyword === 'required') {
    const missing = (error.params as { missingProperty?: string }).missingProperty ?? '';
    return `${where} 缺少必需字段 "${missing}"。`;
  }
  if (error.keyword === 'enum') {
    const allowed = (error.params as { allowedValues?: unknown[] }).allowedValues ?? [];
    return `${where} 的值不在允许范围内，只能是：${allowed.map((item) => String(item)).join(' / ')}。`;
  }
  if (error.keyword === 'const') {
    const expected = (error.params as { allowedValue?: unknown }).allowedValue;
    return `${where} 必须是 ${String(expected)}。`;
  }
  if (error.keyword === 'type') {
    const expected = (error.params as { type?: string }).type ?? '';
    return `${where} 的类型应为 ${expected}。`;
  }
  if (error.keyword === 'minItems' || error.keyword === 'maxItems') {
    const limit = (error.params as { limit?: number }).limit;
    return `${where} 的元素个数不符合要求（${error.keyword} = ${String(limit)}）。`;
  }
  if (error.keyword === 'format') {
    const format = (error.params as { format?: string }).format ?? '';
    return `${where} 不是合法的 ${format}。`;
  }
  if (error.keyword === 'anyOf' || error.keyword === 'oneOf') {
    return `${where} 不符合任何一种允许的写法。`;
  }

  return `${where} ${error.message ?? '不符合 schema'}。`;
}
