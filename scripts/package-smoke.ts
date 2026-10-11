/** 对已经隔离安装的实际 tarball 验收；不从工作区加载插件。 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const installed = resolve(process.argv[2] ?? '');
const pkg = realpathSync(join(installed, 'node_modules/dsh-foldercast'));
assert(existsSync(join(pkg, 'package.json')), '提供隔离安装目录');
const manifest = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')) as { version: string };
for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md', 'lib/src/index.d.ts', 'lib/client.js', 'schemas/script.schema.json']) {
  assert(existsSync(join(pkg, file)), `随包缺少 ${file}`);
}
await import(pathToFileURL(join(pkg, 'lib/src/index.js')).href);
const runtime = await import(pathToFileURL(join(pkg, 'lib/src/runtime.js')).href);
assert.equal(runtime.PACKAGE_ROOT, pkg);
assert(runtime.scriptsInstalled().ok);
for (const name of ['page', 'voice', 'render']) assert(runtime.stageEntryPath(name).endsWith('.js'));
const scratch = mkdtempSync(join(tmpdir(), 'foldercast-smoke-'));
const source = join(scratch, 'source');
const workRoot = join(source, '.foldercast');
mkdirSync(workRoot, { recursive: true });
const script = { foldercast: 2, source: { root: source, label: '分发验收' }, title: '分发验收', scenes: [
  { id: 'cover', type: 'cover', title: '分发验收', narration: '验证安装后的真实发布包。' },
  { id: 'outro', type: 'outro', title: '完成', narration: '校验和页面生成完成。' },
] };
writeFileSync(join(workRoot, 'script.json'), JSON.stringify(script));
const run = (stage: string, args: string[]): ReturnType<typeof spawnSync> => spawnSync(process.execPath,
  [runtime.stageEntryPath(stage), source, '--json', ...args], { encoding: 'utf8', timeout: 120000,
    env: { ...process.env, MIMO_API_KEY: '', DSH_HOME: join(source, 'empty-home') } });
try {
  assert.equal(run('render', ['--check']).status, 0);
  const approved = run('page', ['--approved']);
  assert.equal(approved.status, 2, '没有回执时禁止正式产出');
  const page = run('page', ['--style', '科技风格']);
  assert.equal(page.status, 0, String(page.stderr));
  const html = readFileSync(join(workRoot, 'out/page.html'), 'utf8');
  assert(!html.includes(source), 'HTML 不泄露自动附带的源目录路径');
  assert(html.includes('可以单文件保存和转发'));
  assert(!/<script[\s>]/i.test(html));
  assert.equal(run('voice', ['--provider', 'mimo', '--check']).status, 4, 'MiMo 缺密钥引导');
  if (process.env['FOLDERCAST_SMOKE_RENDER'] === '1') {
    const still = run('render', ['--still', '0']);
    assert.equal(still.status, 0, String(still.stderr));
  }
  // 不接受边界外引用：即使文件真实存在，也不能让摘录和渲染读取。
  writeFileSync(join(workRoot, 'script.json'), JSON.stringify({ ...script, scenes: [
    { id: 'bad', type: 'file', title: '越界', file: '../secret.txt', narration: '这个引用必须被拒绝。' },
  ] }));
  writeFileSync(join(source, '../secret.txt'), 'smoke placeholder');
  const bad = run('render', ['--check']);
  assert.equal(bad.status, 2);
  assert(String(bad.stdout).includes('path-outside-root'));
  console.log(`隔离安装验收通过：dsh-foldercast@${manifest.version}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
