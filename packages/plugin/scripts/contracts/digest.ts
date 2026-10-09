/**
 * `digest.json`（知识压缩产物）的类型与校验 —— 0004 两阶段创作的第一站。
 *
 * **它是给模型的富集事实库**，不是渲染输入：渲染器不读它（讲稿对渲染自足）。
 * 写稿的模型从它里面「选」，评审的模型对着它核对讲稿。
 *
 * 校验只做机器能判的：
 * - 契约版本（v2 起 excerpts 是块级摘录，0005 WP2）；
 * - 引用的文件（`excerpts[].file`、`modules[].path`、`keyFiles`）真实存在；
 * - **摘录真实性**：块级摘录的行要能在源文件里找到、`start` 要对得上（warning —— 与
 *   讲稿摘录同一哲学：必须是原文，但不为疑似拼接拦死管线）；
 * - **计数抽查**：`scale.totalFiles` 这类程序能确定性重数的字段真数一遍 ——
 *   「数字亲手数过」从荣誉制变成机器可查（数不上来的跳过，不猜）。
 * 数字对不上是 warning 不是 blocker：抽查口径（比如要不要算锁文件）可能合理地不同，
 * 报出来让写稿人确认。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** digest 契约版本。v2：excerpts 升级为块级摘录（0005 WP2）——密度从富集里选，先得有整块。 */
export const DIGEST_VERSION = 2 as const;

/** 模块：digest 里的一块（通常对应一个目录）。 */
export type DigestModule = {
  /** 相对源目录的路径，必须存在。 */
  path: string;
  /** 这块是干什么的（一句话，模型写）。 */
  role: string;
  /** 这块下的文件数（写稿时清点；口径是「该路径下的文件」，程序不重数嵌套口径复杂的）。 */
  files: number;
  /** 这块里值得展开讲的关键文件（相对源目录，必须存在）。 */
  keyFiles?: string[];
};

export type DigestExcerpt = {
  /** 相对源目录，必须存在。 */
  file: string;
  /** 摘录的原文行：**整块**（8–12 行），不是单句 —— 写稿模型从块里再取舍。 */
  lines: string[];
  /** 首行在源文件中的 1 基行号；写稿时透传给讲稿的 `excerptStart`。 */
  start?: number;
  /** 这块为什么值得讲（一句话；写稿挑块与评审核对都用）。 */
  why?: string;
};

export type DigestDocument = {
  digest: typeof DIGEST_VERSION;
  source: { root: string; label?: string };
  /** 规模数字（程序抽查 totalFiles）。 */
  scale: {
    totalFiles: number;
    codeLines?: number;
    testFiles?: number;
  };
  modules: DigestModule[];
  /** 内容构成盘点（进讲稿的 inventory 场景从它选）。 */
  inventory?: { groups: { label: string; count: number }[]; total: number };
  excerpts: DigestExcerpt[];
  /** 开放槽：值得记但没处放的观察（收缩史、风险、关系……）。 */
  notes?: string[];
};

export type DigestIssue = {
  code: string;
  severity: 'blocker' | 'warning';
  message: string;
  path?: string;
};

/** 数源目录下的文件数，口径对齐 skill 教的 `rg --files`：尊重 .gitignore，排除 .foldercast。 */
export function countSourceFiles(root: string): number {
  const ignoreFile = join(root, '.gitignore');
  const anyDepth = new Set(['.foldercast', 'node_modules', '.git']);
  const rootOnly = new Set<string>();
  if (existsSync(ignoreFile)) {
    // 近似而非完整 gitignore 语义（digest 抽查够用，对不上报 warning 让人确认）：
    // · 无路径的单段名（`node_modules`）→ 任意深度忽略；
    // · 锚定根目录的（`/assets/`）→ **只在根层级忽略**——写成全局会把
    //   `packages/plugin/scripts/assets/` 这类代码目录一起吞掉（.gitignore 注释里
    //   记着这个坑）；
    // · 带路径 / 通配的模式跳过（太容易误伤，宁多数不误删）。
    for (const line of readFileSync(ignoreFile, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('!')) continue;
      const anchored = trimmed.startsWith('/');
      const normalized = trimmed.replace(/^\/+/, '').replace(/\/+$/, '');
      if (normalized.includes('/') || normalized.includes('*')) continue;
      if (anchored) rootOnly.add(normalized);
      else anyDepth.add(normalized);
    }
  }
  let count = 0;
  const walk = (dir: string, depth: number): void => {
    // 深度上限只是保险丝：node_modules 已忽略，正常仓库到不了这么深
    if (depth > 8) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (anyDepth.has(entry.name)) continue;
      if (depth === 0 && rootOnly.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.isFile()) count += 1;
    }
  };
  walk(root, 0);
  return count;
}

