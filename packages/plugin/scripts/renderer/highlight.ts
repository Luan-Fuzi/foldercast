/**
 * excerpt 的画面预算（Node 侧，0005 WP1）：**代码走 shiki 深色高亮，Markdown 走真正的
 * Markdown 渲染**。摘录是画面主体，散文按源码显示（`**` 星号原样出现）是这个场景
 * 曾经最丑的地方 —— shiki 是语法高亮器不是 Markdown 渲染器，所以 Markdown 系文件
 * 单独走 `marked`（同步、零配置、输出确定）。
 *
 * **为什么不在浏览器里做**：shiki 要异步加载语言与主题，marked 也要体积；放进
 * Remotion 的渲染循环既慢又引入异步。在 CLI 里算一次、把 HTML 字符串当纯数据传进
 * `inputProps`，浏览器只做展示。同一份摘录 + 同一版本依赖 → 同一段 HTML，逐帧一致
 * 不受影响。
 *
 * 深色主题（`github-dark`）的 `<pre>` 自带底色内联样式，与视频面板色相抵（白条就是这样
 * 来的）；用 transformer 把它剥成透明，底色归 `scenes/common.ts` 的 `panel`。高亮失败
 * 不致命：调用方查不到场景 id 就落回等宽纯文本的旧版式。
 */
import { marked } from 'marked';
import { codeToHtml } from 'shiki';
import { isMarkdownFile } from '../contracts/script.ts';
import type { ScriptDocument } from '../contracts/script.ts';

/** 扩展名 → shiki 语言名。认不出的给 `text`；Markdown 系不进这张表（走 marked）。 */
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

/** shiki 把主题底色、内边距与横向滚动内联在 `<pre>` 上；视频里这三样都归面板管。 */
function stripPreChrome(node: { properties: Record<string, unknown> }): void {
  node.properties.style = 'margin:0;padding:0;background:transparent;overflow:visible;';
}

/** Markdown 摘录 → 带作用域类的 HTML。样式在 `scenes/index.ts` 的 `FC_MD_CSS`。 */
function renderMarkdown(lines: string[]): string {
  const body = marked.parse(lines.join('\n'), { async: false });
  return `<div class="fc-md">${body}</div>`;
}

/**
 * 给所有 file 场景的 excerpt 预算画面 HTML（代码高亮 / Markdown 渲染）。返回场景 id → HTML。
 * 单个场景失败跳过（画面落回纯文本），不让一次失败毁掉整次渲染。
 */
export async function highlightExcerpts(script: ScriptDocument): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const scene of script.scenes) {
    if (scene.type !== 'file' || scene.excerpt === undefined || scene.excerpt.length === 0) continue;
    try {
      if (isMarkdownFile(scene.file ?? '')) {
        out[scene.id] = renderMarkdown(scene.excerpt);
        continue;
      }
      out[scene.id] = await codeToHtml(scene.excerpt.join('\n'), {
        lang: langOf(scene.file ?? ''),
        theme: 'github-dark',
        transformers: [{ pre: stripPreChrome }],
      });
    } catch {
      // 落回纯文本版式：调用方查不到这个 id 就走旧渲染
    }
  }
  return out;
}
