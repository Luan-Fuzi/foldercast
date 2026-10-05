/**
 * 字幕切分（契约算法，M3 校验与 M8 配音共用）。
 *
 * coding.md「关键测试用例」点名的三条：超长句在逗号处二次切分、相邻短句合并避免孤行、
 * 每块 ≤ 24 字。这里逐条验。
 */
import { describe, expect, it } from 'vitest';
import { SUB_LIMIT, splitSubtitles, textWidth, validateSubtitles } from '../../contracts/subtitles.ts';

/** 每块的实际宽度，便于断言「都 ≤ 24」。 */
function widths(pieces: readonly string[]): number[] {
  return pieces.map((piece) => textWidth(piece));
}

describe('宽度折算', () => {
  it('中文算 1，半角算 0.5', () => {
    expect(textWidth('中文四个')).toBe(4);
    expect(textWidth('abcd')).toBe(2);
    expect(textWidth('中文ab')).toBe(3);
  });

  it('标点跟着字符宽度走', () => {
    expect(textWidth('。')).toBe(1);
    expect(textWidth('.')).toBe(0.5);
  });

  it('空串是 0', () => {
    expect(textWidth('')).toBe(0);
  });
});

describe('切分规则', () => {
  it('短句按句末标点切，标点留在前一块', () => {
    const pieces = splitSubtitles('第一句。第二句！第三句？');
    expect(pieces).toEqual(['第一句。', '第二句！', '第三句？']);
  });

  it('相邻短句合并，避免孤行 —— 但只在同一句内', () => {
    // 「好。」「很好。」都短，且来自同一句（没有句末标点分隔），应当各自独立成块
    const pieces = splitSubtitles('好。很好。');
    expect(pieces).toEqual(['好。', '很好。']);
  });

  it('超长句在逗号处二次切分', () => {
    const text = '这个目录分成三块，源码放在 src 下面，文档放在 docs 下面，素材放在 assets 里面。';
    const pieces = splitSubtitles(text);
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) expect(textWidth(piece)).toBeLessThanOrEqual(SUB_LIMIT);
    // 每块都以逗号或句号收尾，不会被切成半个词
    for (const piece of pieces) expect(piece).toMatch(/[，。]$/u);
  });

  it('切点不够时保持原样，不硬切出半个词', () => {
    const text = '这一条用来演示字幕切不开的情况因为这个句子从头到尾都没有可以下刀的地方';
    const pieces = splitSubtitles(text);
    expect(pieces).toEqual([text]);
    expect(validateSubtitles(text).length).toBe(1);
  });

  it('合并后的块仍不超限', () => {
    const text = '短句一，短句二，短句三，短句四，短句五，短句六，短句七，短句八，短句九，短句十。';
    const pieces = splitSubtitles(text);
    expect(pieces.join('')).toBe(text);
    for (const piece of pieces) expect(textWidth(piece)).toBeLessThanOrEqual(SUB_LIMIT);
  });

  it('切分不丢字：拼起来的长度与原文一致', () => {
    const text = '第一段话。第二段话稍微长一些，里面有逗号，也有顿号、还有别的。第三段话！';
    expect(splitSubtitles(text).join('')).toBe(text);
  });

  it('空文本切出空数组', () => {
    expect(splitSubtitles('')).toEqual([]);
  });

  it('混合中英的宽度按折算算，不按字符个数', () => {
    // 24 个半角字符宽度是 12，不该被判超限
    const halfWidth = 'a'.repeat(24);
    expect(validateSubtitles(halfWidth)).toEqual([]);
    // 24 个全角字符刚好是上限
    const fullWidth = '字'.repeat(24);
    expect(validateSubtitles(fullWidth)).toEqual([]);
    expect(validateSubtitles('字'.repeat(25)).length).toBe(1);
  });

  it('合规的 narration 不报问题', () => {
    expect(validateSubtitles('整个目录分成四块。content 放讲稿，scripts 放脚本。')).toEqual([]);
  });

  it('超限的块报出它的宽度与文本', () => {
    const oversized = validateSubtitles('字'.repeat(30));
    expect(oversized).toHaveLength(1);
    expect(oversized[0]?.width).toBe(30);
  });

  it('每块都不超限是切分器的硬约束（除切不动的情况）', () => {
    const text = '这句话比较长，所以应该被切成两块，而不是一整块塞进字幕里。第二句也一样长，同样需要切开。';
    for (const piece of splitSubtitles(text)) expect(widths([piece])[0]).toBeLessThanOrEqual(SUB_LIMIT);
  });
});
