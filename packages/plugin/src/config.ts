/**
 * 插件配置。
 *
 * **第一版不暴露任何字段**（ROADMAP「第一版的规模判据：无可配置空间」）：除了「指向哪个
 * 目录」不需要任何其他输入，所以 schema 是空的。这里先立机制，宿主据此生成设置页
 * （ADR 0009）；计划暴露的字段与时机见 INTEGRATION §11.5。
 *
 * 为什么仍然要声明它：`Config` 是宿主认识「这个插件有哪些设置」的唯一入口。第一版空着，
 * 加字段时不需要改任何机制。
 */
import z from '@deepseek-ai/schemastery';

export const Config = z.object({});
