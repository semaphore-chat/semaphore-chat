/**
 * One failed join, one notice: a Join pressed on the community island's voice room that fails shows exactly one
 * visible notice in the Lounge (the call slot's voice notice, with Retry), and no toast. The island and the call
 * slot are rendered together inside the kit's AppFrame (which owns the toast region), over the real join
 * (`useJoinVoiceRoom`) and the real notice (`useVoiceNotice`); the voice connection is a fake whose join records the
 * failure in the voice state, as the classic join path does.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { VoiceFailureKind, VoiceSessionType } from '../../../contexts/VoiceContext';

const m = vi.hoisted(() => ({ state: {} as Record<string, unknown>, rerender: () => {} }));

const joinVoiceChannel = vi.fn();
vi.mock('../../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => ({ state: m.state, actions: { joinVoiceChannel, leaveVoiceChannel: vi.fn() } }),
}));
vi.mock('../../../contexts/VoiceContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../contexts/VoiceContext')>()),
  useVoiceDispatch: () => ({ dispatch: vi.fn() }),
  useVoice: () => m.state,
}));
// Out of a call: the slot shows the notice (or nothing); the bar's model is null.
vi.mock('../../../data/callBar', () => ({ useCallBarModel: () => null }));
vi.mock('../../../data/callVideo', () => ({ useCallVideo: () => null }));
vi.mock('../../../data/touchFirst', () => ({ useTouchFirst: () => false }));
vi.mock('../../../data/voiceRoom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../data/voiceRoom')>()),
  useVoiceRoomPeople: () => ({ people: [], speaking: new Set(), youAreHere: false }),
}));
vi.mock('../../../hooks/useChannelPermissions', () => ({ useChannelPermissions: () => ({ can: () => true }) }));
vi.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ user: { id: 'me' } }) }));
vi.mock('../../../hooks/useAuthenticatedImage', () => ({ useAuthenticatedImage: () => ({ blobUrl: null }) }));
vi.mock('../../../hooks/useSound', () => ({ playSound: vi.fn(), Sounds: { error: 'error' } }));
vi.mock('../../../utils/logger', () => ({
  logger: { dev: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { AppFrame } from '../../../kit';
import { ShellCall } from '../../../shell/lounge/pieces/call/ShellCall';
import { VoiceRoomCardConnected } from '../../../shell/lounge/pieces/community/VoiceRoomCard';
import { renderWithKit } from '../../test-utils/renderWithKit';
import { createChannel } from '../../test-utils';

const squad = createChannel({ id: 'vc-squad', name: 'Squad Up', type: 'VOICE', communityId: 'c-1', createdAt: '2026-01-01T00:00:00.000Z' });

function Lounge() {
  return (
    <AppFrame>
      <VoiceRoomCardConnected room={squad} communityId="c-1" />
      <ShellCall />
    </AppFrame>
  );
}

let consoleError: MockInstance;
beforeEach(() => {
  vi.clearAllMocks();
  consoleError = vi.spyOn(console, 'error');
  m.state = {
    isConnected: false,
    isConnecting: false,
    contextType: VoiceSessionType.Channel,
    currentChannelId: null,
    currentDmGroupId: null,
    joinFailure: null,
    lastEnded: null,
  };
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

describe('a failed join in the Lounge', () => {
  it('shows exactly one notice (the call slot), with Retry, and no toast', async () => {
    const { rerender } = renderWithKit(<Lounge />);
    // The classic join records the failure in the voice state, then rejects.
    joinVoiceChannel.mockImplementation(async () => {
      m.state = {
        ...m.state,
        joinFailure: {
          kind: VoiceFailureKind.ServerUnreachable,
          at: 1,
          target: { type: 'channel', channelId: 'vc-squad', channelName: 'Squad Up', communityId: 'c-1', isPrivate: false, createdAt: '2026-01-01T00:00:00.000Z' },
        },
      };
      throw new Error('503');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Join Squad Up' }));
    await waitFor(() => expect(joinVoiceChannel).toHaveBeenCalledTimes(1));
    await act(async () => {});
    rerender(<Lounge />);

    const notices = screen.getAllByTestId('lounge-voice-notice');
    expect(notices).toHaveLength(1);
    expect(within(notices[0]).getByRole('alert')).toHaveTextContent("Can't reach the voice server");
    expect(within(notices[0]).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    // No toast, and the failure's words appear once on the page.
    // The kit renders the toast region only while a toast shows.
    expect(screen.queryByRole('region', { name: 'Notifications' })).toBeNull();
    expect(screen.getAllByText("Can't reach the voice server")).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});
