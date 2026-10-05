/**
 * ChannelMessageContainer's docked side panel (wide desktop, >= 1200px):
 * threads, pinned messages and search open in a non-modal `complementary`
 * landmark next to the messages instead of a modal drawer / popover. Narrower
 * windows and the phone/tablet layouts keep the drawers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, act, waitFor, within } from '@testing-library/react';
import { renderWithProviders, createChannel } from '../test-utils';
import { createMessage } from '../test-utils/factories';
import ChannelMessageContainer from '../../components/Channel/ChannelMessageContainer';
import { ThreadPanelProvider } from '../../contexts/ThreadPanelProvider';
import { DEVICE_BREAKPOINTS } from '../../utils/breakpoints';
import type { Message } from '../../types/message.type';

const env = vi.hoisted(() => ({ electron: false, wide: true, phone: false }));

vi.mock('../../utils/platform', () => ({
  isElectron: () => env.electron,
}));
vi.mock('@mui/material/useMediaQuery', () => ({
  default: (query: string) =>
    (env.wide && query === `(min-width: ${DEVICE_BREAKPOINTS.DESKTOP}px)`) ||
    (env.phone && query === `(max-width: ${DEVICE_BREAKPOINTS.PHONE - 1}px)`),
}));

const parent: Message = createMessage({ id: 'parent-1', channelId: 'ch-1' });
const otherParent: Message = createMessage({ id: 'parent-2', channelId: 'ch-1' });

vi.mock('../../api-client/@tanstack/react-query.gen', () => ({
  channelsControllerFindOneOptions: () => ({
    queryKey: ['channel'],
    queryFn: async () => createChannel({ id: 'ch-1', name: 'general' }),
  }),
  channelsControllerGetMentionableChannelsOptions: () => ({ queryKey: ['mentionable'], queryFn: async () => [] }),
  moderationControllerGetPinnedMessagesOptions: () => ({
    queryKey: ['pinned'],
    queryFn: async () => [{ id: 'pinned-reply', parentMessageId: 'parent-1' }],
  }),
}));
vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'me', username: 'me' } }),
}));
vi.mock('../../hooks/useAllCommunityMembers', () => ({
  useAllCommunityMembers: () => ({ data: [] }),
}));
vi.mock('../../hooks/useAutoMarkNotificationsRead', () => ({
  useAutoMarkNotificationsRead: vi.fn(),
}));
vi.mock('../../hooks/useMessageFileUpload', () => ({
  useMessageFileUpload: () => ({ handleSendMessage: vi.fn() }),
}));
vi.mock('../../hooks/useJumpToMessage', () => ({
  useJumpToMessage: () => ({ isJumpPending: false, highlightMessageId: undefined, messages: [parent] }),
}));
vi.mock('../../contexts/VoiceContext', () => ({
  useVoice: () => ({ isConnected: false }),
  VoiceSessionType: { Channel: 'channel', Dm: 'dm' },
}));

vi.mock('../../components/Message/MessageContainerWrapper', () => ({
  default: ({
    onOpenThread,
    memberListComponent,
  }: {
    onOpenThread: (m: Message) => void;
    memberListComponent?: React.ReactNode;
  }) => (
    <div>
      <button onClick={() => onOpenThread(parent)}>open thread</button>
      <button onClick={() => onOpenThread(otherParent)}>open other thread</button>
      <input aria-label="Channel composer" />
      {memberListComponent}
    </div>
  ),
}));
vi.mock('../../components/Message/MemberListContainer', () => ({
  default: () => <div data-testid="member-list" />,
}));
vi.mock('../../components/Message/MessageSearch', () => ({
  default: ({ anchorEl }: { anchorEl: HTMLElement | null }) =>
    anchorEl ? <div data-testid="search-popover" /> : null,
}));
vi.mock('../../components/Message/MessageSearchPanel', () => ({
  MessageSearchPanel: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="search-panel">
      <input aria-label="Search input" />
      <button onClick={onClose}>Close search</button>
    </div>
  ),
}));
vi.mock('../../components/Moderation', () => ({
  PinnedMessagesPanel: ({
    onClose,
    onMessageClick,
  }: {
    onClose: () => void;
    onMessageClick: (id: string) => void;
  }) => (
    <div data-testid="pinned-panel">
      <button onClick={() => onMessageClick('pinned-reply')}>pinned thread reply</button>
      <button onClick={onClose}>Close pinned messages</button>
    </div>
  ),
}));
vi.mock('../../components/Thread', async () => {
  const { useThreadPanel } = await import('../../contexts/ThreadPanelContext');
  return {
    ThreadPanel: ({ parentMessage, docked }: { parentMessage: Message; docked?: boolean }) => {
      const { closeThread } = useThreadPanel();
      return (
        <div data-testid="thread-panel" data-parent={parentMessage.id} data-docked={String(!!docked)}>
          <input aria-label="Thread reply" />
          <button onClick={closeThread}>Close thread</button>
        </div>
      );
    },
  };
});
vi.mock('../../components/Channel/ChannelNotificationMenu', () => ({
  default: () => null,
}));

function ui(channelId = 'ch-1', hideHeader = false) {
  return (
    <ThreadPanelProvider>
      <ChannelMessageContainer channelId={channelId} communityId="c1" hideHeader={hideHeader} />
    </ThreadPanelProvider>
  );
}

function renderContainer(hideHeader = false) {
  return renderWithProviders(ui('ch-1', hideHeader), {
    routerProps: { initialEntries: ['/community/c1/channel/ch-1'] },
  });
}

const panel = (name: string | RegExp) => screen.getByRole('complementary', { name });
const pinsButton = () => screen.getByRole('button', { name: /pinned messages \(/i });
const searchButton = () => screen.getByRole('button', { name: 'Search messages' });

describe('ChannelMessageContainer docked side panel (wide desktop)', () => {
  beforeEach(() => {
    env.electron = false;
    env.wide = true;
    env.phone = false;
  });

  it('opens a thread in a docked, non-modal panel that replaces the member list', async () => {
    const { user } = renderContainer();
    expect(screen.getByTestId('member-list')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'open thread' }));

    const thread = panel('Thread');
    expect(within(thread).getByTestId('thread-panel')).toHaveAttribute('data-docked', 'true');
    expect(thread.closest('.MuiDrawer-paper')).toBeNull();
    expect(document.querySelector('.MuiModal-root')).toBeNull();
    expect(screen.queryByTestId('member-list')).not.toBeInTheDocument();
    // The channel stays usable: nothing is aria-hidden, the composer is reachable.
    expect(screen.getByRole('textbox', { name: 'Channel composer' })).toBeInTheDocument();
    // Focus moved into the panel.
    expect(thread).toHaveFocus();
  });

  it('opens the pinned list and search in the panel', async () => {
    const { user } = renderContainer();

    await user.click(pinsButton());
    expect(within(panel('Pinned messages')).getByTestId('pinned-panel')).toBeInTheDocument();
    expect(pinsButton()).toHaveAttribute('aria-expanded', 'true');

    await user.click(searchButton());
    expect(within(panel('Search messages')).getByTestId('search-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('search-popover')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pinned-panel')).not.toBeInTheDocument();
  });

  it('shows one panel at a time: opening another swaps the content', async () => {
    const { user } = renderContainer();

    await user.click(pinsButton());
    await user.click(screen.getByRole('button', { name: 'open thread' }));
    expect(screen.getAllByRole('complementary')).toHaveLength(1);
    expect(screen.queryByTestId('pinned-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('thread-panel')).toHaveAttribute('data-parent', 'parent-1');

    await user.click(screen.getByRole('button', { name: 'open other thread' }));
    expect(screen.getByTestId('thread-panel')).toHaveAttribute('data-parent', 'parent-2');

    await user.click(searchButton());
    expect(screen.queryByTestId('thread-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('search-panel')).toBeInTheDocument();
  });

  it('the header button toggles its panel closed', async () => {
    const { user } = renderContainer();
    await user.click(pinsButton());
    await user.click(pinsButton());
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(screen.getByTestId('member-list')).toBeInTheDocument();
  });

  it('the close button closes the panel and returns focus to the trigger', async () => {
    const { user } = renderContainer();
    await user.click(pinsButton());
    expect(panel('Pinned messages')).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Close pinned messages' }));

    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(pinsButton()).toHaveFocus();
  });

  it('Esc closes the panel when focus is inside it, and focus returns to the trigger', async () => {
    const { user } = renderContainer();
    await user.click(screen.getByRole('button', { name: 'open thread' }));
    await user.click(screen.getByRole('textbox', { name: 'Thread reply' }));

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'open thread' })).toHaveFocus();
  });

  it('Esc outside the panel leaves it open (no focus trap, not modal)', async () => {
    const { user } = renderContainer();
    await user.click(searchButton());
    await user.click(screen.getByRole('textbox', { name: 'Channel composer' }));
    expect(screen.getByRole('textbox', { name: 'Channel composer' })).toHaveFocus();

    await user.keyboard('{Escape}');

    expect(panel('Search messages')).toBeInTheDocument();
  });

  it("the thread's own close button closes the docked panel", async () => {
    const { user } = renderContainer();
    await user.click(screen.getByRole('button', { name: 'open thread' }));
    await user.click(screen.getByRole('button', { name: 'Close thread' }));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'open thread' })).toHaveFocus();
  });

  it('closes a thread and the pinned list on channel switch, but keeps search', async () => {
    const { user, rerender } = renderContainer();

    await user.click(screen.getByRole('button', { name: 'open thread' }));
    rerender(ui('ch-2'));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    // The thread doesn't come back on the original channel either.
    rerender(ui('ch-1'));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();

    await user.click(pinsButton());
    rerender(ui('ch-2'));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();

    await user.click(searchButton());
    rerender(ui('ch-1'));
    expect(panel('Search messages')).toBeInTheDocument();
  });

  it('a pinned thread reply (thread deep link) jumps to the parent and opens its thread in the panel', async () => {
    const { user } = renderContainer();
    await user.click(pinsButton());
    // Pins load asynchronously.
    await waitFor(() => expect(pinsButton()).toHaveTextContent('1'));

    await user.click(screen.getByRole('button', { name: 'pinned thread reply' }));

    const thread = await screen.findByTestId('thread-panel');
    expect(thread).toHaveAttribute('data-parent', 'parent-1');
    expect(thread).toHaveAttribute('data-docked', 'true');
    expect(screen.getAllByRole('complementary')).toHaveLength(1);
    expect(screen.queryByTestId('pinned-panel')).not.toBeInTheDocument();
  });
});

describe('ChannelMessageContainer below the docking breakpoint', () => {
  beforeEach(() => {
    env.electron = false;
    env.wide = false;
    env.phone = false;
  });

  it('narrow Electron window: thread and pins open as drawers, search as a popover', async () => {
    env.electron = true;
    const { user } = renderContainer();

    await user.click(screen.getByRole('button', { name: 'open thread' }));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(screen.getByTestId('thread-panel').closest('.MuiDrawer-paper')).not.toBeNull();
    expect(screen.getByTestId('thread-panel')).toHaveAttribute('data-docked', 'false');
    await user.click(screen.getByRole('button', { name: 'Close thread' }));

    await user.click(await screen.findByRole('button', { name: /pinned messages \(/i }));
    expect(screen.getByTestId('pinned-panel').closest('.MuiDrawer-paper')).not.toBeNull();
  });

  it('narrow window: search opens the popover, not the panel', async () => {
    const { user } = renderContainer();
    await user.click(searchButton());
    expect(screen.getByTestId('search-popover')).toBeInTheDocument();
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('phone: the thread stays a full-screen drawer layer', async () => {
    env.phone = true;
    const { user } = renderContainer(true);
    await user.click(screen.getByRole('button', { name: 'open thread' }));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(screen.getByTestId('thread-panel').closest('.MuiDrawer-paper')).not.toBeNull();
  });

  it('the mobile/tablet chat panel (no header) never docks, even when wide', async () => {
    env.wide = true;
    const { user } = renderContainer(true);
    await user.click(screen.getByRole('button', { name: 'open thread' }));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    await act(async () => {});
    expect(screen.getByTestId('thread-panel').closest('.MuiDrawer-paper')).not.toBeNull();
  });
});
