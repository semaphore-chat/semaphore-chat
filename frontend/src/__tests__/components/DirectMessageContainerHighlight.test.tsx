import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { renderWithProviders } from '../test-utils';
import DirectMessageContainer from '../../components/DirectMessages/DirectMessageContainer';
import { useJumpToMessage } from '../../hooks/useJumpToMessage';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

vi.mock('../../components/Message/MessageContainerWrapper', () => ({
  default: () => <div data-testid="message-container" />,
}));
vi.mock('../../components/Message/MemberListContainer', () => ({
  default: () => null,
}));
vi.mock('../../hooks/useMessageFileUpload', () => ({
  useMessageFileUpload: () => ({ handleSendMessage: vi.fn() }),
}));
vi.mock('../../hooks/useAutoMarkNotificationsRead', () => ({
  useAutoMarkNotificationsRead: vi.fn(),
}));

const jumpResult = (isJumpPending: boolean) => ({
  messages: [],
  isLoading: false,
  error: null,
  mode: 'normal' as const,
  jumpToPresent: vi.fn(),
  highlightMessageId: 'target-msg',
  highlightSeq: 1,
  isJumpPending,
});

vi.mock('../../hooks/useJumpToMessage', () => ({
  useJumpToMessage: vi.fn(),
}));

const LocationProbe = () => {
  const location = useLocation();
  return <span data-testid="location">{location.pathname + location.search}</span>;
};

const renderAt = (url: string) =>
  renderWithProviders(
    <>
      <DirectMessageContainer dmGroupId="dm-123" />
      <LocationProbe />
    </>,
    { routerProps: { initialEntries: [url] } },
  );

describe('DirectMessageContainer — ?highlight deep link', () => {
  beforeEach(() => {
    vi.mocked(useJumpToMessage).mockReset();
  });

  it('keeps ?highlight in the URL while the jump target is still loading', async () => {
    vi.mocked(useJumpToMessage).mockReturnValue(jumpResult(true) as never);
    renderAt('/direct-messages?group=dm-123&highlight=target-msg');

    await screen.findByTestId('message-container');
    expect(screen.getByTestId('location')).toHaveTextContent('highlight=target-msg');
    expect(useJumpToMessage).toHaveBeenCalledWith('dm', 'dm-123', 'target-msg');
  });

  it('clears ?highlight from the URL once the jump has settled', async () => {
    vi.mocked(useJumpToMessage).mockReturnValue(jumpResult(false) as never);
    renderAt('/direct-messages?group=dm-123&highlight=target-msg');

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/direct-messages?group=dm-123'),
    );
    expect(screen.getByTestId('location')).not.toHaveTextContent('highlight');
  });

  it('keeps the /direct-messages/:id path when clearing ?highlight (touch layouts parse the path)', async () => {
    vi.mocked(useJumpToMessage).mockReturnValue(jumpResult(false) as never);
    renderAt('/direct-messages/dm-123?highlight=target-msg');

    await waitFor(() =>
      expect(screen.getByTestId('location')).not.toHaveTextContent('highlight'),
    );
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/direct-messages\/dm-123$/);
  });
});
