/** 使用 pack job 的唯一 tarball；重跑必须与已发布字节匹配。 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const directory = resolve(process.argv[2] ?? 'release');
const pack = JSON.parse(readFileSync(join(directory, 'pack.json'), 'utf8'))[0];
const { version, name, filename, integrity } = pack;
assert.equal(name, 'dsh-foldercast');
assert.equal(process.env['GITHUB_REF_NAME'], `v${version}`);
assert.equal(filename, `dsh-foldercast-${version}.tgz`);
for (const file of pack.files as { path: string }[]) {
  assert(!/(^|\/)(node_modules|tests|fixtures)(\/|$)/.test(file.path), `分发夹具或依赖：${file.path}`);
  assert(!/(^|\/)\.env(?:\.|$)|credentials|\.pem$/.test(file.path), `分发凭据文件：${file.path}`);
}
const tarball = join(directory, filename);
const bytes = readFileSync(tarball);
assert.equal(`sha512-${createHash('sha512').update(bytes).digest('base64')}`, integrity);
const repo = JSON.parse(execFileSync('gh', ['repo', 'view', '--json', 'visibility'], { encoding: 'utf8' }));
assert.equal(repo.visibility, 'PUBLIC', '公开源码后才能发布 provenance 与文档链接');
const checksum = createHash('sha256').update(bytes).digest('hex');
writeFileSync(join(directory, 'SHA256SUMS'), `${checksum}  ${filename}\n`);
const tag = `v${version}`;
const previous = spawnSync('gh', ['release', 'view', tag, '--json', 'isDraft'], { encoding: 'utf8' });
const scratch = mkdtempSync(join(tmpdir(), 'foldercast-release-'));
try {
  let hasPackage = false;
  let hasSums = false;
  if (previous.status === 0) {
    const download = spawnSync('gh', ['release', 'download', tag, '--pattern', filename, '--dir', scratch], { encoding: 'utf8' });
    hasPackage = download.status === 0;
    if (hasPackage) assert(readFileSync(join(scratch, filename)).equals(bytes), '已有 Release 包不同，禁止替换');
    else assert(download.stderr.includes('no assets match'), download.stderr);
    const sums = spawnSync('gh', ['release', 'download', tag, '--pattern', 'SHA256SUMS', '--dir', scratch], { encoding: 'utf8' });
    hasSums = sums.status === 0;
    if (hasSums) assert.equal(readFileSync(join(scratch, 'SHA256SUMS'), 'utf8'), readFileSync(join(directory, 'SHA256SUMS'), 'utf8'));
    else assert(sums.stderr.includes('no assets match'), sums.stderr);
  } else assert(/release not found|Not Found/i.test(previous.stderr), previous.stderr);

  const npmVersion = spawnSync('npm', ['view', `${name}@${version}`, 'dist.integrity', '--json'], { encoding: 'utf8' });
  if (npmVersion.status === 0) {
    assert.equal(JSON.parse(npmVersion.stdout), integrity, 'npm 已存在版本的包不同，禁止覆盖或发布另一份 Release 附件');
  } else {
    assert(npmVersion.stderr.includes('E404'), `无法核实 npm 状态：${npmVersion.stderr}`);
    execFileSync('npm', ['publish', tarball, '--provenance', '--access', 'public', '--tag', version.includes('-') ? 'next' : 'latest'], { stdio: 'inherit' });
    const published = execFileSync('npm', ['view', `${name}@${version}`, 'dist.integrity', '--json'], { encoding: 'utf8' });
    assert.equal(JSON.parse(published), integrity, '发布后的 registry 字节身份不一致');
  }

  if (previous.status === 0) {
    if (!hasPackage) execFileSync('gh', ['release', 'upload', tag, tarball], { stdio: 'inherit' });
    if (!hasSums) execFileSync('gh', ['release', 'upload', tag, join(directory, 'SHA256SUMS')], { stdio: 'inherit' });
    if (JSON.parse(previous.stdout).isDraft) execFileSync('gh', ['release', 'edit', tag, '--draft=false'], { stdio: 'inherit' });
  } else {
    assert(/release not found|Not Found/i.test(previous.stderr), `不能核实 Release：${previous.stderr}`);
    const notes = `dsh-foldercast ${version}\n\nSee CHANGELOG.md and docs/licensing.md at this tag.\n\nSHA256: ${checksum}\n\nInstall: dsh plugin --profile <profile> add dsh-foldercast@${version}\n`;
    writeFileSync(join(scratch, 'notes.md'), notes);
    execFileSync('gh', ['release', 'create', tag, '--verify-tag', '--title', `foldercast ${version}`, '--notes-file', join(scratch, 'notes.md'), ...(version.includes('-') ? ['--prerelease'] : []), tarball, join(directory, 'SHA256SUMS')], { stdio: 'inherit' });
  }
  console.log(`npm 与 GitHub Release 已核对同一份包：${filename} (${checksum})`);
} finally { rmSync(scratch, { recursive: true, force: true }); }
