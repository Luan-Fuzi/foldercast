/**
 * 讲稿（`script.json`）的校验：schema + **跨文件引用**。
 *
 * 这里是 ROADMAP M3 的「**幻觉路径拦截**」：写稿的模型会编路径，所以每个引用都要回到
 * 解读的 `manifest` 里核对。两类基准不能混（SPEC-data-format.md「工作目录」）：
 *
 * | 字段 | 相对于 |
 * |---|---|
 * | `file` / `source` / `tree.highlight` | **源目录**（被讲解的目录） |
 * | `asset` / `items` / `poster` / `pages` | **工作根** `.foldercast/` |
 *
 * 只查机器能判断的。**「有没有讲错重点」不在这里**，那是 M5 评审 agent 的事。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AssetManifest } from '../contracts/assets.ts';
import type { FoldercastDocument } from '../contracts/foldercast.ts';
import {
  SCENE_ALLOWED_FIELDS,
  SCENE_REQUIRED_FIELDS,
  isSceneType,
  type ScriptDocument,
} from '../contracts/script.ts';
import { SUB_LIMIT, validateSubtitles } from '../contracts/subtitles.ts';
import { validateAgainstSchema, type SchemaValidator } from './ajv.ts';
import { createLocator, type Locator } from './locate.ts';
import { IssueCollector, fieldPointer, sceneLabel, scenePointer } from './issue.ts';

export type ScriptInput = {
  document: ScriptDocument;
  /** 报告里显示的文件路径。 */
  path: string;
  /** 读取的文件原文，用于把 JSON 指针换成行列。 */
  text: string;
  validateSchema: SchemaValidator;
  /** 讲稿引用的解读。没有它就无法判断路径真假，所以它不在「可选」里。 */
  reading: FoldercastDocument;
  /** 素材清单（跑过素材阶段才有）。 */
  assets?: AssetManifest;
  /** 工作根 `<源目录>/.foldercast/`。没有它就不查素材文件是否真的在。 */
  workRoot?: string;
};

/** 素材字段：相对工作根。 */
const ASSET_FIELDS = ['asset', 'items', 'poster', 'pages'] as const;

/** 源文件字段：相对源目录。 */
const SOURCE_FIELDS = ['file', 'source'] as const;

type Emit = (pointer: string, severity: 'blocker' | 'warning', code: Parameters<IssueCollector['add']>[0]['code'], message: string, fix: string) => void;

/**
 * 汇总所有素材清单里登记过的产物路径。
 *
 * 除了精确匹配，还接受「工作根 + 产物路径」的后缀匹配 —— 讲稿里写 `assets/pages/a_p1.png`，
 * 清单里登记 `pages/a_p1.png` 时基准写法不同（SPEC 要求前者），那种情况单独当警告报，
 * 不能当成幻觉路径（文件明明是存在的）。
 */
function assetPathsIn(assets: AssetManifest | undefined): { exact: Set<string>; suffixes: Set<string> } {
  const exact = new Set<string>();
  const suffixes = new Set<string>();

  for (const entry of assets?.entries ?? []) {
    for (const product of entry.products) {
      exact.add(product.path);
      suffixes.add(`assets/${product.path}`);
    }
    if (entry.text?.markdown !== undefined) {
      exact.add(entry.text.markdown);
      suffixes.add(`assets/${entry.text.markdown}`);
    }
  }

  return { exact, suffixes };
}

