/**
 * 文件分类：扩展名/文件名 → kind 与语言。
 *
 * 判据是**扩展名与文件名**，不读内容 —— 分类必须对未读取内容的文件（超限、密钥）
 * 同样成立。语言只给 code / markup / data / text 四类里确实有语言的文件。
 */
import type { Kind } from '../contracts/foldercast.ts';

export type Classification = {
  kind: Kind;
  /** 有语言的才有。 */
  language?: string;
};

/** 语言名用常见写法（TypeScript 而不是 ts），与 stats.languages 的展示一致。 */
const BY_EXTENSION: Readonly<Record<string, Classification>> = {
  // ── 代码 ─────────────────────────────────────────────
  ts: { kind: 'code', language: 'TypeScript' },
  mts: { kind: 'code', language: 'TypeScript' },
  cts: { kind: 'code', language: 'TypeScript' },
  tsx: { kind: 'code', language: 'TSX' },
  js: { kind: 'code', language: 'JavaScript' },
  mjs: { kind: 'code', language: 'JavaScript' },
  cjs: { kind: 'code', language: 'JavaScript' },
  jsx: { kind: 'code', language: 'JSX' },
  py: { kind: 'code', language: 'Python' },
  pyi: { kind: 'code', language: 'Python' },
  rb: { kind: 'code', language: 'Ruby' },
  go: { kind: 'code', language: 'Go' },
  rs: { kind: 'code', language: 'Rust' },
  java: { kind: 'code', language: 'Java' },
  kt: { kind: 'code', language: 'Kotlin' },
  kts: { kind: 'code', language: 'Kotlin' },
  swift: { kind: 'code', language: 'Swift' },
  c: { kind: 'code', language: 'C' },
  h: { kind: 'code', language: 'C' },
  cc: { kind: 'code', language: 'C++' },
  cpp: { kind: 'code', language: 'C++' },
  cxx: { kind: 'code', language: 'C++' },
  hpp: { kind: 'code', language: 'C++' },
  hh: { kind: 'code', language: 'C++' },
  cs: { kind: 'code', language: 'C#' },
  php: { kind: 'code', language: 'PHP' },
  sh: { kind: 'code', language: 'Shell' },
  bash: { kind: 'code', language: 'Shell' },
  zsh: { kind: 'code', language: 'Shell' },
  fish: { kind: 'code', language: 'Shell' },
  ps1: { kind: 'code', language: 'PowerShell' },
  bat: { kind: 'code', language: 'Batch' },
  cmd: { kind: 'code', language: 'Batch' },
  lua: { kind: 'code', language: 'Lua' },
  pl: { kind: 'code', language: 'Perl' },
  pm: { kind: 'code', language: 'Perl' },
  r: { kind: 'code', language: 'R' },
  jl: { kind: 'code', language: 'Julia' },
  scala: { kind: 'code', language: 'Scala' },
  clj: { kind: 'code', language: 'Clojure' },
  cljs: { kind: 'code', language: 'Clojure' },
  ex: { kind: 'code', language: 'Elixir' },
  exs: { kind: 'code', language: 'Elixir' },
  erl: { kind: 'code', language: 'Erlang' },
  hs: { kind: 'code', language: 'Haskell' },
  ml: { kind: 'code', language: 'OCaml' },
  mli: { kind: 'code', language: 'OCaml' },
  dart: { kind: 'code', language: 'Dart' },
  vue: { kind: 'code', language: 'Vue' },
  svelte: { kind: 'code', language: 'Svelte' },
  astro: { kind: 'code', language: 'Astro' },
  sql: { kind: 'code', language: 'SQL' },
  css: { kind: 'code', language: 'CSS' },
  scss: { kind: 'code', language: 'SCSS' },
  sass: { kind: 'code', language: 'Sass' },
  less: { kind: 'code', language: 'Less' },
  styl: { kind: 'code', language: 'Stylus' },
  groovy: { kind: 'code', language: 'Groovy' },
  gradle: { kind: 'code', language: 'Groovy' },
  m: { kind: 'code', language: 'Objective-C' },
  mm: { kind: 'code', language: 'Objective-C++' },
  asm: { kind: 'code', language: 'Assembly' },
  s: { kind: 'code', language: 'Assembly' },
  f90: { kind: 'code', language: 'Fortran' },
  vb: { kind: 'code', language: 'Visual Basic' },
  proto: { kind: 'code', language: 'Protocol Buffers' },
  tf: { kind: 'code', language: 'HCL' },
  sol: { kind: 'code', language: 'Solidity' },
  zig: { kind: 'code', language: 'Zig' },
  nim: { kind: 'code', language: 'Nim' },
  ipynb: { kind: 'code', language: 'Jupyter' },

  // ── 标记 ─────────────────────────────────────────────
  html: { kind: 'markup', language: 'HTML' },
  htm: { kind: 'markup', language: 'HTML' },
  xhtml: { kind: 'markup', language: 'HTML' },
  xml: { kind: 'markup', language: 'XML' },
  xsl: { kind: 'markup', language: 'XML' },
  xslt: { kind: 'markup', language: 'XML' },
  xsd: { kind: 'markup', language: 'XML' },
  rss: { kind: 'markup', language: 'XML' },
  haml: { kind: 'markup', language: 'Haml' },
  pug: { kind: 'markup', language: 'Pug' },
  twig: { kind: 'markup', language: 'Twig' },
  jinja: { kind: 'markup', language: 'Jinja' },
  j2: { kind: 'markup', language: 'Jinja' },
  njk: { kind: 'markup', language: 'Nunjucks' },
  erb: { kind: 'markup', language: 'ERB' },

  // ── 文本 ─────────────────────────────────────────────
  md: { kind: 'text', language: 'Markdown' },
  markdown: { kind: 'text', language: 'Markdown' },
  mdx: { kind: 'text', language: 'MDX' },
  txt: { kind: 'text' },
  rst: { kind: 'text', language: 'reStructuredText' },
  adoc: { kind: 'text', language: 'AsciiDoc' },
  asciidoc: { kind: 'text', language: 'AsciiDoc' },
  org: { kind: 'text', language: 'Org' },
  tex: { kind: 'text', language: 'TeX' },
  latex: { kind: 'text', language: 'TeX' },
  bib: { kind: 'text', language: 'BibTeX' },
  log: { kind: 'text' },

  // ── 数据 ─────────────────────────────────────────────
  json: { kind: 'data', language: 'JSON' },
  jsonc: { kind: 'data', language: 'JSON' },
  json5: { kind: 'data', language: 'JSON' },
  yaml: { kind: 'data', language: 'YAML' },
  yml: { kind: 'data', language: 'YAML' },
  toml: { kind: 'data', language: 'TOML' },
  ini: { kind: 'data', language: 'INI' },
  cfg: { kind: 'data', language: 'INI' },
  conf: { kind: 'data', language: 'INI' },
  properties: { kind: 'data', language: 'Properties' },
  env: { kind: 'data', language: 'Environment' },
  csv: { kind: 'data', language: 'CSV' },
  tsv: { kind: 'data', language: 'TSV' },
  parquet: { kind: 'data', language: 'Parquet' },
  avro: { kind: 'data', language: 'Avro' },
  sqlite: { kind: 'data', language: 'SQLite' },
  sqlite3: { kind: 'data', language: 'SQLite' },
  db: { kind: 'data', language: 'SQLite' },

  // ── 办公与 PDF ───────────────────────────────────────
  doc: { kind: 'office', language: 'Word' },
  docx: { kind: 'office', language: 'Word' },
  xls: { kind: 'office', language: 'Excel' },
  xlsx: { kind: 'office', language: 'Excel' },
  xlsm: { kind: 'office', language: 'Excel' },
  ppt: { kind: 'office', language: 'PowerPoint' },
  pptx: { kind: 'office', language: 'PowerPoint' },
  odt: { kind: 'office', language: 'OpenDocument' },
  ods: { kind: 'office', language: 'OpenDocument' },
  odp: { kind: 'office', language: 'OpenDocument' },
  rtf: { kind: 'office', language: 'Rich Text' },
  pages: { kind: 'office', language: 'iWork' },
  numbers: { kind: 'office', language: 'iWork' },
  key: { kind: 'office', language: 'iWork' },
  pdf: { kind: 'pdf' },

  // ── 图片 ─────────────────────────────────────────────
  png: { kind: 'image' },
  jpg: { kind: 'image' },
  jpeg: { kind: 'image' },
  gif: { kind: 'image' },
  webp: { kind: 'image' },
  bmp: { kind: 'image' },
  tif: { kind: 'image' },
  tiff: { kind: 'image' },
  ico: { kind: 'image' },
  heic: { kind: 'image' },
  heif: { kind: 'image' },
  avif: { kind: 'image' },
  svg: { kind: 'image' },
  psd: { kind: 'image' },
  ai: { kind: 'image' },
  eps: { kind: 'image' },
  sketch: { kind: 'image' },
  fig: { kind: 'image' },
  xcf: { kind: 'image' },

  // ── 视频 ─────────────────────────────────────────────
  mp4: { kind: 'video' },
  mov: { kind: 'video' },
  mkv: { kind: 'video' },
  avi: { kind: 'video' },
  webm: { kind: 'video' },
  m4v: { kind: 'video' },
  flv: { kind: 'video' },
  wmv: { kind: 'video' },
  mpg: { kind: 'video' },
  mpeg: { kind: 'video' },
  '3gp': { kind: 'video' },

  // ── 音频 ─────────────────────────────────────────────
  mp3: { kind: 'audio' },
  wav: { kind: 'audio' },
  flac: { kind: 'audio' },
  aac: { kind: 'audio' },
  ogg: { kind: 'audio' },
  m4a: { kind: 'audio' },
  wma: { kind: 'audio' },
  opus: { kind: 'audio' },
  aiff: { kind: 'audio' },
  aif: { kind: 'audio' },
  mid: { kind: 'audio' },
  midi: { kind: 'audio' },

  // ── 压缩包 ───────────────────────────────────────────
  zip: { kind: 'archive' },
  tar: { kind: 'archive' },
  gz: { kind: 'archive' },
  tgz: { kind: 'archive' },
  bz2: { kind: 'archive' },
  xz: { kind: 'archive' },
  zst: { kind: 'archive' },
  '7z': { kind: 'archive' },
  rar: { kind: 'archive' },
  jar: { kind: 'archive' },
  war: { kind: 'archive' },
  ear: { kind: 'archive' },
  iso: { kind: 'archive' },
  dmg: { kind: 'archive' },
  cab: { kind: 'archive' },

  // ── 二进制 ───────────────────────────────────────────
  exe: { kind: 'binary' },
  dll: { kind: 'binary' },
  so: { kind: 'binary' },
  dylib: { kind: 'binary' },
  bin: { kind: 'binary' },
  o: { kind: 'binary' },
  a: { kind: 'binary' },
  lib: { kind: 'binary' },
  class: { kind: 'binary' },
  pyc: { kind: 'binary' },
  pyo: { kind: 'binary' },
  wasm: { kind: 'binary' },
  node: { kind: 'binary' },
  obj: { kind: 'binary' },
  pdb: { kind: 'binary' },
  ko: { kind: 'binary' },
};

