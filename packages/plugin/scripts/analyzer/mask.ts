/**
 * 屏蔽代码里的字符串字面量与注释，只留下真正在「代码位置」上的文本。
 *
 * 为什么需要：`import` / `require` 的抽取是正则做的，而代码里到处是**作为字符串出现的
 * 代码**——测试用例、示例片段、模板、文档字符串。不屏蔽的话，`imports.test.ts` 里那句
 * `"const b = require('../lib/b');"` 会变成一条真实的坏引用。实测在真实项目上就会发生。
 *
 * 做法：把字面量替换成占位符（`"\u00000\u0000"`），并把字面量的值按顺序存下来，
 * 抽取后再回查。注释直接抹成空格，换行保留（否则会改变行首锚点的语义）。
 */

const PLACEHOLDER = '\u0000';

export type MaskedSource = {
  /** 字符串与注释被替换后的文本。 */
  masked: string;
  /** 按出现顺序记录的字面量值。 */
  literals: string[];
};

export type MaskOptions = {
  /** `#` 是否算行注释（Python / Shell / Ruby 等）。JS 里 `#` 是私有字段，不能当注释。 */
  hashComments?: boolean;
};

const TRIPLE_QUOTES = new Set(['"', "'"]);

export function maskCode(source: string, options: MaskOptions = {}): MaskedSource {
  const literals: string[] = [];
  const pieces: string[] = [];
  let index = 0;

  const blank = (from: number, to: number): void => {
    pieces.push(source.slice(from, to).replace(/[^\n]/g, ' '));
  };

  while (index < source.length) {
    const char = source[index];
    if (char === undefined) break;
    const next = source[index + 1];

    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', index);
      const stop = end === -1 ? source.length : end;
      blank(index, stop);
      index = stop;
      continue;
    }

    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(index, stop);
      index = stop;
      continue;
    }

    if (options.hashComments === true && char === '#') {
      const end = source.indexOf('\n', index);
      const stop = end === -1 ? source.length : end;
      blank(index, stop);
      index = stop;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      const triple =
        TRIPLE_QUOTES.has(char) && next === char && source[index + 2] === char;
      const quote = triple ? char.repeat(3) : char;
      let cursor = index + quote.length;
      let value = '';

      while (cursor < source.length) {
        if (source.startsWith(quote, cursor)) break;
        if (!triple && source[cursor] === '\\') {
          value += source[cursor + 1] ?? '';
          cursor += 2;
          continue;
        }
        value += source[cursor];
        cursor += 1;
      }

      literals.push(value);
      pieces.push(`${char}${PLACEHOLDER}${literals.length - 1}${PLACEHOLDER}${char}`);
      index = cursor + quote.length;
      continue;
    }

    pieces.push(char);
    index += 1;
  }

  return { masked: pieces.join(''), literals };
}

/** 把占位符还原成原来的字面量值；不是占位符就原样返回。 */
export function unmaskValue(value: string, literals: readonly string[]): string {
  if (!value.startsWith(PLACEHOLDER)) return value;
  const index = Number(value.slice(1, -1));
  return Number.isInteger(index) ? (literals[index] ?? '') : '';
}
