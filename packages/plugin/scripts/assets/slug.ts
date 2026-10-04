/**
 * 产物文件名的生成。
 *
 * 产物路径要**稳定且可读**：同一份解读重复跑，产物路径必须一样，否则讲稿里写下的
 * `asset` 路径第二次就失效了。所以 slug 只由源文件的相对路径决定，不含时间戳或随机数。
 */
import { createHash } from 'node:crypto';

/**
 * 路径里的不安全字符换成 `-`；目录分隔符换成 `_`，保住层级信息。
 *
 * **保留 Unicode 字母与数字**：中文文件名很常见（本仓库自己的文档就是中文名），
 * 只留 ASCII 会把「面试准备/自我介绍.md」压成「.md」，既看不出是什么，也容易撞名。
 */
export function slugify(relativePath: string): string {
  const replaced = relativePath
    .split('/')
    .map((segment) => segment.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, ''))
    .filter((segment) => segment !== '')
    .join('_');

  // 全是不可用字符时给个兜底，避免空文件名
  return replaced === '' ? 'file' : replaced;
}

/** slug 冲突时的短哈希（取相对路径，保证确定性）。 */
export function slugSuffix(relativePath: string): string {
  return createHash('sha1').update(relativePath).digest('hex').slice(0, 6);
}

/**
 * 生成在本次运行内唯一的 slug。
 *
 * `a/b.md` 与 `a_b.md` 会得到同一个 slug —— 必须靠后缀区分，否则两个源文件会互相覆盖产物。
 */
export function uniqueSlug(relativePath: string, taken: Set<string>): string {
  const base = slugify(relativePath);
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }

  const withSuffix = `${base}-${slugSuffix(relativePath)}`;
  taken.add(withSuffix);
  return withSuffix;
}

/** 去掉最后一个扩展名，用于只保留主名的场景。 */
export function withoutExtension(name: string): string {
  const index = name.lastIndexOf('.');
  return index <= 0 ? name : name.slice(0, index);
}
