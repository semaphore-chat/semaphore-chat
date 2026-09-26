/**
 * Smoke checks for the packaged Electron app, driven by Playwright's Electron
 * driver. Runs inside the electron-smoke container (see run.sh / README.md):
 * the app is mounted at /app, results go to /out, SERVER_URL is the backend.
 *
 * Node runs this file directly (type stripping), so: no TS-only runtime
 * syntax (enums, parameter properties, namespaces).
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { _electron as electron } from 'playwright-core';
import type { ElectronApplication, Page } from 'playwright-core';

const APP = process.env.SMOKE_APP ?? '/app/semaphore-chat';
const OUT = process.env.SMOKE_OUT ?? '/out';
const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:3000';
const KEYRING = process.env.SMOKE_KEYRING !== 'false';
// The seeded e2e user (backend/prisma/seed-e2e.ts).
const USER = { username: 'testuser', password: 'Test123!@#' };

// --no-sandbox: Chromium's sandbox needs the SUID chrome-sandbox helper or
// unprivileged user namespaces, neither of which the container has (the same
// reason CI's smoke steps pass it). --use-fake-device-for-media-stream gives
// the voice check a microphone/camera. NOT --use-fake-ui-for-media-stream:
// that auto-grants getDisplayMedia inside Chromium and so bypasses main.ts's
// permission and display-media handlers, which are what this checks.
const LAUNCH_ARGS = ['--no-sandbox', '--use-fake-device-for-media-stream'];

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}
const checks: Check[] = [];
const results: Record<string, unknown> = { keyring: KEYRING, checks };

mkdirSync(OUT, { recursive: true });

function record(name: string, ok: boolean, detail?: string) {
  checks.push({ name, ok, ...(detail ? { detail } : {}) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

/** Run one check; a thrown error fails it (with the message) without aborting the run. */
async function check(name: string, fn: () => Promise<string | void>): Promise<boolean> {
  try {
    const detail = await fn();
    record(name, true, detail || undefined);
    return true;
  } catch (err) {
    record(name, false, err instanceof Error ? err.message.split('\n')[0] : String(err));
    return false;
  }
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ logs

const mainLog: string[] = [];
const rendererErrors: string[] = [];

async function launch(label: string): Promise<{ app: ElectronApplication; win: Page }> {
  const logFile = `${OUT}/main-${label}.log`;
  const consoleFile = `${OUT}/renderer-${label}.log`;
  const app = await electron.launch({
    executablePath: APP,
    args: LAUNCH_ARGS,
    env: { ...process.env } as Record<string, string>,
    timeout: 60_000,
  });
  const onData = (stream: string) => (data: Buffer) => {
    const text = data.toString();
    appendFileSync(logFile, text);
    for (const line of text.split('\n')) if (line.trim()) mainLog.push(`[${label}:${stream}] ${line}`);
  };
  app.process().stdout?.on('data', onData('out'));
  app.process().stderr?.on('data', onData('err'));
  const win = await app.firstWindow();
  win.on('console', (msg) => {
    appendFileSync(consoleFile, `[${msg.type()}] ${msg.text()}\n`);
    if (msg.type() === 'error') rendererErrors.push(`[${label}] ${msg.text()}`);
  });
  win.on('pageerror', (err) => {
    appendFileSync(consoleFile, `[pageerror] ${err.message}\n`);
    rendererErrors.push(`[${label}] pageerror: ${err.message}`);
  });
  await win.waitForLoadState('domcontentloaded');
  return { app, win };
}

async function shot(win: Page, name: string) {
  await win.screenshot({ path: `${OUT}/${name}.png` }).catch(() => {});
}

// ------------------------------------------------------------------ API

interface Channel { id: string; name: string; type: string }
async function api<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const res = await fetch(`${SERVER_URL}/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

// ------------------------------------------------------------------ run

async function main() {
  const { accessToken } = await api<{ accessToken: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(USER),
  });
  const communities = await api<{ id: string; name: string }[]>('/community/mine', { token: accessToken });
  const community = communities.find((c) => c.name === 'Test Community');
  assert(community, 'seeded "Test Community" not found');
  const channels = await api<Channel[]>(`/channels/community/${community.id}`, { token: accessToken });
  const byName = (n: string) => {
    const c = channels.find((ch) => ch.name === n);
    assert(c, `seeded channel ${n} not found`);
    return c;
  };
  const general = byName('general');
  const random = byName('random');
  const voice = byName('voice-chat');

  // ---------------------------------------------------------- first launch
  let { app, win } = await launch('first');

  const versions = await app.evaluate(() => ({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    v8: process.versions.v8,
  }));
  results.versions = versions;
  console.log('versions', versions);

  await check('main window loads index.html from the app bundle', async () => {
    const url = win.url();
    assert(url.startsWith('file://') && url.includes('/dist/index.html'), `unexpected URL ${url}`);
    await win.waitForSelector('#root > *', { state: 'attached', timeout: 20_000 });
    return url.replace(/^.*\/resources\//, 'resources/');
  });

  await check('preload bridge exposed (isElectron), no Node globals in the renderer', async () => {
    const r = await win.evaluate(() => {
      const w = window as unknown as Record<string, unknown> & { electronAPI?: Record<string, unknown> };
      return {
        isElectron: w.electronAPI?.isElectron,
        platform: w.electronAPI?.platform,
        bridgeKeys: w.electronAPI ? Object.keys(w.electronAPI).length : 0,
        require: typeof w.require,
        process: typeof w.process,
        module: typeof w.module,
      };
    });
    assert(r.isElectron === true, `electronAPI.isElectron = ${String(r.isElectron)}`);
    assert(r.require === 'undefined' && r.process === 'undefined' && r.module === 'undefined',
      `Node globals leaked: require=${r.require} process=${r.process} module=${r.module}`);
    return `platform=${String(r.platform)}, ${r.bridgeKeys} bridge members`;
  });

  await check('webPreferences: contextIsolation, sandbox on, nodeIntegration off', async () => {
    const prefs = await app.evaluate(({ BrowserWindow }) => {
      // Undocumented (and untyped) but long-standing: the preferences the
      // renderer was actually created with.
      const wc = BrowserWindow.getAllWindows()[0].webContents as unknown as {
        getLastWebPreferences(): { contextIsolation?: boolean; sandbox?: boolean; nodeIntegration?: boolean } | null;
      };
      const p = wc.getLastWebPreferences();
      return p ? { contextIsolation: p.contextIsolation, sandbox: p.sandbox, nodeIntegration: p.nodeIntegration } : null;
    });
    assert(prefs, 'no web preferences');
    assert(prefs.contextIsolation === true && prefs.sandbox === true && prefs.nodeIntegration === false,
      JSON.stringify(prefs));
    return JSON.stringify(prefs);
  });

  // ---------------------------------------------------------- wizard + login
  await check('connection wizard: add the server', async () => {
    await win.getByRole('button', { name: /get started|next/i }).first().click({ timeout: 20_000 });
    await win.getByLabel('Server URL').fill(SERVER_URL);
    await win.getByRole('button', { name: /next|connect/i }).last().click();
    await win.getByRole('button', { name: /finish|continue|done/i }).click({ timeout: 20_000 });
    await shot(win, '01-after-wizard');
  });

  // The one-time "secure storage unavailable" toast (SecureStorageWarning)
  // appears right after sign-in when safeStorage can't encrypt: watch for it
  // from before the login on, it hides itself after a few seconds.
  let secureStorageWarning: Promise<boolean> = Promise.resolve(false);
  await check('login through the UI', async () => {
    await win.getByLabel('Username').fill(USER.username, { timeout: 20_000 });
    secureStorageWarning = win.getByText(/secure credential storage is unavailable/i).first()
      .waitFor({ timeout: 20_000 }).then(() => true, () => false);
    await win.getByLabel('Password').fill(USER.password);
    await win.locator('button[type="submit"]').click();
    await win.waitForFunction(() => !location.hash.includes('/login'), undefined, { timeout: 20_000 });
    await shot(win, '02-after-login');
    return win.url().replace(/^.*#/, '#');
  });

  await check('community + text channel render', async () => {
    await win.evaluate(([c, ch]) => { location.hash = `#/community/${c}/channel/${ch}`; }, [community.id, general.id]);
    await win.getByPlaceholder(/message/i).first().waitFor({ timeout: 20_000 });
    await win.getByText('general').first().waitFor();
    await shot(win, '03-channel');
  });

  const text = `electron smoke ${versions.electron} ${Date.now()}`;
  await check('send a message (UI) and the server stores it', async () => {
    const input = win.getByPlaceholder(/message/i).first();
    await input.click();
    await input.fill(text);
    await input.press('Enter');
    await win.getByText(text).first().waitFor({ timeout: 15_000 });
    const page = await api<{ messages?: { spans?: { text?: string }[] }[] }>(
      `/messages/channel/${general.id}?limit=20`, { token: accessToken });
    const found = JSON.stringify(page).includes(text);
    assert(found, 'message rendered but not found through the API');
    await shot(win, '04-message-sent');
  });

  // ---------------------------------------------------------- safeStorage
  const storage = await app.evaluate(({ safeStorage }) => ({
    available: safeStorage.isEncryptionAvailable(),
    backend: process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : 'n/a',
  }));
  results.safeStorage = storage;
  await check(`safeStorage: refresh token persisted (available=${storage.available}, backend ${storage.backend})`, async () => {
    // Let the post-login persist finish.
    await sleep(1000);
    const onDisk = await app.evaluate(({ app: a }) => {
      const fs = process.getBuiltinModule('fs');
      const p = process.getBuiltinModule('path').join(a.getPath('userData'), 'secure-tokens', 'refreshToken');
      return fs.existsSync(p) ? fs.readFileSync(p).length : -1;
    });
    const inLocalStorage = await win.evaluate(() => localStorage.getItem('refreshToken') !== null);
    if (storage.available) {
      assert(onDisk > 0, 'safeStorage available but no secure-tokens/refreshToken file');
      assert(!inLocalStorage, 'refresh token ALSO in localStorage');
      return `${onDisk}-byte encrypted file, not in localStorage`;
    }
    assert(inLocalStorage, 'safeStorage unavailable and no localStorage fallback');
    return 'safeStorage unavailable: fell back to localStorage';
  });

  await check(`SecureStorageWarning ${storage.available ? 'not shown (safeStorage available)' : 'shown (safeStorage unavailable)'}`, async () => {
    const shown = await secureStorageWarning;
    assert(shown === !storage.available, `warning ${shown ? 'shown' : 'not shown'}`);
  });

  // ---------------------------------------------------------- clipboard (Electron 44: async API)
  await check('clipboard: writeClipboard bridge -> main clipboard.writeText', async () => {
    const value = `smoke-clip-${Date.now()}`;
    await win.evaluate((v) => {
      (window as unknown as { electronAPI: { writeClipboard: (t: string) => void } }).electronAPI.writeClipboard(v);
    }, value);
    await sleep(300);
    // `await` works for both the sync (<= 43) and async (44+) readText.
    const read = await app.evaluate(async ({ clipboard }) => await clipboard.readText());
    assert(read === value, `clipboard has ${JSON.stringify(read)}`);
  });

  // ---------------------------------------------------------- desktopCapturer
  await check('desktopCapturer.getSources via the bridge returns sources with thumbnails', async () => {
    const sources = await win.evaluate(async () => {
      const api = (window as unknown as { electronAPI: { getDesktopSources: (t: string[]) => Promise<{ id: string; name: string; thumbnail: string }[]> } }).electronAPI;
      const s = await api.getDesktopSources(['screen', 'window']);
      return s.map((x) => ({ id: x.id, name: x.name, thumb: x.thumbnail.slice(0, 22), thumbLen: x.thumbnail.length }));
    });
    results.desktopSources = sources;
    assert(sources.length > 0, 'no sources');
    assert(sources.some((s) => s.id.startsWith('screen:')), 'no screen source');
    assert(sources.every((s) => s.thumb.startsWith('data:image/png') && s.thumbLen > 100), 'missing thumbnails');
    return sources.map((s) => `${s.id} "${s.name}"`).join(', ');
  });

  // ---------------------------------------------------------- notifications
  await check('desktop notification via the bridge does not throw', async () => {
    const supported = await app.evaluate(({ Notification }) => Notification.isSupported());
    const before = mainLog.length;
    await win.evaluate(() => {
      (window as unknown as { electronAPI: { showNotification: (o: object) => void } }).electronAPI
        .showNotification({ title: 'Electron smoke', body: 'notification check', tag: 'smoke' });
    });
    await sleep(1000);
    const failed = mainLog.slice(before).find((l) => /Failed to show notification/.test(l));
    assert(!failed, failed ?? '');
    return `Notification.isSupported()=${supported}`;
  });

  // ---------------------------------------------------------- deep link (second instance)
  await check('deep link via second instance (semaphore://community/<id>/channel/<id>)', async () => {
    const url = `semaphore://community/${community.id}/channel/${random.id}`;
    const second = spawn(APP, [...LAUNCH_ARGS, url], { env: process.env, stdio: 'ignore' });
    const code = await new Promise<number | null>((resolve) => {
      const t = setTimeout(() => { second.kill('SIGKILL'); resolve(null); }, 20_000);
      second.on('exit', (c) => { clearTimeout(t); resolve(c); });
    });
    await win.waitForFunction((id) => location.hash.includes(`/channel/${id}`), random.id, { timeout: 10_000 });
    await shot(win, '06-deep-link');
    return `second instance exited ${code}, renderer at ${win.url().replace(/^.*#/, '#')}`;
  });

  // ---------------------------------------------------------- voice + screen share picker
  await check('voice: join a voice channel (LiveKit)', async () => {
    await win.evaluate(([c, ch]) => { location.hash = `#/community/${c}/channel/${ch}`; }, [community.id, voice.id]);
    // Joining is a click on the voice channel in the sidebar.
    await win.getByText('voice-chat', { exact: true }).first().click({ timeout: 15_000 });
    await win.getByLabel('Share screen').first().waitFor({ timeout: 30_000 });
    await shot(win, '07-voice-connected');
  });

  await check('screen share: ScreenSourcePicker opens with desktopCapturer sources', async () => {
    await win.getByLabel('Share screen').first().click();
    const dialog = win.getByRole('dialog', { name: /choose what to share/i });
    await dialog.waitFor({ timeout: 15_000 });
    await dialog.getByText('Entire Screens', { exact: false }).waitFor({ timeout: 15_000 });
    const tiles = await dialog.locator('img').count();
    await shot(win, '09-source-picker');
    assert(tiles > 0, 'picker has no source thumbnails');
    return `${tiles} source tiles`;
  });

  await check('screen share: select a screen -> setDisplayMediaRequestHandler -> publishing', async () => {
    const dialog = win.getByRole('dialog', { name: /choose what to share/i });
    await dialog.locator('img').first().click();
    await dialog.getByRole('button', { name: 'Share', exact: true }).click();
    await win.getByLabel('Stop screen share').first().waitFor({ timeout: 30_000 });
    await shot(win, '10-screen-sharing');
    const handled = mainLog.some((l) => /Callback invoked successfully/.test(l));
    assert(handled, 'main process display-media handler did not grant a source');
    await win.getByLabel('Stop screen share').first().click();
  });

  // ---------------------------------------------------------- auto-updater
  await check('auto-updater: no uncaught updater errors', async () => {
    const lines = mainLog.filter((l) => /auto-?updater|checking for update|update (not )?available|APPIMAGE/i.test(l));
    results.updaterLog = lines;
    const uncaught = mainLog.find((l) => /Uncaught|UnhandledPromiseRejection/i.test(l));
    assert(!uncaught, uncaught ?? '');
    return lines.slice(0, 3).map((l) => l.replace(/^\[[^\]]+\] /, '')).join(' | ') || 'no updater output';
  });

  await app.close();

  // ---------------------------------------------------------- restart
  ({ app, win } = await launch('restart'));
  await check('restart: still signed in (refresh token restored)', async () => {
    await win.waitForSelector('#root > *', { state: 'attached', timeout: 20_000 });
    await sleep(3000);
    await shot(win, '11-after-restart');
    const hash = await win.evaluate(() => location.hash);
    assert(!hash.includes('/login'), `landed on ${hash}`);
    await win.evaluate(([c, ch]) => { location.hash = `#/community/${c}/channel/${ch}`; }, [community.id, general.id]);
    await win.getByText(text).first().waitFor({ timeout: 20_000 });
    return `landed on ${hash || '#/'}; channel history loads`;
  });
  await app.close();

  // ---------------------------------------------------------- logs
  await check('no renderer page errors', async () => {
    const pageErrors = rendererErrors.filter((e) => e.includes('pageerror'));
    assert(pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
    return `${rendererErrors.length} console.error line(s) (see renderer-*.log)`;
  });
  await check('no main-process errors', async () => {
    // Playwright reads the first lines of the app's output itself; its
    // pw:browser debug log (DEBUG_FILE, see entrypoint.sh) has all of it.
    const full = process.env.DEBUG_FILE && existsSync(process.env.DEBUG_FILE)
      ? readFileSync(process.env.DEBUG_FILE, 'utf8').split('\n') : [];
    const bad = [...full, ...mainLog].filter((l) =>
      /Uncaught|Unhandled|TypeError|ReferenceError|FATAL|is not a function|Error in auto-updater/.test(l));
    assert(bad.length === 0, bad.slice(0, 3).join(' | '));
  });
  results.rendererErrors = rendererErrors;
}

main()
  .catch((err) => {
    record('smoke run', false, err instanceof Error ? err.stack ?? err.message : String(err));
  })
  .finally(() => {
    writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
    process.exit(checks.every((c) => c.ok) ? 0 : 1);
  });
