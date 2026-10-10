/** 嵌套配置投影。缺失的用户字段必须保持键缺失，不能用 undefined 冒充覆盖。 */
export function projectFields(
  layer: Record<string, unknown> | undefined,
  fields: readonly { key: string; path: readonly string[] }[],
  user = false,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    let current: unknown = layer;
    let present = true;
    for (const segment of field.path) {
      if (current === null || typeof current !== 'object' || !Object.hasOwn(current, segment)) {
        present = false;
        break;
      }
      current = (current as Record<string, unknown>)[segment];
    }
    if (!user) out[field.key] = present ? current : undefined;
    else if (present) out[field.key] = true;
  }
  return out;
}

/** 音色留空表示当前引擎的默认值，必须覆盖继承音色；只有 resetField 才恢复继承。 */
export function settingsVoiceField(field: string) {
  return {
    field,
    format: (value: unknown): string => typeof value === 'string' ? value : '',
    parse: (text: string) => ({ kind: 'set' as const, value: text.trim() }),
  };
}
