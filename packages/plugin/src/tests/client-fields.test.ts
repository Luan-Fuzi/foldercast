import { describe, expect, it } from 'vitest';
import { projectFields, settingsVoiceField } from '../client/fields.ts';

const fields = [
  { key: 'provider', path: ['voice', 'provider'] },
  { key: 'voice', path: ['voice', 'voice'] },
  { key: 'prompt', path: ['visual', 'prompt'] },
];
describe('设置页用户覆盖状态', () => {
  it('缺失的字段没有自有键；显式设置的空串仍是覆盖', () => {
    const projected = projectFields({ voice: { provider: 'edge', voice: '' } }, fields, true);
    expect(projected).toEqual({ provider: true, voice: true });
    expect(Object.hasOwn(projected, 'prompt')).toBe(false);
    expect(projectFields(undefined, fields, true)).toEqual({});
  });
  it('显示层保留实际值，嵌套层缺失时不抛异常', () => {
    expect(projectFields({ visual: { prompt: '多用流程' } }, fields)).toEqual({
      provider: undefined, voice: undefined, prompt: '多用流程',
    });
  });
  it('选择引擎默认音色时保存显式空覆盖，不能恢复上一个引擎的继承音色', () => {
    expect(settingsVoiceField('voice').parse('')).toEqual({ kind: 'set', value: '' });
  });
});
