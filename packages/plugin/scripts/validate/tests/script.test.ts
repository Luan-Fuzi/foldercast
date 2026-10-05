/**
 * M3 的验收：对一份**故意写坏**的讲稿（fixtures/bad-script.json）必须**全部报出**，
 * 并指出具体位置。
 *
 * 期望值写死在这里，与夹具逐条对应：夹具里每条错误都能在下面对上一条断言。
 * 解读不是手写的 —— 用分析器对 analyzer 的夹具目录真跑一遍，这样两件事同时被验证：
 * 报出来的问题真的是讲稿的问题（而不是解读造出来的），以及分析器的产物能过校验。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { analyzeDirectory } from '../../analyzer/analyze.ts';
import { validateContracts, type CheckedFile, type ValidateReport } from '../validate.ts';

const FIXTURES = import.meta.dirname;
const SAMPLE = resolve(FIXTURES, '../../analyzer/tests/fixtures/sample');
const BAD_SCRIPT = join(FIXTURES, 'fixtures/bad-script.json');

/** 夹具里的 `source.root` 是占位路径；测试时换成分析器写进解读的那个。 */
const ROOT_PATTERN = /"root": "[^"]*"/;

/** 每个夹具错误对应的一条期望。`scene` 与 `field` 用于验证「指到具体位置」。 */
type Expectation = {
  code: string;
  pointer: string;
  scene?: string;
  field?: string;
  /** 消息里必须出现的关键词，确保说的是这件事而不是别的。 */
  about: string;
};

const EXPECTED: Expectation[] = [
  // ① schema：cover 缺必需字段 title（SPEC 场景类型清单里 cover 的必需字段）
  { code: 'scene-field-missing', pointer: '/scenes/0/title', scene: 'cover', field: 'title', about: 'title' },
  // ② 幻觉路径：src/main.ts 不在 manifest 里，并且要给出相近的候选
  { code: 'path-hallucinated', pointer: '/scenes/3/file', scene: 'entry', field: 'file', about: 'src/main.ts' },
  // ③ 高亮行区间超出文件行数（src/index.ts 只有 6 行）
  { code: 'focus-lines-out-of-range', pointer: '/scenes/2/focusLines', scene: 'entry', field: 'focusLines', about: '只有 6 行' },
  // ④ 场景 id 重复：配音产物按 id 命名，重复会互相覆盖
  { code: 'scene-id-duplicate', pointer: '/scenes/3/id', scene: 'entry', field: 'id', about: '重复' },
  // ⑤ 素材基准写错：清单登记的是相对工作根的路径，这里多了一层 assets/
  { code: 'asset-missing', pointer: '/scenes/3/asset', scene: 'entry', field: 'asset', about: 'thumbs/logo.png' },
  // ⑥ 素材不存在
  { code: 'asset-missing', pointer: '/scenes/4/items/0', scene: 'shots', field: 'items', about: 'does-not-exist.png' },
  // ⑦ 盘点数量与解读对不上（说 9 个，实际 5 个）
  { code: 'inventory-group-count-mismatch', pointer: '/scenes/5/groups/0/count', scene: 'counts', field: 'groups', about: 'code' },
  // ⑧ tree 强调了一个不存在的子路径
  { code: 'path-hallucinated', pointer: '/scenes/1/highlight/2', scene: 'overview', field: 'highlight', about: 'nowhere' },
  // ⑨ cover 场景出现了 groups
  { code: 'scene-field-unused', pointer: '/scenes/7/groups', scene: 'misc', field: 'groups', about: 'groups' },
  // ⑩ 字幕切不开：整句没有任何标点，切不出 ≤ 24 字的块
  { code: 'subtitle-too-long', pointer: '/scenes/8/narration', scene: 'long', field: 'narration', about: '最长一块' },
];

/** 这些问题没有「待确认」一说，必须是 blocker。 */
const MUST_BLOCK = new Set(EXPECTED.map((item) => item.code).filter((code) => code !== 'inventory-group-count-mismatch'));

let workRoot = '';
let report: ValidateReport;

function find(issues: readonly CheckedFile[], expectation: Expectation): CheckedFile[] {
  return issues.filter(
    (issue) =>
      issue.code === expectation.code &&
      issue.pointer === expectation.pointer &&
      issue.message.includes(expectation.about),
  );
}

