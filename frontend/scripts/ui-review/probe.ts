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
 *              concurrency?: number, quietMs?: number, freezeTime?: string }
 * out.json:  { hits: { [storyId]: { [viewport]: string[] } }, errors: [...], durationMs }
 *
 * Per story, stopping at the first viewport where a target ran: desktop →
 * tablet → phone, each a fresh load with that viewport's touch/mobile emulation;
 * "*keyboard*" stories only get phone-short. A story whose load fails is kept
 * (every target counted as hit) so the capture shows why.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { createRequire } from 'node:module';
import type { Browser, CDPSession, Page } from 'playwright-core';
import { exercisedTargets, fileFromModuleUrl, type CoverageScript, type TargetLines } from './lib/coverage.ts';
import { VIEWPORTS, viewportsForStory, type Viewport } from './lib/viewports.ts';
import { waitForDomQuiet } from './lib/settle.ts';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core') as typeof import('playwright-core');

interface Plan {
  baseUrl: string;
  stories: string[];
  targets: Record<string, TargetLines>;
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
const targets = new Map(Object.entries(plan.targets));
const quietMs = plan.quietMs ?? 600;
// CPU-bound (React dev build + coverage instrumentation): scale with cores.
const concurrency = plan.concurrency ?? Math.min(12, Math.max(2, availableParallelism() - 2));
const sources = new Map<string, Promise<string>>();
const PROBE_ORDER = ['desktop', 'tablet', 'phone', 'phone-short'];

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

interface ProbePage {
  page: Page;
  /** Targets that ran since the previous call (V8 resets counts on every take). */
  take: () => Promise<string[]>;
  close: () => Promise<void>;
}

async function openPage(browser: Browser, vp: Viewport, storyId: string): Promise<ProbePage> {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.isMobile,
    hasTouch: vp.hasTouch,
  });
  const page = await context.newPage();
  if (plan.freezeTime) await page.clock.setFixedTime(new Date(plan.freezeTime));
  const cdp: CDPSession = await context.newCDPSession(page);
  await cdp.send('Profiler.enable');
  // detailed: false — see lib/coverage.ts for why not block coverage.
  await cdp.send('Profiler.startPreciseCoverage', { callCount: true, detailed: false });
  await page.goto(`${plan.baseUrl}/?story=${encodeURIComponent(storyId)}&mode=preview`, { waitUntil: 'networkidle', timeout: 60_000 });
  await waitForDomQuiet(page, quietMs);
  const take = async () => {
    const { result } = (await cdp.send('Profiler.takePreciseCoverage')) as unknown as { result: CoverageScript[] };
    const relevant = result.filter((s) => {
      const file = fileFromModuleUrl(s.url);
      return file !== null && targets.has(file);
    });
    const texts = new Map<string, string>();
    await Promise.all(relevant.map(async (s) => texts.set(s.url, await sourceFor(s.url))));
    return [...exercisedTargets(relevant, texts, targets)].sort();
  };
  return { page, take, close: () => context.close() };
}

async function probeStory(browser: Browser, storyId: string): Promise<Record<string, string[]>> {
  const hits: Record<string, string[]> = {};
  // Desktop first: it renders the most at once (sidebars, member list, chat).
  // Each viewport is a fresh load with that viewport's touch/mobile emulation —
  // resizing one page instead re-mounts layouts in ways a real load never does
  // (it made the probe report changes the phone capture then didn't show).
  for (const viewport of viewportsForStory(storyId, PROBE_ORDER)) {
    const p = await openPage(browser, VIEWPORTS[viewport], storyId);
    try {
      hits[viewport] = await p.take();
    } finally {
      await p.close();
    }
    if (hits[viewport].length) break;
  }
  return hits;
}

async function main() {
  const started = Date.now();
  const browser = await chromium.launch();
  const hits: Record<string, Record<string, string[]>> = {};
  const errors: { storyId: string; message: string }[] = [];
  let next = 0;
  let done = 0;

  const worker = async () => {
    while (next < plan.stories.length) {
      const storyId = plan.stories[next++];
      try {
        hits[storyId] = await probeStory(browser, storyId);
      } catch (err) {
        errors.push({ storyId, message: String((err as Error)?.message ?? err) });
        hits[storyId] = { error: [...targets.keys()].sort() };
      }
      done++;
      const seen = Object.entries(hits[storyId]).filter(([, h]) => h.length > 0);
      const secs = Math.round((Date.now() - started) / 1000);
      console.log(`[probe] ${done}/${plan.stories.length} ${secs}s ${storyId}: ${seen.length ? `renders the change (${seen[0][0]})` : '-'}`);
    }
  };
  console.log(`[probe] ${plan.stories.length} stories, ${targets.size} changed module(s), ${concurrency} in parallel`);
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, plan.stories.length)) }, worker));
  await browser.close();

  writeFileSync(outPath, JSON.stringify({ hits, errors, durationMs: Date.now() - started }, null, 2));
  const kept = Object.values(hits).filter((h) => Object.values(h).some((x) => x.length > 0)).length;
  console.log(`[probe] ${kept}/${plan.stories.length} stories render the change (${Math.round((Date.now() - started) / 1000)}s, ${errors.length} error(s))`);
}

main().catch((err) => {
  console.error('[probe] fatal:', err);
  process.exit(1);
});
