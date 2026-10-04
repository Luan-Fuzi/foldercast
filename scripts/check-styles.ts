/**
 * 校验风格预设的 token 键集合完全一致 —— 四套预设可互换的前提。
 *
 * 用法：node scripts/check-styles.ts
 */
import { dirname, join } from 'node:path';
import { REPO_ROOT, readJson, rel, walkFiles } from './lib/repo.ts';

const STYLE_DIR = join(REPO_ROOT, 'styles');

/** 这些顶层键是元信息，不参与 token 对比。 */
const META_GROUPS = new Set(['$comment', 'name', 'label', 'description']);

type Preset = { file: string; name: string; keys: Set<string> };

function loadPreset(file: string): Preset {
  const data = readJson(file);
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${rel(file)}: 顶层必须是对象`);
  }

  const record = data as Record<string, unknown>;
  const keys = new Set<string>();
  for (const [group, value] of Object.entries(record)) {
    if (META_GROUPS.has(group)) continue;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
    for (const key of Object.keys(value)) keys.add(`${group}.${key}`);
  }

  const name = typeof record['name'] === 'string' ? record['name'] : rel(file);
  return { file: rel(file), name, keys };
}

function main(): number {
  const files = walkFiles('.json').filter((file) => dirname(file) === STYLE_DIR);
  if (files.length < 2) {
    console.log(`styles/ 下只找到 ${files.length} 个预设，无法比对。`);
    return 1;
  }

  const presets = files.map(loadPreset);
  const [base] = presets as [Preset, ...Preset[]];
  let ok = true;

  for (const preset of presets.slice(1)) {
    const missing = [...base.keys].filter((key) => !preset.keys.has(key)).sort();
    const extra = [...preset.keys].filter((key) => !base.keys.has(key)).sort();
    if (missing.length === 0 && extra.length === 0) continue;

    ok = false;
    console.log(`${preset.name}（${preset.file}）与 ${base.name} 的 token 不一致：`);
    if (missing.length > 0) console.log(`  缺少 ${missing.length} 个：${missing.join('、')}`);
    if (extra.length > 0) console.log(`  多出 ${extra.length} 个：${extra.join('、')}`);
  }

  if (!ok) return 1;

  console.log(`${presets.length} 套预设的 token 键集合一致（${base.keys.size} 个）：${presets.map((p) => p.name).join(' / ')}`);
  return 0;
}

process.exitCode = main();
