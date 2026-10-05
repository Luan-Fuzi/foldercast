/**
 * 把一段**实测总时长**分给若干块，按宽度占比。
 *
 * 这是契约里的算法，**三处共用**：校验器（判分配合不合理）、渲染器（字幕窗口）、
 * 配音阶段（写 `durations.json` 的 `subs`）。三处各写一遍必然漂移 —— 而字幕与画面
 * 一旦漂移，观众看到的就是「声音说到第三句、字幕还在第二句」。
 *
 * 单位是**宽度单位的一半**（整数）：中日韩字符算 2，其余算 1。乘 2 用整数比较是
 * `subtitles.ts` 的老规矩，避免浮点误差。
 *
 * 分配规则（与 `renderer/estimate.ts` 是同一套，M8 把实测秒数交给它）：
 *
 * 1. 先按宽度占比分；
 * 2. 低于下限的块从**最长的块**那里要，要到最长块也只剩下限为止（下限的上限是
 *    `总长 / 块数`，所以抬完不会超过总长）；
 * 3. **最后一块吃掉余量** —— 于是字幕在末尾留白期间保持可见，而不是提前消失。
 *
 * **总长永远不变**：它是实测出来的，字幕必须迁就它。分不够时宁可某块偏短，
 * 也不把视频改长。唯一无法两全的情况是「块数 > 总单位数」（总长不到 1 帧/毫秒 × 块数），
 * 那时靠后的块为 0 —— 正常路径上不会发生。
 */
import { halfWidthUnits } from './subtitles.ts';

export type Span = { from: number; to: number };

/**
 * 把 `total` 按 `weights` 的占比分成连续的区间。
 *
 * @param weights 每块的权重（宽度单位的一半，整数）。负数与 0 会被当成 1 ——
 *                一个完全由标点组成的块仍然要占时间，否则它永远不显示。
 * @param total 总长（帧或毫秒，调用方定）。单位只影响精度，不影响顺序。
 * @param min 每块的下限（同一单位）。传 0 表示不设下限。
 */
export function allocateSpans(weights: readonly number[], total: number, min: number): Span[] {
  if (weights.length === 0) return [];
  const safe = weights.map((weight) => (Number.isFinite(weight) && weight > 0 ? weight : 1));
  const count = safe.length;

  // 块数比总长还多时没有任何办法「既铺满又每块 ≥1」：只能有的块是 0。
  // 那种情况只可能出现在总长极小（< 块数）的调用里，正常路径上不会发生。
  if (total <= 0) return safe.map(() => ({ from: 0, to: 0 }));
  if (count > total) {
    const spans: Span[] = [];
    let cursor = 0;
    for (let i = 0; i < count; i += 1) {
      const length = i < total ? 1 : 0;
      spans.push({ from: cursor, to: cursor + length });
      cursor += length;
    }
    return spans;
  }

  const sum = safe.reduce((acc, weight) => acc + weight, 0);
  const quota = safe.map((weight) => Math.max(1, Math.round((weight / sum) * total)));

  // 下限：抬起来的时间从**最长的块**里扣，扣到它也只剩下限为止。
  // 上限是 `total / count`，所以不会出现「抬完超过总长」——那是把总时长改掉了，
  // 而总时长是实测出来的，字幕必须迁就它。
  const floor = Math.max(1, Math.min(min, Math.floor(total / count)));
  for (let i = 0; i < count; i += 1) {
    let need = floor - (quota[i] ?? 0);
    let guard = 0;
    while (need > 0 && guard < count * 4) {
      guard += 1;
      let donor = -1;
      let donorValue = floor;
      for (let j = 0; j < count; j += 1) {
        const value = quota[j] ?? 0;
        if (j === i || value <= donorValue) continue;
        donor = j;
        donorValue = value;
      }
      if (donor === -1) break;
      const give = Math.min(need, donorValue - floor);
      quota[donor] = donorValue - give;
      quota[i] = (quota[i] ?? 0) + give;
      need -= give;
    }
  }

  // 取整的余数补给最长的块（而不是最后一块）：最后一块已经被「吃掉余量」的规则占着了，
  // 再补给它会让末尾的留白凭空变长
  const drift = total - quota.reduce((acc, value) => acc + value, 0);
  if (drift !== 0) {
    let longest = 0;
    for (let j = 1; j < count; j += 1) if ((quota[j] ?? 0) > (quota[longest] ?? 0)) longest = j;
    quota[longest] = Math.max(1, (quota[longest] ?? 1) + drift);
  }

  const spans: Span[] = [];
  let cursor = 0;
  for (let i = 0; i < count; i += 1) {
    const isLast = i === count - 1;
    const length = isLast ? total - cursor : Math.max(1, quota[i] ?? 1);
    spans.push({ from: cursor, to: cursor + length });
    if (!isLast) cursor += length;
  }
  return spans;
}

/** 一段文本按宽度占比分到 `total` 上。权重就是各块的显示宽度。 */
export function allocateByWidth(texts: readonly string[], total: number, min: number): Span[] {
  return allocateSpans(
    texts.map((text) => halfWidthUnits(text)),
    total,
    min,
  );
}
