/**
 * 时长分配（`contracts/spans.ts`）。
 *
 * 这一层是**配音与画面之间唯一的算术**：配音阶段用它把实测秒数分给字幕块，渲染阶段
 * 用它把同一批块分到帧上。两处算法要是漂了，表现就是「声音说到第三句、字幕还在第二句」——
 * 而且只在成片里看得出来。所以判据钉在这里：
 *
 * 1. 区间首尾相接、合起来正好等于总长（不多不少）；
 * 2. 每块至少 1 个单位、下限生效时短的会被抬起来；
 * 3. 同一个输入永远得到同一组区间。
 */
import { describe, expect, it } from 'vitest';
import { allocateByWidth, allocateSpans } from '../spans.ts';

/** 区间是否首尾相接且总长正好。 */
function isPartition(spans: { from: number; to: number }[], total: number): boolean {
  if (spans.length === 0) return total === 0;
  if (spans[0]?.from !== 0) return false;
  for (let i = 1; i < spans.length; i += 1) {
    if (spans[i]?.from !== spans[i - 1]?.to) return false;
  }
  return spans[spans.length - 1]?.to === total;
}

describe('allocateSpans', () => {
  it('按权重分配，且正好铺满总长', () => {
    const spans = allocateSpans([1, 1, 2], 400, 0);
    expect(isPartition(spans, 400)).toBe(true);
    expect(spans[2]!.to - spans[2]!.from).toBeGreaterThan(spans[0]!.to - spans[0]!.from);
  });

  it('每块至少 1 个单位', () => {
    const spans = allocateSpans([1000, 1, 1], 3, 0);
    for (const span of spans) expect(span.to - span.from).toBeGreaterThanOrEqual(1);
    expect(isPartition(spans, 3)).toBe(true);
  });

  it('下限生效时从最长的块里要时间，不改变总长', () => {
    // 极短、极短、很长；下限 30，总 120
    const spans = allocateSpans([1, 1, 50], 120, 30);
    expect(isPartition(spans, 120)).toBe(true);
    for (const span of spans) expect(span.to - span.from).toBeGreaterThanOrEqual(30);
  });

  it('下限大于「平均能给的」时不硬凑（宁可某块偏短）', () => {
    const spans = allocateSpans([1, 1, 1, 1], 4, 100);
    expect(isPartition(spans, 4)).toBe(true);
    for (const span of spans) expect(span.to - span.from).toBeGreaterThanOrEqual(1);
  });

  it('权重为 0 或负数按 1 算 —— 纯标点的块也要占时间', () => {
    const spans = allocateSpans([0, -5, 10], 100, 0);
    expect(isPartition(spans, 100)).toBe(true);
    expect(spans[0]!.to - spans[0]!.from).toBeGreaterThanOrEqual(1);
  });

  it('空输入返回空', () => {
    expect(allocateSpans([], 100, 10)).toEqual([]);
    expect(allocateByWidth([], 100, 10)).toEqual([]);
  });

  it('确定性：同一输入两次结果相同', () => {
    expect(allocateSpans([3, 1, 4, 1, 5], 999, 20)).toEqual(allocateSpans([3, 1, 4, 1, 5], 999, 20));
  });
});

describe('allocateByWidth', () => {
  it('中文按 1、拉丁按 0.5 算宽度，长的块分到更多时间', () => {
    const spans = allocateByWidth(['短句。', '这是一个明显更长的句子，用来占更多时间。'], 1000, 0);
    expect(isPartition(spans, 1000)).toBe(true);
    expect(spans[1]!.to - spans[1]!.from).toBeGreaterThan(spans[0]!.to - spans[0]!.from);
  });

  it('毫秒级精度下各块之和正好等于总毫秒', () => {
    const spans = allocateByWidth(['第一句在这里。', '第二句稍微长一点，带一个逗号。', '第三句收尾。'], 9123, 1000);
    const sum = spans.reduce((acc, span) => acc + (span.to - span.from), 0);
    expect(sum).toBe(9123);
  });
});
