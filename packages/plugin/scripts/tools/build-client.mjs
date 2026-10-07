#!/usr/bin/env node
/**
 * 把浏览器半侧（src/client/index.ts）打成 DSH web 端认的模块格式。
 *
 * 产物 `lib/client.js` 的形状照官方伴生包（ui-settings-shell）：
 *
 * ```js
 * window.__ModuleLoader__.load({ id: "<包名>", factory: (require) => { …
 *     return module.exports; } });
 * ```
 *
 * react 与 `@deepseek-ai/dsh-client-ui-*` 由宿主页面提供（factory 的 `require`），
 * 全部标 external —— 所以它们**不是**本包的 npm 依赖，装到哪台机器上都从宿主解析。
 *
 * 用法：node scripts/tools/build-client.mjs（prepack 的一部分；需要 esbuild）。
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

await build({
  entryPoints: [join(ROOT, 'src/client/index.ts')],
  outfile: join(ROOT, 'lib/client.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  // 宿主注册表解析这些模块；cjs 格式下 external 的 import 保留为 require() 调用
  external: ['react', 'react/jsx-runtime', '@deepseek-ai/*'],
  banner: {
    js: [
      'window.__ModuleLoader__.load({',
      '  id: "dsh-foldercast",',
      '  factory: (require) => {',
      '    var module = { exports: {} };',
      '    var exports = module.exports;',
    ].join('\n'),
  },
  footer: {
    js: ['    return module.exports;', '  }', '});'].join('\n'),
  },
  minify: false,
  sourcemap: false,
  logLevel: 'info',
});