export function checkScript(input: ScriptInput): IssueCollector {
  const { document, path, text, validateSchema, reading, assets, workRoot } = input;
  const collector = new IssueCollector();
  const locator = createLocator(text);

  const emit: Emit = (pointer, severity, code, message, fix) => {
    const at = locator.at(pointer);
    collector.add({ path, pointer, severity, code, message, fix, ...(at === undefined ? {} : { at }) });
  };

  for (const issue of validateAgainstSchema(validateSchema, document, path, locator)) collector.add(issue);

  if (document.foldercast !== 1) {
    emit('/foldercast', 'blocker', 'version-unsupported', `讲稿声明的解读版本是 ${String(document.foldercast)}，本工具只认 1。`, '把 foldercast 改成 1，或重新生成解读与讲稿。');
  }

  if (document.source.root !== reading.source.root) {
    emit(
      '/source/root',
      'blocker',
      'source-root-mismatch',
      `讲稿的 source.root 是 ${document.source.root}，解读的是 ${reading.source.root}。`,
      '讲稿与解读必须来自同一个目录；重新跑分析器，或改对 root。',
    );
  }

  const plan = buildPlan(reading, assets, workRoot);
  const scenes = document.scenes;

  scenes.forEach((scene, index) => {
    const pointer = scenePointer(index);
    const label = sceneLabel(scene, index);

    if (!isSceneType(scene.type)) {
      emit(`${pointer}/type`, 'blocker', 'scene-type-unknown', `${label} 的 type 是 ${String(scene.type)}，不是一个场景类型。`, '用 cover / tree / inventory / file / gallery / clip / document / outro 之一。');
      return;
    }

    const sceneId = scene.id;
    /**
     * 报一个场景字段的问题。**字段不存在时位置回退到场景对象上** —— 缺字段的指针
     * （`/scenes/0/title`）在文件里没有对应节点，不回退就会报出一个没有行号的错误。
     */
    const add = (name: string, severity: 'blocker' | 'warning', code: Parameters<IssueCollector['add']>[0]['code'], message: string, fix: string): void => {
      const pointer = fieldPointer(index, name);
      const at = locator.at(pointer) ?? locator.at(scenePointer(index));
      collector.add({
        path,
        pointer,
        severity,
        code,
        message,
        fix,
        sceneId,
        field: name,
        ...(at === undefined ? {} : { at }),
      });
    };

    // 该类型必需的字段
    for (const required of SCENE_REQUIRED_FIELDS[scene.type]) {
      const value = (scene as unknown as Record<string, unknown>)[required];
      if (value === undefined) {
        add(required, 'blocker', 'scene-field-missing', `${label} 是 ${scene.type} 场景，缺 ${required}。`, `补上 ${required}，见 SPEC-data-format.md 的场景类型清单。`);
      }
    }

    // 该类型用不上的字段（schema 允许的字段集合是并集，所以这里要按类型查）
    const allowed = new Set(SCENE_ALLOWED_FIELDS[scene.type]);
    for (const name of Object.keys(scene)) {
      if (allowed.has(name)) continue;
      add(name, 'blocker', 'scene-field-unused', `${label} 是 ${scene.type} 场景，不该有 ${name}。`, `删掉 ${name}，或把场景类型改成用得上它的那个。`);
    }

    // 源文件路径：必须存在于解读的 manifest
    for (const name of SOURCE_FIELDS) {
      const value = (scene as unknown as Record<string, unknown>)[name];
      if (typeof value !== 'string' || value === '') continue;

      if (!plan.sourcePaths.has(value)) {
        const hint = plan.similarHint(value);
        add(name, 'blocker', 'path-hallucinated', `${label} 引用的 ${value} 不在解读的 manifest 里。`, `只能引用解读里存在的路径${hint}。清单共 ${String(plan.sourcePaths.size)} 条，可用 pnpm analyze 重新生成。`);
        continue;
      }

      const entry = plan.sourceEntry(value);
      if (entry !== undefined && (scene.type === 'clip' || scene.type === 'document')) {
        if (!accepts(scene.type, entry.kind)) {
          const expected = scene.type === 'document' ? 'office / pdf' : 'video';
          add(name, 'warning', 'scene-field-unused', `${label} 的 ${value} 是 ${entry.kind} 类型，${scene.type} 场景通常用 ${expected}。`, '确认场景类型选对了，或换一个源文件。');
        }
      }
    }

    // 素材路径：相对工作根
    for (const name of ASSET_FIELDS) {
      const value = (scene as unknown as Record<string, unknown>)[name];
      const list = typeof value === 'string' ? [value] : Array.isArray(value) ? (value as unknown[]) : [];

      list.forEach((item, itemIndex) => {
        if (typeof item !== 'string' || item === '') return;
        const suffix = Array.isArray(value) ? `/${String(itemIndex)}` : '';
        const at = locator.at(`${pointer}/${name}${suffix}`);

        const verdict = plan.checkAsset(item);
        if (verdict === 'ok') return;
        if (verdict === 'wrong-base') {
          collector.add({
            path,
            pointer: `${pointer}/${name}${suffix}`,
            severity: 'warning',
            code: 'asset-missing',
            message: `${label} 的 ${name} 写作 ${item}，素材清单里登记的是相对工作根的路径。`,
            fix: `写成 assets/${item.replace(/^assets\//, '')}，与清单的基准一致。`,
            sceneId,
            field: name,
            ...(at === undefined ? {} : { at }),
          });
          return;
        }
        collector.add({
          path,
          pointer: `${pointer}/${name}${suffix}`,
          severity: 'blocker',
          code: 'asset-missing',
          message: `${label} 的 ${name} 指向 ${item}，但${plan.assetHint()}`,
          fix: plan.hasAssets ? '只能用素材清单里登记过的产物；先跑 pnpm assets <目录>。' : '先跑 pnpm assets <目录> 生成素材。',
          sceneId,
          field: name,
          ...(at === undefined ? {} : { at }),
        });
      });
    }

    // tree：highlight 的子路径必须能在结构树里找到
    if (scene.type === 'tree') {
      (scene.highlight ?? []).forEach((highlight, highlightIndex) => {
        if (plan.hasPrefix(highlight)) return;
        const at = locator.at(`${pointer}/highlight/${String(highlightIndex)}`);
        collector.add({
          path,
          pointer: `${pointer}/highlight/${String(highlightIndex)}`,
          severity: 'blocker',
          code: 'path-hallucinated',
          message: `${label} 强调的 ${highlight} 在结构树里不存在。`,
          fix: 'highlight 写子路径（目录名或文件路径），必须是解读里有的。',
          sceneId,
          field: 'highlight',
          ...(at === undefined ? {} : { at }),
        });
      });
    }

    // inventory：两个方向都不信任，核对后给警告（解读可能重新分析过）
    if (scene.type === 'inventory') {
      (scene.groups ?? []).forEach((group, groupIndex) => {
        const actual = reading.stats.kindCounts[group.kind];
        if (actual === undefined) {
          const at = locator.at(`${pointer}/groups/${String(groupIndex)}/kind`);
          collector.add({
            path,
            pointer: `${pointer}/groups/${String(groupIndex)}/kind`,
            severity: 'blocker',
            code: 'inventory-group-kind-unknown',
            message: `${label} 的分组类型 ${String(group.kind)} 不是契约里的 12 类之一。`,
            fix: '用 code / text / markup / data / office / pdf / image / video / audio / archive / binary / other。',
            sceneId,
            field: 'groups',
            ...(at === undefined ? {} : { at }),
          });
          return;
        }
        if (group.count !== actual) {
          const at = locator.at(`${pointer}/groups/${String(groupIndex)}/count`);
          collector.add({
            path,
            pointer: `${pointer}/groups/${String(groupIndex)}/count`,
            severity: 'warning',
            code: 'inventory-group-count-mismatch',
            message: `${label} 说 ${group.kind} 有 ${String(group.count)} 个，解读里的统计是 ${String(actual)} 个。`,
            fix: '解说可以取整或概括，但与解读差距大时应当核对；解读重新分析过就要改这里。',
            sceneId,
            field: 'groups',
            ...(at === undefined ? {} : { at }),
          });
        }
      });
    }

    // file：高亮行区间不能超出文件真实行数
    if (scene.type === 'file' && scene.file !== undefined && scene.focusLines !== undefined) {
      const [start, end] = scene.focusLines;
      const lines = plan.sourceEntry(scene.file)?.lines;
      if (start !== undefined && end !== undefined && start > end) {
        add('focusLines', 'blocker', 'focus-lines-out-of-range', `${label} 的 focusLines 是 [${String(start)}, ${String(end)}]，起点在终点之后。`, '写成 [起, 止]，起 ≤ 止。');
      } else if (end !== undefined && lines !== undefined && end > lines) {
        add('focusLines', 'blocker', 'focus-lines-out-of-range', `${label} 高亮到第 ${String(end)} 行，但 ${scene.file} 只有 ${String(lines)} 行。`, '把区间收在文件行数之内。');
      }
    }

    // clip：片段区间的方向
    if (scene.type === 'clip' && scene.clipRange !== undefined) {
      const [start, end] = scene.clipRange;
      if (start !== undefined && end !== undefined && end <= start) {
        add('clipRange', 'blocker', 'clip-range-invalid', `${label} 的 clipRange 是 [${String(start)}, ${String(end)}] 秒，止必须大于起。`, '写成 [起秒, 止秒]，止 > 起。');
      }
    }

    // 字幕：能不能切成 ≤ 24 的块
    const oversized = validateSubtitles(scene.narration);
    if (oversized.length > 0) {
      const worst = oversized.reduce((max, piece) => (piece.width > max.width ? piece : max), oversized[0] as (typeof oversized)[number]);
      add(
        'narration',
        'blocker',
        'subtitle-too-long',
        `${label} 的 narration 切出 ${String(oversized.length)} 块超过 ${String(SUB_LIMIT)} 字，最长一块 ${String(worst.width)} 字：「${worst.text}」。`,
        '在该块里加标点（，、）或拆成两句；一句里没有任何可切点时长句无法上字幕。',
      );
    }
  });

  // 场景 id 唯一：配音产物按 id 命名，重复会互相覆盖
  const seen = new Map<string, number>();
  scenes.forEach((scene, index) => {
    const previous = seen.get(scene.id);
    if (previous === undefined) {
      seen.set(scene.id, index);
      return;
    }
    const at = locator.at(`${scenePointer(index)}/id`);
    collector.add({
      path,
      pointer: `${scenePointer(index)}/id`,
      severity: 'blocker',
      code: 'scene-id-duplicate',
      message: `场景 id "${scene.id}" 与第 ${String(previous + 1)} 个场景重复。`,
      fix: 'id 用于配音产物命名与对齐，必须唯一。',
      sceneId: scene.id,
      field: 'id',
      ...(at === undefined ? {} : { at }),
    });
  });

  // outfit: 至少要有一个 cover 与一个 outro，否则片子没有头尾
  if (scenes.length > 0 && !scenes.some((scene) => scene.type === 'cover')) {
    emit('/scenes', 'warning', 'scene-field-missing', '讲稿里没有 cover 场景。', '开头补一个 cover，标题与副标题来自解读的 source.label。');
  }
  if (scenes.length > 0 && !scenes.some((scene) => scene.type === 'outro')) {
    emit('/scenes', 'warning', 'scene-field-missing', '讲稿里没有 outro 场景。', '结尾补一个 outro。');
  }

  return collector;
}

