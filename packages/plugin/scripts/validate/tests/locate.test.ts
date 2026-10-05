import { describe, expect, it } from 'vitest';
import { createLocator, pointerSegments, positionAt } from '../locate.ts';

const SAMPLE = `{
  "a": {
    "b": [10, 20, 30]
  },
  "c": "x"
}
`;

describe('JSON 指针解析', () => {
  it('根与嵌套路径', () => {
    expect(pointerSegments('/')).toEqual([]);
    expect(pointerSegments('')).toEqual([]);
    expect(pointerSegments('/a/b/0')).toEqual(['a', 'b', '0']);
  });

  it('转义：~1 是斜杠，~0 是波浪号', () => {
    expect(pointerSegments('/a~1b/c~0d')).toEqual(['a/b', 'c~d']);
  });
});

describe('行列换算', () => {
  it('1 起，列按字符算', () => {
    expect(positionAt(SAMPLE, 0)).toEqual({ line: 1, column: 1 });
    expect(positionAt(SAMPLE, 4)).toEqual({ line: 2, column: 3 });
  });
});

describe('定位到节点', () => {
  const locator = createLocator(SAMPLE);

  it('根对象指向第一行', () => {
    expect(locator.at('/')).toEqual({ line: 1, column: 1 });
  });

  it('嵌套字段指向值所在行', () => {
    expect(locator.at('/a/b')).toEqual({ line: 3, column: 10 });
  });

  it('数组元素能定位', () => {
    expect(locator.at('/a/b/1')).toEqual({ line: 3, column: 15 });
  });

  it('不存在的路径返回 undefined，而不是抛错', () => {
    expect(locator.at('/a/zzz')).toBeUndefined();
    expect(locator.at('/nope/deep')).toBeUndefined();
    expect(locator.at('/a/b/99')).toBeUndefined();
  });

  it('非法 JSON 也给出位置（容错解析）', () => {
    const broken = createLocator('{\n  "a": ,\n  "b": 1\n}\n');
    expect(broken.at('/')?.line).toBe(1);
  });
});
