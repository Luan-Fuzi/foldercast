/**
 * `durations.json` 的校验。
 *
 * 这一份产物是**配音与画面之间唯一的接口**，所以它错了会以最难查的方式表现出来：
 * 声音与字幕错位、最后一句话被切掉、某个场景的画面在说别人的台词。机器能判的部分
 * 全在这里查：
 *
 * 1. **场景对得上**（id 在讲稿里、不重复、不漏）；
 * 2. **音频文件真的存在**（不是「写了路径就算」）；
 * 3. **算术自洽**：`duration = audioSec + pause`、`subs` 各块之和 ≈ `duration`、
 *    音轨长度 ≈ 各场景之和；
 * 4. **场景时长与实测音频一致**：`audioSec` 与 ffprobe 的差值超过 50ms 就报出来 ——
 *    那是「改了音频没重跑配音」的典型症状。
 *
 * **不查**「音色好不好听」「断句对不对」—— 那是人耳的事。
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DurationsDocument } from '../contracts/durations.ts';
import type { ScriptDocument } from '../contracts/script.ts';
import { splitSubtitles } from '../contracts/subtitles.ts';
import { IssueCollector } from './issue.ts';

/** 允许的浮点误差（秒）。ffprobe 给三位小数，拼接与编码还有几毫秒的出入。 */
const TOLERANCE_SEC = 0.05;

export type CheckDurationsOptions = {
  document: DurationsDocument;
  path: string;
  workRoot: string;
  script?: ScriptDocument;
  /** 实测音频时长（绝对路径 → 秒）。不给就跳过「音频与记录是否一致」那一条。 */
  measure?: (path: string) => number | undefined;
};

/** 人读的秒数：三位小数足够，也避免报告里出现 `9.498999999999999`。 */
function sec(value: number): string {
  return `${Math.round(value * 1000) / 1000}s`;
}

