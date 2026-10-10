/**
 * 凭据 seam：`.env` 解析与读取优先级。
 *
 * 全部离线：来源都是显式传入的字符串与环境对象，不读真实文件、不碰真实密钥。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeSecretReader, parseEnvFile } from '../env.ts';

describe('parseEnvFile', () => {
  it('KEY=value、注释、可选引号都认；空行与无值行跳过', () => {
    expect(
      parseEnvFile(['# 注释', 'MIMO_API_KEY=abc', 'EMPTY=', 'QUOTED="带空格 的值"', "SINGLE='单引号'", '  '].join('\n')),
    ).toEqual({ MIMO_API_KEY: 'abc', QUOTED: '带空格 的值', SINGLE: '单引号' });
  });

  it('不展开变量（不做 shell）', () => {
    expect(parseEnvFile('A=1\nB=${A}')).toEqual({ A: '1', B: '${A}' });
  });
});

describe('makeSecretReader（优先级：进程环境 > 项目 .env > DSH home .env）', () => {
  let root = '';

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'foldercast-env-'));
  });

  afterAll(() => {
    if (root !== '') rmSync(root, { recursive: true, force: true });
  });

  function fixture(): { projectRoot: string; dshHome: string } {
    const projectRoot = join(root, 'project');
    const dshHome = join(root, 'dsh-home');
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(dshHome, { recursive: true });
    writeFileSync(join(projectRoot, '.env'), 'MIMO_API_KEY=from-project\nBLANK=from-project\n');
    writeFileSync(join(dshHome, '.env'), 'MIMO_API_KEY=from-dsh\nOTHER_KEY=only-dsh\n');
    return { projectRoot, dshHome };
  }

  it('三层来源叠加，先命中的赢', () => {
    const { projectRoot, dshHome } = fixture();
    const secret = makeSecretReader({ env: {}, projectRoot, dshHome });
    expect(secret('MIMO_API_KEY')).toBe('from-project');
    expect(secret('OTHER_KEY')).toBe('only-dsh');
    expect(secret('MISSING')).toBeUndefined();
  });

  it('进程环境最优先，且空白值不算配了', () => {
    const { projectRoot, dshHome } = fixture();
    const secret = makeSecretReader({ env: { MIMO_API_KEY: '  from-env  ', BLANK: '   ' }, projectRoot, dshHome });
    expect(secret('MIMO_API_KEY')).toBe('from-env');
    expect(secret('BLANK')).toBe('from-project');
  });

  it('配音 CLI 从被讲解目录读取密钥，检查模式不发请求或输出密钥', () => {
    const { projectRoot, dshHome } = fixture();
    mkdirSync(join(projectRoot, '.foldercast'), { recursive: true });
    writeFileSync(join(projectRoot, '.foldercast/script.json'), JSON.stringify({
      foldercast: 2, source: { root: projectRoot }, title: '离线检查',
      scenes: [{ id: 'cover', type: 'cover', title: '离线检查', narration: '检查配置。' }],
    }));
    const output = execFileSync(process.execPath,
      [resolve(import.meta.dirname, '../main.ts'), projectRoot, '--provider', 'mimo', '--check', '--json'],
      { encoding: 'utf8', env: { ...process.env, MIMO_API_KEY: '', DSH_HOME: join(dshHome, 'empty') } });
    expect(JSON.parse(output)).toMatchObject({ provider: 'mimo', scenes: [{ id: 'cover' }] });
    expect(output).not.toContain('from-project');
  });
});
