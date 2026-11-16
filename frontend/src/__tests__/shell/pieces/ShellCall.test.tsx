/**
 * The Lounge call slot with the real data layer (useCallBarModel, useVoiceNotice, useCallVideo) over mocked
 * voice hooks: each control reaches the very function the classic bar (or classic stage tile, or classic
 * VoiceNotice) calls for that action; the surface's chunk loads only when there is video to offer; the slot's
 * "shown" flag agrees with what it renders.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act, fireEvent, renderHook, screen, waitFor, within } from '@testing-library/react';
import { VoiceActionType, VoiceSessionType } from '../../../contexts/VoiceContext';

const m = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  media: { isMicrophoneEnabled: true, isCameraEnabled: false, isScreenShareEnabled: false },
  ptt: { isActive: false, isKeyHeld: false, currentKeyDisplay: 'V' },
  publish: { canSpeak: true, canVideo: true, canShare: true, speakBlockedReason: "You can't speak here" },
  speaking: new Map<string, boolean>(),
  touch: false,
  width: 'phone' as 'phone' | 'compact' | 'wide',
  surfaceLoads: 0,
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}));

// The classic bar's functions: VoiceBottomBarContent calls these (toggleMute, toggleDeafen,
// leaveVoiceChannel, cancelReconnect, revealVideoTiles, toggleScreenShare); the classic stage tiles call the
// watch ones; the classic VoiceNotice's Retry joins again.
const actions = {
  toggleMute: vi.fn(),
  toggleDeafen: vi.fn(),
  leaveVoiceChannel: vi.fn(),
  cancelReconnect: vi.fn(),
  revealVideoTiles: vi.fn(),
  toggleScreenShare: vi.fn().mockResolvedValue(undefined),
  joinVoiceChannel: vi.fn().mockResolvedValue(undefined),
  joinDmVoice: vi.fn().mockResolvedValue(undefined),
  watchScreenShare: vi.fn(),
  stopWatchingScreenShare: vi.fn(),
  watchCamera: vi.fn(),
  stopWatchingCamera: vi.fn(),
};
const pttPress = vi.fn().mockResolvedValue(undefined);
const pttRelease = vi.fn().mockResolvedValue(undefined);
const dispatch = vi.fn();

vi.mock('../../../hooks/useVoiceConnection', () => ({ useVoiceConnection: () => ({ state: m.state, actions }) }));
vi.mock('../../../hooks/useLocalMediaState', () => ({ useLocalMediaState: () => m.media }));
vi.mock('../../../hooks/usePushToTalk', () => ({
  usePushToTalkStatus: () => ({ ...m.ptt, inputMode: 'push_to_talk', pttPress, pttRelease }),
}));
vi.mock('../../../hooks/useVoicePublishPermissions', () => ({ useVoicePublishPermissions: () => m.publish }));
vi.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ user: { id: 'me' } }) }));
vi.mock('../../../hooks/useSpeaking', () => ({
  useSpeaking: () => ({ speakingMap: m.speaking, isSpeaking: (id: string) => !!m.speaking.get(id) }),
}));
vi.mock('../../../contexts/VoiceContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../contexts/VoiceContext')>()),
  useVoiceDispatch: () => ({ dispatch }),
  useVoice: () => m.state,
}));
vi.mock('../../../data/touchFirst', () => ({ useTouchFirst: () => m.touch }));
vi.mock('../../../kit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../kit')>()),
  useWidthRange: () => m.width,
}));
vi.mock('../../../shell/lounge/call/surface/CallSurface', async (importOriginal) => {
  m.surfaceLoads += 1;
  return importOriginal();
});

import { ShellCall } from '../../../shell/lounge/pieces/call/ShellCall';
import { useCallSlotShown } from '../../../data/callSlot';
import { renderWithKit } from '../../test-utils/renderWithKit';

/** A LiveKit room as far as the call slot reads it, with events to emit. */
function fakeRoom() {
  const handlers = new Map<string, Set<() => void>>();
  const remoteParticipants = new Map<string, { identity: string; name: string; trackPublications: Map<string, unknown> }>();
  return {
    remoteParticipants,
    localParticipant: { identity: 'me', isScreenShareEnabled: false },
    on(event: string, fn: () => void) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(fn);
    },
    off(event: string, fn: () => void) {
      handlers.get(event)?.delete(fn);
    },
    emit(event: string) {
      act(() => handlers.get(event)?.forEach((fn) => fn()));
    },
    listeners: () => [...handlers.values()].reduce((n, set) => n + set.size, 0),
    publish(identity: string, name: string, source: 'screen_share' | 'camera', track: unknown = null, isMuted = false) {
      const participant = remoteParticipants.get(identity) ?? { identity, name, trackPublications: new Map() };
      participant.trackPublications.set(`${identity}-${source}`, {
        source,
        isMuted,
        isSubscribed: track !== null,
        track,
      });
      remoteParticipants.set(identity, participant);
    },
    unpublish(identity: string, source: 'screen_share' | 'camera') {
      remoteParticipants.get(identity)?.trackPublications.delete(`${identity}-${source}`);
    },
    leave(identity: string) {
      remoteParticipants.delete(identity);
    },
  };
}

