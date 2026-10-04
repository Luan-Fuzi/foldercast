/**
 * 内容读取与预览提取。
 *
 * 原则：
 * - **单文件超过 `maxFileSizeMb` 就不读内容**（仍进结构树与计数，SPEC-data-format.md）。
 * - 读到的文本同时供依赖提取使用，避免同一次分析读两遍文件。
 * - 媒体类只读文件头拿尺寸；office / pdf / video 的深化提取属于 M2（`dsoffice`、
 *   `officeparser`、`ffprobe`），M1 不引入这些依赖，预览留空而不是编一个。
 */
import { openSync, readSync, closeSync, readFileSync, statSync } from 'node:fs';
import { type Classification, extensionOf } from './classify.ts';

/** 预览长度上限，与 schema 的 maxLength: 200 一致。 */
export const PREVIEW_MAX_LENGTH = 200;

/** 图片只读头部这些字节就够判断尺寸。 */
const IMAGE_HEADER_BYTES = 64 * 1024;

export type ContentInsight = {
  /** 行数。二进制类为 undefined。 */
  lines?: number;
  /** 供依赖提取用的文本（只在文本类文件上有）。 */
  text?: string;
  title?: string;
  preview?: string;
  /** 内容是否因为超过体积上限而没有读。 */
  skippedForSize: boolean;
};

const TEXT_KINDS = new Set(['code', 'markup', 'data', 'text']);

/** 统计行数：末尾有换行就不多算一行空行。 */
export function countLines(text: string): number {
  if (text === '') return 0;
  let lines = 0;
  for (const character of text) if (character === '\n') lines += 1;
  return text.endsWith('\n') ? lines : lines + 1;
}

/** 压成一行并截断，去掉多余空白。 */
function condense(text: string, limit = PREVIEW_MAX_LENGTH): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
}

/** C 预处理指令长得像行注释，先排除掉。 */
const PREPROCESSOR = /^#\s*(?:include|define|if|ifdef|ifndef|else|elif|endif|pragma|undef|error|line)\b/;

