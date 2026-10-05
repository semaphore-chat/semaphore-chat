import { describe, it, expect } from 'vitest';
import { act, screen } from '@testing-library/react';
import { renderWithProviders, createTestQueryClient, createChannel } from '../test-utils';
import { MessageSpan, HIDDEN_CHANNEL_MENTION_LABEL } from '../../components/Message/MessageSpan';
import { SpanType } from '../../types/message.type';
import { channelsControllerFindAllForCommunityQueryKey } from '../../api-client/@tanstack/react-query.gen';

const listKey = (communityId: string) =>
  channelsControllerFindAllForCommunityQueryKey({ path: { communityId } });

describe('#channel mention spans', () => {
  it('a channel in the reader\'s visible list renders as a #name link to it', () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(listKey('co-1'), [
      createChannel({ id: 'ch-1', name: 'release-notes', communityId: 'co-1' }),
    ]);
    renderWithProviders(
      <MessageSpan span={{ type: SpanType.CHANNEL_MENTION, channelId: 'ch-1' }} index={0} />,
      { queryClient },
    );
    const link = screen.getByTestId('channel-mention');
    expect(link).toHaveTextContent('#release-notes');
    expect(link).toHaveAttribute('href', '/community/co-1/channel/ch-1');
  });

  it('a channel the reader cannot see renders as a non-interactive #private-channel', () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(listKey('co-1'), [
      createChannel({ id: 'ch-1', name: 'release-notes', communityId: 'co-1' }),
    ]);
    renderWithProviders(
      <MessageSpan span={{ type: SpanType.CHANNEL_MENTION, channelId: 'hidden' }} index={0} />,
      { queryClient },
    );
    const hidden = screen.getByTestId('channel-mention-hidden');
    expect(hidden).toHaveTextContent(HIDDEN_CHANNEL_MENTION_LABEL);
    expect(hidden.tagName).toBe('SPAN');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('never shows text stored on the span (spans carry no channel name)', () => {
    renderWithProviders(
      <MessageSpan
        span={{ type: SpanType.CHANNEL_MENTION, channelId: 'hidden', text: '#leaked-name' }}
        index={0}
      />,
    );
    expect(screen.queryByText(/leaked-name/)).not.toBeInTheDocument();
    expect(screen.getByText(HIDDEN_CHANNEL_MENTION_LABEL)).toBeInTheDocument();
  });

  it('updates when the channel list arrives', () => {
    const queryClient = createTestQueryClient();
    renderWithProviders(
      <MessageSpan span={{ type: SpanType.CHANNEL_MENTION, channelId: 'ch-1' }} index={0} />,
      { queryClient },
    );
    expect(screen.getByTestId('channel-mention-hidden')).toBeInTheDocument();
    act(() => {
      queryClient.setQueryData(listKey('co-1'), [
        createChannel({ id: 'ch-1', name: 'general', communityId: 'co-1' }),
      ]);
    });
    expect(screen.getByTestId('channel-mention')).toHaveTextContent('#general');
  });

  it('a mention the server redacted (channelId null) renders as #private-channel', () => {
    renderWithProviders(
      <MessageSpan span={{ type: SpanType.CHANNEL_MENTION, channelId: null }} index={0} />,
    );
    expect(screen.getByTestId('channel-mention-hidden')).toHaveTextContent(
      HIDDEN_CHANNEL_MENTION_LABEL,
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