/**
 * 校验 digest（存在时由 `render --check` 调）。**digest.json 缺席不报错**：它是写稿的
 * 中间产物，管线不强制（讲稿自足性不依赖它）。
 */
export function checkDigest(doc: DigestDocument, root: string): DigestIssue[] {
  const issues: DigestIssue[] = [];
  if (doc.digest !== DIGEST_VERSION) {
    issues.push({
      code: 'digest-version',
      severity: 'blocker',
      message: `digest 版本是 ${String(doc.digest)}，当前契约要 ${String(DIGEST_VERSION)}（v2：excerpts 升级为块级摘录 lines + start；把 text 换成 lines、补 start 即可迁移）`,
    });
  }

  const exists = (relative: string): boolean => {
    const stats = statSync(resolve(root, relative), { throwIfNoEntry: false });
    return stats !== undefined;
  };

  for (const [index, excerpt] of doc.excerpts.entries()) {
    const at = (field: string): string => `/excerpts/${String(index)}/${field}`;
    if (!exists(excerpt.file)) {
      issues.push({
        code: 'digest-path-missing',
        severity: 'blocker',
        message: `digest 摘录引用的文件不存在：${excerpt.file}`,
        path: at('file'),
      });
      continue;
    }
    // v2 块级摘录的真实性（与讲稿摘录同一哲学：必须是原文，行号要对得上）
    const nonEmpty = (excerpt.lines ?? []).filter((line) => line.trim() !== '');
    if (nonEmpty.length === 0) continue;
    let content: string | undefined;
    try {
      content = readFileSync(resolve(root, excerpt.file), 'utf8');
    } catch {
      continue;
    }
    const haystack = content.replace(/\r\n/g, '\n');
    const missing = nonEmpty.find((line) => !haystack.includes(line.trim()));
    if (missing !== undefined) {
      issues.push({
        code: 'digest-excerpt-unverifiable',
        severity: 'warning',
        message: `digest 摘录行在 ${excerpt.file} 里找不到：「${missing.trim().slice(0, 40)}」`,
        path: at('lines'),
      });
    }
    if (excerpt.start !== undefined) {
      const atLine = haystack.split('\n')[excerpt.start - 1];
      if (atLine === undefined || atLine.trim() !== (nonEmpty[0] ?? '').trim()) {
        issues.push({
          code: 'digest-start-mismatch',
          severity: 'warning',
          message: `digest 摘录的 start ${String(excerpt.start)} 对不上：${excerpt.file} 那一行不是摘录的第一行`,
          path: at('start'),
        });
      }
    }
  }

  for (const [index, module] of doc.modules.entries()) {
    if (!exists(module.path)) {
      issues.push({
        code: 'digest-path-missing',
        severity: 'blocker',
        message: `digest 模块路径不存在：${module.path}`,
        path: `/modules/${String(index)}/path`,
      });
      continue;
    }
    for (const key of module.keyFiles ?? []) {
      if (!exists(key)) {
        issues.push({
          code: 'digest-path-missing',
          severity: 'blocker',
          message: `digest 关键文件不存在：${key}`,
          path: `/modules/${String(index)}/keyFiles`,
        });
      }
    }
  }

  const actual = countSourceFiles(root);
  if (Math.abs(actual - doc.scale.totalFiles) > Math.max(2, Math.round(doc.scale.totalFiles * 0.05))) {
    issues.push({
      code: 'digest-count-mismatch',
      severity: 'warning',
      message: `totalFiles 写的 ${String(doc.scale.totalFiles)}，程序数出来 ${String(actual)}（口径可能是锁文件/隐藏文件的算法差异，确认后改准）`,
      path: '/scale/totalFiles',
    });
  }

  return issues;
}
