/**
 * The new shell's banner row: the view (kit Alerts, most urgent first, as many as fit), the cap rule,
 * the three connection states with their grace period, read-out-once across remounts, and the model
 * fed from the headless state both shells share (data/).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, screen, within } from '@testing-library/react';
import { renderWithKit } from '../../test-utils/renderWithKit';
import { createFakeElectronAPI, emitOnSubscribe } from '../../test-utils/fakeElectronAPI';
import { ShellBanners } from '../../../shell/lounge/pieces/ShellBanners';
import {
  CONNECTION_GRACE_MS,
  NO_BANNERS,
  useShellBannersModel,
  visibleBanners,
  type ShellBannersModel,
} from '../../../shell/lounge/pieces/shellBannersModel';
import { connectAppUpdates } from '../../../data/appUpdate';
import { dismissDesktopSignInNotice, showDesktopSignInNotice } from '../../../data/signInNotice';
import { forgetAllAnnouncements } from '../../../shell/bannerMemory';

vi.mock('../../../utils/logger', () => ({
  logger: { dev: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const ring = vi.hoisted(() => ({
  prompt: null as null | { callerName: string; callerAvatarFileId: null; groupName: string; accept: () => Promise<void>; decline: () => void },
}));
vi.mock('../../../data/incomingCall', () => ({ useIncomingCallPrompt: () => ring.prompt }));
const connection = vi.hoisted(() => ({ state: 'connected' as 'connected' | 'connecting' | 'reconnecting' }));
vi.mock('../../../data/connection', () => ({ useConnectionState: () => connection.state }));
const pwa = vi.hoisted(() => ({
  online: true,
  webUpdate: null as null | { reload: () => void; reloading: boolean },
  install: null as null | { ios: boolean; install: () => Promise<void>; installing: boolean; dismiss: () => void },
}));
vi.mock('../../../data/pwa', () => ({
  useBrowserOnline: () => pwa.online,
  useWebUpdate: () => pwa.webUpdate,
  useInstallOffer: () => pwa.install,
}));

const noop = () => undefined;
const call = { callerName: 'Priya Diallo', groupName: 'Priya Diallo', onJoin: noop, onDecline: noop };
const SIX: ShellBannersModel = {
  incomingCall: call,
  connection: 'unreachable',
  signIn: { message: 'A desktop app just signed in to your account.', onDismiss: noop },
  update: { state: 'ready', version: '1.4.0', onRestart: noop },
  webUpdate: { onReload: noop },
  install: { ios: false, onInstall: noop, onDismiss: noop },
};

function renderBanners(model: Partial<ShellBannersModel>) {
  return renderWithKit(<ShellBanners {...NO_BANNERS} {...model} />);
}

/** The polite root live region (kit announcer). */
function politeRegion(): HTMLElement {
  return document.body.querySelector<HTMLElement>('[data-kit-live-slot="root"] [aria-live="polite"]')!;
}

beforeEach(() => {
  forgetAllAnnouncements();
});

