/**
 * 配音产物（`durations.json`）的校验。
 *
 * 这一份是**配音与画面之间唯一的接口**，所以它错了会以最难查的方式表现出来：
 * 声音说到第三句、字幕还在第二句，或者最后一句话被切掉。机器能判的部分全在这里验：
 * 算术自洽（`duration = audioSec + pause`）、字幕块之和、与讲稿一致、音频与音轨存在。
 *
 * 夹具用分析器真跑出来（解读、素材都真），音频用手写的 RIFF/WAVE（不装 TTS 也能测）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { analyzeDirectory } from '../../analyzer/analyze.ts';
import { validateContracts, type ValidateReport } from '../validate.ts';

const SAMPLE = resolve(import.meta.dirname, '../../analyzer/tests/fixtures/sample');

let root = '';
let workRoot = '';

const SCRIPT = {
  foldercast: 1,
  source: { root: '' },
  title: '配音校验夹具',
  scenes: [
    { id: 'cover', type: 'cover', title: '封面', narration: '第一段旁白，短。' },
    { id: 'outro', type: 'outro', title: '结尾', narration: '第二段旁白，稍微长一点。' },
  ],
};

/** 写一段 1 秒的静音 wav（自带头部，不依赖 ffmpeg）。 */
function writeWav(path: string, seconds = 1): void {
  const sampleRate = 8000;
  const samples = Math.round(sampleRate * seconds);
  const data = Buffer.alloc(samples * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'latin1');
  header.write('fmt ', 12, 'latin1');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'latin1');
  header.writeUInt32LE(data.length, 40);
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, Buffer.concat([header, data]));
}

/** 一份形状正确的 durations.json（数值自洽）。 */
function goodDurations(): Record<string, unknown> {
  return {
    durations: 1,
    generatedAt: '2026-10-05T21:00:00+08:00',
    provider: 'fake',
    voice: '测试音色',
    track: 'audio/narration.wav',
    pause: 0.5,
    scenes: [
      {
        id: 'cover',
        audio: 'audio/cover.wav',
        audioSec: 1,
        duration: 1.5,
        subs: [['第一段旁白，短。', 1.5]],
      },
      {
        id: 'outro',
        audio: 'audio/outro.wav',
        audioSec: 1,
        duration: 1.5,
        subs: [
          ['第二段旁白，', 0.7],
          ['稍微长一点。', 0.8],
        ],
      },
    ],
  };
}

function writeDurations(document: unknown): string {
  const path = join(workRoot, 'durations.json');
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
  return path;
}

function validate(): ValidateReport {
  return validateContracts({ target: root, workRoot, assets: undefined });
}

/** 只留配音相关的问题，其余（素材缺失之类）与这条用例无关。 */
function durationsIssues(report: ValidateReport): { code: string; message: string }[] {
  return report.issues
    .filter((issue) => issue.code.startsWith('durations-'))
    .map((issue) => ({ code: issue.code, message: issue.message }));
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'foldercast-durations-'));
  workRoot = join(root, '.foldercast');
  // 拿分析器的夹具当被讲解的目录：**真跑一遍分析器**，解读与素材都是真的，
  // 这样「报出来的问题真的是配音产物的问题」才成立
  cpSync(SAMPLE, root, { recursive: true });
  // `analyzeDirectory` 只算不写，落盘是 CLI 的事 —— 这里自己写，与 CLI 同一套路径
  const analyzed = await analyzeDirectory({ root });
  mkdirSync(workRoot, { recursive: true });
  writeFileSync(join(workRoot, 'foldercast.json'), `${JSON.stringify(analyzed.document, null, 2)}\n`);
  // 讲稿的 `source.root` 必须与解读一致（不一致校验器会报 source-root-mismatch，那是另一条用例）
  const reading = analyzed.document as unknown as { source: { root: string } };
  writeFileSync(
    join(workRoot, 'script.json'),
    `${JSON.stringify({ ...SCRIPT, source: { root: reading.source.root } }, null, 2)}\n`,
  );
  mkdirSync(join(workRoot, 'audio'), { recursive: true });
});

afterAll(() => {
  if (root !== '') rmSync(root, { recursive: true, force: true });
});