let room: ReturnType<typeof fakeRoom>;
const IN_CHANNEL = () => ({
  isConnected: true,
  isConnecting: false,
  contextType: VoiceSessionType.Channel,
  currentChannelId: 'vc-1',
  channelName: 'Squad Up',
  communityId: 'c-1',
  currentDmGroupId: null,
  dmGroupName: null,
  isDeafened: false,
  isServerMuted: false,
  reconnect: null,
  joinFailure: null,
  lastEnded: null,
  watchingCameras: new Set<string>(),
  watchingScreenShares: new Set<string>(),
  room,
});

let consoleError: MockInstance;
beforeEach(() => {
  vi.clearAllMocks();
  consoleError = vi.spyOn(console, 'error');
  HTMLElement.prototype.setPointerCapture = vi.fn();
  room = fakeRoom();
  m.state = IN_CHANNEL();
  m.media = { isMicrophoneEnabled: true, isCameraEnabled: false, isScreenShareEnabled: false };
  m.ptt = { isActive: false, isKeyHeld: false, currentKeyDisplay: 'V' };
  m.publish = { ...m.publish, canSpeak: true };
  m.speaking = new Map();
  m.touch = false;
  m.width = 'phone';
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

describe('ShellCall: the controls are the classic bar functions', () => {
  it('Mute, Deafen and Leave call the classic toggleMute, toggleDeafen and leaveVoiceChannel', () => {
    renderWithKit(<ShellCall />);
    click('Mute');
    expect(actions.toggleMute).toHaveBeenCalledTimes(1);
    click('Deafen');
    expect(actions.toggleDeafen).toHaveBeenCalledTimes(1);
    click('Leave call');
    expect(actions.leaveVoiceChannel).toHaveBeenCalledTimes(1);
  });

  it.each(['compact', 'wide'] as const)('Mute, Deafen and Leave at %s too (they never depend on the left island)', (width) => {
    m.width = width;
    renderWithKit(<ShellCall />);
    click('Mute');
    expect(actions.toggleMute).toHaveBeenCalledTimes(1);
    click('Deafen');
    expect(actions.toggleDeafen).toHaveBeenCalledTimes(1);
    click('Leave call');
    expect(actions.leaveVoiceChannel).toHaveBeenCalledTimes(1);
  });

  it('Mute while deafened is the classic Mute (it does not undeafen), and afterwards both buttons and the line tell the truth', () => {
    m.width = 'wide';
    m.state = { ...IN_CHANNEL(), isDeafened: true };
    m.media = { ...m.media, isMicrophoneEnabled: false };
    const { rerender } = renderWithKit(<ShellCall />);
    expect(screen.getByRole('button', { name: 'Mute' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Deafen' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Deafened', { exact: true })).toBeInTheDocument();
    click('Mute');
    expect(actions.toggleMute).toHaveBeenCalledTimes(1);
    expect(actions.toggleDeafen).not.toHaveBeenCalled();
    // What the classic toggleMicrophone leaves behind: the mic on, still deafened.
    m.media = { ...m.media, isMicrophoneEnabled: true };
    rerender(<ShellCall />);
    expect(screen.getByRole('button', { name: 'Mute' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Deafen' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('lounge-call-line')).toHaveTextContent('Deafened · your mic is on');
    // Undeafen is on screen; pressing it is the classic toggleDeafen.
    click('Deafen');
    expect(actions.toggleDeafen).toHaveBeenCalledTimes(1);
  });

  it('a failed action is logged as a warning, never an unhandled rejection', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    actions.toggleMute.mockRejectedValueOnce(new Error('Room is not connected'));
    actions.toggleDeafen.mockImplementationOnce(() => {
      throw new Error('no room');
    });
    renderWithKit(<ShellCall />);
    click('Mute');
    click('Deafen');
    await waitFor(() => expect(warn).toHaveBeenCalledTimes(2));
    expect(warn.mock.calls.map((call) => call[0])).toEqual([
      '[Voice] Call bar: deafen failed:',
      '[Voice] Call bar: mute failed:',
    ]);
    warn.mockRestore();
  });

  it('Cancel while reconnecting calls the classic cancelReconnect', () => {
    m.state = { ...IN_CHANNEL(), reconnect: { attempt: 3, maxAttempts: 5, nextRetryAt: null } };
    renderWithKit(<ShellCall />);
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting (3)…');
    click('Cancel');
    expect(actions.cancelReconnect).toHaveBeenCalledTimes(1);
  });

  it('Open call view goes to the classic voice room and reveals the tiles', () => {
    renderWithKit(<ShellCall />);
    // The room's row is the control, at every width.
    expect(screen.queryByRole('button', { name: 'Open call view' })).toBeNull();
    click('Open call view, Squad Up');
    expect(mockNavigate).toHaveBeenCalledWith('/community/c-1/channel/vc-1');
    expect(actions.revealVideoTiles).toHaveBeenCalledTimes(1);
  });

  it('touch hold-to-talk presses and releases through usePushToTalkStatus (the classic bar path)', () => {
    m.ptt = { isActive: true, isKeyHeld: false, currentKeyDisplay: 'V' };
    m.touch = true;
    renderWithKit(<ShellCall />);
    const hold = screen.getByRole('button', { name: 'Hold to talk' });
    fireEvent.pointerDown(hold, { pointerId: 1, button: 0, pointerType: 'touch' });
    expect(pttPress).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(hold, { pointerId: 1 });
    fireEvent.lostPointerCapture(hold, { pointerId: 1 });
    expect(pttRelease).toHaveBeenCalledTimes(1);
  });

  it('a hold running when the slot unmounts is released', () => {
    m.ptt = { isActive: true, isKeyHeld: false, currentKeyDisplay: 'V' };
    m.touch = true;
    const { unmount } = renderWithKit(<ShellCall />);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Hold to talk' }), { pointerId: 1, button: 0, pointerType: 'touch' });
    unmount();
    expect(pttRelease).toHaveBeenCalledTimes(1);
  });

  it('server-muted: the hold control is unavailable (still a Tab stop) and presses nothing', () => {
    m.ptt = { isActive: true, isKeyHeld: false, currentKeyDisplay: 'V' };
    m.touch = true;
    m.media = { ...m.media, isMicrophoneEnabled: false };
    m.state = { ...IN_CHANNEL(), isServerMuted: true };
    renderWithKit(<ShellCall />);
    const hold = screen.getByRole('button', { name: 'Hold to talk' });
    expect(hold).not.toBeDisabled();
    expect(hold).toHaveAttribute('aria-disabled', 'true');
    fireEvent.pointerDown(hold, { pointerId: 1, button: 0, pointerType: 'touch' });
    expect(pttPress).not.toHaveBeenCalled();
    expect(screen.getByText('Muted by a moderator', { exact: true })).toBeInTheDocument();
  });

  it('push-to-talk with a key (not touch): the mic says the key and toggles nothing', () => {
    m.ptt = { isActive: true, isKeyHeld: false, currentKeyDisplay: 'V' };
    m.media = { ...m.media, isMicrophoneEnabled: false };
    renderWithKit(<ShellCall />);
    expect(screen.getByRole('button', { name: 'Mute' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Hold V to talk', { exact: true })).toBeInTheDocument();
    click('Mute');
    expect(actions.toggleMute).not.toHaveBeenCalled();
  });
});

describe('ShellCall: the voice notice', () => {
  const failure = {
    kind: 'server_unreachable',
    at: 5,
    target: {
      type: 'channel',
      channelId: 'vc-9',
      channelName: 'Old room',
      communityId: 'c-1',
      isPrivate: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  };

  it('out of a call: Retry joins again (as the classic notice), Dismiss clears it', async () => {
    m.state = { ...IN_CHANNEL(), isConnected: false, currentChannelId: null, room: null, joinFailure: failure };
    renderWithKit(<ShellCall />);
    expect(screen.getByRole('alert')).toHaveTextContent("Can't reach the voice server");
    click('Retry');
    await waitFor(() =>
      expect(actions.joinVoiceChannel).toHaveBeenCalledWith('vc-9', 'Old room', 'c-1', false, '2026-01-01T00:00:00.000Z'),
    );
    click('Dismiss');
    expect(dispatch).toHaveBeenCalledWith({ type: VoiceActionType.ClearVoiceNotice });
  });

  it('hidden while a join runs, and in a call', () => {
    m.state = { ...IN_CHANNEL(), isConnected: false, isConnecting: true, currentChannelId: null, room: null, joinFailure: failure };
    const { rerender } = renderWithKit(<ShellCall />);
    expect(screen.queryByRole('alert')).toBeNull();
    m.state = { ...IN_CHANNEL(), joinFailure: failure };
    rerender(<ShellCall />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('region', { name: 'Call in Squad Up' })).toBeInTheDocument();
  });
});

describe('ShellCall: the call surface', () => {
  it('is not mounted, and its chunk not loaded, with no video in the call', async () => {
    // No test before this one renders video, so the surface module has never been imported (a static
    // import of it from the call slot would have loaded it with this file).
    renderWithKit(<ShellCall />);
    await act(async () => {});
    expect(screen.queryByTestId('lounge-call-surface')).toBeNull();
    expect(m.surfaceLoads).toBe(0);
  });

  it('mounts when a peer publishes a share: offered with Watch, nothing watched by itself', async () => {
    renderWithKit(<ShellCall />);
    room.publish('u-drop', 'dropbear', 'screen_share');
    room.emit('trackPublished');
    expect(await screen.findByTestId('lounge-call-surface')).toBeInTheDocument();
    expect(actions.watchScreenShare).not.toHaveBeenCalled();
    click("Watch dropbear's screen");
    expect(actions.watchScreenShare).toHaveBeenCalledWith('u-drop');
  });

  it('a watched share shows its video; Stop watching calls the classic stop-watching function for each tile shown', async () => {
    const track = { attach: vi.fn((el: HTMLMediaElement) => el), detach: vi.fn((el: HTMLMediaElement) => el) };
    room.publish('u-drop', 'dropbear', 'screen_share', track);
    room.publish('u-pri', 'pri', 'camera', track);
    m.state = {
      ...IN_CHANNEL(),
      watchingScreenShares: new Set(['u-drop']),
      watchingCameras: new Set(['u-pri']),
    };
    renderWithKit(<ShellCall />);
    await screen.findByTestId('lounge-call-surface');
    expect(screen.getByRole('group', { name: "dropbear's screen" })).toBeInTheDocument();
    expect(track.attach).toHaveBeenCalled();
    click('Stop watching');
    expect(actions.stopWatchingScreenShare).toHaveBeenCalledWith('u-drop');
    expect(actions.stopWatchingCamera).toHaveBeenCalledWith('u-pri');
    expect(m.state.showVideoTiles).toBeUndefined();
  });

  it('Stop watching also stops a watched camera that is turned off (no tile, still watched)', async () => {
    const track = { attach: vi.fn((el: HTMLMediaElement) => el), detach: vi.fn((el: HTMLMediaElement) => el) };
    room.publish('u-drop', 'dropbear', 'screen_share', track);
    room.publish('u-pri', 'pri', 'camera', null, true);
    m.state = { ...IN_CHANNEL(), watchingScreenShares: new Set(['u-drop']), watchingCameras: new Set(['u-pri']) };
    renderWithKit(<ShellCall />);
    await screen.findByTestId('lounge-call-surface');
    expect(screen.queryByRole('group', { name: 'pri' })).toBeNull();
    click('Stop watching');
    expect(actions.stopWatchingScreenShare).toHaveBeenCalledWith('u-drop');
    expect(actions.stopWatchingCamera).toHaveBeenCalledWith('u-pri');
  });

  it.each([
    ['the share ends (unpublished)', () => room.unpublish('u-drop', 'screen_share'), 'trackUnpublished'],
    ['the sharer leaves', () => room.leave('u-drop'), 'participantDisconnected'],
  ])('a watched share: when %s, the tile goes and its track is detached from its element', async (_name, end, event) => {
    const track = { attach: vi.fn((el: HTMLMediaElement) => el), detach: vi.fn((el: HTMLMediaElement) => el) };
    room.publish('u-drop', 'dropbear', 'screen_share', track);
    room.publish('u-pri', 'pri', 'camera');
    m.state = { ...IN_CHANNEL(), watchingScreenShares: new Set(['u-drop']) };
    renderWithKit(<ShellCall />);
    await screen.findByRole('group', { name: "dropbear's screen" });
    expect(track.attach).toHaveBeenCalledTimes(1);
    const element = track.attach.mock.calls[0][0];
    end();
    room.emit(event);
    expect(screen.queryByRole('group', { name: "dropbear's screen" })).toBeNull();
    expect(track.detach).toHaveBeenCalledTimes(1);
    expect(track.detach).toHaveBeenCalledWith(element);
    expect(track.attach).toHaveBeenCalledTimes(1);
  });

  it('a speaking change re-renders the tile without attaching again', async () => {
    const track = { attach: vi.fn((el: HTMLMediaElement) => el), detach: vi.fn((el: HTMLMediaElement) => el) };
    room.publish('u-drop', 'dropbear', 'screen_share', track);
    m.state = { ...IN_CHANNEL(), watchingScreenShares: new Set(['u-drop']) };
    const { rerender } = renderWithKit(<ShellCall />);
    await screen.findByRole('group', { name: "dropbear's screen" });
    m.speaking = new Map([['u-drop', true]]);
    rerender(<ShellCall />);
    expect(screen.getByRole('group', { name: "dropbear's screen, speaking" })).toBeInTheDocument();
    m.speaking = new Map([['u-drop', false]]);
    rerender(<ShellCall />);
    expect(track.attach).toHaveBeenCalledTimes(1);
    expect(track.detach).not.toHaveBeenCalled();
  });

  it('more than three offered: a summary row counts them all above the first three', async () => {
    for (const name of ['a1', 'a2', 'a3', 'a4', 'a5']) room.publish(`u-${name}`, name, 'camera');
    room.publish('u-drop', 'dropbear', 'screen_share');
    renderWithKit(<ShellCall />);
    await screen.findByTestId('lounge-call-surface');
    expect(screen.getAllByRole('button', { name: /^Watch / }).map((b) => b.getAttribute('aria-label'))).toEqual([
      "Watch dropbear's screen",
      'Watch a1',
      'Watch a2',
    ]);
    expect(screen.getAllByText('1 screen shared · 5 cameras on').length).toBeGreaterThan(0);
    click('See all in the call view');
    expect(mockNavigate).toHaveBeenCalledWith('/community/c-1/channel/vc-1');
  });

  it('shares come first, then cameras', async () => {
    room.publish('u-pri', 'pri', 'camera');
    room.publish('u-drop', 'dropbear', 'screen_share');
    renderWithKit(<ShellCall />);
    await screen.findByTestId('lounge-call-surface');
    const watch = screen.getAllByRole('button', { name: /^Watch / }).map((b) => b.getAttribute('aria-label'));
    expect(watch).toEqual(["Watch dropbear's screen", 'Watch pri']);
  });

  it('your own share: Stop sharing calls the classic toggleScreenShare', async () => {
    m.media = { ...m.media, isScreenShareEnabled: true };
    renderWithKit(<ShellCall />);
    await screen.findByTestId('lounge-call-surface');
    fireEvent.click(within(screen.getByTestId('lounge-call-surface')).getByRole('button', { name: 'Stop sharing' }));
    expect(actions.toggleScreenShare).toHaveBeenCalledTimes(1);
  });

  it("while the keyboard is up, the one-line summary keeps Stop sharing (the surface's is hidden then)", async () => {
    m.media = { ...m.media, isScreenShareEnabled: true };
    renderWithKit(<ShellCall />);
    await screen.findByTestId('lounge-call-surface');
    const summary = screen.getByTestId('lounge-call-summary');
    fireEvent.click(within(summary).getByRole('button', { name: 'Stop sharing', hidden: true }));
    expect(actions.toggleScreenShare).toHaveBeenCalledTimes(1);
  });

  it('the surface has no Open call view of its own (the room name is it); See all stays', async () => {
    for (const name of ['a1', 'a2', 'a3', 'a4']) room.publish(`u-${name}`, name, 'camera');
    const track = { attach: vi.fn((el: HTMLMediaElement) => el), detach: vi.fn((el: HTMLMediaElement) => el) };
    room.publish('u-drop', 'dropbear', 'screen_share', track);
    m.state = { ...IN_CHANNEL(), watchingScreenShares: new Set(['u-drop']) };
    renderWithKit(<ShellCall />);
    const surface = await screen.findByTestId('lounge-call-surface');
    expect(within(surface).queryByRole('button', { name: /open call view/i })).toBeNull();
    expect(within(surface).getByRole('button', { name: 'See all in the call view' })).toBeInTheDocument();
  });

  it('stops listening to the room when it unmounts', () => {
    const { unmount } = renderWithKit(<ShellCall />);
    expect(room.listeners()).toBeGreaterThan(0);
    unmount();
    expect(room.listeners()).toBe(0);
  });
});

describe('useCallSlotShown agrees with what the slot renders', () => {
  const states: [string, () => Record<string, unknown>, boolean][] = [
    ['in a call', IN_CHANNEL, true],
    ['joining', () => ({ ...IN_CHANNEL(), isConnected: false, isConnecting: true }), true],
    ['no call, no notice', () => ({ ...IN_CHANNEL(), isConnected: false, currentChannelId: null, room: null }), false],
    [
      'a notice',
      () => ({ ...IN_CHANNEL(), isConnected: false, currentChannelId: null, room: null, lastEnded: { reason: 'duplicate_identity', error: null, at: 1 } }),
      true,
    ],
    [
      'a notice while a new join runs (before its place is known)',
      () => ({
        ...IN_CHANNEL(),
        isConnected: false,
        isConnecting: true,
        currentChannelId: null,
        room: null,
        lastEnded: { reason: 'duplicate_identity', error: null, at: 1 },
      }),
      false,
    ],
  ];
  it.each(states)('%s', (_name, state, shown) => {
    m.state = state();
    expect(renderHook(() => useCallSlotShown()).result.current).toBe(shown);
    const { container } = renderWithKit(<ShellCall />);
    expect(container.textContent !== '').toBe(shown);
  });
});
