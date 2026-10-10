import { describe, expect, it } from 'vitest';
import { normalizeVisualStyle, renderStyleFor, visualPreferencesFor, type VisualStyleInputName } from '../visual.ts';
import { checkScript } from '../../renderer/check.ts';

describe('对外风格名称与旧输入兼容', () => {
  it('自定义模式使用用户描述，内置模式忽略未启用的自定义名称', () => {
    const custom = visualPreferencesFor('自定义风格', '像手绘笔记，少量图像。', { name: '手绘风格', baseStyle: '科技风格' });
    expect(custom.stylePrompt).toContain('手绘风格');
    expect(custom.stylePrompt).toContain('像手绘笔记，少量图像。');
    expect(custom.stylePrompt).not.toContain('Tech-inspired Design');
    const builtin = visualPreferencesFor('瑞士风格', '少量图像。', { name: '手绘风格', baseStyle: '科技风格' });
    expect(builtin.name).toBeUndefined();
    expect(builtin.baseStyle).toBeUndefined();
    expect(builtin.stylePrompt).toContain('Swiss Style');
    expect(visualPreferencesFor('自定义风格').name).toBe('自定义风格');
    expect(visualPreferencesFor('自定义风格').stylePrompt).toContain('效果描述尚未填写');
  });

  it('自定义讲稿需要非空效果描述，名称保持原值，渲染使用基础预设', async () => {
    const script = { foldercast: 2 as const, source: { root: '/tmp' },
      visual: { style: '自定义风格' as const, name: '水墨风格', baseStyle: '科技风格' as const, prompt: '留白，节奏舒缓。' },
      scenes: [{ id: 'cover', type: 'cover' as const, title: '说明', narration: '说明。' }] };
    expect((await checkScript(script, '/tmp')).blocker).toBe(0);
    expect(renderStyleFor(script.visual)).toBe('科技风格');
    expect(script.visual.name).toBe('水墨风格');
    expect(renderStyleFor({ style: '自定义风格', prompt: '留白。' }, '科技风格')).toBe('瑞士风格');
    for (const prompt of [undefined, '', '  ']) {
      expect((await checkScript({ ...script, visual: { ...script.visual, prompt } }, '/tmp')).blocker).toBeGreaterThan(0);
    }
  });
  it('每套旧名称返回设计名称和具名的创作指导，保留用户补充', () => {
    for (const [legacy, name, english] of [
      ['素稿', '瑞士风格', 'Swiss Style'],
      ['杂志', '编辑设计风格', 'Editorial Design'],
      ['夜幕', '科技风格', 'Tech-inspired Design'],
    ] as const) {
      const preferences = visualPreferencesFor(legacy, '重点用左右对比。');
      expect(preferences.style).toBe(name);
      expect(preferences.stylePrompt).toContain(name);
      expect(preferences.stylePrompt).toContain(english);
      expect(preferences.prompt).toBe('重点用左右对比。');
      expect(normalizeVisualStyle(name)).toBe(name);
    }
    expect(normalizeVisualStyle('不存在')).toBeUndefined();
    expect(normalizeVisualStyle('__proto__')).toBeUndefined();
  });

  it('新名称与旧讲稿都通过真实 schema，校验不改写原讲稿', async () => {
    for (const style of ['瑞士风格', '编辑设计风格', '科技风格', '素稿', '杂志', '夜幕'] as VisualStyleInputName[]) {
      const script = { foldercast: 2 as const, source: { root: '/tmp' }, visual: { style },
        scenes: [{ id: 'cover', type: 'cover' as const, title: '说明', narration: '说明。' }] };
      const original = JSON.stringify(script);
      expect((await checkScript(script, '/tmp')).blocker).toBe(0);
      expect(JSON.stringify(script)).toBe(original);
    }
  });
});
