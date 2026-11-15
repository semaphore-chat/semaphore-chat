/**
 * The banner hooks in src/data (connection, incomingCall, appUpdate, signInNotice): headless state the
 * old shell's chrome and the new shell's banner row both read.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createFakeElectronAPI, emitOnSubscribe } from '../test-utils/fakeElectronAPI';
import { SocketContext } from '../../utils/SocketContext';

vi.mock('../../utils/logger', () => ({
  logger: { dev: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
const call = vi.hoisted(() => ({
  incoming: null as null | { dmGroupId: string; dmGroupName: string; callerName: string; callerAvatar: string | null; startedAt: number },
  dismissCall: vi.fn(),
  joinDmVoice: vi.fn(),
  decline: vi.fn(),
  playSound: vi.fn(),
}));
vi.mock('../../contexts/IncomingCallContext', () => ({
  useIncomingCall: () => ({ incomingCall: call.incoming, dismissCall: call.dismissCall }),
}));
vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => ({ state: {}, actions: { joinDmVoice: call.joinDmVoice } }),
}));
vi.mock('../../hooks/useSound', () => ({ playSound: call.playSound, Sounds: { callEnded: 'callEnded' } }));
vi.mock('../../api-client/sdk.gen', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  dmVoicePresenceControllerDeclineDmVoiceCall: call.decline,
}));

import { forgetConnectionHistory, useConnectionState, useRecordConnectionHistory } from '../../data/connection';
import { useIncomingCallPrompt } from '../../data/incomingCall';
import { connectAppUpdates, useAppUpdate } from '../../data/appUpdate';
import { dismissDesktopSignInNotice, showDesktopSignInNotice, useDesktopSignInBanner } from '../../data/signInNotice';

beforeEach(() => {
  call.incoming = null;
  call.dismissCall.mockReset();
  call.joinDmVoice.mockReset().mockResolvedValue(undefined);
  call.decline.mockReset().mockResolvedValue(undefined);
  call.playSound.mockReset();
  dismissDesktopSignInNotice();
});

describe('useConnectionState', () => {
  it('connecting until the socket has connected once, reconnecting after a drop, connecting again after the session ends', () => {
    let connected = false;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SocketContext.Provider value={{ socket: null, isConnected: connected }}>{children}</SocketContext.Provider>
    );
    const { result, rerender } = renderHook(
      () => {
        useRecordConnectionHistory();
        return useConnectionState();
      },
      { wrapper },
    );
    expect(result.current).toBe('connecting');
    connected = true;
    rerender();
    expect(result.current).toBe('connected');
    connected = false;
    rerender();
    expect(result.current).toBe('reconnecting');
    act(() => forgetConnectionHistory());
    rerender();
    expect(result.current).toBe('connecting');
  });
});

describe('useIncomingCallPrompt', () => {
  it('is null when nothing rings', () => {
    expect(renderHook(() => useIncomingCallPrompt()).result.current).toBeNull();
  });

  it('accept joins the DM call, then stops the ringing; a failed join keeps it ringing', async () => {
    call.incoming = { dmGroupId: 'dm-1', dmGroupName: 'Hangout', callerName: 'pri', callerAvatar: 'f-1', startedAt: 1 };
    const { result } = renderHook(() => useIncomingCallPrompt());
    expect(result.current).toMatchObject({ callerName: 'pri', groupName: 'Hangout', callerAvatarFileId: 'f-1' });
    await act(() => result.current!.accept());
    expect(call.joinDmVoice).toHaveBeenCalledWith('dm-1', 'Hangout');
    expect(call.dismissCall).toHaveBeenCalledTimes(1);

    call.joinDmVoice.mockRejectedValueOnce(new Error('no'));
    await act(() => result.current!.accept());
    expect(call.dismissCall).toHaveBeenCalledTimes(1);
  });

  it('decline stops the ringing at once, plays the sound and tells the server', () => {
    call.incoming = { dmGroupId: 'dm-1', dmGroupName: 'Hangout', callerName: 'pri', callerAvatar: null, startedAt: 1 };
    const { result } = renderHook(() => useIncomingCallPrompt());
    act(() => result.current!.decline());
    expect(call.dismissCall).toHaveBeenCalledTimes(1);
    expect(call.playSound).toHaveBeenCalledWith('callEnded');
    expect(call.decline).toHaveBeenCalledWith({ path: { dmGroupId: 'dm-1' }, throwOnError: true });
  });
});

describe('useAppUpdate', () => {
  it('goes none → downloading → ready from the updater, installs, and starts fresh for the next subscriber', () => {
    let progress: (p: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void = () => undefined;
    let downloaded: (info: { version: string }) => void = () => undefined;
    const quitAndInstall = vi.fn();
    const api = createFakeElectronAPI({
      onUpdateAvailable: emitOnSubscribe({ version: '1.4.0' }),
      onDownloadProgress: (cb: typeof progress) => {
        progress = cb;
        return () => undefined;
      },
      onUpdateDownloaded: (cb: typeof downloaded) => {
        downloaded = cb;
        return () => undefined;
      },
      quitAndInstall,
    });
    const { result } = renderHook(() => useAppUpdate());
    expect(result.current.state).toBe('none');
    let disconnect = () => undefined as void;
    act(() => {
      disconnect = connectAppUpdates(api);
    });
    expect(result.current).toMatchObject({ state: 'downloading', version: '1.4.0' });
    act(() => progress({ percent: 40, bytesPerSecond: 1, transferred: 4, total: 10 }));
    expect(result.current.progress).toBe(40);
    act(() => downloaded({ version: '1.4.0' }));
    expect(result.current).toMatchObject({ state: 'ready', downloading: false, ready: true });
    result.current.install();
    expect(quitAndInstall).toHaveBeenCalledTimes(1);
    act(() => disconnect());
    expect(result.current.state).toBe('none');
  });

  it('an error is shown until dismissed', () => {
    const { result } = renderHook(() => useAppUpdate());
    let disconnect = () => undefined as void;
    act(() => {
      disconnect = connectAppUpdates(createFakeElectronAPI({ onUpdateError: emitOnSubscribe(new Error('Cannot download')) }));
    });
    expect(result.current).toMatchObject({ state: 'error', errorMessage: 'Cannot download' });
    act(() => result.current.dismissError());
    expect(result.current.state).toBe('none');
    act(() => disconnect());
  });
});

describe('useDesktopSignInBanner', () => {
  it('shows once per notice and goes when dismissed', () => {
    const { result } = renderHook(() => useDesktopSignInBanner());
    expect(result.current).toBeNull();
    act(() => showDesktopSignInNotice());
    act(() => showDesktopSignInNotice());
    expect(result.current?.message).toMatch(/desktop app just signed in/i);
    act(() => result.current!.dismiss());
    expect(result.current).toBeNull();
  });
});
