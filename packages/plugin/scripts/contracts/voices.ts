/** 设置页与 provider 共用的预置音色；自定义名称仍可透传给对应 provider。 */
export const DEFAULT_EDGE_VOICE = 'zh-CN-XiaoxiaoNeural';
export const EDGE_VOICES = [
  'zh-CN-XiaoxiaoNeural', 'zh-CN-XiaoyiNeural', 'zh-CN-YunjianNeural',
  'zh-CN-YunxiNeural', 'zh-CN-YunyangNeural',
  'zh-CN-liaoning-XiaobeiNeural', 'zh-CN-shaanxi-XiaoniNeural',
] as const;
export const MIMO_VOICES = ['mimo_default', '冰糖', '茉莉', '苏打', '白桦', 'Mia', 'Chloe', 'Milo', 'Dean'] as const;

export function voicesFor(provider: string): readonly string[] {
  return provider === 'mimo' ? MIMO_VOICES : EDGE_VOICES;
}
export function defaultVoiceFor(provider: string): string {
  return provider === 'mimo' ? 'mimo_default' : DEFAULT_EDGE_VOICE;
}
