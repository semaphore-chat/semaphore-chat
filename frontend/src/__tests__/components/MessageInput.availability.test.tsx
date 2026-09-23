import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, act } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { renderInEveryTheme } from '../test-utils/themeMatrix';
import MessageInput from '../../components/Message/MessageInput';
import { ComposerUnavailableNotice } from '../../components/Message/MessageInput';
import { VoiceSessionType } from '../../contexts/VoiceContext';
import type { ComposerAvailability } from '../../hooks/useComposerAvailability';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

vi.mock('../../components/Common/UserAvatar', () => ({
  default: () => <div data-testid="avatar" />,
}));

const mockAvailability = vi.fn<() => ComposerAvailability>(() => ({ state: 'ok' }));
vi.mock('../../hooks/useComposerAvailability', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useComposerAvailability: () => mockAvailability(),
}));

function renderInput() {
  return renderWithProviders(
    <MessageInput
      contextType={VoiceSessionType.Channel}
      contextId="channel-1"
      communityId="community-1"
      userMentions={[]}
      onSendMessage={vi.fn()}
    />,
  );
}

function expectComposerGone() {
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /send/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /attach file/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /add emoji/i })).not.toBeInTheDocument();
}

describe('MessageInput availability', () => {
  beforeEach(() => {
    mockAvailability.mockReset();
    mockAvailability.mockReturnValue({ state: 'ok' });
  });

  it('renders the normal composer when ok', () => {
    renderInput();
    expect(screen.getByPlaceholderText('Type a message...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows a no-permission notice naming the channel, with no composer', () => {
    mockAvailability.mockReturnValue({ state: 'no-permission', channelName: 'announcements' });
    renderInput();
    expect(screen.getByRole('status')).toHaveTextContent("You can't send messages in #announcements");
    expectComposerGone();
  });

  it('falls back to "this channel" when the channel name is unknown', () => {
    mockAvailability.mockReturnValue({ state: 'no-permission' });
    renderInput();
    expect(screen.getByRole('status')).toHaveTextContent("You can't send messages in this channel");
  });

  it('shows a timed-out notice with the time left, with no composer', () => {
    mockAvailability.mockReturnValue({
      state: 'timed-out',
      until: new Date(Date.now() + 12 * 60_000),
      remainingMs: 12 * 60_000 - 500,
    });
    renderInput();
    expect(screen.getByRole('status')).toHaveTextContent('Timed out, 12 min left');
    expectComposerGone();
  });

  it('updates the countdown as the remaining time changes', () => {
    mockAvailability.mockReturnValue({ state: 'timed-out', remainingMs: 2 * 60_000 });
    const { rerender } = renderInput();
    expect(screen.getByRole('status')).toHaveTextContent('Timed out, 2 min left');
    mockAvailability.mockReturnValue({ state: 'timed-out', remainingMs: 42_000 });
    act(() => {
      rerender(
        <MessageInput
          contextType={VoiceSessionType.Channel}
          contextId="channel-1"
          communityId="community-1"
          userMentions={[]}
          onSendMessage={vi.fn()}
        />,
      );
    });
    expect(screen.getByRole('status')).toHaveTextContent('Timed out, 42 s left');
  });

  it('formats long timeouts in hours and minutes', () => {
    mockAvailability.mockReturnValue({ state: 'timed-out', remainingMs: (2 * 60 + 5) * 60_000 });
    renderInput();
    expect(screen.getByRole('status')).toHaveTextContent('Timed out, 2 h 5 min left');
  });

  it('shows a banned notice with no composer', () => {
    mockAvailability.mockReturnValue({ state: 'banned' });
    renderInput();
    expect(screen.getByRole('status')).toHaveTextContent(/banned/i);
    expectComposerGone();
  });

  it('includes the reason when one is known', () => {
    mockAvailability.mockReturnValue({ state: 'timed-out', remainingMs: 5 * 60_000, reason: 'Spamming' });
    renderInput();
    expect(screen.getByRole('status')).toHaveTextContent('Spamming');
  });

  it('renders every notice under all theme intensities and modes', () => {
    const states: ComposerAvailability[] = [
      { state: 'no-permission', channelName: 'general' },
      { state: 'timed-out', remainingMs: 60_000 },
      { state: 'banned' },
    ];
    for (const availability of states) {
      renderInEveryTheme(<ComposerUnavailableNotice availability={availability} />, (result) => {
        expect(result.getByRole('status')).toBeInTheDocument();
      });
    }
  });
});