beforeAll(() => {
  // 真跑一遍分析器：解读由程序产出，不是手写的
  const { document } = analyzeDirectory({ root: SAMPLE });

  workRoot = mkdtempSync(join(tmpdir(), 'foldercast-validate-'));
  mkdirSync(workRoot, { recursive: true });
  writeFileSync(join(workRoot, 'foldercast.json'), `${JSON.stringify(document, null, 2)}\n`);
  // 夹具里的 source.root 是占位路径，按实际解读里的那个改写（不依赖仓库绝对路径，CI 上也能过）
  writeFileSync(
    join(workRoot, 'script.json'),
    readFileSync(BAD_SCRIPT, 'utf8').replace(ROOT_PATTERN, `"root": ${JSON.stringify(document.source.root)}`),
  );

  report = validateContracts({ target: SAMPLE, readingPath: join(workRoot, 'foldercast.json'), workRoot, scriptPath: join(workRoot, 'script.json') });
});

afterAll(() => {
  if (workRoot !== '') rmSync(workRoot, { recursive: true, force: true });
});

describe('解读本身能过校验（分析器的产物是干净的）', () => {
  it('解读没有 blocker', () => {
    const readingIssues = report.issues.filter((issue) => issue.path.endsWith('foldercast.json'));
    expect(readingIssues).toEqual([]);
  });
});

describe('故意写坏的讲稿：每条都要报出，并指到位置', () => {
  it('十类错误全部报出', () => {
    const missing = EXPECTED.filter((expectation) => find(report.issues, expectation).length === 0);
    expect(missing.map((item) => `${item.code} @ ${item.pointer}`)).toEqual([]);
  });

  it('每条都带上场景 id 与字段名，并指到行号', () => {
    for (const expectation of EXPECTED) {
      const matches = find(report.issues, expectation);
      const withScene = matches.filter((issue) => issue.sceneId === expectation.scene);
      expect(withScene.length, `${expectation.code} @ ${expectation.pointer} 应当指到场景`).toBeGreaterThan(0);
      for (const issue of withScene) {
        expect(issue.field, `${expectation.code} 应当带字段名`).toBe(expectation.field);
        expect(issue.line, `${expectation.code} 应当指到行号`).toBeGreaterThan(0);
      }
    }
  });

  it('该拦的都是 blocker，只有盘点数量是待确认', () => {
    for (const expectation of EXPECTED) {
      const severity = MUST_BLOCK.has(expectation.code) ? 'blocker' : 'warning';
      for (const issue of find(report.issues, expectation)) {
        expect(issue.severity, `${expectation.code} @ ${expectation.pointer}`).toBe(severity);
      }
    }
  });

  it('报告判定为不通过', () => {
    expect(report.ok).toBe(false);
    expect(report.counts.blocker).toBeGreaterThanOrEqual(MUST_BLOCK.size);
  });

  it('每个问题都给得出「怎么改」', () => {
    const withoutFix = report.issues.filter((issue) => issue.fix === undefined || issue.fix === '');
    expect(withoutFix.map((issue) => `${issue.code} @ ${issue.pointer}`)).toEqual([]);
  });

  it('行号指向的是那个字段所在行，不是文件开头', () => {
    const hallucinated = find(report.issues, EXPECTED[1] as Expectation)[0];
    expect(hallucinated?.line).toBeGreaterThan(10);
  });
});

describe('只报真问题：不误伤写得对的地方', () => {
  it('存在的路径与一致的统计不被报出来', () => {
    // src/index.ts 与 assets/logo.png 都存在，docs 是真实目录：都不该被报
    const falsePositives = report.issues.filter(
      (issue) =>
        issue.pointer === '/scenes/1/highlight/0' ||
        issue.pointer === '/scenes/1/highlight/1' ||
        issue.pointer === '/scenes/2/file',
    );
    expect(falsePositives).toEqual([]);
  });

  it('inventory 里与解读一致的 count 不报，不一致的才报', () => {
    const reported = report.issues.filter((issue) => issue.pointer.startsWith('/scenes/5/groups'));
    expect(reported.map((issue) => issue.pointer)).toEqual(['/scenes/5/groups/0/count']);
  });

  it('讲稿与解读的 source.root 不一致时报错（夹具的占位 root 必须被改写）', () => {
    // 用夹具原样的占位 root（/tmp/target）跑一遍：解读的 root 是真实路径，两者必须对不上
    writeFileSync(join(workRoot, 'script.json'), readFileSync(BAD_SCRIPT, 'utf8'));
    const mismatched = validateContracts({
      target: SAMPLE,
      readingPath: join(workRoot, 'foldercast.json'),
      workRoot,
      scriptPath: join(workRoot, 'script.json'),
    });

    const issues = mismatched.issues.filter((issue) => issue.code === 'source-root-mismatch');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.pointer).toBe('/source/root');
    expect(issues[0]?.line).toBeGreaterThan(0);
  });

  it('没引用不存在的路径时不报幻觉路径', () => {
    const hallucinated = report.issues.filter((issue) => issue.code === 'path-hallucinated');
    expect(hallucinated.map((issue) => issue.pointer)).toEqual(['/scenes/1/highlight/2', '/scenes/3/file']);
  });
});
