/**
 * 配音阶段：`script.json` → 逐场景音频 + `durations.json`（+ 整条音轨）。
 *
 * 用法：
 *   pnpm voice <目录> [--provider edge|mimo] [--voice <音色>] [--style <怎么读>]
 *                  [--pause 0.45] [--force] [--no-track] [--limit N] [--check] [--json]
 *
 * 独立可跑：它不认识 DSH，只认工作根下的文件。两个 provider 都是云端（要网络）：
 * `edge` 免密钥（默认），`mimo` 要 `MIMO_API_KEY`（docs/decisions/0002）。
 *
 * 退出码：0 成功；2 参数、讲稿或环境有问题；4 缺密钥（引导里写清三种配置办法）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EXIT_CREDENTIAL_MISSING, type TtsProvider } from '../contracts/durations.ts';
import { makeVoiceEnv } from './env.ts';
import { edgeProvider } from './providers/edge.ts';
import { mimoProvider } from './providers/mimo.ts';
import { audioFileName, SynthError, synthesize, type SynthReport } from './synth.ts';

/**
 * provider 注册表：加 provider 就是往这里放一行。CLI 参数与设置页都用 `name` 在这里查。
 */
const PROVIDERS: Readonly<Record<string, TtsProvider>> = {
  edge: edgeProvider,
  mimo: mimoProvider,
};

const USAGE = `给讲稿配旁白，产出逐场景音频、实测时长与 durations.json。

用法：
  pnpm voice <目录> [选项]

选项：
  --provider <引擎>   edge（默认，免密钥）或 mimo（要 MIMO_API_KEY）。都要网络
  --voice <音色>      引擎各自的音色名（如 edge 的 zh-CN-XiaoxiaoNeural）。缺省用默认中文音色
  --style <怎么读>    自然语描述。mimo 落进风格指令；edge 表达不了，忽略
  --pause <秒>        每个场景末尾的留白，算进场景时长。默认 0.45
  --script <文件>     讲稿路径。默认 <目录>/.foldercast/script.json
  --force             已存在的音频也重新合成
  --no-track          不拼整条音轨（只出逐场景音频与 durations.json）
  --limit <n>         只做前 n 个场景（试音色用）
  --check             只报哪些音频会重合成，不真的调 TTS
  --json              以 JSON 输出报告（给 agent 与 CI 用）
  -h, --help          显示这段说明

退出码：0 成功；2 参数、讲稿或环境有问题（缺 ffmpeg 时引导里写清怎么装）；4 缺密钥。`;

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
  check: boolean;
  json: boolean;
};

function parseArgs(argv: string[]): Options | { error: string } {
  const options: Options = { target: '', force: false, track: true, check: false, json: false };

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
        if (options.target !== '') return { error: '只接受一个目录，收到多个' };
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
  const env = makeVoiceEnv();
  const provider = PROVIDERS[parsed.provider ?? 'edge'];
  if (provider === undefined) {
    const hint = `不认识的配音引擎「${parsed.provider ?? ''}」。可用：${Object.keys(PROVIDERS).join('、')}。`;
    if (parsed.json) console.log(JSON.stringify({ ok: false, error: hint }, null, 2));
    else console.error(hint);
    return 2;
  }

  // 前置检查：缺命令或缺密钥在这里就返回引导，**不发起请求**（等跑到一半才失败更难办）。
  // 缺密钥是专用退出码 4（可操作的环境问题，与参数错误分开）
  const preflight = provider.preflight(env);
  if (!preflight.ok) {
    if (parsed.json) {
      console.log(
        JSON.stringify({ ok: false, provider: provider.name, reason: preflight.reason, hint: preflight.hint }, null, 2),
      );
    } else {
      console.error(`配音还不能跑（${preflight.reason}）：\n${preflight.hint}`);
    }
    return preflight.reason === 'credential-missing' ? EXIT_CREDENTIAL_MISSING : 2;
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
