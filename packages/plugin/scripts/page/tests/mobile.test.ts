import { expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openBrowser } from '@remotion/renderer';
import { resolveBrowser } from '../../renderer/browser.ts';
import { highlightExcerpts } from '../../renderer/highlight.ts';
import { buildPlan } from '../../renderer/plan.ts';
import { collectPlanModel } from '../collect.ts';
import { renderPage } from '../render.ts';
import { styleByName } from '../styles.ts';
import { fullScript } from './fixture.ts';

const browser = resolveBrowser();
it.skipIf(browser.kind === 'missing')('窄屏长标题、对比和高亮代码不撑宽整页，代码在区块内滚动', async () => {
  if (browser.kind !== 'found') return;
  const root = mkdtempSync(join(tmpdir(), 'foldercast-mobile-'));
  const script = fullScript(root);
  script.scenes[0]!.title = 'LongUnbrokenTitle'.repeat(20);
  const code = script.scenes.find((scene) => scene.type === 'file')!;
  code.file = 'fixture.ts'; code.excerpt = ['const longValue = "' + 'long'.repeat(150) + '";'];
  const style = styleByName('瑞士风格')!;
  const plan = buildPlan({ script, style: '瑞士风格' });
  plan.highlight = await highlightExcerpts(script, false);
  const html = renderPage({ model: collectPlanModel(script, plan), style, images: new Map(), notes: [],
    scriptRef: '.foldercast/script.json', generatedAt: '2026-10-11' });
  writeFileSync(join(root, 'page.html'), html);
  const opened = await openBrowser('chrome', { browserExecutable: browser.path });
  try {
    const page = await opened.newPage({ context: () => null, logLevel: 'error', indent: false,
      pageIndex: 0, onBrowserLog: null, onLog: () => {} });
    for (const width of [320, 390, 1440]) {
      await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
      await page.goto({ url: pathToFileURL(join(root, 'page.html')).href, timeout: 30000 });
      const actual = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth,
        codeScrolls: Array.from(document.querySelectorAll('pre')).some((pre) => pre.scrollWidth > pre.clientWidth && getComputedStyle(pre).overflowX === 'auto') }));
      expect(actual.documentWidth).toBeLessThanOrEqual(width);
      if (width < 400) expect(actual.codeScrolls).toBe(true);
    }
  } finally { await opened.close({ silent: true }); rmSync(root, { recursive: true, force: true }); }
}, 60000);
