/**
 * 字幕切分。**契约里的算法，两处共用**：校验器（M3）用它判断 `narration` 能不能切成
 * 合规的字幕块，配音阶段（M8）用它真正切出 `durations.json` 的 `subs`。
 *
 * 规则来自 docs/specs/SPEC-data-format.md 第四节（沿用 `lecture-videos` 已验证的做法）：
 * 先按句末标点切，超长的在逗号处二次切，相邻短块合并避免孤行，每块 ≤ 24 字。
 *
 * **「字」按显示宽度折算**：中日韩文字算 1，其余（半角标点、拉丁字母、数字）算 0.5。
 * 24 本来就是屏幕上一行的容量，中英混排时按这个折算才与画面一致；纯中文文本下
 * 它与「数汉字个数」完全等价。常量见 `SUB_LIMIT`。
 */

/** 句末标点：先在这里切。 */
const SENTENCE_END = new Set(['。', '！', '？', '；', '：']);

/** 二次切分点：句末切完还超长的块，在这里再切。 */
const CLAUSE_END = new Set(['，', '、']);

/** 一块字幕的容量上限（宽度单位）。 */
export const SUB_LIMIT = 24;

const CJK = /[\u2E80-\u9FFF\u3000-\u303F\uAC00-\uD7FF\uFF00-\uFF60\uFFE0-\uFFE6]/u;

/** 一个字符的显示宽度：中日韩文字与全角标点 1，其余 0.5。 */
export function charWidth(char: string): number {
  return CJK.test(char) ? 1 : 0.5;
}

/**
 * 一段文本的宽度。用 `Array.from` 按码点遍历，代理对（emoji 等）算一个字符。
 *
 * 宽度是半角单位的 0.5 的倍数，所以**乘 2 用整数比较**，避免浮点误差。
 */
export function textWidth(text: string): number {
  return halfWidthUnits(text) / 2;
}

/** 宽度的一半，整数。用于比较，避免 0.1 + 0.2 那类误差。 */
export function halfWidthUnits(text: string): number {
  let units = 0;
  for (const char of text) units += CJK.test(char) ? 2 : 1;
  return units;
}

/** 按标点切，标点跟在前一块末尾。空块丢弃。 */
function splitOn(text: string, stops: ReadonlySet<string>): string[] {
  const pieces: string[] = [];
  let current = '';

  for (const char of text) {
    current += char;
    if (stops.has(char)) {
      pieces.push(current);
      current = '';
    }
  }
  if (current !== '') pieces.push(current);

  return pieces.filter((piece) => piece.trim() !== '');
}

/**
 * 把一块在 `stops` 处按容量切开。用于那些一次切完仍然超长的块。
 *
 * **不硬切**：真正切不动的长串（比如一整句没有标点的英文）原样留下，
 * 由调用方判断它是否超限 —— 硬切会产生半个词，比超长更难读。
 */
function breakLong(piece: string, stops: ReadonlySet<string>, limitUnits: number): string[] {
  const candidates = splitOn(piece, stops);
  if (candidates.length <= 1) return [piece];

  const merged: string[] = [];
  let current = '';
  for (const candidate of candidates) {
    const joined = current + candidate;
    if (current !== '' && halfWidthUnits(joined) > limitUnits) {
      merged.push(current);
      current = candidate;
    } else {
      current = joined;
    }
  }
  if (current !== '') merged.push(current);
  return merged;
}

/** 合并相邻短块，避免孤行 —— 但**只在同一句内**合并，不跨句。 */
function mergeWithinSentence(sentence: string[], limitUnits: number): string[] {
  const merged: string[] = [];
  let current = '';

  for (const piece of sentence) {
    const joined = current + piece;
    if (current !== '' && halfWidthUnits(joined) <= limitUnits) {
      current = joined;
    } else {
      if (current !== '') merged.push(current);
      current = piece;
    }
  }
  if (current !== '') merged.push(current);
  return merged;
}

/**
 * 切字幕块。输入是场景的 `narration`，输出是各块文本。
 *
 * 返回的每一块都应 ≤ `limit`；**返回超限的块是刻意的** —— 那说明这段文字里没有任何
 * 可切点，硬切只会产生半个词，交给校验器报出来让人改稿更合适（`validateSubtitles`）。
 */
export function splitSubtitles(text: string, limit = SUB_LIMIT): string[] {
  const limitUnits = Math.round(limit * 2);
  const pieces: string[] = [];

  for (const sentence of splitOn(text, SENTENCE_END)) {
    if (halfWidthUnits(sentence) <= limitUnits) {
      pieces.push(sentence);
      continue;
    }
    const clauses = breakLong(sentence, CLAUSE_END, limitUnits);
    pieces.push(...mergeWithinSentence(clauses, limitUnits));
  }

  return pieces;
}

/** 一块超限的字幕。 */
export type OversizedPiece = {
  text: string;
  /** 折算后的宽度。 */
  width: number;
};

/** 检查一段 `narration` 是否能切出合规字幕。合规时返回空数组。 */
export function validateSubtitles(text: string, limit = SUB_LIMIT): OversizedPiece[] {
  const limitUnits = Math.round(limit * 2);
  return splitSubtitles(text, limit)
    .filter((piece) => halfWidthUnits(piece) > limitUnits)
    .map((piece) => ({ text: piece, width: textWidth(piece) }));
}
