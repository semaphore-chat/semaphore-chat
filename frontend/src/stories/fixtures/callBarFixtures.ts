/**
 * A fake of the call model (`data/callBar`, `data/voiceNotice`, `data/callVideo`) for the call bar, notice
 * and surface stories and component tests: plain objects in every phase and mic mode, no LiveKit.
 */
import type { CallBarActions, CallBarMic, CallBarModel } from '../../data/callBar';
import type { VoiceNotice } from '../../data/voiceNotice';
import type { CallVideoTile, CallVideoTrack } from '../../data/callVideo';

const noop = () => undefined;

export function fakeCallBarActions(overrides: Partial<CallBarActions> = {}): CallBarActions {
  return {
    toggleMute: noop,
    toggleDeafen: noop,
    leave: noop,
    cancel: noop,
    stopSharing: noop,
    openCallView: noop,
    holdStart: () => true,
    holdEnd: () => true,
    ...overrides,
  };
}

const MIC_LIVE: CallBarMic = {
  on: true,
  label: 'Mute',
  title: 'Mute',
  description: null,
  blocked: false,
  serverMuted: false,
  mode: 'toggle',
  tappable: true,
  keyLabel: null,
  transmitting: false,
  speaking: false,
};

/** The mic in each state the classic bar knows, as `useCallBarModel` builds it. */
export const MIC = {
  live: MIC_LIVE,
  muted: { ...MIC_LIVE, on: false, title: 'Unmute' },
  speaking: { ...MIC_LIVE, speaking: true },
  serverMuted: {
    ...MIC_LIVE,
    on: false,
    serverMuted: true,
    tappable: false,
    title: 'Server Muted — contact a moderator',
    description: 'Server Muted — contact a moderator',
  },
  blocked: {
    ...MIC_LIVE,
    on: false,
    blocked: true,
    title: "You can't speak in this room",
    description: "You can't speak in this room",
  },
  pttIdle: {
    ...MIC_LIVE,
    on: false,
    mode: 'pushToTalkKey',
    tappable: false,
    keyLabel: 'V',
    title: 'Hold V to talk',
    description: 'Hold V to talk',
  },
  pttHeld: {
    ...MIC_LIVE,
    on: true,
    mode: 'pushToTalkKey',
    tappable: false,
    keyLabel: 'V',
    transmitting: true,
    title: 'Transmitting...',
    description: 'Transmitting...',
  },
  holdIdle: {
    ...MIC_LIVE,
    on: false,
    label: 'Hold to talk',
    mode: 'holdToTalk',
    tappable: false,
    keyLabel: 'V',
    title: 'Hold to talk',
    description: null,
  },
  holdHeld: {
    ...MIC_LIVE,
    on: true,
    label: 'Hold to talk',
    mode: 'holdToTalk',
    tappable: false,
    keyLabel: 'V',
    transmitting: true,
    title: 'Transmitting...',
    description: 'Transmitting...',
  },
  holdServerMuted: {
    ...MIC_LIVE,
    on: false,
    label: 'Hold to talk',
    mode: 'holdToTalk',
    tappable: false,
    keyLabel: 'V',
    serverMuted: true,
    title: 'Server Muted — contact a moderator',
    description: 'Server Muted — contact a moderator',
  },
  holdBlocked: {
    ...MIC_LIVE,
    on: false,
    label: 'Mute',
    mode: 'holdToTalk',
    tappable: false,
    keyLabel: 'V',
    blocked: true,
    title: "You can't speak in this room",
    description: "You can't speak in this room",
  },
} satisfies Record<string, CallBarMic>;

export function fakeCallBarModel(overrides: Partial<Omit<CallBarModel, 'actions'>> & { actions?: Partial<CallBarActions> } = {}): CallBarModel {
  const { actions, ...rest } = overrides;
  return {
    place: { kind: 'channel', name: 'Squad Up', channelId: 'vc-1', communityId: 'c-1' },
    phase: 'connected',
    reconnectAttempt: null,
    kindLabel: 'Voice Connected',
    mic: MIC.live,
    deafened: false,
    sharingScreen: false,
    talking: null,
    callViewPath: '/community/c-1/channel/vc-1',
    ...rest,
    actions: fakeCallBarActions(actions),
  };
}

export const DM_PLACE: CallBarModel['place'] = { kind: 'dm', name: 'aiko', dmGroupId: 'dm-1' };
export const LONG_PLACE: CallBarModel['place'] = {
  kind: 'channel',
  name: 'The extremely long voice room name for the Friday night co-op raid and the debrief after it',
  channelId: 'vc-2',
  communityId: 'c-1',
};

/** A failed join that Retry can help (the classic copy for "server unreachable"). */
export function fakeVoiceNotice(overrides: Partial<VoiceNotice> = {}): VoiceNotice {
  return {
    id: 'join-failure:server-unreachable:1',
    severity: 'error',
    title: "Can't reach the voice server",
    message: "Check your internet connection. If it's working, the voice server may be down or blocked: ask your admin.",
    retryTarget: {
      type: 'channel',
      channelId: 'vc-1',
      channelName: 'Squad Up',
      communityId: 'c-1',
      isPrivate: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    retry: () => Promise.resolve(),
    dismiss: noop,
    joining: false,
    ...overrides,
  };
}

/** Why a call ended, with no Retry (the classic copy for "another device"). */
export const ENDED_NOTICE: Partial<VoiceNotice> = {
  id: 'ended:duplicate-identity:2',
  severity: 'info',
  title: 'You joined from another device',
  message: 'Voice moved to the device you joined from last.',
  retryTarget: null,
};

/** A join to a room that is gone: no Retry (trying again can't help), as classic. */
export const NOT_FOUND_NOTICE: Partial<VoiceNotice> = {
  id: 'join-failure:not-found:3',
  severity: 'error',
  title: 'Voice channel not found',
  message: 'It may have been deleted.',
  retryTarget: null,
};

/** A track whose picture is a canvas stream (a story stand-in for a LiveKit video track). */
export function canvasTrack(colour: string, text: string): CallVideoTrack {
  let stream: MediaStream | null = null;
  const make = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = colour;
      ctx.fillRect(0, 0, 640, 360);
      ctx.fillStyle = '#ffffff';
      ctx.font = '32px sans-serif';
      ctx.fillText(text, 32, 64);
    }
    return typeof canvas.captureStream === 'function' ? canvas.captureStream(1) : null;
  };
  return {
    attach(element) {
      stream ??= make();
      element.srcObject = stream;
      return element;
    },
    detach(element) {
      element.srcObject = null;
      return element;
    },
  };
}

export function fakeTile(overrides: Partial<CallVideoTile> = {}): CallVideoTile {
  return {
    id: 'u-drop:screen',
    identity: 'u-drop',
    name: 'dropbear',
    kind: 'screen',
    watched: false,
    track: null,
    speaking: false,
    ...overrides,
  };
}
