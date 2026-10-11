import { afterEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const publish = resolve(import.meta.dirname, '../publish-package.ts');
function run(state: { npmExists: boolean; releaseExists: boolean; npmDifferent?: boolean; releaseDifferent?: boolean; delayedViews?: number; registryError?: string }): { status: number | null; calls: string[]; stderr: string } {
  const root = mkdtempSync(join(tmpdir(), 'foldercast-publish-')); roots.push(root);
  const bin = join(root, 'bin'); mkdirSync(bin);
  const bytes = Buffer.from('test tarball bytes');
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  const filename = 'dsh-foldercast-0.3.1-rc.1.tgz';
  writeFileSync(join(root, filename), bytes);
  writeFileSync(join(root, 'pack.json'), JSON.stringify([{ name: 'dsh-foldercast', version: '0.3.1-rc.1', filename, integrity, files: [{ path: 'lib/src/index.js' }] }]));
  const record = join(root, 'state.json'); writeFileSync(record, JSON.stringify({ ...state, integrity, calls: [] }));
  for (const command of ['gh', 'npm']) writeFileSync(join(bin, command), `#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');
const record=process.env.FOLDERCAST_PUBLISH_TEST_STATE,s=JSON.parse(fs.readFileSync(record));
const a=process.argv.slice(2),command=${JSON.stringify(command)};
const save=()=>fs.writeFileSync(record,JSON.stringify(s));
if(command==='npm'){
 if(a[0]==='view'){if(!s.npmExists){console.error('E404');process.exit(1)}if(s.delayedViews>0){s.delayedViews--;save();console.error('E404');process.exit(1)}if(s.registryError){console.error(s.registryError);process.exit(1)}console.log(JSON.stringify(s.npmDifferent?'different':s.integrity))}
 else if(a[0]==='publish'){s.calls.push('npm publish');s.npmExists=true;save()}
 else process.exit(9);
}else{
 if(a[0]==='repo'){console.log(JSON.stringify({visibility:'PUBLIC'}))}
 else if(a[1]==='view'){if(!s.releaseExists){console.error('release not found');process.exit(1)}console.log(JSON.stringify({isDraft:false}))}
 else if(a[1]==='download'){
  const file=a[a.indexOf('--pattern')+1],dir=a[a.indexOf('--dir')+1];
  if(file==='SHA256SUMS')fs.copyFileSync(path.join(process.env.FOLDERCAST_PUBLISH_TEST_ROOT,file),path.join(dir,file));
  else fs.writeFileSync(path.join(dir,file),s.releaseDifferent?'different':'test tarball bytes');
 }else if(['upload','edit','create'].includes(a[1])){s.calls.push('gh '+a[1]);save()}
 else process.exit(9);
}
`, { mode: 0o755 });
  const result = spawnSync(process.execPath, [publish, root], { encoding: 'utf8', env: { ...process.env,
    PATH: `${bin}${delimiter}${process.env['PATH'] ?? ''}`, GITHUB_REF_NAME: 'v0.3.1-rc.1',
    FOLDERCAST_PUBLISH_TEST_STATE: record, FOLDERCAST_PUBLISH_TEST_ROOT: root } });
  return { status: result.status, stderr: result.stderr, calls: JSON.parse(readFileSync(record, 'utf8')).calls as string[] };
}
// 发布 job 固定 Ubuntu；Windows 不支持此测试使用的 shebang CLI 替身。
it.skipIf(process.platform === 'win32')('已发布 npm 或 Release 的字节不同，任何写入前失败', () => {
  for (const state of [
    { npmExists: true, releaseExists: false, npmDifferent: true },
    { npmExists: false, releaseExists: true, releaseDifferent: true },
  ]) {
    const result = run(state); expect(result.status).not.toBe(0); expect(result.calls).toEqual([]);
  }
});
it.skipIf(process.platform === 'win32')('相同包重跑不再次发布；新版本先 npm 后 Release', () => {
  const repeated = run({ npmExists: true, releaseExists: true });
  expect(repeated.status, repeated.stderr).toBe(0); expect(repeated.calls).toEqual([]);
  const fresh = run({ npmExists: false, releaseExists: false });
  expect(fresh.status, fresh.stderr).toBe(0); expect(fresh.calls).toEqual(['npm publish', 'gh create']);
});

it.skipIf(process.platform === 'win32')('npm 接受上传后尚未可见：等待后核对原包，只发布一次', () => {
  const result = run({ npmExists: false, releaseExists: false, delayedViews: 1 });
  expect(result.status, result.stderr).toBe(0);
  expect(result.calls).toEqual(['npm publish', 'gh create']);
});

it.skipIf(process.platform === 'win32')('上传后包身份不同或 registry 权限出错：不创建 Release、不重传', () => {
  for (const state of [{ npmDifferent: true }, { registryError: 'E403' }]) {
    const result = run({ npmExists: false, releaseExists: false, ...state });
    expect(result.status).not.toBe(0);
    expect(result.calls).toEqual(['npm publish']);
  }
});
