/**
 * 配音阶段（M8）：`script.json` → 逐场景音频 + `durations.json`（+ 整条音轨）。
 *
 * 用法：
 *   pnpm voice <目录> [--provider say|mimo] [--voice <音色>] [--style <怎么读>]
 *                     [--pause 0.45] [--force] [--no-track] [--limit N]
 *                     [--list-providers] [--list-voices] [--check] [--json]
 *
 * 与别的阶段一样**独立可跑**（ADR 0008）：它不认识 DSH，只认工作根下的文件。
 *
 * 退出码：0 成功；2 参数或讲稿有问题；4 **缺密钥**（可操作的环境问题，不是崩溃）——
 * 与「渲染缺浏览器用 3」同一套思路：把「环境还没配好」和「程序出错」分开。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EXIT_CREDENTIAL_MISSING } from '../contracts/durations.ts';
import { makeVoiceEnv } from './env.ts';
import { findProvider, listProviders, providerNames } from './providers/index.ts';
import { audioFileName, SynthError, synthesize, type SynthReport } from './synth.ts';

const USAGE = `给讲稿配旁白，产出逐场景音频、实测时长与 durations.json。

用法：
  pnpm voice <目录> [选项]

选项：
  --provider <名字>   TTS provider。默认取讲稿的 voice.provider，否则 say（免密钥）
  --voice <音色>      provider 内的音色标识（say 是系统音色名，mimo 是「白桦」这类 ID）
  --style <怎么读>    风格/语速描述，各 provider 自行翻译
  --pause <秒>        每个场景末尾的留白，算进场景时长。默认 0.45
  --script <文件>     讲稿路径。默认 <目录>/.foldercast/script.json
  --force             已存在的音频也重新合成（会重新消耗配额）
  --no-track          不拼整条音轨（只出逐场景音频与 durations.json）
  --limit <n>         只做前 n 个场景（试音色用，省配额）
  --list-providers    列出可用 provider 后退出
  --list-voices       列出当前 provider 的音色后退出
  --check             只报会用哪个 provider、哪些音频会重合成，不调用 TTS
  --json              以 JSON 输出报告（给 agent 与 CI 用）
  -h, --help          显示这段说明

退出码：0 成功；2 参数或讲稿有问题；4 缺密钥（引导里写清怎么配）。`;

type Options = {
  target: string;
  provider?: string;
  voice?: string;
  style?: string;
  pause?: number;
  script?: string;
  force: boolean;
  track: boolean;
  limit?: number;
  listProviders: boolean;
  listVoices: boolean;
  check: boolean;
  json: boolean;
};

function parseArgs(argv: string[]): Options | { error: string } {
  const options: Options = { target: '', force: false, track: true, listProviders: false, listVoices: false, check: false, json: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) break;
    switch (arg) {
      case '-h':
      case '--help':
        return { error: 'help' };
      case '--force':
        options.force = true;
        break;
      case '--no-track':
        options.track = false;
        break;
      case '--list-providers':
        options.listProviders = true;
        break;
      case '--list-voices':
        options.listVoices = true;
        break;
      case '--check':
        options.check = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--provider':
      case '--voice':
      case '--style':
      case '--pause':
      case '--script':
      case '--limit': {
        const value = argv[i + 1];
        if (value === undefined) return { error: `${arg} 后面缺一个值` };
        i += 1;
        if (arg === '--provider') options.provider = value;
        else if (arg === '--voice') options.voice = value;
        else if (arg === '--style') options.style = value;
        else if (arg === '--script') options.script = value;
        else if (arg === '--pause') {
          const seconds = Number(value);
          if (!Number.isFinite(seconds) || seconds < 0) return { error: `--pause 要一个非负秒数，收到 ${value}` };
          options.pause = seconds;
        } else {
          const count = Number(value);
          if (!Number.isInteger(count) || count < 1) return { error: `--limit 要一个正整数，收到 ${value}` };
          options.limit = count;
        }
        break;
      }
      default:
        if (arg.startsWith('-')) return { error: `不认识的选项：${arg}` };
        if (options.target !== '') return { error: `只接受一个目录，收到多个` };
        options.target = arg;
        break;
    }
  }

  return options;
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if ('error' in parsed) {
    if (parsed.error === 'help') {
      console.log(USAGE);
      return 0;
    }
    console.error(`${parsed.error}\n\n${USAGE}`);
    return 2;
  }

  const target = resolve(parsed.target === '' ? process.cwd() : parsed.target);
  const workRoot = join(target, '.foldercast');
  const env = makeVoiceEnv({ projectRoot: target });

  if (parsed.listProviders) {
    const rows = listProviders();
    if (parsed.json) {
      console.log(JSON.stringify(rows, null, 2));
      return 0;
    }
    for (const row of rows) {
      console.log(`${row.name.padEnd(6)} ${row.requiresKey ? '需要密钥' : '免密钥'}  ${row.description}`);
    }
    return 0;
  }

  const providerName = parsed.provider ?? undefined;
  const provider = findProvider(providerName);
  if (provider === undefined) {
    console.error(`不认识的 provider：${String(providerName)}\n可用的有：${providerNames().join('、')}。`);
    return 2;
  }

  if (parsed.listVoices) {
    const voices = provider.listVoices?.() ?? [];
    if (parsed.json) {
      console.log(JSON.stringify({ provider: provider.name, voices }, null, 2));
      return 0;
    }
    if (voices.length === 0) {
      console.log(`${provider.name} 没有静态音色表（${provider.describe()}）`);
    } else {
      for (const voice of voices) console.log(voice);
    }
    return 0;
  }

  // 前置检查：缺密钥在这里就返回引导，**不发起合成**（等 401 的话措辞是外部给的）
  const preflight = provider.preflight(env);
  if (!preflight.ok) {
    if (parsed.json) {
      console.log(
        JSON.stringify({ ok: false, provider: provider.name, reason: preflight.reason, hint: preflight.hint }, null, 2),
      );
    } else {
      console.error(`provider ${provider.name} 还不能用（${preflight.reason}）：\n${preflight.hint}`);
    }
    return preflight.reason === 'credential-missing' ? EXIT_CREDENTIAL_MISSING : 2;
  }

  // 缺命令的检查放在**前置检查之后**：先说「你选的 provider 缺密钥」（可操作、要用户决定），
  // 再说「这台机器缺 ffmpeg」。反过来的话，缺 ffmpeg 的机器上永远看不到密钥引导 ——
  // 而 CI 恰好就是那台机器（实测踩过：缺密钥本该退出 4，却因为先撞上缺 ffmpeg 退成了 2）。
  if (!env.has('ffmpeg')) {
    console.error(
      '配音需要 ffmpeg（把 say 的输出转成 wav、按场景拼接音轨）。macOS：brew install ffmpeg\n' +
        '注意：缺它只影响配音，分析、素材、页面与静音出片都不受影响。',
    );
    return 2;
  }

  if (parsed.check) {
    const scriptPath = parsed.script === undefined ? join(workRoot, 'script.json') : resolve(parsed.script);
    if (!existsSync(scriptPath)) {
      console.error(`找不到讲稿：${scriptPath}`);
      return 2;
    }
    const script = JSON.parse(readFileSync(scriptPath, 'utf8')) as { scenes: { id: string; narration: string }[] };
    const rows = script.scenes.map((scene) => {
      const audio = resolve(workRoot, audioFileName(scene.id));
      const exists = existsSync(audio);
      return { id: scene.id, chars: [...scene.narration].length, audio: exists ? '已存在（会跳过）' : '待合成' };
    });
    if (parsed.json) {
      console.log(JSON.stringify({ provider: provider.name, description: provider.describe(), scenes: rows }, null, 2));
      return 0;
    }
    console.log(`${provider.name}：${provider.describe()}`);
    for (const row of rows) console.log(`  ${row.id.padEnd(20)} ${String(row.chars).padStart(4)} 字  ${row.audio}`);
    return 0;
  }

  let report: SynthReport;
  try {
    report = await synthesize({
      target,
      workRoot,
      ...(parsed.script === undefined ? {} : { scriptPath: parsed.script }),
      ...(parsed.provider === undefined ? {} : { provider: parsed.provider }),
      ...(parsed.voice === undefined ? {} : { voice: parsed.voice }),
      ...(parsed.style === undefined ? {} : { style: parsed.style }),
      ...(parsed.pause === undefined ? {} : { pauseSec: parsed.pause }),
      ...(parsed.limit === undefined ? {} : { limit: parsed.limit }),
      force: parsed.force,
      track: parsed.track,
      env,
      onProgress: ({ sceneId, index, total, cached }) => {
        if (!parsed.json && process.stderr.isTTY) {
          process.stderr.write(`\r配音 ${index}/${total} ${sceneId}${cached ? '（已存在）' : ''}   `);
        }
      },
    });
  } catch (error) {
    if (error instanceof SynthError) {
      if (parsed.json) console.log(JSON.stringify({ ok: false, error: error.message }, null, 2));
      else console.error(error.message);
      return error.exitCode;
    }
    throw error;
  }

  if (!parsed.json && process.stderr.isTTY) process.stderr.write('\r');
  printReport(report, parsed.json);
  return 0;
}

function printReport(report: SynthReport, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const lines = [
    report.target,
    `  provider  ${report.provider}${report.voice === undefined ? '' : ` · ${report.voice}`}`,
    `  场景      ${report.scenes.length} 个 · 合成 ${report.synthesized} · 跳过（已存在）${report.cached}`,
    `  总时长    ${report.totalSec} 秒`,
    `  时长表    ${report.durationsPath}`,
  ];
  if (report.trackPath !== undefined) lines.push(`  音轨      ${report.trackPath}`);
  for (const note of report.notes) lines.push(`  说明      ${note}`);
  for (const warning of report.warnings) lines.push(`  提醒      ${warning}`);
  console.log(lines.join('\n'));
}

const exitCode = await main();
process.exitCode = exitCode;
