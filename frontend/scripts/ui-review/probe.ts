/**
 * Render probe: loads each candidate story in Chromium with V8 function
 * coverage on and records which changed modules actually ran — line-precise
 * where the diff and Vite's inline source maps allow (see lib/coverage.ts).
 * Narrows "statically reachable" (nearly every story, via the shared harness)
 * to "renders the changed code".
 *
 * Runs in the ui-review `shots` container (Playwright image, `playwright-core`
 * on NODE_PATH):
 *   node scripts/ui-review/probe.ts <plan.json> <out.json>
 * plan.json: { baseUrl, stories: string[], targets: { [file]: number[] | 'all' },
 *              viewports?: string[], concurrency?: number, quietMs?: number, freezeTime?: string }
 * out.json:  { hits: { [storyId]: { [viewport]: string[] } }, errors: [...], durationMs }
 * A story stops probing at the first viewport where a target ran. A story whose
 * load fails is kept (every target counted as hit) so the capture shows why.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Browser } from 'playwright-core';
import { exercisedTargets, fileFromModuleUrl, type CoverageScript, type TargetLines } from './lib/coverage.ts';
import { VIEWPORTS, viewportsForStory } from './lib/viewports.ts';
import { waitForDomQuiet } from './lib/settle.ts';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core') as typeof import('playwright-core');

interface Plan {
  baseUrl: string;
  stories: string[];
  targets: Record<string, TargetLines>;
  viewports?: string[];
  concurrency?: number;
  quietMs?: number;
  freezeTime?: string;
}

const [planPath, outPath] = process.argv.slice(2);
if (!planPath || !outPath) {
  console.error('usage: node scripts/ui-review/probe.ts <plan.json> <out.json>');
  process.exit(2);
}
const plan: Plan = JSON.parse(readFileSync(planPath, 'utf8'));
// Desktop first: it renders the most at once (sidebars + member list + chat).
const probeViewports = plan.viewports ?? ['desktop', 'phone', 'tablet', 'phone-short'];
const targets = new Map(Object.entries(plan.targets));
const sources = new Map<string, Promise<string>>();

function sourceFor(url: string): Promise<string> {
  if (!sources.has(url)) {
    sources.set(
      url,
      fetch(url)
        .then((res) => (res.ok ? res.text() : ''))
        .catch(() => ''),
    );
  }
  return sources.get(url)!;
}

async function probeOnce(browser: Browser, storyId: string, viewportName: string): Promise<string[]> {
  const vp = VIEWPORTS[viewportName];
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.isMobile,
    hasTouch: vp.hasTouch,
  });
  try {
    const page = await context.newPage();
    if (plan.freezeTime) await page.clock.setFixedTime(new Date(plan.freezeTime));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Profiler.enable');
    // detailed: false — see lib/coverage.ts for why not block coverage.
    await cdp.send('Profiler.startPreciseCoverage', { callCount: true, detailed: false });
    await page.goto(`${plan.baseUrl}/?story=${encodeURIComponent(storyId)}&mode=preview`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });
    await waitForDomQuiet(page, plan.quietMs ?? 600);
    const { result } = (await cdp.send('Profiler.takePreciseCoverage')) as unknown as { result: CoverageScript[] };
    const relevant = result.filter((s) => {
      const file = fileFromModuleUrl(s.url);
      return file !== null && targets.has(file);
    });
    const texts = new Map<string, string>();
    await Promise.all(relevant.map(async (s) => texts.set(s.url, await sourceFor(s.url))));
    return [...exercisedTargets(relevant, texts, targets)].sort();
  } finally {
    await context.close();
  }
}

async function main() {
  const started = Date.now();
  const browser = await chromium.launch();
  const hits: Record<string, Record<string, string[]>> = {};
  const errors: { storyId: string; viewport: string; message: string }[] = [];
  let next = 0;
  let done = 0;

  const worker = async () => {
    while (next < plan.stories.length) {
      const storyId = plan.stories[next++];
      hits[storyId] = {};
      for (const viewportName of viewportsForStory(storyId, probeViewports)) {
        try {
          hits[storyId][viewportName] = await probeOnce(browser, storyId, viewportName);
        } catch (err) {
          errors.push({ storyId, viewport: viewportName, message: String((err as Error)?.message ?? err) });
          hits[storyId][viewportName] = [...targets.keys()].sort();
        }
        if (hits[storyId][viewportName].length > 0) break;
      }
      done++;
      const seen = Object.values(hits[storyId]).some((h) => h.length > 0);
      console.log(`[probe] ${done}/${plan.stories.length} ${storyId}: ${seen ? 'renders the change' : '-'}`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(plan.concurrency ?? 4, plan.stories.length)) }, worker));
  await browser.close();

  writeFileSync(outPath, JSON.stringify({ hits, errors, durationMs: Date.now() - started }, null, 2));
  const kept = Object.values(hits).filter((h) => Object.values(h).some((x) => x.length > 0)).length;
  console.log(`[probe] ${kept}/${plan.stories.length} stories render the change (${Math.round((Date.now() - started) / 1000)}s, ${errors.length} error(s))`);
}

main().catch((err) => {
  console.error('[probe] fatal:', err);
  process.exit(1);
});
