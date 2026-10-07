/**
 * 用 JSON Schema 校验 examples/ 下的示例文件。
 *
 * 契约有三处表示，这里是其中两处的自动核对：示例必须符合 schema
 * （见 docs/conventions/docs.md 第五节）。
 *
 * 用法：node scripts/check-examples.ts
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { FormatsPlugin } from 'ajv-formats';
import { REPO_ROOT, readJson, rel } from './lib/repo.ts';

// ajv 与 ajv-formats 都是 CJS 包。ajv 在 module.exports 上挂了同名属性，可以具名导入；
// ajv-formats 只有 default，而它的 d.ts 在 Node 的 CJS 互操作下被推断成命名空间，所以经 require 取。
const require = createRequire(import.meta.url);
const addFormats = require('ajv-formats') as FormatsPlugin;

/** [示例文件, 对应 schema, 打印用名称] */
const PAIRS: ReadonlyArray<readonly [string, string, string]> = [
  ['examples/script.example.json', 'docs/specs/script.schema.json', '讲稿示例'],
];

function main(): number {
  // schema 是 draft 2020-12；strict 关掉是因为 schema 里还有未声明的注解键。
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);

  let failures = 0;
  for (const [instancePath, schemaPath, label] of PAIRS) {
    const schema = readJson(join(REPO_ROOT, schemaPath));
    const instance = readJson(join(REPO_ROOT, instancePath));
    const validate = ajv.compile(schema as object);

    if (validate(instance)) {
      console.log(`${label}通过 ${schemaPath}`);
      continue;
    }

    failures += 1;
    console.log(`${label}（${instancePath}）不符合 ${schemaPath}：`);
    for (const error of validate.errors ?? []) {
      const where = error.instancePath === '' ? '/' : error.instancePath;
      console.log(`  ${where} ${error.message ?? ''}`);
    }
  }

  if (failures > 0) {
    console.log(`\n${failures} 个示例未通过；改 schema 时必须在同一个提交里更新示例。`);
    return 1;
  }

  console.log(`全部示例通过（${PAIRS.length} 个）。`);
  return 0;
}

process.exitCode = main();
