/**
 * 读出 Office / PDF 的文本内容，打到 stdout —— 给 agent 通读用的。
 *
 * 用法：node …/assets/text.ts <文件> [--meta]
 *
 * `--meta` 时输出 JSON（标题 / 大纲 / 工作表 / 页数等摘要），否则输出 Markdown 正文。
 * 页数只有 dsoffice 在的时候才转得出（要起引擎渲染一遍）；文本提取不需要它。
 */
import { resolve } from 'node:path';
import { extractOfficeText } from './office.ts';

async function main(): Promise<number> {
  const args = process.argv.slice(2).filter((arg) => arg !== '');
  const meta = args.includes('--meta');
  const file = args.find((arg) => !arg.startsWith('-'));
  if (file === undefined) {
    console.error('用法：node …/assets/text.ts <文件> [--meta]');
    return 2;
  }

  try {
    const extracted = await extractOfficeText(resolve(file));
    if (meta) {
      console.log(
        JSON.stringify(
          {
            file,
            outline: extracted.outline,
            sheetNames: extracted.sheetNames,
            slideTitles: extracted.slideTitles,
            tableCount: extracted.tableCount,
            markdownChars: [...extracted.markdown].length,
          },
          null,
          2,
        ),
      );
    } else if (extracted.markdown.trim() === '') {
      console.error('（这个文件里提不出文本：可能是扫描版 PDF，没有文本层。）');
      return 0;
    } else {
      console.log(extracted.markdown);
    }
    return 0;
  } catch (error) {
    console.error(`提不出内容：${(error as Error).message}`);
    return 2;
  }
}

const code = await main();
process.exitCode = code;
