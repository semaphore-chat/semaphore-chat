/**
 * ChannelMessageContainer overlays on touch layouts:
 *  - phone renders the thread as a full-screen layer (not a 400px side drawer),
 *  - hardware/browser back closes the thread / pinned layer first, without
 *    leaving the channel,
 *  - Electron at phone width stays on the desktop side drawer (Review Focus #1).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, act, waitFor } from '@testing-library/react';
import { renderWithProviders, createChannel } from '../test-utils';
import { createMessage } from '../test-utils/factories';
import ChannelMessageContainer from '../../components/Channel/ChannelMessageContainer';
import { ThreadPanelProvider } from '../../contexts/ThreadPanelProvider';
import { DEVICE_BREAKPOINTS } from '../../utils/breakpoints';
import type { Message } from '../../types/message.type';

const env = vi.hoisted(() => ({ electron: false, phone: true }));

vi.mock('../../utils/platform', () => ({
  isElectron: () => env.electron,
}));
vi.mock('@mui/material/useMediaQuery', () => ({
  default: (query: string) =>
    env.phone && query === `(max-width: ${DEVICE_BREAKPOINTS.PHONE - 1}px)`,
}));

vi.mock('../../api-client/@tanstack/react-query.gen', () => ({
  channelsControllerFindOneOptions: () => ({
    queryKey: ['channel'],
    queryFn: async () => createChannel({ id: 'ch-1', name: 'general' }),
  }),
  channelsControllerGetMentionableChannelsOptions: () => ({ queryKey: ['mentionable'], queryFn: async () => [] }),
  moderationControllerGetPinnedMessagesOptions: () => ({ queryKey: ['pinned'], queryFn: async () => [] }),
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
  useJumpToMessage: () => ({ isJumpPending: false, highlightMessageId: undefined, messages: [] }),
}));
vi.mock('../../contexts/VoiceContext', () => ({
  useVoice: () => ({ isConnected: false }),
  VoiceSessionType: { Channel: 'channel', Dm: 'dm' },
}));

const parent: Message = createMessage({ id: 'parent-1' });

vi.mock('../../components/Message/MessageContainerWrapper', () => ({
  default: ({ onOpenThread }: { onOpenThread: (m: Message) => void }) => (
    <button onClick={() => onOpenThread(parent)}>open thread</button>
  ),
}));
vi.mock('../../components/Message/MemberListContainer', () => ({
  default: () => <div data-testid="member-list" />,
}));
vi.mock('../../components/Message/MessageSearch', () => ({
  default: () => null,
}));
vi.mock('../../components/Moderation', () => ({
  PinnedMessagesPanel: () => <div data-testid="pinned-panel" />,
}));
vi.mock('../../components/Thread', () => ({
  ThreadPanel: ({ fullScreen }: { fullScreen?: boolean }) => (
    <div data-testid="thread-panel" data-fullscreen={String(!!fullScreen)} />
  ),
}));
vi.mock('../../components/Channel/ChannelNotificationMenu', () => ({
  default: () => null,
}));

function renderContainer(hideHeader = true) {
  return renderWithProviders(
    <ThreadPanelProvider>
      <ChannelMessageContainer channelId="ch-1" communityId="c1" hideHeader={hideHeader} />
    </ThreadPanelProvider>,
    { routerProps: { initialEntries: ['/community/c1/channel/ch-1'] } },
  );
}

const threadPaper = () => screen.getByTestId('thread-panel').closest('.MuiDrawer-paper') as HTMLElement;

const overlayDepth = () =>
  ((window.history.state as Record<string, unknown> | null)?.__overlayStack as unknown[] | undefined)?.length ?? 0;

// jsdom (>= 30) resolves viewport units in getComputedStyle() to pixels
// against window.innerWidth, like a browser does, so width assertions are in
// px for an explicit viewport. useMediaQuery is mocked above: the viewport
// width here only feeds `vw`, not the phone/desktop layout decision.
// (Assign, don't Object.defineProperty: Vitest's `window.innerWidth` is an
// accessor that forwards writes to jsdom's own window, which is what jsdom
// reads; redefining the property would cut that link.)
const DEFAULT_INNER_WIDTH = window.innerWidth;
function setViewportWidth(width: number) {
  (window as { innerWidth: number }).innerWidth = width;
}

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

describe('ChannelMessageContainer overlays', () => {
  beforeEach(() => {
    env.electron = false;
    env.phone = true;
  });

  afterEach(async () => {
    setViewportWidth(DEFAULT_INNER_WIDTH);
    // Pop any overlay history entries a test left behind.
    while ((window.history.state as Record<string, unknown> | null)?.__overlayStack) {
      window.history.back();
      await flush();
    }
  });

  it('phone: opens the thread full-screen', async () => {
    // Wider than the 400px side drawer, so 100vw and min(400px, 100vw) differ.
    setViewportWidth(1024);
    const { user } = renderContainer();
    await user.click(screen.getByRole('button', { name: 'open thread' }));

    expect(screen.getByTestId('thread-panel')).toHaveAttribute('data-fullscreen', 'true');
    // 100vw: the whole viewport.
    expect(threadPaper()).toHaveStyle({ width: '1024px' });
  });

  it('phone: back closes the thread and stays on the channel', async () => {
    const href = window.location.href;
    const { user } = renderContainer();
    await user.click(screen.getByRole('button', { name: 'open thread' }));
    expect(overlayDepth()).toBe(1);

    act(() => window.history.back());

    await waitFor(() => expect(screen.queryByTestId('thread-panel')).not.toBeInTheDocument());
    expect(window.location.href).toBe(href);
    // The panel content unmounts as soon as the thread closes, but the modal
    // Drawer keeps aria-hidden on its siblings until its slide-out transition
    // ends (MUI 7.3.11 made Drawer closeAfterTransition), so wait for the
    // channel to become accessible again instead of asserting synchronously.
    expect(await screen.findByRole('button', { name: 'open thread' })).toBeInTheDocument();
  });

  it('Electron at phone width keeps the desktop side drawer and no history entry', async () => {
    env.electron = true;
    setViewportWidth(1024);
    const { user } = renderContainer(false);
    await user.click(screen.getByRole('button', { name: 'open thread' }));

    expect(screen.getByTestId('thread-panel')).toHaveAttribute('data-fullscreen', 'false');
    // min(400px, 100vw): the 400px drawer, capped at the viewport width.
    expect(threadPaper()).toHaveStyle({ width: '400px' });
    setViewportWidth(360);
    expect(threadPaper()).toHaveStyle({ width: '360px' });
    expect(overlayDepth()).toBe(0);
  });

  it('desktop width keeps the side drawer', async () => {
    env.phone = false;
    const { user } = renderContainer(false);
    await user.click(screen.getByRole('button', { name: 'open thread' }));
    expect(screen.getByTestId('thread-panel')).toHaveAttribute('data-fullscreen', 'false');
  });
});

describe('ChannelMessageContainer header: members drawer', () => {
  beforeEach(() => {
    env.electron = false;
    env.phone = true;
  });

  it('a narrow Electron window (desktop layout) offers the member list as a drawer', async () => {
    env.electron = true;
    const { user } = renderContainer(false);
    expect(screen.queryByTestId('member-list')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show members' }));

    expect(await screen.findByTestId('member-list')).toBeInTheDocument();
    expect(screen.getByTestId('member-list').closest('.MuiDrawer-paper')).not.toBeNull();
  });

  it('desktop width has no members button (the column is inline)', () => {
    env.phone = false;
    renderContainer(false);
    expect(screen.queryByRole('button', { name: 'Show members' })).not.toBeInTheDocument();
  });
});
