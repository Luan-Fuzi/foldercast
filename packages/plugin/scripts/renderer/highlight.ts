/**
 * excerpt 的语法高亮（Node 侧预算，v2）。
 *
 * **为什么不在浏览器里高亮**：shiki 要异步加载语言与主题，放进 Remotion 的渲染循环
 * 既慢又引入异步；在 CLI 里算一次、把 HTML 字符串当纯数据传进 `inputProps`，浏览器
 * 只做展示。同一份摘录 + 同一版本 shiki → 同一段 HTML，逐帧一致不受影响。
 *
 * 语言按扩展名猜，猜不出的按纯文本（shiki 的 `text` 不上色，只是等宽排版）。
 * 高亮失败不致命：调用方落回等宽纯文本的旧版式。
 */
import { codeToHtml } from 'shiki';
import type { ScriptDocument } from '../contracts/script.ts';

/** 扩展名 → shiki 语言名。认不出的给 `text`。 */
const LANG_BY_EXT: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  json: 'json',
  jsonc: 'json',
  md: 'markdown',
  markdown: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  rb: 'ruby',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  css: 'css',
  html: 'html',
  xml: 'xml',
  sql: 'sql',
};

function langOf(file: string): string {
  const ext = file.split('.').pop()?.toLowerCase() ?? '';
  return LANG_BY_EXT[ext] ?? 'text';
}

/**
 * 给所有 file 场景的 excerpt 预算高亮 HTML。返回场景 id → HTML。
 * 单个场景失败跳过（画面落回纯文本），不让一次高亮失败毁掉整次渲染。
 */
export async function highlightExcerpts(script: ScriptDocument): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const scene of script.scenes) {
    if (scene.type !== 'file' || scene.excerpt === undefined || scene.excerpt.length === 0) continue;
    try {
      out[scene.id] = await codeToHtml(scene.excerpt.join('\n'), {
        lang: langOf(scene.file ?? ''),
        theme: 'github-light',
      });
    } catch {
      // 落回纯文本版式：调用方查不到这个 id 就走旧渲染
    }
  }
  return out;
}
