/**
 * The new shell's banner row: the view (kit Alerts, one per notice, most urgent first) and the
 * model it is fed from the headless state both shells share (data/).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, screen, within } from '@testing-library/react';
import { renderWithKit } from '../../test-utils/renderWithKit';
import { createFakeElectronAPI, emitOnSubscribe } from '../../test-utils/fakeElectronAPI';
import { ShellBanners } from '../../../shell/lounge/pieces/ShellBanners';
import { NO_BANNERS, hasBanners, useShellBannersModel, type ShellBannersModel } from '../../../shell/lounge/pieces/shellBannersModel';
import { connectAppUpdates } from '../../../data/appUpdate';
import { dismissDesktopSignInNotice, showDesktopSignInNotice } from '../../../data/signInNotice';

vi.mock('../../../utils/logger', () => ({
  logger: { dev: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const ring = vi.hoisted(() => ({
  prompt: null as null | { callerName: string; callerAvatarFileId: null; groupName: string; accept: () => Promise<void>; decline: () => void },
}));
vi.mock('../../../data/incomingCall', () => ({ useIncomingCallPrompt: () => ring.prompt }));
const connection = vi.hoisted(() => ({ state: 'connected' as 'connected' | 'reconnecting' }));
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

function renderBanners(model: Partial<ShellBannersModel>) {
  return renderWithKit(<ShellBanners {...NO_BANNERS} {...model} />);
}

describe('ShellBanners (the view)', () => {
  it('incoming call: the caller, Join and Decline (two actions, no dismiss)', async () => {
    const onJoin = vi.fn();
    const onDecline = vi.fn();
    const { user } = renderBanners({ incomingCall: { callerName: 'Priya Diallo', onJoin, onDecline } });
    const alert = screen.getByRole('status');
    expect(alert).toHaveTextContent('Priya Diallo');
    expect(alert).toHaveTextContent('Incoming voice call');
    await user.click(within(alert).getByRole('button', { name: 'Join' }));
    expect(onJoin).toHaveBeenCalledTimes(1);
    await user.click(within(alert).getByRole('button', { name: 'Decline' }));
    expect(onDecline).toHaveBeenCalledTimes(1);
    expect(within(alert).queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('offline: a warning that interrupts, with no action', () => {
    renderBanners({ offline: true });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("You're offline. Reconnecting…");
    expect(within(alert).queryByRole('button')).toBeNull();
  });

  it('desktop sign-in: a warning the user dismisses', async () => {
    const onDismiss = vi.fn();
    const { user } = renderBanners({ signIn: { message: 'A desktop app just signed in to your account.', onDismiss } });
    await user.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('update: downloading (quiet, with the percentage), ready (Restart now), error (dismissable)', async () => {
    const { rerender, user } = renderBanners({ update: { state: 'downloading', progress: 41.6 } });
    expect(screen.getByRole('note')).toHaveTextContent('Downloading an update (42%)');

    const onRestart = vi.fn();
    rerender(<ShellBanners {...NO_BANNERS} update={{ state: 'ready', version: '1.4.0', onRestart }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Version 1.4.0 is ready. The app restarts to install it.');
    await user.click(screen.getByRole('button', { name: 'Restart now' }));
    expect(onRestart).toHaveBeenCalledTimes(1);

    const onDismiss = vi.fn();
    rerender(<ShellBanners {...NO_BANNERS} update={{ state: 'error', message: 'Cannot download update', onDismiss }} />);
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't download the update");
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

  it('two at once stack in priority order: the call, then offline', () => {
    const { container } = renderBanners({
      incomingCall: { callerName: 'Priya Diallo', onJoin: vi.fn(), onDecline: vi.fn() },
      offline: true,
      update: { state: 'downloading', progress: 10 },
    });
    const texts = [...container.querySelectorAll('[role="status"], [role="alert"], [role="note"]')].map((el) => el.textContent);
    expect(texts).toEqual([
      expect.stringContaining('Priya Diallo'),
      expect.stringContaining("You're offline"),
      expect.stringContaining('Downloading an update'),
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

  it('is empty when nothing concerns the whole app', () => {
    const { result } = renderHook(() => useShellBannersModel());
    expect(result.current).toEqual(NO_BANNERS);
    expect(hasBanners(result.current)).toBe(false);
  });

  it('is offline when the browser has no network, even with the socket still up', () => {
    pwa.online = false;
    expect(renderHook(() => useShellBannersModel()).result.current.offline).toBe(true);
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
    expect(hasBanners(result.current)).toBe(true);
  });

  it('follows the connection, the ringing call, the sign-in notice and the update store', () => {
    const accept = vi.fn(async () => undefined);
    const decline = vi.fn();
    ring.prompt = { callerName: 'Priya Diallo', callerAvatarFileId: null, groupName: 'Hangout', accept, decline };
    connection.state = 'reconnecting';
    const { result } = renderHook(() => useShellBannersModel());
    expect(result.current.offline).toBe(true);
    expect(result.current.incomingCall?.callerName).toBe('Priya Diallo');
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
