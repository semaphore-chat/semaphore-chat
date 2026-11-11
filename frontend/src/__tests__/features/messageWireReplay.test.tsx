import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, type InfiniteData } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import MessageComponent from '../../components/Message/MessageComponent';
import { handlerRegistry } from '../../socket-hub/handlers';
import { channelMessagesQueryKey, messageQueryKeyForContext } from '../../utils/messageQueryKeys';
import recorded from '../fixtures/message-wire-payloads.json';

/**
 * What a server sends today, recorded from the real backend by
 * backend/test/message-wire-contract.e2e-spec.ts (RECORD_WIRE_PAYLOADS=1, then
 * copy the file here), through the real socket handlers and the real message
 * renderer. Also run against an older client's checkout before changing the
 * wire shape: it only uses what those clients already had.
 */
vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'user-1', username: 'alice' } }),
}));
vi.mock('../../contexts/UserProfileContext', () => ({
  useUserProfile: () => ({ openProfile: vi.fn() }),
}));
vi.mock('../../components/Common/UserAvatar', () => ({
  default: () => <div data-testid="user-avatar" />,
}));
vi.mock('../../components/Message/MessageAttachments', () => ({
  default: ({ attachments }: { attachments: { filename: string }[] }) => (
    <div>{attachments.map((a) => a.filename).join(',')}</div>
  ),
  MessageAttachments: ({ attachments }: { attachments: { filename: string }[] }) => (
    <div>{attachments.map((a) => a.filename).join(',')}</div>
  ),
}));
vi.mock('../../hooks/useMessagePermissions', () => ({
  useMessagePermissions: () => ({
    canEdit: false,
    canDelete: false,
    canPin: false,
    canReact: false,
    isOwnMessage: false,
  }),
}));
vi.mock('../../components/Message/useMessageActions', () => ({
  useMessageActions: () => ({
    isEditing: false,
    editText: '',
    editAttachments: [],
    stagedForDelete: false,
    isDeleting: false,
    setEditText: vi.fn(),
    handleEditClick: vi.fn(),
    handleEditSave: vi.fn(),
    handleEditCancel: vi.fn(),
    handleRemoveAttachment: vi.fn(),
    handleDeleteClick: vi.fn(),
    handleConfirmDelete: vi.fn(),
    handleCancelDelete: vi.fn(),
    handleConfirmThreadDelete: vi.fn(),
    handleCancelThreadDelete: vi.fn(),
    showThreadDeleteConfirm: false,
    handleReactionClick: vi.fn(),
    handleEmojiSelect: vi.fn(),
    handlePin: vi.fn(),
    handleUnpin: vi.fn(),
  }),
}));

interface WireMessage {
  id: string;
  channelId: string | null;
  directMessageGroupId: string | null;
  spans: { text: string | null }[];
  attachments: { filename: string }[];
  webhook: { name: string } | null;
  deletedAt: string | null;
}
type Page = { messages: WireMessage[] };

interface RecordedPayload {
  message?: WireMessage & { editedAt?: string | null };
  reply?: WireMessage;
}

const events = recorded.events as { event: string; payload: RecordedPayload }[];

/** Every whole message the server sent, on the socket and in REST responses. */
const messages: WireMessage[] = [
  ...events.flatMap((e) => (e.payload.message ? [e.payload.message] : e.payload.reply ? [e.payload.reply] : [])),
  ...(recorded.responses as unknown as { component: string; body: WireMessage & Page & { replies: WireMessage[] } }[]).flatMap((r) => {
    if (r.component === 'MessageDto') return [r.body];
    if (r.component === 'CommunitySearchResultDto') return [r.body];
    if (r.component === 'PaginatedMessagesResponseDto' || r.component === 'AnchoredMessagesResponseDto') {
      return r.body.messages;
    }
    if (r.component === 'ThreadRepliesResponseDto') return r.body.replies;
    return [];
  }),
];

function seed(queryClient: QueryClient, key: readonly unknown[]) {
  if (queryClient.getQueryData(key)) return;
  queryClient.setQueryData<InfiniteData<Page>>(key, {
    pages: [{ messages: [] }],
    pageParams: [''],
  });
}

describe('replaying recorded server payloads', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
  });

  it('recorded every kind of message', () => {
    const seen = new Set(events.map((e) => e.event));
    for (const event of ['newMessage', 'newDirectMessage', 'updateMessage', 'deleteMessage', 'newThreadReply']) {
      expect(seen).toContain(event);
    }
    expect(messages.some((m) => m.attachments.length > 0)).toBe(true);
    expect(messages.some((m) => m.webhook)).toBe(true);
    expect(messages.some((m) => m.deletedAt)).toBe(true);
    expect(messages.length).toBeGreaterThan(20);
  });

  it('the socket handlers apply every event without throwing', async () => {
    for (const { event, payload } of events) {
      const message = payload.message;
      if (message) seed(queryClient, messageQueryKeyForContext(message)!);
      const handlers = (handlerRegistry as unknown as Record<string, ((p: unknown, q: QueryClient) => Promise<void>)[]>)[event];
      expect(handlers, event).toBeDefined();
      for (const handler of handlers) await handler(payload, queryClient);
    }

    const first = events.find((e) => e.event === 'newMessage')!.payload.message!;
    const cached = queryClient.getQueryData<InfiniteData<Page>>(channelMessagesQueryKey(first.channelId!));
    const ids = cached!.pages.flatMap((p) => p.messages.map((m) => m.id));
    expect(ids).toContain(first.id);

    const edited = events.find((e) => e.event === 'updateMessage' && e.payload.message?.editedAt)!.payload.message!;
    const row = cached!.pages.flatMap((p) => p.messages).find((m) => m.id === edited.id);
    expect(row?.spans[0].text).toBe('edited');
  });

  it('renders every message the server sent', () => {
    for (const message of messages) {
      const { unmount } = renderWithProviders(<MessageComponent message={message as never} />);

      for (const span of message.spans) {
        if (span.text) expect(document.body.textContent).toContain(span.text);
      }
      for (const file of message.attachments) {
        expect(document.body.textContent).toContain(file.filename);
      }
      if (message.webhook) expect(document.body.textContent).toContain(message.webhook.name);
      unmount();
    }
    expect(screen.queryByText('undefined')).toBeNull();
  });

  it('a blank removed message renders without content', () => {
    const blank = messages.find((m) => m.deletedAt && m.spans.length === 0);
    expect(blank).toBeDefined();

    renderWithProviders(<MessageComponent message={blank as never} />);

    expect(screen.getByTestId('message-body').textContent).toBe('');
  });
});
