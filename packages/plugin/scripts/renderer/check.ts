/**
 * 讲稿的契约校验 —— 原来的独立 validate 阶段收缩成了渲染入口的一个模块。
 *
 * 只查**机器能判的**：形状（schema）、字段（按场景类型的必需/允许表）、路径存在、
 * 场景 id 唯一、字幕切得开、盘点数字自洽。「有没有讲错重点」不是它能管的，那是评审
 * subagent 的事。
 *
 * blocker 必须修（编了路径、字段用错、字幕切不开）；warning 是「可能是笔误，自己确认」。
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BEAT_ENTERS,
  BEAT_GRAPHICS,
  SCENE_ALLOWED_FIELDS,
  SCENE_REQUIRED_FIELDS,
  SCRIPT_VERSION,
  isSceneType,
  type ScriptDocument,
  type Scene,
} from '../contracts/script.ts';
import { checkDigest, type DigestDocument } from '../contracts/digest.ts';
import { prepKindOf } from '../contracts/prep.ts';
import { splitSubtitles, textWidth, validateSubtitles } from '../contracts/subtitles.ts';
import { estimateSceneSec } from './estimate.ts';

export type Issue = {
  code: string;
  severity: 'blocker' | 'warning';
  message: string;
  /** 讲稿里的 JSON 指针（`/scenes/0/title`）。 */
  path?: string;
  sceneId?: string;
  fix?: string;
};

export type CheckReport = {
  blocker: number;
  warning: number;
  issues: Issue[];
};

/**
 * 找 `script.schema.json`：包内 `schemas/`（发布版）优先，仓库 `docs/specs/` 兜底。
 * 上溯找而不是数层级 —— 源码与编译产物深度不同（旧版实测踩过）。
 */
