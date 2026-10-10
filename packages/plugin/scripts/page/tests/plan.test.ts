import { describe, expect, it } from 'vitest';
import type { ScriptDocument } from '../../contracts/script.ts';
import type { Prepared } from '../../contracts/prep.ts';
import { buildPlan } from '../../renderer/plan.ts';
import { collectSceneCards } from '../../scenecard/from-plan.ts';
import { renderSceneCard } from '../../scenecard/render.ts';
import { collectPlanModel } from '../collect.ts';
import { createPageEmbedder } from '../embed.ts';

const script: ScriptDocument = {
  foldercast: 2, source: { root: '/source' }, scenes: [
    { id: 'clip', type: 'clip', source: 'movie.mp4', narration: '视频。' },
    { id: 'doc', type: 'document', source: 'guide.pdf', pages: [2], narration: '第二页。' },
    { id: 'file', type: 'file', file: 'readme.md', excerpt: ['# 说明'], narration: '说明。' },
  ],
};

describe('共享计划的页面出口', () => {
  it('页面与视频使用同一封面、选定页图和预计算摘录', () => {
    const prep = new Map<string, Prepared>([
      ['movie.mp4', { source: 'movie.mp4', kind: 'video', products: [{ role: 'poster', path: 'assets/poster.jpg' }] }],
      ['guide.pdf', { source: 'guide.pdf', kind: 'pdf', products: [{ role: 'page', path: 'assets/p001.png' }, { role: 'page', path: 'assets/p002.png' }] }],
    ]);
    const plan = buildPlan({ script, prep, workRoot: '/source/.foldercast', embed: ({ path }) => ({ src: `data:${path}`, bytes: 1, scaled: false }) });
    plan.highlight = { file: '<div class="fc-md"><h1>说明</h1></div>' };
    const model = collectPlanModel(script, plan);
    expect(model.sections).toEqual(collectSceneCards(plan));
    for (const mode of ['page', 'video'] as const) {
      const html = collectSceneCards(plan).map((card) => renderSceneCard(card, { mode, no: 1 })).join('');
      expect(html).toContain('data:assets/poster.jpg');
      expect(html).toContain('data:assets/p002.png');
      expect(html).not.toContain('data:assets/p001.png');
      expect(html).toContain('<h1>说明</h1>');
    }
  });

  it('同一素材多次出现只占一次预算；超预算后相对引用准备好的产物', () => {
    let calls = 0;
    const { embed, report } = createPageEmbedder({ sourceDir: '/source', outDir: '/source/.foldercast/out', totalBudgetBytes: 10, embed: () => {
      calls += 1;
      return { src: 'data:image/png;base64,AA==', bytes: 6, scaled: false };
    } });
    const first = { path: 'assets/poster.jpg', workRoot: '/source/.foldercast', width: 100 };
    expect(embed(first)?.src).toContain('data:');
    expect(embed(first)?.src).toContain('data:');
    expect(embed({ ...first, path: 'assets/p002.png' })?.src).toBe('../assets/p002.png');
    expect(calls).toBe(2);
    expect(report.inlineBytes).toBe(6);
    expect(report.inlined).toBe(1);
    expect(report.linked).toBe(1);
    expect(report.notes[0]).toContain('转发时要把源文件一起带上');
  });
});
