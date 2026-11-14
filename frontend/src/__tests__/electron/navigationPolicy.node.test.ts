// @vitest-environment node
/**
 * The main window's navigation and IPC trust policy (WEB-3): only the app's
 * own page may be navigated to and may use the preload bridge. A dropped
 * local HTML file or a page on some other localhost port must not.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createAppUrlPolicy, type FrameLike } from '../../../electron/navigation-policy';

const distDir = path.resolve('/opt/Semaphore/resources/app.asar/dist');
const indexUrl = pathToFileURL(path.join(distDir, 'index.html')).href;
// No real files: realpath is the identity, as for a path that doesn't exist.
const realPath = (p: string) => path.resolve(p);

const packaged = createAppUrlPolicy({ distDir, devServerAllowed: false, realPath });
const dev = createAppUrlPolicy({ distDir, devServerAllowed: true, realPath });

describe('isAllowedNavigation', () => {
  it('allows the packaged app entry, with any hash route or query', () => {
    expect(packaged.isAllowedNavigation(indexUrl)).toBe(true);
    expect(packaged.isAllowedNavigation(`${indexUrl}#/community/x/channel/y`)).toBe(true);
    expect(packaged.isAllowedNavigation(`${indexUrl}?a=1#/`)).toBe(true);
  });

  it('refuses any other local file (a file dropped on the window)', () => {
    expect(packaged.isAllowedNavigation('file:///home/u/Downloads/x.html')).toBe(false);
    expect(packaged.isAllowedNavigation(pathToFileURL(path.join(distDir, 'other.html')).href)).toBe(false);
    expect(packaged.isAllowedNavigation(pathToFileURL(path.join(distDir, '..', 'evil.html')).href)).toBe(false);
    expect(packaged.isAllowedNavigation('file://')).toBe(false);
  });

  it('refuses other localhost pages', () => {
    expect(packaged.isAllowedNavigation('http://localhost:8080/')).toBe(false);
    expect(dev.isAllowedNavigation('http://localhost:8080/')).toBe(false);
    expect(dev.isAllowedNavigation('https://localhost:5173/')).toBe(false);
  });

  it('allows the dev server only in unpackaged builds', () => {
    expect(packaged.isAllowedNavigation('http://localhost:5173/')).toBe(false);
    expect(dev.isAllowedNavigation('http://localhost:5173/')).toBe(true);
    expect(dev.isAllowedNavigation('http://localhost:5173/#/login')).toBe(true);
  });

  it('refuses remote pages and junk', () => {
    expect(packaged.isAllowedNavigation('https://example.com/')).toBe(false);
    expect(packaged.isAllowedNavigation('javascript:alert(1)')).toBe(false);
    expect(packaged.isAllowedNavigation('not a url')).toBe(false);
  });
});

describe('isAppOrigin', () => {
  it('trusts the dev server only in unpackaged builds', () => {
    expect(packaged.isAppOrigin('http://localhost:5173')).toBe(false);
    expect(dev.isAppOrigin('http://localhost:5173')).toBe(true);
  });

  it('trusts files inside dist, nothing else', () => {
    expect(packaged.isAppOrigin(indexUrl)).toBe(true);
    expect(packaged.isAppOrigin('file:///home/u/Downloads/x.html')).toBe(false);
    expect(packaged.isAppOrigin('file://')).toBe(false);
  });

  it('follows symlinks out of dist', () => {
    const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'navpolicy-'));
    const realDist = path.join(tmp, 'dist');
    fs.mkdirSync(realDist);
    fs.writeFileSync(path.join(tmp, 'outside.html'), '');
    fs.symlinkSync(path.join(tmp, 'outside.html'), path.join(realDist, 'link.html'));
    const policy = createAppUrlPolicy({ distDir: realDist, devServerAllowed: false });
    expect(policy.isAppOrigin(pathToFileURL(path.join(realDist, 'link.html')).href)).toBe(false);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe('isTrustedSender', () => {
  const mainFrame: FrameLike = { url: indexUrl, processId: 4, routingId: 1 };

  it('accepts the main window\'s top frame on the app page', () => {
    expect(packaged.isTrustedSender({ ...mainFrame }, mainFrame)).toBe(true);
  });

  it('rejects a missing frame or a missing main window', () => {
    expect(packaged.isTrustedSender(null, mainFrame)).toBe(false);
    expect(packaged.isTrustedSender(undefined, mainFrame)).toBe(false);
    expect(packaged.isTrustedSender(mainFrame, null)).toBe(false);
  });

  it('rejects a subframe', () => {
    expect(packaged.isTrustedSender({ ...mainFrame, routingId: 2 }, mainFrame)).toBe(false);
    expect(packaged.isTrustedSender({ ...mainFrame, processId: 5 }, mainFrame)).toBe(false);
  });

  it('rejects the main frame once it shows a page that is not the app', () => {
    const dropped = { ...mainFrame, url: 'file:///home/u/Downloads/notes.html' };
    expect(packaged.isTrustedSender(dropped, dropped)).toBe(false);
    const local = { ...mainFrame, url: 'http://localhost:5173/' };
    expect(packaged.isTrustedSender(local, local)).toBe(false);
  });
});

describe('main.ts IPC registration', () => {
  it('registers every IPC handler through the sender-checking wrappers', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../electron/main.ts'), 'utf8');
    const raw = source.match(/ipcMain\.(handle|on|once|handleOnce)\(/g) ?? [];
    // Only the two wrapper definitions may call ipcMain directly.
    expect(raw).toEqual(['ipcMain.handle(', 'ipcMain.on(']);
    expect(source).toMatch(/function handleTrusted\b/);
    expect(source).toMatch(/function onTrusted\b/);
  });
});