export function findSchemaDir(start: string): string | undefined {
  let current = resolve(start);
  const { root } = parse(current);
  for (;;) {
    if (existsSync(join(current, 'schemas', 'script.schema.json'))) return join(current, 'schemas');
    if (existsSync(join(current, 'docs', 'specs', 'script.schema.json'))) return join(current, 'docs', 'specs');
    if (current === root) return undefined;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

type SchemaLike = { $defs?: Record<string, unknown> } & Record<string, unknown>;

async function loadSchema(): Promise<SchemaLike | undefined> {
  const dir = findSchemaDir(MODULE_DIR);
  if (dir === undefined) return undefined;
  try {
    const { readFileSync } = await import('node:fs');
    return JSON.parse(readFileSync(join(dir, 'script.schema.json'), 'utf8')) as SchemaLike;
  } catch {
    return undefined;
  }
}

/**
 * 校验讲稿。`root` 是被讲解目录（路径存在性按它查）。
 *
 * schema 读不到时跳过那一层（字段表与语义检查仍然全跑）—— 校验不该因为一个数据文件
 * 的摆放问题整体失效。
 */
export async function checkScript(script: ScriptDocument, root: string): Promise<CheckReport> {
  const issues: Issue[] = [];
  const push = (issue: Issue): void => {
    issues.push(issue);
  };

  const schema = await loadSchema();
  if (schema !== undefined) {
    // schema 是 draft 2020-12，要用 Ajv2020（经典 Ajv 不认这份元 schema）。
    // ESM/CJS 互操作在两套 tsconfig 下表现不同，这里只声明用到的最小形状。
    type AjvLike = {
      compile: (schema: unknown) => ((data: unknown) => boolean) & { errors?: Array<{ instancePath?: string; message?: string }> };
    };
    const module = (await import('ajv/dist/2020.js')) as unknown as { default: new (options?: Record<string, unknown>) => AjvLike };
    const ajv = new module.default({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);
    if (!validate(script)) {
      for (const error of validate.errors ?? []) {
        const where = error.instancePath === '' ? '' : error.instancePath;
        push({
          code: 'schema-invalid',
          severity: 'blocker',
          message: `${where === '' ? '讲稿' : where}：${error.message ?? '不符合 schema'}`,
          path: where,
        });
      }
    }
  }

  // 契约版本：v2 起 beats 进画面层（0004）。v1 是旧版讲稿，字段大体重叠但没有节拍。
  if ((script as { foldercast?: number }).foldercast !== SCRIPT_VERSION) {
    push({
      code: 'script-version',
      severity: 'blocker',
      message: `讲稿版本是 ${String((script as { foldercast?: number }).foldercast)}，当前契约要 ${String(SCRIPT_VERSION)}（v2：场景支持 beats 节拍）`,
      path: '/foldercast',
      fix: '把 "foldercast" 改成 2；v1 字段大部分照用，按 skill 的密度判据补 points/beats。',
    });
  }

  const seen = new Map<string, number>();
  for (const [index, scene] of script.scenes.entries()) {
    const at = (field: string): string => `/scenes/${String(index)}/${field}`;

    if (!isSceneType(scene.type)) {
      push({
        code: 'scene-type-unknown',
        severity: 'blocker',
        message: `场景类型 ${String(scene.type)} 不认识。可用：${Object.keys(SCENE_ALLOWED_FIELDS).join(' / ')}`,
        sceneId: scene.id,
        path: at('type'),
      });
      continue;
    }

    // 同 id 的第二次出现才报（第一次是对的）
    const first = seen.get(scene.id);
    if (first !== undefined) {
      push({
        code: 'scene-id-duplicate',
        severity: 'blocker',
        message: `场景 id 重复：${scene.id}（第一次在 /scenes/${String(first)}）`,
        sceneId: scene.id,
        path: at('id'),
        fix: '场景 id 用于配音产物命名与对齐，必须唯一。',
      });
    } else {
      seen.set(scene.id, index);
    }

    for (const field of SCENE_REQUIRED_FIELDS[scene.type]) {
      if (scene[field as keyof Scene] === undefined) {
        push({
          code: 'scene-field-missing',
          severity: 'blocker',
          message: `${scene.type} 场景缺必需字段 ${field}`,
          sceneId: scene.id,
          path: at(field),
        });
      }
    }
    for (const field of Object.keys(scene)) {
      if (!SCENE_ALLOWED_FIELDS[scene.type].includes(field)) {
        push({
          code: 'scene-field-unused',
          severity: 'blocker',
          message: `${scene.type} 场景里出现 ${field}（这个类型没有这个字段，多半是笔误）`,
          sceneId: scene.id,
          path: at(field),
        });
      }
    }

    pushPathChecks(scene, root, push);
    pushExcerptChecks(scene, root, push);
    pushSubtitleCheck(scene, push);
    pushBeatChecks(scene, push, at);
  }

  // 版式多样性提醒（0005 WP3）：file 连播是自举片翻过车的坑。只提醒不强制——
  // 哪种形态讲哪段是创作判断，校验器只把「全片一种版式」这件事报给写稿人。
  const contentScenes = script.scenes.filter((scene) => scene.type !== 'cover' && scene.type !== 'outro');
  const fileScenes = contentScenes.filter((scene) => scene.type === 'file').length;
  if (contentScenes.length >= 6 && fileScenes / contentScenes.length > 0.6) {
    push({
      code: 'layout-monotony',
      severity: 'warning',
      message: `${String(fileScenes)}/${String(contentScenes.length)} 个内容场景都是 file 版式，画面形态单一`,
      path: '/scenes',
      fix: '论断用 concept、对比用 compare、流程用 flow；file 留给值得逐行看的文件。',
    });
  }

  // digest 是两阶段创作的第一站（0004）：在场就顺带校验（引用路径 + 计数抽查），
  // 缺席不报错 —— 讲稿对渲染自足，管线不强制 digest。
  const digestPath = join(root, '.foldercast', 'digest.json');
  if (existsSync(digestPath)) {
    try {
      const digest = JSON.parse(readFileSync(digestPath, 'utf8')) as DigestDocument;
      for (const issue of checkDigest(digest, root)) {
        push({
          code: issue.code,
          severity: issue.severity === 'blocker' ? 'blocker' : 'warning',
          message: issue.message,
          path: issue.path === undefined ? '/digest' : `/digest${issue.path}`,
        });
      }
    } catch (error) {
      push({
        code: 'digest-unreadable',
        severity: 'warning',
        message: `digest.json 不是合法 JSON（${(error as Error).message}），跳过它的检查`,
        path: '/digest',
      });
    }
  }

  // 时长闭环：写了 `video.targetDurationSec` 就比一比「旁白量撑不撑得起」。
  // 有配音时成片时长由实测音频决定（target 是软约束），所以真正的时长旋钮是旁白量——
  // 预估与目标差太远，说明场景规划与时长规划脱节，写稿人该知道。
  const target = script.video?.targetDurationSec;
  if (target !== undefined && target !== null && target > 0) {
    const estimated = script.scenes.reduce((total, scene) => total + estimateSceneSec(scene.narration), 0);
    const deviation = Math.abs(estimated - target) / target;
    if (deviation > 0.35) {
      push({
        code: 'duration-mismatch',
        severity: 'warning',
        message: `旁白量与目标时长不匹配：预估约 ${Math.round(estimated)} 秒，目标 ${String(target)} 秒（差 ${Math.round(deviation * 100)}%）`,
        path: '/video/targetDurationSec',
        fix: '增删场景或旁白向目标靠拢，或按讲清的需要改目标——两者都可以，别脱节。',
      });
    }
  }

  return {
    blocker: issues.filter((issue) => issue.severity === 'blocker').length,
    warning: issues.filter((issue) => issue.severity === 'warning').length,
    issues,
  };
}

/** 画面阅读量（显示宽度）：标题、说明、摘录、类型化字段（路径/标签/计数）与要点。 */
function visualWidth(scene: Scene): number {
  let width = textWidth(scene.title ?? '');
  if (scene.subtitle !== undefined) width += textWidth(scene.subtitle);
  if (scene.note !== undefined) width += textWidth(scene.note);
  // 摘录（0005 起是 8–12 行整块）：画面上以小字号、带高亮呈现，观众**扫读锚定**而不是
  // 逐行精读——阅读负载远低于同宽度的散文。按 1/4 计宽且封顶 100（约三条要点的量），
  // 否则「标准画面」永远爆密度上界、两行旧摘录反而落在带内，信号就反了。
  const excerptRaw = scene.excerpt?.reduce((sum, line) => sum + textWidth(line), 0) ?? 0;
  width += Math.min(Math.round(excerptRaw * 0.25), 100);
  width += scene.lines?.reduce((sum, line) => sum + textWidth(line), 0) ?? 0;
  width += scene.entries?.reduce((sum, entry) => sum + textWidth(entry.path) + String(entry.files).length, 0) ?? 0;
  width += scene.groups?.reduce((sum, group) => sum + textWidth(group.label) + String(group.count).length, 0) ?? 0;
  width += scene.beats?.reduce((sum, beat) => sum + (beat.points?.reduce((inner, point) => inner + textWidth(point), 0) ?? 0), 0) ?? 0;
  // 0005 WP3 的三个文本原生场景：论断、对比两栏、流程步骤
  width += textWidth(scene.statement ?? '');
  width += scene.points?.reduce((sum, point) => sum + textWidth(point), 0) ?? 0;
  for (const side of [scene.left, scene.right]) {
    width += textWidth(side?.label ?? '');
    width += side?.lines.reduce((sum, line) => sum + textWidth(line), 0) ?? 0;
  }
  width += scene.steps?.reduce((sum, step) => sum + textWidth(step.label) + textWidth(step.note ?? ''), 0) ?? 0;
  return width;
}

/**
 * 节拍检查（v2，0004）：形状合法、与旁白句大致一拍一句、画面密度落在 1.5×–3×。
 * 密度只查内容场景——cover / outro 是标题场景，天然留白。
 */
function pushBeatChecks(scene: Scene, push: (issue: Issue) => void, at: (field: string) => string): void {
  const beats = scene.beats ?? [];

  for (const [index, beat] of beats.entries()) {
    const beatAt = (field: string): string => `${at('beats')}/${String(index)}/${field}`;
    const hasPoints = beat.points !== undefined && beat.points.some((point) => point.trim() !== '');
    if (!hasPoints && beat.graphic === undefined) {
      push({
        code: 'beat-empty',
        severity: 'blocker',
        message: '节拍既没有 points 也没有 graphic，画不出东西',
        sceneId: scene.id,
        path: at('beats'),
      });
      continue;
    }
    if (beat.points?.some((point) => point.trim() === '') === true) {
      push({
        code: 'beat-point-empty',
        severity: 'blocker',
        message: '节拍里有空要点（写了 points 数组就要条条有内容）',
        sceneId: scene.id,
        path: beatAt('points'),
      });
    }
    if (beat.enter !== undefined && !BEAT_ENTERS.includes(beat.enter)) {
      push({
        code: 'beat-enter-unknown',
        severity: 'blocker',
        message: `入场意图 ${String(beat.enter)} 不认识。可用：${BEAT_ENTERS.join(' / ')}`,
        sceneId: scene.id,
        path: beatAt('enter'),
      });
    }
    if (beat.graphic !== undefined) {
      if (!BEAT_GRAPHICS.includes(beat.graphic)) {
        push({
          code: 'beat-graphic-unknown',
          severity: 'blocker',
          message: `图形 ${String(beat.graphic)} 不认识。可用：${BEAT_GRAPHICS.join(' / ')}`,
          sceneId: scene.id,
          path: beatAt('graphic'),
        });
      } else if (beat.graphic === 'proportion' && scene.type !== 'inventory') {
        push({
          code: 'beat-graphic-unfit',
          severity: 'warning',
          message: 'proportion 图形吃 inventory 的 groups 数据；这个场景类型没有可占比的数据',
          sceneId: scene.id,
          path: beatAt('graphic'),
        });
      }
    }
  }

  if (beats.length > 0) {
    const parts = splitSubtitles(scene.narration);
    if (parts.length > 0 && beats.length > parts.length * 2) {
      push({
        code: 'beats-unaligned',
        severity: 'warning',
        message: `${String(beats.length)} 个节拍对 ${String(parts.length)} 条字幕 —— 节拍应与旁白句大致一拍一句`,
        sceneId: scene.id,
        path: at('beats'),
        fix: '合并节拍，或给旁白加句（每句旁白对应一个画面动作）。',
      });
    }
  }

  if (scene.type !== 'cover' && scene.type !== 'outro') {
    const visual = visualWidth(scene);
    const spoken = textWidth(scene.narration);
    if (spoken > 0) {
      const ratio = visual / spoken;
      if (ratio < 1.5 || ratio > 3) {
        push({
          code: 'density-out-of-band',
          severity: 'warning',
          message: `画面信息量 / 旁白量 = ${ratio.toFixed(2)}（画面 ${String(Math.round(visual))} 宽，旁白 ${String(Math.round(spoken))} 宽），合理区间 1.5–3`,
          sceneId: scene.id,
          path: at('title'),
          fix: ratio < 1.5 ? '画面太空：加 points 要点、摘长一点的 excerpt' : '画面过载：删要点，或让旁白多承担一些',
        });
      }
    }
  }
}

function pushPathChecks(scene: Scene, root: string, push: (issue: Issue) => void): void {  const exists = (relative: string | undefined): boolean => {
    if (relative === undefined) return false;
    const stats = statSync(resolve(root, relative), { throwIfNoEntry: false });
    return stats !== undefined && stats.isFile();
  };
  const missing = (relative: string, where: string): void => {
    push({
      code: 'path-missing',
      severity: 'blocker',
      message: `${where} 引用的文件不存在：${relative}`,
      sceneId: scene.id,
      fix: '讲稿只能引用源目录里真实存在的文件；要讲它就先确认它在（或改路径）。',
    });
  };

  if (scene.file !== undefined && !exists(scene.file)) missing(scene.file, 'file');
  if (scene.source !== undefined && !exists(scene.source)) missing(scene.source, scene.type);
  for (const item of scene.items ?? []) {
    if (!exists(item)) missing(item, 'gallery');
  }

  if (scene.type === 'gallery') {
    for (const item of scene.items ?? []) {
      const kind = prepKindOf(item);
      if (kind !== undefined && kind !== 'image' && kind !== 'video') {
        push({
          code: 'gallery-item-kind',
          severity: 'warning',
          message: `gallery 里的 ${item} 不是图片（${kind}）—— 画面会用它的主产物，观感可能不如图片`,
          sceneId: scene.id,
        });
      }
    }
  }

  if (scene.type === 'inventory' && scene.groups !== undefined && scene.total !== undefined) {
    const sum = scene.groups.reduce((total, group) => total + group.count, 0);
    if (sum > scene.total) {
      push({
        code: 'inventory-total-mismatch',
        severity: 'warning',
        message: `各组 count 之和 ${String(sum)} 大于 total ${String(scene.total)} —— 盘点数字自相矛盾`,
        sceneId: scene.id,
        fix: 'total 应当是各组之和，或大于它（有没列出的「其余」）。',
      });
    }
  }
}

function pushSubtitleCheck(scene: Scene, push: (issue: Issue) => void): void {
  const oversized = validateSubtitles(scene.narration);
  for (const piece of oversized) {
    push({
      code: 'subtitle-too-long',
      severity: 'blocker',
      message: `这段没有可切点，切不出 ≤24 显示宽度的字幕块（最长一块 ${String(piece.width)} 宽）：${piece.text}`,
      sceneId: scene.id,
      fix: '加标点或拆句 —— 字幕先按句末标点切、超长在逗号处再切，一句没有任何标点就切不开。',
    });
  }
}

/**
 * 摘录层检查（0005 WP1）：只管「画面 = 摘录文字」的 file 场景（没有素材转换的那些）。
 * 有素材的画面不是摘录，行数下限与真实性都不适用。三条都是 warning：
 * 行数太少是观感问题（写稿判断），摘录对不上原文可能是换行拼接（也可能真是编造），
 * 都不该像编造路径那样拦死整条管线。
 */
const EXCERPT_MIN_LINES = 6;
/** 超过这个大小的源文件不读来做真实性比对（摘录校验不值得为几十 MB 的文件买单）。 */
const EXCERPT_VERIFY_MAX_BYTES = 2_000_000;

function pushExcerptChecks(scene: Scene, root: string, push: (issue: Issue) => void): void {
  if (scene.type !== 'file' || scene.file === undefined) return;
  if (prepKindOf(scene.file) !== undefined) return; // 图片 / 视频 / Office / PDF 走素材画面

  const nonEmpty = (scene.excerpt ?? []).filter((line) => line.trim() !== '');
  if (nonEmpty.length === 0) {
    push({
      code: 'excerpt-too-short',
      severity: 'warning',
      message: 'file 场景没有素材也没有摘录，画面会是空的',
      sceneId: scene.id,
      fix: '从源文件摘原文进讲稿（digest 的 excerpts 里选），或改讲有素材的文件。',
    });
    return;
  }

  let content: string | undefined;
  try {
    const size = statSync(resolve(root, scene.file), { throwIfNoEntry: false })?.size ?? 0;
    if (size > EXCERPT_VERIFY_MAX_BYTES) return;
    content = readFileSync(resolve(root, scene.file), 'utf8');
  } catch {
    return; // 路径存在性由 path 检查兜底；读不了的不做内容比对
  }
  if (content === undefined) return;
  const haystack = content.replace(/\r\n/g, '\n');

  // 真实性：摘录行必须是源文件原文（两端空白可容忍 —— 续行缩进是正常的）
  const missing = nonEmpty.find((line) => !haystack.includes(line.trim()));
  if (missing !== undefined) {
    push({
      code: 'excerpt-unverifiable',
      severity: 'warning',
      message: `摘录行在源文件里找不到：「${missing.trim().slice(0, 40)}」`,
      sceneId: scene.id,
      fix: '摘录必须是原文（回源文件复制）；要转述就写进 note 或旁白，别冒充摘录。',
    });
  }

  if (scene.excerptStart !== undefined) {
    const at = haystack.split('\n')[scene.excerptStart - 1];
    if (at === undefined || at.trim() !== (nonEmpty[0] ?? '').trim()) {
      push({
        code: 'excerpt-start-mismatch',
        severity: 'warning',
        message: `excerptStart ${String(scene.excerptStart)} 对不上：源文件那一行不是摘录的第一行`,
        sceneId: scene.id,
        fix: 'excerptStart 是摘录首行在源文件中的 1 基行号，数一下再写。',
      });
    }
  }

  // 行数下限：短文件全文摘录是合法的，下限取 min(6, 文件非空行数)
  const totalLines = haystack.split('\n').filter((line) => line.trim() !== '').length;
  const floor = Math.min(EXCERPT_MIN_LINES, totalLines);
  if (nonEmpty.length < floor) {
    push({
      code: 'excerpt-too-short',
      severity: 'warning',
      message: `摘录只有 ${String(nonEmpty.length)} 行，画面会大面积留白（这个文件建议 ≥${String(floor)} 行）`,
      sceneId: scene.id,
      fix: '回 digest 摘整块原文（8–12 行、带行号）；文件本身就短且已全文摘录时忽略这条。',
    });
  }
}
