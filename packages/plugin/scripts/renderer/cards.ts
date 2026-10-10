/** 视频仅负责把共享场景卡按视频模式渲染。 */
import type { Plan } from './plan.ts';
import { collectSceneCards } from '../scenecard/from-plan.ts';
import { renderSceneCard } from '../scenecard/render.ts';

export function buildCards(plan: Plan): Record<string, string> {
  const out: Record<string, string> = {};
  let no = 0;
  for (const card of collectSceneCards(plan)) {
    if (card.kind !== 'cover' && card.kind !== 'outro') no += 1;
    out[card.id] = renderSceneCard(card, { mode: 'video', no });
  }
  return out;
}
