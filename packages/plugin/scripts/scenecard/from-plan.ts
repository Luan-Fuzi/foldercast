/**
 * 计划 → 场景卡（0006）：`PlanScene` 映射成 `scenecard` 的 `SceneCard`，
 * 两个出口统一消费卡片。**纯函数**：同一份 plan 两次构建得到同一组卡，
 * 逐帧一致不受影响（卡片是字符串，帧驱动的动效在包装组件的 CSS 变量上）。
 *
 * 分工：plan 负责解析素材地址与节拍时刻；这里只做「计划形状 → 卡片形状」的字段搬运
 * 与展示算术（bytesLabel、L 区间、占比），不做统计、不猜内容。
 */
import { isMarkdownFile } from '../contracts/script.ts';
import { prepKindOf } from '../contracts/prep.ts';
import type { Plan, PlanScene } from '../renderer/plan.ts';
import { fitSize, humanBytes } from '../renderer/plan.ts';
import type { SceneCard } from '../scenecard/card.ts';

export function cardOf(scene: PlanScene, plan: Plan): SceneCard {
  const common = {
    id: scene.id,
    title: scene.title,
    narration: scene.narration,
    beats: scene.beats.map((beat) => ({ enter: beat.enter, points: beat.points, graphic: beat.graphic })),
  };
  switch (scene.type) {
    case 'cover':
      return {
        ...common,
        kind: 'cover',
        ...(scene.subtitle === undefined ? {} : { subtitle: scene.subtitle }),
        label: plan.label,
        facts: scene.facts,
      };
    case 'tree': {
      const max = scene.rows.reduce((value, row) => Math.max(value, row.files), 0);
      return {
        ...common,
        kind: 'structure',
        rows: scene.rows.map((row) => ({
          path: row.path,
          files: row.files,
          ...(row.bytes === undefined ? {} : { bytesLabel: humanBytes(row.bytes) }),
          share: max === 0 ? 0 : row.files / max,
          highlight: row.highlight,
        })),
      };
    }
    case 'inventory':
      return {
        ...common,
        kind: 'inventory',
        rows: scene.groups.map((group) => ({
          label: group.label,
          count: group.count,
          share: group.share,
          ...(group.note === undefined ? {} : { note: group.note }),
        })),
        total: scene.totalFiles,
      };
    case 'file': {
      const markdown = isMarkdownFile(scene.path);
      const highlightHtml = plan.highlight?.[scene.id];
      const codeSizePx = fitSize(scene.excerpt.join('\n'), 15, 11);
      return {
        ...common,
        kind: 'file',
        file: scene.path,
        ...(scene.note === undefined ? {} : { note: scene.note }),
        excerpt: scene.excerpt,
        ...(scene.excerptStart === undefined ? {} : { excerptStart: scene.excerptStart }),
        // 代码字号写在卡片上：基准盒没有布局引擎回读，按字符量估（与旧 fitSize 同一思路）
        ...(highlightHtml === undefined || markdown ? {} : { highlightHtml: wrapCode(highlightHtml, codeSizePx) }),
        ...(markdown && highlightHtml !== undefined ? { highlightHtml, highlightIsMarkdown: true } : {}),
        ...(scene.media?.src === undefined ? {} : { shotSrc: scene.media.src }),
        // 文本和源码的摘录就是画面，不把「无需转图」的内部诊断展示给观众。
        ...(scene.noteMissing === undefined || (prepKindOf(scene.path) === undefined && scene.excerpt.length > 0)
          ? {} : { noteMissing: scene.noteMissing }),
      };
    }
    case 'gallery':
      return {
        ...common,
        kind: 'gallery',
        // 两个出口只收有地址的格子（缺素材的由 plan 记 warning，不画空板块）
        items: scene.items
          .filter((item) => item.src !== undefined)
          .map((item) => ({
            path: item.file ?? item.path,
            kindLabel: '素材',
            isImage: true,
            ...(item.src === undefined ? {} : { src: item.src }),
          })),
      };
    case 'clip':
      return {
        ...common,
        kind: 'clip',
        source: scene.file,
        ...(scene.range === undefined
          ? {}
          : { rangeLabel: `${fmt(scene.range[0] ?? 0)}–${fmt(scene.range[1] ?? 0)} 秒` }),
        ...(scene.poster?.src === undefined ? {} : { posterSrc: scene.poster.src }),
      };
    case 'document':
      return {
        ...common,
        kind: 'document',
        source: scene.file,
        pagesLabel: scene.footer,
        pages: scene.pages
          .filter((page) => page.src !== undefined)
          .map((page) => ({ src: page.src! })),
      };
    case 'concept':
      return { ...common, kind: 'concept', statement: scene.statement, points: scene.points };
    case 'compare':
      return { ...common, kind: 'compare', left: scene.left, right: scene.right };
    case 'flow':
      return { ...common, kind: 'flow', steps: scene.steps };
    case 'outro':
      return {
        ...common,
        kind: 'outro',
        ...(scene.subtitle === undefined ? {} : { subtitle: scene.subtitle }),
        lines: scene.lines,
      };
  }
}

/** 秒的展示写法：整数不带小数点，其余一位小数。 */
function fmt(seconds: number): string {
  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
}

/** shiki 的输出套一层字号：基准盒按字符量估（无布局引擎，宁可小不可溢出）。 */
function wrapCode(html: string, codeSizePx: number): string {
  return `<div style="font-size:${String(codeSizePx)}px">${html}</div>`;
}


/** 同一个计划向两个出口提供同一组场景卡；展示时序由出口决定。 */
export function collectSceneCards(plan: Plan): SceneCard[] {
  return plan.scenes.map((scene) => cardOf(scene, plan));
}