describe('ShellBanners (the view)', () => {
  it('incoming call: "… is calling", the group when it differs, Join and Decline (two actions, no dismiss)', async () => {
    const onJoin = vi.fn();
    const onDecline = vi.fn();
    const { user } = renderBanners({ incomingCall: { callerName: 'pri', groupName: 'Weekend Plans', onJoin, onDecline } });
    const alert = screen.getByRole('status');
    expect(alert).toHaveTextContent('pri is calling');
    expect(alert).toHaveTextContent('Voice call in Weekend Plans');
    await user.click(within(alert).getByRole('button', { name: 'Join' }));
    await user.click(within(alert).getByRole('button', { name: 'Decline' }));
    expect(onJoin).toHaveBeenCalledTimes(1);
    expect(onDecline).toHaveBeenCalledTimes(1);
    expect(within(alert).queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it.each([
    ['offline', "You're offline. Semaphore Chat reconnects when your network is back."],
    ['unreachable', "Can't reach the server. Reconnecting…"],
    ['connecting', 'Connecting…'],
  ] as const)('connection %s: its own words, a quiet note said politely once, never an interrupting alert', async (problem, text) => {
    renderBanners({ connection: problem });
    expect(screen.getByRole('note')).toHaveTextContent(text);
    expect(screen.queryByRole('alert')).toBeNull();
    await vi.waitFor(() => expect(politeRegion()).toHaveTextContent(text));
  });

  it('a banner that mounts again (a shell flip) is not read out again', async () => {
    const first = renderBanners({ connection: 'unreachable', signIn: SIX.signIn });
    expect(screen.getByRole('alert')).toHaveTextContent(/desktop app/);
    await vi.waitFor(() => expect(politeRegion()).toHaveTextContent("Can't reach the server"));
    first.unmount();
    renderBanners({ connection: 'unreachable', signIn: SIX.signIn });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getAllByRole('note')).toHaveLength(2);
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    expect(politeRegion()).toHaveTextContent('');
  });

  it('desktop sign-in: a warning the user dismisses', async () => {
    const onDismiss = vi.fn();
    const { user } = renderBanners({ signIn: { message: 'A desktop app just signed in to your account.', onDismiss } });
    await user.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('update: downloading (quiet), ready (Restart now), error (what happens next, no raw message)', async () => {
    const { rerender, user } = renderBanners({ update: { state: 'downloading', progress: 41.6 } });
    expect(screen.getByRole('note')).toHaveTextContent('Downloading an update (42%)');

    const onRestart = vi.fn();
    rerender(<ShellBanners {...NO_BANNERS} update={{ state: 'ready', version: '1.4.0', onRestart }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Version 1.4.0 is ready. The app restarts to install it.');
    await user.click(screen.getByRole('button', { name: 'Restart now' }));
    expect(onRestart).toHaveBeenCalledTimes(1);

    const onDismiss = vi.fn();
    rerender(<ShellBanners {...NO_BANNERS} update={{ state: 'error', onDismiss }} />);
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't download the update");
    expect(screen.getByRole('alert')).toHaveTextContent('It tries again the next time the app starts.');
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('web update: Update available, Reload', async () => {
    const onReload = vi.fn();
    const { user } = renderBanners({ webUpdate: { onReload } });
    expect(screen.getByRole('status')).toHaveTextContent('Update available');
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('install offer: a quiet note with Install and Dismiss; on iOS the steps and no Install', async () => {
    const onInstall = vi.fn();
    const onDismiss = vi.fn();
    const { user, rerender } = renderBanners({ install: { ios: false, onInstall, onDismiss } });
    const note = screen.getByRole('note');
    expect(note).toHaveTextContent('Install Semaphore Chat');
    await user.click(within(note).getByRole('button', { name: 'Install' }));
    await user.click(within(note).getByRole('button', { name: 'Dismiss' }));
    expect(onInstall).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);

    rerender(<ShellBanners {...NO_BANNERS} install={{ ios: true, onInstall, onDismiss }} />);
    expect(screen.getByRole('note')).toHaveTextContent('In Safari, tap Share, then Add to Home Screen.');
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull();
  });

  it('six pending at wide (the default here): the three most urgent, in order', () => {
    const { container } = renderBanners(SIX);
    const texts = [...container.querySelectorAll('[role="status"], [role="alert"], [role="note"]')].map((el) => el.textContent);
    expect(texts).toEqual([
      expect.stringContaining('is calling'),
      expect.stringContaining("Can't reach the server"),
      expect.stringContaining('desktop app'),
    ]);
  });
});

describe('visibleBanners (the cap rule)', () => {
  it('two below wide, three at wide, by priority', () => {
    expect(visibleBanners(SIX, 'phone')).toEqual(['incomingCall', 'connection']);
    expect(visibleBanners(SIX, 'compact')).toEqual(['incomingCall', 'connection']);
    expect(visibleBanners(SIX, 'wide')).toEqual(['incomingCall', 'connection', 'signIn']);
  });

  it('the quiet ones (install, download progress) only when nothing else shows', () => {
    const quiet = { ...NO_BANNERS, install: SIX.install, update: { state: 'downloading' as const, progress: 5 } };
    expect(visibleBanners(quiet, 'wide')).toEqual(['install', 'downloading']);
    expect(visibleBanners({ ...quiet, webUpdate: SIX.webUpdate }, 'wide')).toEqual(['webUpdate']);
  });

  it('the update error before the update ready, and the web Reload waits while offline', () => {
    expect(visibleBanners({ ...NO_BANNERS, update: { state: 'error', onDismiss: noop } }, 'wide')).toEqual(['updateError']);
    expect(visibleBanners({ ...NO_BANNERS, webUpdate: SIX.webUpdate, connection: 'offline' }, 'wide')).toEqual(['connection']);
    expect(visibleBanners({ ...NO_BANNERS, webUpdate: SIX.webUpdate, connection: 'unreachable' }, 'wide')).toEqual([
      'connection',
      'webUpdate',
    ]);
  });
});

describe('useShellBannersModel (from the shared state)', () => {
  beforeEach(() => {
    ring.prompt = null;
    connection.state = 'connected';
    pwa.online = true;
    pwa.webUpdate = null;
    pwa.install = null;
    dismissDesktopSignInNotice();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is empty when nothing concerns the whole app', () => {
    const { result } = renderHook(() => useShellBannersModel());
    expect(result.current).toEqual(NO_BANNERS);
    expect(visibleBanners(result.current, 'wide')).toEqual([]);
  });

  it('the browser offline shows at once, even with the socket still up', () => {
    pwa.online = false;
    expect(renderHook(() => useShellBannersModel()).result.current.connection).toBe('offline');
  });

  it('a first connect or a reconnect shows only once it lasts longer than the grace period', () => {
    vi.useFakeTimers();
    connection.state = 'connecting';
    const { result, rerender } = renderHook(() => useShellBannersModel());
    expect(result.current.connection).toBeNull();
    act(() => vi.advanceTimersByTime(CONNECTION_GRACE_MS - 1));
    expect(result.current.connection).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.connection).toBe('connecting');

    // Connected: gone. A drop that recovers within the grace period never shows.
    connection.state = 'connected';
    rerender();
    expect(result.current.connection).toBeNull();
    connection.state = 'reconnecting';
    rerender();
    act(() => vi.advanceTimersByTime(CONNECTION_GRACE_MS / 2));
    connection.state = 'connected';
    rerender();
    act(() => vi.advanceTimersByTime(CONNECTION_GRACE_MS));
    expect(result.current.connection).toBeNull();

    connection.state = 'reconnecting';
    rerender();
    act(() => vi.advanceTimersByTime(CONNECTION_GRACE_MS));
    expect(result.current.connection).toBe('unreachable');
  });

  it('carries the web update and the install offer (Install ignored while one runs)', () => {
    const reload = vi.fn();
    const install = vi.fn(async () => undefined);
    const dismiss = vi.fn();
    pwa.webUpdate = { reload, reloading: false };
    pwa.install = { ios: false, install, installing: true, dismiss };
    const { result } = renderHook(() => useShellBannersModel());
    result.current.webUpdate?.onReload();
    result.current.install?.onInstall();
    result.current.install?.onDismiss();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(install).not.toHaveBeenCalled();
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('follows the ringing call, the sign-in notice and the update store', () => {
    const accept = vi.fn(async () => undefined);
    const decline = vi.fn();
    ring.prompt = { callerName: 'Priya Diallo', callerAvatarFileId: null, groupName: 'Hangout', accept, decline };
    const { result } = renderHook(() => useShellBannersModel());
    expect(result.current.incomingCall).toMatchObject({ callerName: 'Priya Diallo', groupName: 'Hangout' });
    result.current.incomingCall?.onJoin();
    result.current.incomingCall?.onDecline();
    expect(accept).toHaveBeenCalledTimes(1);
    expect(decline).toHaveBeenCalledTimes(1);

    act(() => showDesktopSignInNotice());
    expect(result.current.signIn?.message).toMatch(/desktop app just signed in/i);
    act(() => result.current.signIn?.onDismiss());
    expect(result.current.signIn).toBeNull();

    const quitAndInstall = vi.fn();
    let disconnect = () => undefined as void;
    act(() => {
      disconnect = connectAppUpdates(
        createFakeElectronAPI({
          onUpdateAvailable: emitOnSubscribe({ version: '1.4.0' }),
          onUpdateDownloaded: emitOnSubscribe({ version: '1.4.0' }),
          quitAndInstall,
        }),
      );
    });
    expect(result.current.update).toMatchObject({ state: 'ready', version: '1.4.0' });
    if (result.current.update?.state === 'ready') result.current.update.onRestart();
    expect(quitAndInstall).toHaveBeenCalledTimes(1);
    act(() => disconnect());
  });
});
