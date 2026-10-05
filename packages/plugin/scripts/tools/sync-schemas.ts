#!/usr/bin/env node
/**
 * 把契约 schema 复制进插件包，供分发使用。
 *
 * **schema 只有一份**，在 `docs/specs/` 下（docs/conventions/docs.md 第五节）。插件里这份是
 * **构建产物**：`pnpm pack` / `pnpm publish` 前由 `prepack` 生成，不进版本库。复制而不是
 * 让插件直接读 `docs/`，是因为 publish 只打包包目录，`docs/` 不在包里。
 *
 * 用法：node packages/plugin/scripts/tools/sync-schemas.ts
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '../..');
const SOURCE = join(REPO_ROOT, 'docs/specs');
const TARGET = join(PACKAGE_ROOT, 'schemas');

/** 随包分发的 schema。加一份就要同时加进 package.json 的 files 与校验器的查找。 */
const SHIPPED = ['foldercast.schema.json', 'script.schema.json', 'assets.schema.json'] as const;

type ShippedName = (typeof SHIPPED)[number];

if (!existsSync(SOURCE)) {
  console.error(`找不到契约目录：${SOURCE}。本脚本按仓库布局工作，请在仓库内运行。`);
  process.exit(1);
}

mkdirSync(TARGET, { recursive: true });

// 目标目录里多出来的旧 schema 会让「契约只有一份」变得含糊，先清掉
const stale = readdirSync(TARGET).filter((name) => name.endsWith('.schema.json') && !SHIPPED.includes(name as ShippedName));
for (const name of stale) rmSync(join(TARGET, name));

for (const name of SHIPPED) {
  copyFileSync(join(SOURCE, name), join(TARGET, name));
  // 读一遍确认是合法 JSON：坏 schema 要在打包时暴露，而不是等用户装上以后
  JSON.parse(readFileSync(join(TARGET, name), 'utf8'));
}

console.log(
  `已同步 ${String(SHIPPED.length)} 份 schema 到 ${TARGET}${stale.length > 0 ? `（清掉 ${String(stale.length)} 份旧文件）` : ''}`,
);
