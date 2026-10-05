import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { ThreadMessageInput } from '../../components/Thread/ThreadMessageInput';
import { VoiceSessionType } from '../../contexts/VoiceContext';
import type {
  ComposerAvailability,
  UseComposerAvailabilityOptions,
} from '../../hooks/useComposerAvailability';

const mockAvailability = vi.fn<(o: UseComposerAvailabilityOptions) => ComposerAvailability>(() => ({ state: 'ok' }));
vi.mock('../../hooks/useComposerAvailability', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useComposerAvailability: (options: UseComposerAvailabilityOptions) => mockAvailability(options),
}));

describe('ThreadMessageInput availability', () => {
  beforeEach(() => {
    mockAvailability.mockReset();
    mockAvailability.mockReturnValue({ state: 'ok' });
  });

  it('asks for the thread-reply capability of the parent\'s channel', () => {
    renderWithProviders(
      <ThreadMessageInput parentMessageId="msg-1" communityId="community-1" channelId="channel-1" />,
    );
    expect(mockAvailability).toHaveBeenCalledWith({
      contextType: VoiceSessionType.Channel,
      contextId: 'channel-1',
      communityId: 'community-1',
      thread: true,
    });
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('DM threads are a DM context (always ok)', () => {
    renderWithProviders(<ThreadMessageInput parentMessageId="msg-1" />);
    expect(mockAvailability).toHaveBeenCalledWith(
      expect.objectContaining({ contextType: VoiceSessionType.Dm, thread: true }),
    );
  });

  it('shows the read-only notice instead of the reply box', () => {
    mockAvailability.mockReturnValue({
      state: 'read-only',
      channelName: 'announcements',
      postingRoleNames: ['Moderator'],
    });
    renderWithProviders(
      <ThreadMessageInput parentMessageId="msg-1" communityId="community-1" channelId="channel-1" />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      '#announcements is read-only. Only Moderator can post.',
    );
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('shows the timeout notice while timed out', () => {
    mockAvailability.mockReturnValue({ state: 'timed-out', remainingMs: 5 * 60_000 });
    renderWithProviders(
      <ThreadMessageInput parentMessageId="msg-1" communityId="community-1" channelId="channel-1" />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Timed out, 5 min left');
  });
});
