/**
 * provider 注册表。
 *
 * 第一版只做两个（`say` 兜底 + `mimo` 云端），但**接口是可插拔的**：加一个 provider
 * 只需实现 `TtsProvider` 并在这里注册一行。多 provider 的暴露押后（ROADMAP 押后表），
 * 适配层先立起来。
 *
 * 「注册」不做能力探测：能力靠 `capabilities` 声明（rd 文档第四节第 2 条）——
 * 调用方按能力分支，而不是 try/except 撞运气。
 */
import type { TtsProvider } from '../../contracts/durations.ts';
import { mimoProvider } from './mimo.ts';
import { sayProvider } from './say.ts';

/** 默认 provider：**免密钥的那个**。装了插件不配任何东西就能出片。 */
export const DEFAULT_PROVIDER = 'say';

const PROVIDERS: readonly TtsProvider[] = [sayProvider, mimoProvider];

export function listProviders(): { name: string; requiresKey: boolean; capabilities: readonly string[]; description: string }[] {
  return PROVIDERS.map((provider) => ({
    name: provider.name,
    requiresKey: provider.requiresKey,
    capabilities: provider.capabilities,
    description: provider.describe(),
  }));
}

/**
 * 按名字取 provider。
 *
 * - `name` 给空（`undefined` 或空串）→ 默认 provider（`say`，免密钥那个）；
 * - 给了名字但没注册 → `undefined`，**调用方要报错**，不静默回落（否则用户以为在用 A、
 *   实际用了 B）。
 */
export function findProvider(name: string | undefined): TtsProvider | undefined {
  if (name === undefined || name === '') return PROVIDERS.find((provider) => provider.name === DEFAULT_PROVIDER);
  return PROVIDERS.find((provider) => provider.name === name);
}

export function providerNames(): string[] {
  return PROVIDERS.map((provider) => provider.name);
}
