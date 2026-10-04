import { describe, expect, it } from 'vitest';
import { maskCode, unmaskValue } from '../mask.ts';

describe('字符串与注释屏蔽', () => {
  it('字符串替换成占位符，值按顺序留下', () => {
    const { masked, literals } = maskCode("import a from './util';\nconst b = 'x';");
    expect(literals).toEqual(['./util', 'x']);
    expect(masked).not.toContain('./util');
    expect(masked).toContain('import a from');
  });

  it('占位符能还原', () => {
    const { masked, literals } = maskCode("const a = 'hello';");
    const captured = /"([^"]+)"|'([^']+)'/.exec(masked)?.[2] ?? '';
    expect(unmaskValue(captured, literals)).toBe('hello');
    expect(unmaskValue('普通值', literals)).toBe('普通值');
  });

  it('转义引号不会提前结束字面量', () => {
    const { literals } = maskCode("const a = 'it\\'s';\nconst b = 'next';");
    expect(literals).toEqual(["it's", 'next']);
  });

  it('注释被抹掉，换行保留（行首锚点语义不变）', () => {
    const source = "// import x from './fake'\nimport y from './real';\n/* import z from './also-fake' */";
    const { masked } = maskCode(source);
    expect(masked).not.toContain('./fake');
    expect(masked).not.toContain('./also-fake');
    expect(masked.split('\n')).toHaveLength(3);
  });

  it('三引号字符串整体算一个字面量', () => {
    const { literals } = maskCode('x = """\nimport os\n"""\n');
    expect(literals).toHaveLength(1);
    expect(literals[0]).toContain('import os');
  });

  it('`#` 只在指定语言里当注释（JS 的私有字段不能吃）', () => {
    const js = maskCode('this.#cache = 1;\nimport a from "./b";');
    expect(js.masked).toContain('#cache');

    const py = maskCode("x = 1  # import os\nimport sys\n", { hashComments: true });
    expect(py.masked).not.toContain('import os');
    expect(py.masked).toContain('import sys');
  });

  it('模板字面量里的代码形状文本不泄漏', () => {
    const { masked, literals } = maskCode('const t = `import x from "./nope"`;\nimport y from "./yes";');
    // 两个字面量都被换掉，值留在 literals 里供回查
    expect(masked).not.toContain('./nope');
    expect(masked).not.toContain('./yes');
    expect(literals).toEqual(['import x from "./nope"', './yes']);
  });
});