describe('配音产物校验', () => {
  it('自洽的时长表通过，且报告里标明校验过', () => {
    writeWav(join(workRoot, 'audio/cover.wav'));
    writeWav(join(workRoot, 'audio/outro.wav'));
    writeWav(join(workRoot, 'audio/narration.wav'), 3);
    writeDurations(goodDurations());

    const report = validate();
    expect(report.durationsValidated).toBe(true);
    expect(durationsIssues(report)).toEqual([]);
  });

  it('算术不对就报出来：duration ≠ audioSec + pause', () => {
    const document = goodDurations();
    (document['scenes'] as { duration: number }[])[0]!.duration = 2.5;
    writeDurations(document);

    const issues = durationsIssues(validate());
    expect(issues.map((issue) => issue.code)).toContain('durations-duration-mismatch');
    expect(issues.find((issue) => issue.code === 'durations-duration-mismatch')?.message).toContain('应为');
  });

  it('字幕块之和与场景时长不符也报出来', () => {
    const document = goodDurations();
    (document['scenes'] as { subs: [string, number][] }[])[0]!.subs = [['第一段旁白，短。', 0.4]];
    writeDurations(document);
    expect(durationsIssues(validate()).map((issue) => issue.code)).toContain('durations-subs-mismatch');
  });

  it('音频文件不存在：报出来（不是「写了路径就算」）', () => {
    const document = goodDurations();
    (document['scenes'] as { audio: string }[])[1]!.audio = 'audio/nope.wav';
    writeDurations(document);
    const issues = durationsIssues(validate());
    expect(issues.map((issue) => issue.code)).toContain('durations-audio-missing');
    expect(issues.find((issue) => issue.code === 'durations-audio-missing')?.message).toContain('nope.wav');
  });

  it('字幕与讲稿不一致（改了讲稿没重跑配音）：警告，且指出块数', () => {
    const document = goodDurations();
    (document['scenes'] as { subs: [string, number][] }[])[0]!.subs = [['改过的旁白。', 1.5]];
    writeDurations(document);
    const issues = durationsIssues(validate());
    expect(issues.map((issue) => issue.code)).toContain('durations-subs-stale');
  });

  it('时长表里的场景在讲稿里不存在：报出来', () => {
    const document = goodDurations();
    (document['scenes'] as { id: string }[])[0]!.id = 'ghost';
    writeDurations(document);
    expect(durationsIssues(validate()).map((issue) => issue.code)).toContain('durations-scene-unknown');
  });

  it('讲稿里的场景没配音：警告（画面照出，只是没声音）', () => {
    const document = goodDurations();
    (document['scenes'] as unknown[]).pop();
    writeDurations(document);
    const issues = durationsIssues(validate());
    expect(issues.map((issue) => issue.code)).toContain('durations-scene-missing');
  });

  it('音轨不存在：警告，渲染会出静音片', () => {
    rmSync(join(workRoot, 'audio/narration.wav'), { force: true });
    const document = goodDurations();
    writeDurations(document);
    expect(durationsIssues(validate()).map((issue) => issue.code)).toContain('durations-track-missing');
  });

  it('超宽的字幕块：报出来（硬切会产生半个词，要改讲稿）', () => {
    writeWav(join(workRoot, 'audio/narration.wav'), 3);
    const document = goodDurations();
    (document['scenes'] as { subs: [string, number][] }[])[0]!.subs = [
      ['这一句话故意写得很长很长很长超过二十四个宽度单位。', 1.5],
    ];
    writeDurations(document);
    expect(durationsIssues(validate()).map((issue) => issue.code)).toContain('durations-subs-too-wide');
  });

  it('没有 durations.json 时跳过这一层（没跑过配音的机器上本来就没有）', () => {
    rmSync(join(workRoot, 'durations.json'), { force: true });
    const report = validate();
    expect(report.durationsValidated).toBe(false);
    expect(durationsIssues(report)).toEqual([]);
  });

  it('坏 JSON：报 blocker（不是静默忽略）', () => {
    writeFileSync(join(workRoot, 'durations.json'), '{ 这不是 JSON\n');
    const report = validate();
    expect(report.issues.some((issue) => issue.code === 'json-invalid' && issue.path.endsWith('durations.json'))).toBe(true);
  });
});
