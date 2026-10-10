/** 页面只负责文档组织；场景内容由共享的 Plan → SceneCard 转换提供。 */
import type { ScriptDocument } from '../contracts/script.ts';
import { isSceneType } from '../contracts/script.ts';
import { prepKindOf } from '../contracts/prep.ts';
import { buildPlan, humanBytes, type Plan } from '../renderer/plan.ts';
import { collectSceneCards } from '../scenecard/from-plan.ts';
import type { CardCommon, SceneCard } from '../scenecard/card.ts';

export type HeroSection = CardCommon & { kind: 'hero'; subtitle?: string };
export type PageSection = Exclude<SceneCard, { kind: 'cover' }> | HeroSection;
export type PageModel = {
  title: string;
  label: string;
  sourceRoot: string;
  hero?: HeroSection;
  sections: PageSection[];
  skipped: { id: string; type: string }[];
  references: string[];
};
export const formatBytes = humanBytes;
export function describePages(pages: readonly number[] | undefined): string {
  return pages === undefined || pages.length === 0 ? '翻全部页' : `翻第 ${pages.join('、')} 页`;
}

/** 素材、摘录高亮与内容字段均来自与视频相同的计划。 */
export function collectPlanModel(script: ScriptDocument, plan: Plan): PageModel {
  const sections: PageSection[] = [];
  let hero: HeroSection | undefined;
  for (const card of collectSceneCards(plan)) {
    const points = [...(card.points ?? []), ...(card.beats ?? []).flatMap((beat) => beat.points ?? [])];
    if (card.kind === 'cover') {
      const section: HeroSection = { ...card, kind: 'hero', points };
      if (hero === undefined) hero = section;
      else sections.push(section);
    } else {
      sections.push({ ...card, ...(points.length > 0 ? { points } : {}) });
    }
  }
  const references = [...new Set(script.scenes.flatMap((scene) =>
    [scene.file, scene.source, ...(scene.items ?? [])].filter((path): path is string => path !== undefined && path !== ''),
  ))];
  return {
    title: script.title ?? plan.label,
    label: plan.label,
    sourceRoot: script.source.root,
    ...(hero === undefined ? {} : { hero }),
    sections,
    skipped: script.scenes.filter((scene) => !isSceneType(scene.type)).map((scene) => ({ id: scene.id, type: String(scene.type) })),
    references,
  };
}

/** 兼容纯讲稿调用：无素材准备时保留引用占位；产品入口使用 collectPlanModel。 */
export function collectViewModel(script: ScriptDocument): PageModel {
  const model = collectPlanModel(script, buildPlan({ script }));
  for (const section of model.sections) {
    const scene = script.scenes.find((item) => item.id === section.id);
    if (section.kind === 'gallery') {
      section.items = (scene?.items ?? []).map((path) => {
        const kind = prepKindOf(path);
        return { path, isImage: kind === 'image', kindLabel: ({ image: '图片', video: '视频', office: 'Office', pdf: 'PDF' } as Record<string, string>)[kind ?? ''] ?? '文件' };
      });
    } else if (section.kind === 'document') section.pagesLabel = describePages(scene?.pages);
  }
  return model;
}
export function countSections(model: PageModel): number {
  return model.sections.length + (model.hero === undefined ? 0 : 1);
}