/** 取首个块注释、或开头的连续行注释，失败则取前若干非空行。 */
function codePreview(text: string): string | undefined {
  const source = text.replace(/^#!.*\n/, '');
  const block = /\/\*[\s\S]*?\*\//.exec(source) ?? /"""[\s\S]*?"""/.exec(source) ?? /'''[\s\S]*?'''/.exec(source);
  if (block !== null) {
    const body = block[0]
      .replace(/^\/\*+|"""|'''|\*\/$/g, '')
      .split('\n')
      .map((line) => line.replace(/^\s*\*?\s?/, '').trim())
      .filter((line) => line !== '');
    if (body.length > 0) return condense(body.join(' '));
  }

  // 开头的连续行注释：源码里这是信息量最高的位置（文件用途、作者、版权）
  const commentLines: string[] = [];
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (line === '') {
      if (commentLines.length > 0) break;
      continue;
    }
    if (PREPROCESSOR.test(line)) break;
    const match = /^(?:\/\/|#|--|<!--|\*)\s?(.*)$/.exec(line);
    if (match === null) break;
    commentLines.push((match[1] ?? '').replace(/-->$/, '').trim());
  }
  if (commentLines.length > 0 && commentLines.some((line) => line !== '')) {
    return condense(commentLines.join(' '));
  }

  const lines = source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('//') && !line.startsWith('#'));
  return lines.length > 0 ? condense(lines.slice(0, 10).join(' ')) : undefined;
}

/** 首个 Markdown 标题，以及它之后的第一段。 */
function markdownTitleAndPreview(text: string): { title?: string; preview?: string } {
  const lines = text.split('\n');
  let title: string | undefined;
  const paragraph: string[] = [];

  for (const line of lines) {
    const heading = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (heading !== null) {
      if (title === undefined) {
        title = heading[1];
        continue;
      }
      break; // 第二个标题起就不再进预览
    }
    if (title === undefined) continue;
    if (line.trim() === '') {
      if (paragraph.length > 0) break;
      continue;
    }
    paragraph.push(line.trim());
  }

  const preview = paragraph.length > 0 ? condense(paragraph.join(' ')) : title;
  return { title, preview };
}

/** JSON 顶层键、CSV 表头与行数、YAML/TOML/INI 的前几个键。 */
function dataPreview(text: string, extension: string): string | undefined {
  if (extension === 'json' || extension === 'jsonc' || extension === 'json5') {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const keys = Object.keys(parsed);
        return condense(`{${keys.slice(0, 12).join(', ')}}`);
      }
      if (Array.isArray(parsed)) return `[${parsed.length} 项]`;
    } catch {
      return undefined;
    }
    return undefined;
  }

  const lines = text.split('\n');
  if (extension === 'csv' || extension === 'tsv') {
    const header = lines[0]?.trim();
    if (header === undefined || header === '') return undefined;
    const rows = lines.filter((line) => line.trim() !== '').length - 1;
    return condense(`${header} —— ${rows} 行数据`);
  }

  const keys: string[] = [];
  for (const line of lines) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const match = /^([A-Za-z_][\w.-]*)\s*[:=]/.exec(line);
    if (match?.[1] !== undefined) keys.push(match[1]);
    if (keys.length >= 10) break;
  }
  return keys.length > 0 ? condense(keys.join(', ')) : undefined;
}

/** HTML 的 <title>，退回首行。 */
function markupPreview(text: string): string | undefined {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text);
  if (title?.[1] !== undefined && title[1].trim() !== '') return condense(title[1]);
  const first = text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '' && !line.startsWith('<!--'));
  return first === undefined ? undefined : condense(first);
}

// ── 图片尺寸 ───────────────────────────────────────────

export type ImageSize = { width: number; height: number };

function pngSize(buffer: Buffer): ImageSize | undefined {
  if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47) return undefined;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function gifSize(buffer: Buffer): ImageSize | undefined {
  if (buffer.length < 10 || buffer.toString('ascii', 0, 3) !== 'GIF') return undefined;
  return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
}

function bmpSize(buffer: Buffer): ImageSize | undefined {
  if (buffer.length < 26 || buffer.toString('ascii', 0, 2) !== 'BM') return undefined;
  return { width: Math.abs(buffer.readInt32LE(18)), height: Math.abs(buffer.readInt32LE(22)) };
}

function jpegSize(buffer: Buffer): ImageSize | undefined {
  if (buffer.length < 4 || buffer.readUInt16BE(0) !== 0xffd8) return undefined;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1] ?? 0;
    // SOF0..SOF3 / SOF5..SOF7 / SOF9..SOF11 / SOF13..SOF15
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    const length = buffer.readUInt16BE(offset + 2);
    if (isStartOfFrame) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return undefined;
}

function webpSize(buffer: Buffer): ImageSize | undefined {
  if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF') return undefined;
  const format = buffer.toString('ascii', 8, 12);
  if (format === 'VP8X') {
    const width = 1 + (buffer.readUIntLE(24, 3) & 0xffffff);
    const height = 1 + (buffer.readUIntLE(27, 3) & 0xffffff);
    return { width, height };
  }
  if (format === 'VP8L') {
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (format === 'VP8 ') {
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  return undefined;
}

/** 从文件头读出图片尺寸。不认识的格式返回 undefined，不猜。 */
export function readImageSize(absolute: string): ImageSize | undefined {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(absolute, 'r');
    const buffer = Buffer.alloc(IMAGE_HEADER_BYTES);
    const read = readSync(descriptor, buffer, 0, IMAGE_HEADER_BYTES, 0);
    const header = buffer.subarray(0, read);
    return pngSize(header) ?? jpegSize(header) ?? gifSize(header) ?? bmpSize(header) ?? webpSize(header);
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

/**
 * 读取一个文件并产出 insight。
 *
 * `maxBytes` 来自 `sources.maxFileSizeMb`：超过就只拿体积，不读内容。
 */
export function inspectFile(
  absolute: string,
  classification: Classification,
  maxBytes: number,
): ContentInsight {
  let size: number;
  try {
    size = statSync(absolute).size;
  } catch {
    return { skippedForSize: false };
  }

  if (size > maxBytes) return { skippedForSize: true };

  if (classification.kind === 'image') {
    const dimensions = readImageSize(absolute);
    const preview = dimensions === undefined ? undefined : `${dimensions.width}×${dimensions.height}`;
    return { preview, skippedForSize: false };
  }

  if (!TEXT_KINDS.has(classification.kind)) return { skippedForSize: false };

  let text: string;
  try {
    text = readFileSync(absolute, 'utf8');
  } catch {
    return { skippedForSize: false };
  }

  const lines = countLines(text);
  const extension = extensionOf(absolute.split('/').at(-1) ?? absolute);

  if (classification.kind === 'text') {
    const { title, preview } = markdownTitleAndPreview(text);
    return { lines, text, title, preview: preview ?? condense(text), skippedForSize: false };
  }

  if (classification.kind === 'code') {
    const preview = codePreview(text);
    const firstComment = /^\s*(?:\/\/|#|--)\s*(.+)$/m.exec(text);
    return { lines, text, title: firstComment?.[1]?.trim(), preview, skippedForSize: false };
  }

  if (classification.kind === 'markup') {
    return { lines, text, preview: markupPreview(text), skippedForSize: false };
  }

  return { lines, text, preview: dataPreview(text, extension), skippedForSize: false };
}
