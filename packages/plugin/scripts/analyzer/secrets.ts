/**
 * 密钥类文件的判据与审计（ADR 0007）。
 *
 * **只按文件名匹配，不做内容检测** —— 判据零成本、确定、无误报，但不可能完备：
 * 硬编码在源码里的密钥、自定义命名的密钥文件都会被读到。README 与 skill 必须写明这个边界。
 *
 * 命中的文件**仍进结构树与计数**（"这里有个 .env" 本身有信息量），但内容不读：
 * 没有 lines、没有 preview、不参与依赖图、不生成素材。清单见 stats.secrets.excluded，
 * **必须打印给用户看**；用户可用 sources.rescan 把误拦的文件放回来。
 */

/** 默认判据，与 SPEC-data-format.md 的「密钥类文件名」一节逐条对应。 */
export const DEFAULT_SECRET_PATTERNS: readonly string[] = [
  '.env',
  '.env.*',
  '*.env',
  'credentials.json',
  'secrets.json',
  '.netrc',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  '*.keystore',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  '.*_key',
  '*_api_key',
  '*_token',
  '*_secret',
];

/** 文件名 glob（`*` 不跨目录分隔符）→ 正则。模式只用于文件名，不含路径。 */
function filenamePatternToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${escaped}$`, 'i');
}

const COMPILED: ReadonlyArray<{ pattern: string; regexp: RegExp }> = DEFAULT_SECRET_PATTERNS.map(
  (pattern) => ({ pattern, regexp: filenamePatternToRegExp(pattern) }),
);

export type SecretVerdict =
  | { secret: false }
  | { secret: true; match: string };

/**
 * 判定一个文件名是否命中密钥判据。
 * 只看文件名（basename），与所在目录无关。
 */
export function matchSecretFilename(basename: string): SecretVerdict {
  for (const { pattern, regexp } of COMPILED) {
    if (regexp.test(basename)) return { secret: true, match: pattern };
  }
  return { secret: false };
}
