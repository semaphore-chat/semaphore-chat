/**
 * One-shot CDP actions on a running packaged app:
 *
 *   node driver.ts <action> '<json args>'     (CDP endpoint in BASELINE_CDP)
 *
 * Each action connects, does its work, prints one JSON line and exits, which
 * drops the debugger session: measurement windows run with no driver attached.
 * Node runs this directly (type stripping), so no TS-only runtime syntax.
 */
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';

const CDP = process.env.BASELINE_CDP ?? 'http://127.0.0.1:19222';

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

/** Bounded poll until the debug port answers, so we can attach during start-up. */
async function waitForPort(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${CDP}/json/version`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`no CDP endpoint at ${CDP} within ${timeoutMs} ms`);
}

/** The app's window: the first page with the bundled index.html. */
async function appPage(browser: Browser, timeoutMs = 60_000): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if (page.url().includes('index.html')) return page;
      }
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('the app window never appeared over CDP');
}

async function connect(): Promise<{ browser: Browser; page: Page }> {
  await waitForPort(60_000);
  const browser = await chromium.connectOverCDP(CDP);
  return { browser, page: await appPage(browser) };
}

const composer = (page: Page) => page.getByPlaceholder(/message/i).first();

async function waitInteractive(page: Page, timeout = 60_000): Promise<void> {
  await composer(page).waitFor({ state: 'visible', timeout });
  await page.locator('[data-message-id]').first().waitFor({ state: 'attached', timeout });
  const deadline = Date.now() + timeout;
  while (!(await composer(page).isEditable())) {
    assert(Date.now() < deadline, 'composer never became editable');
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Sequence number (#<seq> prefix from the seed) of the top-most visible message. */
const READ_LIST_STATE = () => {
  const items = Array.from(document.querySelectorAll<HTMLElement>('[data-message-id]'));
  const visible = items.filter((el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight && r.height > 0;
  });
  const seqs = visible
    .map((el) => /#(\d{1,7})\b/.exec(el.textContent ?? ''))
    .filter(Boolean)
    .map((m) => Number((m as RegExpExecArray)[1]));
  return {
    rendered: items.length,
    visible: visible.length,
    top_seq: seqs.length ? Math.min(...seqs) : null,
    bottom_seq: seqs.length ? Math.max(...seqs) : null,
  };
};

/** Installed before LiveKit creates its connections: keeps them reachable for getStats. */
const STATS_HOOK = () => {
  const w = window as unknown as { __baselinePcs?: RTCPeerConnection[]; RTCPeerConnection: typeof RTCPeerConnection };
  if (w.__baselinePcs) return;
  const pcs: RTCPeerConnection[] = [];
  w.__baselinePcs = pcs;
  const Native = w.RTCPeerConnection;
  w.RTCPeerConnection = class extends Native {
    constructor(...args: ConstructorParameters<typeof RTCPeerConnection>) {
      super(...args);
      pcs.push(this);
    }
  } as typeof RTCPeerConnection;
};

const READ_STATS = async () => {
  const pcs = (window as unknown as { __baselinePcs?: RTCPeerConnection[] }).__baselinePcs ?? [];
  const video: unknown[] = [];
  const audio: unknown[] = [];
  let outboundAudioBytes = 0;
  let codecs: Record<string, string> = {};
  for (const pc of pcs) {
    if (pc.connectionState === 'closed') continue;
    const report = await pc.getStats();
    codecs = {};
    report.forEach((s: Record<string, unknown>) => {
      if (s.type === 'codec') codecs[String(s.id)] = String(s.mimeType);
    });
    report.forEach((s: Record<string, unknown>) => {
      if (s.type === 'inbound-rtp' && s.kind === 'video') {
        video.push({
          id: s.trackIdentifier, width: s.frameWidth ?? null, height: s.frameHeight ?? null,
          frames_received: s.framesReceived ?? null, frames_decoded: s.framesDecoded ?? 0, frames_dropped: s.framesDropped ?? 0,
          bytes: s.bytesReceived ?? 0, codec: codecs[String(s.codecId)] ?? null,
          decoder: s.decoderImplementation ?? null, ts: s.timestamp,
        });
      } else if (s.type === 'inbound-rtp' && s.kind === 'audio') {
        audio.push({ id: s.trackIdentifier, bytes: s.bytesReceived ?? 0, energy: s.totalAudioEnergy ?? 0, ts: s.timestamp });
      } else if (s.type === 'outbound-rtp' && s.kind === 'audio') {
        outboundAudioBytes += Number(s.bytesSent ?? 0);
      }
    });
  }
  return { connections: pcs.length, video, audio, outbound_audio_bytes: outboundAudioBytes };
};

type Args = Record<string, unknown>;
const actions: Record<string, (args: Args) => Promise<unknown>> = {
  /** Printed before connecting so the orchestrator can spawn the app only once we're listening. */
  async 'wait-interactive'() {
    console.error('READY');
    const { page } = await connect();
    const attached = Date.now();
    await waitInteractive(page);
    const interactive = Date.now();
    const paint = await page.evaluate(() => ({
      time_origin: performance.timeOrigin,
      paints: performance.getEntriesByType('paint').map((e) => [e.name, e.startTime]),
    }));
    return { attached_wall_ms: attached, interactive_wall_ms: interactive, ...paint };
  },

  /** First run on an empty profile: connection wizard, password login, open #general. */
  async login(args) {
    const { page } = await connect();
    await page.getByRole('button', { name: /get started|next/i }).first().click({ timeout: 30_000 });
    await page.getByLabel('Server URL').fill(String(args.server));
    await page.getByRole('button', { name: /next|connect/i }).last().click();
    await page.getByRole('button', { name: /finish|continue|done|sign in with password/i }).click({ timeout: 20_000 });
    await page.getByLabel('Username').fill(String(args.username), { timeout: 20_000 });
    await page.getByLabel('Password').fill(String(args.password));
    await page.locator('button[type="submit"]').click();
    await page.waitForFunction(() => !location.hash.includes('/login'), undefined, { timeout: 30_000 });
    await page.evaluate(([c, ch]) => { location.hash = `#/community/${c}/channel/${ch}`; }, [args.community, args.channel]);
    await waitInteractive(page);
    return { hash: await page.evaluate(() => location.hash) };
  },

  async state() {
    const { browser, page } = await connect();
    const dom = await page.evaluate(READ_LIST_STATE);
    const win = await page.evaluate(() => ({
      inner_width: innerWidth, inner_height: innerHeight, device_pixel_ratio: devicePixelRatio,
      hash: location.hash, user_agent: navigator.userAgent,
    }));
    return { ...dom, ...win, browser_version: browser.version() };
  },

  /** GPU process facts, from the browser-level CDP target (no WebGL context in the app's page). */
  async gpu() {
    const { browser } = await connect();
    const session = await browser.newBrowserCDPSession();
    const info = (await session.send('SystemInfo.getInfo')) as unknown as {
      gpu: { devices: unknown[]; driverBugWorkarounds: string[]; featureStatus: Record<string, string>; auxAttributes: Record<string, unknown> };
    };
    const aux = info.gpu.auxAttributes ?? {};
    return {
      devices: info.gpu.devices,
      feature_status: info.gpu.featureStatus,
      gl_renderer: aux.glRenderer ?? null,
      gl_implementation: aux.glImplementationParts ?? aux.glImplementation ?? null,
      software_rendering: aux.softwareRendering ?? null,
    };
  },

  /** Reloads so the hook is in place before LiveKit makes its connections. */
  async 'install-stats-hook'() {
    const { browser, page } = await connect();
    await browser.contexts()[0].addInitScript(STATS_HOOK);
    await page.reload();
    await waitInteractive(page);
    return { installed: await page.evaluate(() => Array.isArray((window as unknown as { __baselinePcs?: unknown }).__baselinePcs)) };
  },

  /** Joining is a click on the voice channel in the sidebar. */
  async 'join-voice'(args) {
    const { page } = await connect();
    await page.getByText(String(args.channel), { exact: true }).first().click({ timeout: 30_000 });
    await page.getByLabel('Share screen').first().waitFor({ timeout: 30_000 });
    return { joined: String(args.channel) };
  },

  /** Video is opt-in (autoSubscribe: false): click every "Watch ..." tile until `expect` are on. */
  async 'watch-all'(args) {
    const { page } = await connect();
    const expected = Number(args.expect);
    const deadline = Date.now() + 90_000;
    let clicked = 0;
    let seen = 0;
    while (Date.now() < deadline && clicked < expected) {
      const tiles = page.getByRole('button', { name: /^Watch .* (camera|screen share)$/ });
      seen = await tiles.count();
      if (seen === 0) {
        // The panel opens by itself for a screen share; before that, ask for it.
        const open = page.getByRole('button', { name: /open call view|show video tiles/i }).first();
        if (await open.isVisible().catch(() => false)) await open.click().catch(() => {});
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }
      await tiles.first().click({ timeout: 10_000 });
      clicked += 1;
    }
    assert(clicked >= expected, `only ${clicked}/${expected} tiles could be watched (${seen} left on screen)`);
    return { clicked };
  },

  async screenshot(args) {
    const { page } = await connect();
    await page.screenshot({ path: String(args.path) });
    return { path: args.path, hash: await page.evaluate(() => location.hash) };
  },

  async stats() {
    const { page } = await connect();
    return page.evaluate(READ_STATS);
  },

  /** Wayland fallback for xdotool: wheel events over CDP, so the driver stays attached. */
  async wheel(args) {
    const { page } = await connect();
    await page.mouse.move(Number(args.x), Number(args.y));
    const notches = Number(args.notches);
    const gap = Number(args.delay_ms);
    const start = Date.now();
    for (let i = 0; i < notches; i += 1) {
      await page.mouse.wheel(0, -100);
      const due = start + (i + 1) * gap;
      const wait = due - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
    return { notches };
  },
};

async function main() {
  const [name, raw] = process.argv.slice(2);
  const action = actions[name];
  assert(action, `unknown action ${name}; one of ${Object.keys(actions).join(', ')}`);
  const result = await action(raw ? (JSON.parse(raw) as Args) : {});
  console.log(JSON.stringify(result));
  // Not browser.close(): exiting just drops the debugger session.
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
