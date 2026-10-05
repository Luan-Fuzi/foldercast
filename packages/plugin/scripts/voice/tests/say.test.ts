/**
 * `say` provider：解析、挑音色、语速。
 *
 * 这一层的三个判据都来自实测踩到的坑：
 *
 * 1. **音色表在 stderr 上**（`say -v '?'`），不在 stdout；
 * 2. **不指定音色时必须挑中文的** —— 系统默认是英文音色，读中文出来是一串字母音；
 * 3. **输出格式只认字节**：新系统的神经音色会写 CAF 容器里的 AAC，后缀是 `.aiff` 也没用，
 *    所以统一过一遍 ffmpeg 转 wav。
 */
import { describe, expect, it } from 'vitest';
import { parseVoiceList, pickChineseVoice, rateFromStyle } from '../providers/say.ts';

/** `say -v '?'` 的真实输出片段（音色名带空格与括号）。 */
const LISTING = `Albert              en_US    # Hello! My name is Albert.
Eddy (中文（中国大陆）)     zh_CN    # 你好！我叫Eddy。
Eddy (English (US))       en_US    # Hello! I'm Eddy.
Meijia              zh_TW    # 你好，我叫Meijia。
Tingting            zh_CN    # 你好，我叫Tingting。
Zosia               pl_PL    # Witaj! Nazywam się Zosia.
`;

describe('解析 say 的音色表', () => {
  it('音色名里的空格与括号不拆错', () => {
    const voices = parseVoiceList(LISTING);
    expect(voices).toHaveLength(6);
    expect(voices[1]).toEqual({ name: 'Eddy (中文（中国大陆）)', locale: 'zh_CN' });
    expect(voices[0]).toEqual({ name: 'Albert', locale: 'en_US' });
  });

  it('认不出的行直接跳过，不猜', () => {
    expect(parseVoiceList('garbage line\n\n===  voices  ===\n')).toEqual([]);
  });

  it('挑中文音色：优先 zh_CN，其次任何 zh', () => {
    expect(pickChineseVoice(parseVoiceList(LISTING))?.locale).toBe('zh_CN');
    expect(pickChineseVoice(parseVoiceList('Meijia  zh_TW  # 你好\n'))?.name).toBe('Meijia');
    expect(pickChineseVoice(parseVoiceList('Albert  en_US  # hi\n'))).toBeUndefined();
  });
});

describe('语速', () => {
  it('从风格描述里取数字当语速', () => {
    expect(rateFromStyle('慢一点，大概 150 字/分')).toBe(150);
    expect(rateFromStyle('read at 200 words per minute')).toBe(200);
    expect(rateFromStyle('自然、清晰')).toBeUndefined();
    expect(rateFromStyle(undefined)).toBeUndefined();
  });

  it('离谱的数字不认（免得把语速设成 5 或 9999）', () => {
    expect(rateFromStyle('语速 5')).toBeUndefined();
    expect(rateFromStyle('语速 9999')).toBeUndefined();
  });
});
