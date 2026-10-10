/** 页面与视频共用美术预设；保留页面 API 与默认色板一致性检查。 */
import { TOKENS } from '../renderer/styles.ts';
import { DEFAULT_STYLE_NAME, PAGE_STYLES } from '../contracts/visual.ts';
export { PAGE_STYLES, DEFAULT_STYLE_NAME, STYLE_NAMES, styleByName } from '../contracts/visual.ts';
export type { PageStyle } from '../contracts/visual.ts';

/**
 * 瑞士风格预设是否仍与渲染器成片 token 同色（漂移说明有人只改了一边）。
 * 页面与视频是同一份讲稿的两个出口，这套颜色该一起动。
 */
export function samePaletteAsVideo(): boolean {
  const draft = PAGE_STYLES[DEFAULT_STYLE_NAME];
  if (draft === undefined) return false;
  const pairs: [string, string][] = [
    ['--bg', TOKENS.bg],
    ['--ink', TOKENS.ink],
    ['--muted', TOKENS.muted],
    ['--line', TOKENS.line],
    ['--accent', TOKENS.accent],
    ['--panel', TOKENS.panel],
    ['--code-bg', TOKENS.codeBg],
  ];
  return pairs.every(([key, value]) => draft.vars[key] === value);
}
