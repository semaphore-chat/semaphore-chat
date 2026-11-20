import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { VoiceSessionType } from '../../contexts/VoiceContext';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}));

const actions = {
  toggleMute: vi.fn(),
  toggleDeafen: vi.fn(),
  leaveVoiceChannel: vi.fn(),
  cancelReconnect: vi.fn(),
  revealVideoTiles: vi.fn(),
  toggleScreenShare: vi.fn().mockResolvedValue(undefined),
};
const m = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  media: { isMicrophoneEnabled: true, isCameraEnabled: false, isScreenShareEnabled: false },
  ptt: { isActive: false, isKeyHeld: false, currentKeyDisplay: 'V' },
  publish: { canSpeak: true, canVideo: true, canShare: true, speakBlockedReason: 'Timed out — you can listen until 10:30' },
  speaking: new Map<string, boolean>(),
}));
const pttPress = vi.fn().mockResolvedValue(undefined);
const pttRelease = vi.fn().mockResolvedValue(undefined);

vi.mock('../../hooks/useVoiceConnection', () => ({ useVoiceConnection: () => ({ state: m.state, actions }) }));
vi.mock('../../hooks/useLocalMediaState', () => ({ useLocalMediaState: () => m.media }));
vi.mock('../../hooks/usePushToTalk', () => ({
  usePushToTalkStatus: () => ({ ...m.ptt, inputMode: 'voice_activity', pttPress, pttRelease }),
}));
vi.mock('../../hooks/useVoicePublishPermissions', () => ({ useVoicePublishPermissions: () => m.publish }));
vi.mock('../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ user: { id: 'me' } }) }));
vi.mock('../../hooks/useSpeaking', () => ({
  useSpeaking: () => ({ speakingMap: m.speaking, isSpeaking: (id: string) => !!m.speaking.get(id) }),
}));

import { useCallBarModel } from '../../data/callBar';

const room = {
  remoteParticipants: new Map([
    ['u-drop', { identity: 'u-drop', name: 'dropbear' }],
    ['u-pri', { identity: 'u-pri', name: 'pri' }],
  ]),
};

const IN_CHANNEL = {
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
  room,
};

beforeEach(() => {
  vi.clearAllMocks();
  m.state = { ...IN_CHANNEL };
  m.media = { isMicrophoneEnabled: true, isCameraEnabled: false, isScreenShareEnabled: false };
  m.ptt = { isActive: false, isKeyHeld: false, currentKeyDisplay: 'V' };
  m.publish = { ...m.publish, canSpeak: true };
  m.speaking = new Map();
});

const model = (touch = false) => renderHook(() => useCallBarModel(touch));

describe('useCallBarModel: the call', () => {
  it('is null when not in a call', () => {
    m.state = { ...IN_CHANNEL, isConnected: false, currentChannelId: null };
    expect(model().result.current).toBeNull();
  });

  it('is null connected with no channel or DM', () => {
    m.state = { ...IN_CHANNEL, currentChannelId: null };
    expect(model().result.current).toBeNull();
  });

  it('connected in a channel: the room, the classic route, "Voice Connected"', () => {
    const bar = model().result.current!;
    expect(bar.phase).toBe('connected');
    expect(bar.place).toEqual({ kind: 'channel', name: 'Squad Up', channelId: 'vc-1', communityId: 'c-1' });
    expect(bar.callViewPath).toBe('/community/c-1/channel/vc-1');
    expect(bar.kindLabel).toBe('Voice Connected');
    expect(bar.reconnectAttempt).toBeNull();
  });

  it('connecting: a join in progress', () => {
    m.state = { ...IN_CHANNEL, isConnected: false, isConnecting: true };
    expect(model().result.current!.phase).toBe('connecting');
  });

  it('reconnecting, with the attempt; Cancel hangs up', () => {
    m.state = { ...IN_CHANNEL, reconnect: { attempt: 2, maxAttempts: 5, nextRetryAt: null } };
    const bar = model().result.current!;
    expect(bar.phase).toBe('reconnecting');
    expect(bar.reconnectAttempt).toBe(2);
    bar.actions.cancel();
    expect(actions.cancelReconnect).toHaveBeenCalled();
  });

  it('a DM call: its name and the DM route', () => {
    m.state = { ...IN_CHANNEL, contextType: VoiceSessionType.Dm, currentChannelId: null, currentDmGroupId: 'dm-1', dmGroupName: 'Aiko' };
    const bar = model().result.current!;
    expect(bar.place).toEqual({ kind: 'dm', name: 'Aiko', dmGroupId: 'dm-1' });
    expect(bar.callViewPath).toBe('/direct-messages/dm-1');
    expect(bar.kindLabel).toBe('DM Voice Call');
  });

  it('fallback names when the context has none', () => {
    m.state = { ...IN_CHANNEL, channelName: null };
    expect(model().result.current!.place.name).toBe('Voice Channel');
    m.state = { ...IN_CHANNEL, contextType: VoiceSessionType.Dm, currentDmGroupId: 'dm-1', dmGroupName: null };
    expect(model().result.current!.place.name).toBe('Direct Message');
  });

  it('deafened', () => {
    m.state = { ...IN_CHANNEL, isDeafened: true };
    const bar = model().result.current!;
    expect(bar.deafened).toBe(true);
    bar.actions.toggleDeafen();
    expect(actions.toggleDeafen).toHaveBeenCalled();
  });

  it('who else is talking (never you)', () => {
    m.speaking = new Map([['me', true], ['u-drop', true]]);
    expect(model().result.current!.talking).toBe('dropbear');
    m.speaking = new Map([['me', true]]);
    expect(model().result.current!.talking).toBeNull();
  });

  it('sharing: Stop sharing stops it; it does nothing when not sharing', () => {
    m.media = { ...m.media, isScreenShareEnabled: true };
    const bar = model().result.current!;
    expect(bar.sharingScreen).toBe(true);
    bar.actions.stopSharing();
    expect(actions.toggleScreenShare).toHaveBeenCalledTimes(1);

    m.media = { ...m.media, isScreenShareEnabled: false };
    model().result.current!.actions.stopSharing();
    expect(actions.toggleScreenShare).toHaveBeenCalledTimes(1);
  });

  it('Open call view goes to the classic call route and shows the tiles', () => {
    model().result.current!.actions.openCallView();
    expect(mockNavigate).toHaveBeenCalledWith('/community/c-1/channel/vc-1');
    expect(actions.revealVideoTiles).toHaveBeenCalled();
  });

  it('Leave hangs up', () => {
    model().result.current!.actions.leave();
    expect(actions.leaveVoiceChannel).toHaveBeenCalled();
  });
});

describe('useCallBarModel: the mic', () => {
  it('voice activity: tap to mute, named "Mute", no description', () => {
    const { mic, actions: a } = model().result.current!;
    expect(mic).toMatchObject({ on: true, mode: 'toggle', label: 'Mute', title: 'Mute', description: null, tappable: true, keyLabel: null });
    a.toggleMute();
    expect(actions.toggleMute).toHaveBeenCalled();
  });

  it('muted: the tooltip offers Unmute', () => {
    m.media = { ...m.media, isMicrophoneEnabled: false };
    expect(model().result.current!.mic).toMatchObject({ on: false, title: 'Unmute', description: null });
  });

  it('speaking lights the mic only while it is on', () => {
    m.speaking = new Map([['me', true]]);
    expect(model().result.current!.mic.speaking).toBe(true);
    m.media = { ...m.media, isMicrophoneEnabled: false };
    expect(model().result.current!.mic.speaking).toBe(false);
  });

  it('push-to-talk key: "Hold V to talk", not tappable, then transmitting', () => {
    m.ptt = { isActive: true, isKeyHeld: false, currentKeyDisplay: 'V' };
    expect(model().result.current!.mic).toMatchObject({
      mode: 'pushToTalkKey', label: 'Mute', title: 'Hold V to talk', description: 'Hold V to talk', tappable: false, keyLabel: 'V', transmitting: false,
    });
    m.ptt = { isActive: true, isKeyHeld: true, currentKeyDisplay: 'V' };
    expect(model().result.current!.mic).toMatchObject({ title: 'Transmitting...', transmitting: true });
  });

  it('touch push-to-talk is hold-to-talk: its own name, press and release once', () => {
    m.ptt = { isActive: true, isKeyHeld: false, currentKeyDisplay: 'V' };
    const { result } = model(true);
    expect(result.current!.mic).toMatchObject({ mode: 'holdToTalk', label: 'Hold to talk', title: 'Hold to talk', description: null });

    act(() => {
      expect(result.current!.actions.holdStart()).toBe(true);
    });
    expect(pttPress).toHaveBeenCalledTimes(1);
    // pointerup, then lostpointercapture: one release
    expect(result.current!.actions.holdEnd()).toBe(true);
    expect(result.current!.actions.holdEnd()).toBe(false);
    expect(pttRelease).toHaveBeenCalledTimes(1);
  });

  it('server-muted: says so, not tappable, a hold never starts', () => {
    m.state = { ...IN_CHANNEL, isServerMuted: true };
    m.ptt = { isActive: true, isKeyHeld: false, currentKeyDisplay: 'V' };
    const { result } = model(true);
    expect(result.current!.mic).toMatchObject({
      serverMuted: true, tappable: false, title: 'Server Muted — contact a moderator', description: 'Server Muted — contact a moderator',
    });
    expect(result.current!.actions.holdStart()).toBe(false);
    expect(result.current!.actions.holdEnd()).toBe(false);
    expect(pttPress).not.toHaveBeenCalled();
  });

  it('server-muted without push-to-talk is not tappable either', () => {
    m.state = { ...IN_CHANNEL, isServerMuted: true };
    expect(model().result.current!.mic.tappable).toBe(false);
  });

  it('blocked (no SPEAK, or timed out) with the mic off: the reason, and the name stays "Mute"', () => {
    m.publish = { ...m.publish, canSpeak: false };
    m.media = { ...m.media, isMicrophoneEnabled: false };
    m.ptt = { isActive: true, isKeyHeld: false, currentKeyDisplay: 'V' };
    expect(model(true).result.current!.mic).toMatchObject({
      blocked: true, label: 'Mute', title: 'Timed out — you can listen until 10:30', description: 'Timed out — you can listen until 10:30',
    });
  });

  it('not blocked while a stray live mic can still be turned off', () => {
    m.publish = { ...m.publish, canSpeak: false };
    expect(model().result.current!.mic.blocked).toBe(false);
  });
});

describe('useCallBarModel: identity and routes', () => {
  it('keeps the same actions object across renders while the call is unchanged', () => {
    const { result, rerender } = model();
    const before = result.current!.actions;
    rerender();
    expect(result.current!.actions).toBe(before);
  });

  it('never builds a "/community/null/..." route', () => {
    m.state = { ...IN_CHANNEL, communityId: null };
    const bar = model().result.current!;
    expect(bar.callViewPath).toBe('/');
    bar.actions.openCallView();
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });
});