type Plan = {
  sourcePaths: Set<string>;
  sourceEntry(path: string): { kind: string; lines?: number } | undefined;
  hasPrefix(prefix: string): boolean;
  similarHint(value: string): string;
  checkAsset(value: string): 'ok' | 'missing' | 'wrong-base';
  assetHint(): string;
  hasAssets: boolean;
};

const DOCUMENT_KINDS: ReadonlySet<string> = new Set(['office', 'pdf']);

/** 场景类型是否接受这个 kind。用于「场景类型选错了」这类警告。 */
export function accepts(type: 'clip' | 'document', kind: string): boolean {
  return type === 'document' ? DOCUMENT_KINDS.has(kind) : kind === 'video';
}

/** 预先算好解读与素材的索引，避免每个场景重复扫清单。 */
function buildPlan(reading: FoldercastDocument, assets: AssetManifest | undefined, workRoot: string | undefined): Plan {
  const entries = new Map(reading.manifest.map((entry) => [entry.path, entry]));
  const directories = new Set<string>();
  for (const entry of reading.manifest) {
    const segments = entry.path.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(segments.slice(0, index).join('/'));
    }
  }

  // 路径已排序，前缀用二分查找：highlight 的数量乘以清单长度会变成扫描一万次的循环
  const sortedPaths = [...entries.keys()].sort();
  const hasPrefix = (prefix: string): boolean => {
    if (directories.has(prefix)) return true;
    const at = lowerBound(sortedPaths, prefix);
    const candidate = sortedPaths[at];
    return candidate !== undefined && candidate.startsWith(`${prefix}/`);
  };

  const { exact, suffixes } = assetPathsIn(assets);
  const hasAssets = assets !== undefined;

  return {
    sourcePaths: new Set(entries.keys()),
    sourceEntry: (path) => entries.get(path),
    hasPrefix,
    similarHint: (value) => {
      const base = value.split('/').pop() ?? value;
      const matches = [...entries.keys()].filter((path) => path.endsWith(`/${base}`) || path === base).slice(0, 3);
      return matches.length === 0 ? '' : `；相近的有 ${matches.join('、')}`;
    },
    checkAsset: (value) => {
      // 基准写错：清单里登记的是相对工作根的路径，讲稿多写了一层 assets/
      if (suffixes.has(value)) return 'wrong-base';
      if (exact.has(value)) return 'ok';

      // 素材清单没有这个产物时，仍看一眼文件系统：清单是可重算的缓存，可能还没重跑
      if (workRoot !== undefined && existsSync(join(workRoot, value))) return hasAssets ? 'wrong-base' : 'ok';

      return 'missing';
    },
    assetHint: () => (hasAssets ? '素材清单里没有它，也没有这个文件。' : '还没有素材清单，也没有这个文件。'),
    hasAssets,
  };
}

/** 排序数组里第一个 ≥ 目标的下标。 */
function lowerBound(sorted: readonly string[], target: string): number {
  let low = 0;
  let high = sorted.length;

  while (low < high) {
    const middle = (low + high) >> 1;
    const value = sorted[middle];
    if (value !== undefined && value < target) low = middle + 1;
    else high = middle;
  }

  return low;
}
