import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import DirectMessageContainer from '../../components/DirectMessages/DirectMessageContainer';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

// Mock heavy child components
let capturedWrapperProps: Record<string, unknown> = {};
vi.mock('../../components/Message/MessageContainerWrapper', () => ({
  default: (props: Record<string, unknown>) => {
    capturedWrapperProps = props;
    return (
      <div data-testid="message-container">
        <span data-testid="context-type">{String(props.contextType)}</span>
        <span data-testid="context-id">{String(props.contextId)}</span>
        <span data-testid="placeholder">{String(props.placeholder)}</span>
        <span data-testid="empty-state">{String(props.emptyStateMessage)}</span>
      </div>
    );
  },
}));

vi.mock('../../components/Message/MemberListContainer', () => ({
  default: (props: { contextType: string; contextId: string }) => (
    <div data-testid="member-list" data-context-type={props.contextType} data-context-id={props.contextId} />
  ),
}));

// Mock hooks that are hard to provide in test context
vi.mock('../../hooks/useMessages', () => ({
  useMessages: () => ({
    messages: [],
    isLoading: false,
    error: null,
    continuationToken: undefined,
    isLoadingMore: false,
    onLoadMore: vi.fn(),
  }),
}));

vi.mock('../../hooks/useMessageFileUpload', () => ({
  useMessageFileUpload: () => ({ handleSendMessage: vi.fn() }),
}));

vi.mock('../../hooks/useAutoMarkNotificationsRead', () => ({
  useAutoMarkNotificationsRead: vi.fn(),
}));

describe('DirectMessageContainer', () => {
  it('passes correct context props to MessageContainerWrapper', async () => {
    renderWithProviders(<DirectMessageContainer dmGroupId="dm-123" />);

    await waitFor(() => {
      expect(screen.getByTestId('context-type')).toHaveTextContent('dm');
    });
    expect(screen.getByTestId('context-id')).toHaveTextContent('dm-123');
  });

  it('passes DM placeholder text', async () => {
    renderWithProviders(<DirectMessageContainer dmGroupId="dm-123" />);

    await waitFor(() => {
      expect(screen.getByTestId('placeholder')).toHaveTextContent('Message @Other User');
    });
  });

  it('passes empty state message', async () => {
    renderWithProviders(<DirectMessageContainer dmGroupId="dm-123" />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toHaveTextContent('No messages yet. Start the conversation!');
    });
  });

  it('passes member list component with correct context', async () => {
    renderWithProviders(<DirectMessageContainer dmGroupId="dm-123" />);

    await waitFor(() => {
      expect(capturedWrapperProps.memberListComponent).toBeDefined();
    });
  });
});
