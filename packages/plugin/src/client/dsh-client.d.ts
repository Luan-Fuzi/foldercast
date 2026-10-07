/**
 * 浏览器端宿主服务的**结构桩**。
 *
 * 这些包由 DSH 的 web 端在运行时提供（`window.__ModuleLoader__` 的 require 注册表），
 * 不是本包的 npm 依赖 —— 所以没有它们的官方类型，这里只声明本插件用到的最小形状。
 * 只服务于 `src/client/index.ts` 的类型检查；运行时形状以官方 `ui-settings-shell`
 * 伴生包的编译产物为准（它是这份代码的抄写来源）。
 */

declare module '@deepseek-ai/dsh-client-ui-primitives' {
  /** 文本字段描述器：空串 = 清除（恢复默认）。 */
  export function settingsTextField(field: string): unknown;
  /** 数字字段描述器：解析不出有限数 = invalid。 */
  export function settingsNumberField(field: string): unknown;

  export interface FormShellState {
    available: boolean;
    writable: boolean;
    dirty: boolean;
    invalid: boolean;
    saving: boolean;
    failed: boolean;
  }

  export interface FormActionSet {
    edit(field: string, text: string): void;
    resetField(field: string): void;
    save(): void;
    discard(): void;
  }

  export class SettingsFormModel {
    constructor(scope: unknown, specs: unknown[], secrets?: unknown[]);
    /** 绑定一个投影，返回快照 store（slot 组件经 hooks 里的 useX 选择器读它）。 */
    bind<T>(project: () => T): { getSnapshot(): T; set(value: T): void };
    shell(): FormShellState;
    field(field: string): { text: string; overridden: boolean; invalid: boolean };
    actions(): FormActionSet;
    dispose(): void;
  }

  /** 表单框组件（labels + 状态 + 保存/放弃）。 */
  export const SettingsForm: unknown;
  /** 单字段控件（label/hint/数值/覆盖标记/重置）。 */
  export const SettingsValueField: unknown;
}

declare module '@deepseek-ai/dsh-client-ui-slots' {}
declare module '@deepseek-ai/dsh-client-ui-renderer/client' {}
declare module '@deepseek-ai/dsh-client-locale/client' {}
declare module '@deepseek-ai/dsh-client-ui-settings/client' {}
