import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import {
  VoiceActionType,
  VoiceEndReason,
  VoiceFailureKind,
  type VoiceJoinTarget,
} from '../../contexts/VoiceContext';

const mockDispatch = vi.fn();
const mockJoinVoiceChannel = vi.fn().mockResolvedValue(undefined);
const mockJoinDmVoice = vi.fn().mockResolvedValue(undefined);
let voiceState: Record<string, unknown> = {};

vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => ({
    state: voiceState,
    actions: { joinVoiceChannel: mockJoinVoiceChannel, joinDmVoice: mockJoinDmVoice },
  }),
}));

vi.mock('../../contexts/VoiceContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../contexts/VoiceContext')>();
  return { ...actual, useVoiceDispatch: () => ({ dispatch: mockDispatch, stateRef: { current: null } }) };
});

import { VoiceNotice } from '../../components/Voice/VoiceNotice';
import { VoiceBottomBar } from '../../components/Voice/VoiceBottomBar';
import { VOICE_FAILURE_COPY } from '../../features/voice/joinFailure';
import { VOICE_END_DETAILS, VOICE_END_MESSAGES } from '../../features/voice/voiceEndReason';

const channel: VoiceJoinTarget = {
  type: 'channel',
  channelId: 'vc-1',
  channelName: 'Hangout',
  communityId: 'c1',
  isPrivate: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};
const dm: VoiceJoinTarget = { type: 'dm', dmGroupId: 'dm-1', dmGroupName: 'Alice' };

const base = { isConnected: false, isConnecting: false, joinFailure: null, lastEnded: null };
const failure = (kind: VoiceFailureKind, target: VoiceJoinTarget = channel) => ({
  ...base,
  joinFailure: { kind, error: 'raw error', target, at: 100 },
});
const ended = (reason: VoiceEndReason, target: VoiceJoinTarget | null = channel) => ({
  ...base,
  lastEnded: { reason, error: null, at: 100, target },
});

describe('VoiceNotice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    voiceState = { ...base };
  });

  it('renders nothing without a notice', () => {
    renderWithProviders(<VoiceNotice />);
    expect(screen.queryByTestId('voice-notice')).not.toBeInTheDocument();
  });

  describe('join failures', () => {
    it.each(Object.values(VoiceFailureKind))('%s: title, message and Retry only when it can help', (kind) => {
      voiceState = failure(kind);
      renderWithProviders(<VoiceNotice />);

      const copy = VOICE_FAILURE_COPY[kind];
      const notice = screen.getByTestId('voice-notice');
      expect(notice).toHaveTextContent(copy.title);
      expect(notice).toHaveTextContent(copy.message);
      expect(!!screen.queryByRole('button', { name: 'Retry' })).toBe(copy.retryable);
    });

    it('Retry rejoins the channel that failed', async () => {
      voiceState = failure(VoiceFailureKind.MediaUnreachable);
      const { user } = renderWithProviders(<VoiceNotice />);

      await user.click(screen.getByRole('button', { name: 'Retry' }));
      expect(mockJoinVoiceChannel).toHaveBeenCalledWith('vc-1', 'Hangout', 'c1', false, '2026-01-01T00:00:00.000Z');
    });

    it('Retry rejoins a DM call', async () => {
      voiceState = failure(VoiceFailureKind.ServerError, dm);
      const { user } = renderWithProviders(<VoiceNotice />);

      await user.click(screen.getByRole('button', { name: 'Retry' }));
      expect(mockJoinDmVoice).toHaveBeenCalledWith('dm-1', 'Alice');
    });

    it('a failing Retry is swallowed (the next notice explains it)', async () => {
      mockJoinVoiceChannel.mockRejectedValueOnce(new Error('again'));
      voiceState = failure(VoiceFailureKind.MediaUnreachable);
      const { user } = renderWithProviders(<VoiceNotice />);

      await user.click(screen.getByRole('button', { name: 'Retry' }));
      expect(mockJoinVoiceChannel).toHaveBeenCalled();
    });

    it('disables Retry while a join is in progress', () => {
      voiceState = { ...failure(VoiceFailureKind.MediaUnreachable), isConnecting: true };
      renderWithProviders(<VoiceNotice />);
      expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled();
    });
  });

  describe('why a call ended', () => {
    it.each(Object.values(VoiceEndReason))('%s', (reason) => {
      voiceState = ended(reason);
      renderWithProviders(<VoiceNotice />);

      const notice = screen.getByTestId('voice-notice');
      expect(notice).toHaveTextContent(VOICE_END_MESSAGES[reason]);
      expect(notice).toHaveTextContent(VOICE_END_DETAILS[reason]);
      expect(!!screen.queryByRole('button', { name: 'Retry' })).toBe(reason === VoiceEndReason.ReconnectFailed);
    });

    it('"You joined from another device" for a duplicate identity', () => {
      voiceState = ended(VoiceEndReason.DuplicateIdentity);
      renderWithProviders(<VoiceNotice />);
      expect(screen.getByTestId('voice-notice')).toHaveTextContent('You joined from another device');
    });

    it('Retry after ReconnectFailed rejoins the call that dropped', async () => {
      voiceState = ended(VoiceEndReason.ReconnectFailed);
      const { user } = renderWithProviders(<VoiceNotice />);

      await user.click(screen.getByRole('button', { name: 'Retry' }));
      expect(mockJoinVoiceChannel).toHaveBeenCalledWith('vc-1', 'Hangout', 'c1', false, '2026-01-01T00:00:00.000Z');
    });

    it('no Retry after ReconnectFailed when the target is unknown', () => {
      voiceState = ended(VoiceEndReason.ReconnectFailed, null);
      renderWithProviders(<VoiceNotice />);
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    });
  });

  it('shows the newer of a join failure and an ended call', () => {
    voiceState = {
      ...base,
      joinFailure: { kind: VoiceFailureKind.Permission, error: null, target: channel, at: 200 },
      lastEnded: { reason: VoiceEndReason.ReconnectFailed, error: null, at: 100, target: channel },
    };
    renderWithProviders(<VoiceNotice />);
    expect(screen.getByTestId('voice-notice')).toHaveTextContent(VOICE_FAILURE_COPY[VoiceFailureKind.Permission].title);
  });

  it('dismissing clears the notice', async () => {
    voiceState = ended(VoiceEndReason.ParticipantRemoved);
    const { user } = renderWithProviders(<VoiceNotice />);

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(mockDispatch).toHaveBeenCalledWith({ type: VoiceActionType.ClearVoiceNotice });
  });

  describe('in the voice bar shell', () => {
    it('shows the notice where the bar would be when out of a call', () => {
      voiceState = failure(VoiceFailureKind.MediaUnreachable);
      renderWithProviders(<VoiceBottomBar />);
      expect(screen.getByTestId('voice-notice-shell')).toBeInTheDocument();
      expect(screen.getByTestId('voice-notice')).toBeInTheDocument();
    });

    it('hides it while a join is in progress', () => {
      voiceState = { ...failure(VoiceFailureKind.MediaUnreachable), isConnecting: true };
      renderWithProviders(<VoiceBottomBar />);
      expect(screen.queryByTestId('voice-notice-shell')).not.toBeInTheDocument();
    });

    it('renders nothing when there is nothing to say', () => {
      const { container } = renderWithProviders(<VoiceBottomBar />);
      expect(container.querySelector('[data-testid="voice-notice-shell"]')).toBeNull();
    });
  });
});