/** 没有扩展名或扩展名不说明问题的文件，按文件名判断。 */
const BY_FILENAME: Readonly<Record<string, Classification>> = {
  makefile: { kind: 'code', language: 'Makefile' },
  'cmakelists.txt': { kind: 'code', language: 'CMake' },
  dockerfile: { kind: 'code', language: 'Dockerfile' },
  'docker-compose.yml': { kind: 'data', language: 'YAML' },
  procfile: { kind: 'text' },
  license: { kind: 'text' },
  'license.md': { kind: 'text', language: 'Markdown' },
  licence: { kind: 'text' },
  copying: { kind: 'text' },
  notice: { kind: 'text' },
  authors: { kind: 'text' },
  contributors: { kind: 'text' },
  changelog: { kind: 'text' },
  'changelog.md': { kind: 'text', language: 'Markdown' },
  '.gitignore': { kind: 'text' },
  '.gitattributes': { kind: 'text' },
  '.npmignore': { kind: 'text' },
  '.editorconfig': { kind: 'data', language: 'INI' },
  '.nvmrc': { kind: 'text' },
  '.python-version': { kind: 'text' },
  gemfile: { kind: 'code', language: 'Ruby' },
  rakefile: { kind: 'code', language: 'Ruby' },
  'go.mod': { kind: 'data', language: 'Go Module' },
  'go.sum': { kind: 'data', language: 'Go Module' },
  'cargo.toml': { kind: 'data', language: 'TOML' },
  'cargo.lock': { kind: 'data', language: 'TOML' },
  'requirements.txt': { kind: 'data', language: 'Python Requirements' },
  'pyproject.toml': { kind: 'data', language: 'TOML' },
  'package.json': { kind: 'data', language: 'JSON' },
};

/** 最后一个扩展名（小写，不含点）；没有则为空串。 */
export function extensionOf(basename: string): string {
  const index = basename.lastIndexOf('.');
  // 前导点开头的文件（.gitignore）不算有扩展名
  if (index <= 0) return '';
  return basename.slice(index + 1).toLowerCase();
}

/** 分类一个文件。先看文件名，再看扩展名，都不认识就是 other。 */
export function classify(basename: string): Classification {
  const lower = basename.toLowerCase();
  const byName = BY_FILENAME[lower];
  if (byName !== undefined) return byName;

  const extension = extensionOf(basename);
  if (extension === '') return { kind: 'other' };

  const byExtension = BY_EXTENSION[extension];
  if (byExtension !== undefined) return byExtension;

  return { kind: 'other' };
}

/** 已知扩展名的集合，供依赖解析时尝试补全。 */
export const KNOWN_EXTENSIONS: readonly string[] = Object.keys(BY_EXTENSION);

/** 语言 → 是否算「代码行」。用于 stats.languages 的取舍。 */
export function hasLanguage(classification: Classification): boolean {
  return classification.language !== undefined;
}
