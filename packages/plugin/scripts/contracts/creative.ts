/** 设置页提供创作偏好，写稿模型结合上下文决定本次采用值；渲染器不执行这些偏好。 */
export const DIALOGUE_MODES = ['按需询问', '先沟通目标', '直接规划'] as const;
export const CREATIVE_DEPTHS = ['自动判断', '快速导览', '标准讲解', '深入讲解'] as const;
export type CreativePreferences = {
  dialogue?: typeof DIALOGUE_MODES[number];
  depth?: typeof CREATIVE_DEPTHS[number];
  audience?: string;
  focus?: string;
  /** 创作前沟通与取舍的补充指导。 */
  prompt?: string;
  /** 分钟；仅供内容规划参考，不控制渲染时轴。 */
  videoMinutes?: number;
  /** 分钟；预期阅读量，不是页面播放时长。 */
  pageMinutes?: number;
};
