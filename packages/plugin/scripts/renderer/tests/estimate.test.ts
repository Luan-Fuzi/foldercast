/**
 * 时长预估与字幕时序。
 *
 * 这一层是**画面的时间轴**：帧号一旦算错，配音（M8）回来对不上，字幕会跟画面错位。
 * 所以这里钉住三件事：
 *
 * 1. **确定性**：同一个讲稿算出的帧号永远一样（没有时钟、没有随机）。
 * 2. **字幕块与讲稿同源**：块来自 `contracts/subtitles.ts`，窗口首尾相接、覆盖整段。
 * 3. **尺度**：中文按约 4.3 字/秒 —— 改语速常数会让「180 秒的片子」变成 400 秒，
 *    这一条用真实讲稿的量级守住。
 */
import { describe, expect, it } from 'vitest';
import {
  captionWindows,
  estimateNarrationSec,
  estimateSceneSec,
  scaleToTarget,
  secToFrames,
  summarizeDurations,
  MAX_SCENE_SEC,
  MIN_SCENE_SEC,
} from '../estimate.ts';
import { splitSubtitles } from '../../contracts/subtitles.ts';

describe('语速与场景时长', () => {
  it('中文按约 4.3 字/秒：100 个字约 23 秒', () => {
    const text = '这是一个用来测语速的句子，'.repeat(10);
    const seconds = estimateNarrationSec(text);
    const chars = [...text].length;
    expect(seconds).toBeGreaterThan(chars / 4.3 - 12);
    expect(seconds).toBeLessThan(chars / 4.3 + 2);
  });

  it('标点算停顿，不计入朗读字数', () => {
    const plain = estimateNarrationSec('这是一句话');
    const withPause = estimateNarrationSec('这是一句话。');
    expect(withPause).toBeGreaterThan(plain);
  });

  it('场景时长 = 朗读 + 留白，且夹在上下限之间', () => {
    expect(estimateSceneSec('好')).toBe(MIN_SCENE_SEC);
    expect(estimateSceneSec('这是一段正常的旁白，大概二十来个字。')).toBeGreaterThan(MIN_SCENE_SEC);
    expect(estimateSceneSec('长'.repeat(2000))).toBe(MAX_SCENE_SEC);
  });

  it('空旁白不炸，取场景下限', () => {
    expect(estimateSceneSec('')).toBe(MIN_SCENE_SEC);
    expect(estimateSceneSec('   ')).toBe(MIN_SCENE_SEC);
    expect(estimateSceneSec('。。。')).toBe(MIN_SCENE_SEC);
  });

  it('秒换帧至少 1 帧', () => {
    expect(secToFrames(0, 30)).toBe(1);
    expect(secToFrames(10, 30)).toBe(300);
    expect(secToFrames(10, 24)).toBe(240);
  });
});

describe('字幕窗口', () => {
  const narration = '第一句话在这里。第二句话稍微长一点，带一个逗号。第三句收尾。';

  it('块与讲稿切分完全一致', () => {
    const windows = captionWindows(narration, 300, 30);
    expect(windows.map((window) => window.text)).toEqual(splitSubtitles(narration));
  });

  it('窗口首尾相接、正好覆盖整段', () => {
    const frames = 271;
    const windows = captionWindows(narration, frames, 30);
    expect(windows[0]?.from).toBe(0);
    expect(windows[windows.length - 1]?.to).toBe(frames);
    for (let i = 1; i < windows.length; i += 1) {
      expect(windows[i]?.from).toBe(windows[i - 1]?.to);
    }
  });

  it('同一段话算两次得到同样的窗口', () => {
    expect(captionWindows(narration, 300, 30)).toEqual(captionWindows(narration, 300, 30));
  });

  it('块多时短的抬到下限，长的让出时间 —— 总长不变', () => {
    // 三块：极短、极短、很长。下限 30 帧，总 120 帧。
    const text = '好。嗯。这是一个很长很长很长很长很长很长的句子用来当那个让出时间的块。';
    const windows = captionWindows(text, 120, 30);
    const total = windows.reduce((sum, window) => sum + (window.to - window.from), 0);
    expect(total).toBe(120);
    for (const window of windows.slice(0, -1)) {
      expect(window.to - window.from).toBeGreaterThanOrEqual(30);
    }
  });

  it('分不够时不硬凑：块数多于帧数也不产生空窗口', () => {
    const text = '一。二。三。四。五。';
    const windows = captionWindows(text, 3, 30);
    for (const window of windows) {
      expect(window.to).toBeGreaterThan(window.from);
      expect(window.to - window.from).toBeGreaterThanOrEqual(1);
    }
  });

  it('没有旁白就没有窗口', () => {
    expect(captionWindows('', 300, 30)).toEqual([]);
  });
});

describe('目标时长是软约束', () => {
  it('缩放后总帧数精确等于目标', () => {
    const scaled = scaleToTarget([100, 200, 300], 1000);
    expect(scaled.reduce((sum, value) => sum + value, 0)).toBe(1000);
  });

  it('每场至少 1 帧', () => {
    const scaled = scaleToTarget([1000, 1], 3);
    expect(scaled.every((value) => value >= 1)).toBe(true);
  });

  it('目标小到每场不够 1 帧时，宁可比目标长也不删场景', () => {
    // 2 个场景、目标 3 帧：按比例是 [3, 0]，抬到下限后是 [3, 1]。这时总帧数（4）大于目标，
    // 因为「每个场景至少露一帧」比「严格等于目标」重要 —— 时长是软约束。
    const scaled = scaleToTarget([1000, 1], 3);
    expect(scaled).toEqual([3, 1]);
    expect(scaled.reduce((sum, value) => sum + value, 0)).toBe(4);
  });

  it('目标非法时原样返回', () => {
    expect(scaleToTarget([10, 20], 0)).toEqual([10, 20]);
    expect(scaleToTarget([], 100)).toEqual([]);
  });
});

describe('整片预估汇总', () => {
  const scenes = [
    { id: 'cover', type: 'cover', narration: '这是封面，交代一下这个目录是什么。' },
    { id: 'tree', type: 'tree', narration: '这是结构，分三块，第一块最大。' },
    { id: 'file', type: 'file', narration: '这个文件是入口，被引用了十二次。' },
  ];

  it('逐场景给出秒数与帧数，合计等于各项之和', () => {
    const summary = summarizeDurations(scenes, 30);
    expect(summary.scenes).toHaveLength(3);
    const frames = summary.scenes.reduce((sum, scene) => sum + scene.frames, 0);
    expect(summary.totalFrames).toBe(frames);
  });

  it('两次调用结果相同（确定性）', () => {
    expect(summarizeDurations(scenes, 30)).toEqual(summarizeDurations(scenes, 30));
  });
});