export function checkDurations(options: CheckDurationsOptions): IssueCollector {
  const collect = new IssueCollector();
  const { document, path } = options;
  const pointer = (suffix: string): string => `/scenes${suffix}`;

  if (document.scenes.length === 0) {
    collect.add({
      path,
      pointer: '/scenes',
      severity: 'blocker',
      code: 'durations-empty',
      message: '时长表里没有场景。',
      fix: '重跑配音：pnpm voice <目录>',
    });
    return collect;
  }

  const ids = new Set<string>();
  let total = 0;

  document.scenes.forEach((scene, index) => {
    const where = pointer(`/${String(index)}`);
    if (ids.has(scene.id)) {
      collect.add({
        path,
        pointer: where,
        severity: 'blocker',
        code: 'durations-scene-duplicate',
        message: `场景 id 重复：${scene.id}`,
        fix: '重跑配音；id 重复说明生成时把两个场景写到了同一条上。',
        sceneId: scene.id,
      });
    }
    ids.add(scene.id);
    total += scene.duration;

    const audioPath = resolve(options.workRoot, scene.audio);
    if (!existsSync(audioPath)) {
      collect.add({
        path,
        pointer: `${where}/audio`,
        severity: 'blocker',
        code: 'durations-audio-missing',
        message: `音频文件不存在：${scene.audio}`,
        fix: '重跑配音；或删掉 durations.json 回到按字数预估（画面仍可出，只是没有配音）。',
        sceneId: scene.id,
        field: 'audio',
      });
    } else if (options.measure !== undefined) {
      const measured = options.measure(audioPath);
      if (measured !== undefined && Math.abs(measured - scene.audioSec) > TOLERANCE_SEC) {
        collect.add({
          path,
          pointer: `${where}/audioSec`,
          severity: 'warning',
          code: 'durations-audio-drift',
          message: `记录的实测时长与音频不符：记录 ${sec(scene.audioSec)}，实际 ${sec(measured)}（${scene.audio}）`,
          fix: '音频被替换过或没重跑配音。重跑：pnpm voice <目录>（已存在的音频会跳过，用 --force 强制重合成）。',
          sceneId: scene.id,
          field: 'audioSec',
        });
      }
    }

    const expected = scene.audioSec + document.pause;
    if (Math.abs(expected - scene.duration) > TOLERANCE_SEC) {
      collect.add({
        path,
        pointer: `${where}/duration`,
        severity: 'blocker',
        code: 'durations-duration-mismatch',
        message: `场景时长对不上：${sec(scene.duration)}，按 audioSec + pause 应为 ${sec(expected)}`,
        fix: '手改过 durations.json，或改了 pause 没重跑。重跑配音。',
        sceneId: scene.id,
        field: 'duration',
      });
    }

    const sum = scene.subs.reduce((acc, [, seconds]) => acc + seconds, 0);
    if (scene.subs.length > 0 && Math.abs(sum - scene.duration) > TOLERANCE_SEC) {
      collect.add({
        path,
        pointer: `${where}/subs`,
        severity: 'blocker',
        code: 'durations-subs-mismatch',
        message: `字幕块时长之和 ${sec(sum)} 与场景时长 ${sec(scene.duration)} 不符`,
        fix: '字幕会提前消失或拖到下一场。重跑配音。',
        sceneId: scene.id,
        field: 'subs',
      });
    }

    for (const [partIndex, [text]] of scene.subs.entries()) {
      const width = textWidthOf(text);
      if (width > 24) {
        collect.add({
          path,
          pointer: `${where}/subs/${String(partIndex)}`,
          severity: 'blocker',
          code: 'durations-subs-too-wide',
          message: `字幕块超过 24 宽度单位（${width}）：「${text.slice(0, 24)}…」`,
          fix: '改讲稿的 narration（加标点或拆句）后重跑配音；硬切会产生半个词。',
          sceneId: scene.id,
          field: 'subs',
        });
      }
    }

    if (options.script !== undefined) {
      const scene2 = options.script.scenes.find((item) => item.id === scene.id);
      if (scene2 === undefined) {
        collect.add({
          path,
          pointer: where,
          severity: 'blocker',
          code: 'durations-scene-unknown',
          message: `时长表里的场景 ${scene.id} 在讲稿里不存在`,
          fix: '讲稿改过之后要重跑配音；或删掉 durations.json 回到按字数预估。',
          sceneId: scene.id,
        });
      } else if (scene.subs.length > 0) {
        // 判据是**文本对不上**，不是「块数不一样」：改几个字往往块数不变，
        // 而音频与字幕都已经过期了（配音是按旧文本合成的）。
        const expectedParts = splitSubtitles(scene2.narration);
        const recorded = scene.subs.map(([text]) => text).join('');
        if (recorded !== expectedParts.join('')) {
          collect.add({
            path,
            pointer: `${where}/subs`,
            severity: 'warning',
            code: 'durations-subs-stale',
            message: `字幕与当前讲稿不一致（时长表 ${String(scene.subs.length)} 块，讲稿切出 ${String(expectedParts.length)} 块）`,
            fix: '讲稿改过之后要重跑配音：音频、时长与字幕会一起更新（旧音频会被 --force 覆盖）。',
            sceneId: scene.id,
            field: 'subs',
          });
        }
      }
    }
  });

  if (options.script !== undefined) {
    const missing = options.script.scenes.filter((scene) => !ids.has(scene.id)).map((scene) => scene.id);
    if (missing.length > 0) {
      collect.add({
        path,
        pointer: '/scenes',
        severity: 'warning',
        code: 'durations-scene-missing',
        message: `这些场景没有配音：${missing.join('、')}`,
        fix: '它们是按字数预估时长的（画面照出，只是没声音）。要补齐就重跑配音。',
      });
    }
  }

  if (document.track !== '') {
    const trackPath = resolve(options.workRoot, document.track);
    if (!existsSync(trackPath)) {
      collect.add({
        path,
        pointer: '/track',
        severity: 'warning',
        code: 'durations-track-missing',
        message: `音轨文件不存在：${document.track}`,
        fix: '渲染会出静音片。重跑配音即可重建音轨。',
        field: 'track',
      });
    } else if (options.measure !== undefined) {
      const measured = options.measure(trackPath);
      if (measured !== undefined && Math.abs(measured - total) > TOLERANCE_SEC) {
        collect.add({
          path,
          pointer: '/track',
          severity: 'warning',
          code: 'durations-track-mismatch',
          message: `音轨长度 ${sec(measured)} 与场景总长 ${sec(total)} 不符`,
          fix: '画面与配音会整体错位。重跑配音。',
          field: 'track',
        });
      }
    }
  }

  return collect;
}

/** 显示宽度（半角单位）——与 `contracts/subtitles.ts` 同一套折算。 */
function textWidthOf(text: string): number {
  let units = 0;
  for (const char of text) {
    units += /[\u2E80-\u9FFF\u3000-\u303F\uAC00-\uD7FF\uFF00-\uFF60\uFFE0-\uFFE6]/u.test(char) ? 2 : 1;
  }
  return units / 2;
}

/** 读时长表；不存在返回 undefined。 */
export function readDurations(path: string): DurationsDocument | undefined {
  try {
    const document = JSON.parse(readFileSync(path, 'utf8')) as DurationsDocument;
    return document;
  } catch {
    return undefined;
  }
}
