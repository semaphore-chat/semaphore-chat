import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { renderWithProviders } from '../test-utils';
import { createTestQueryClient } from '../test-utils/queryClient';
import { renderInEveryTheme } from '../test-utils/themeMatrix';
import { createMessage } from '../test-utils/factories';
import { ThreadPanel } from '../../components/Thread/ThreadPanel';
import { TOUCH_TARGETS } from '../../utils/breakpoints';

const closeThread = vi.hoisted(() => vi.fn());
const responsive = vi.hoisted(() => ({ shouldUseTouchUI: false }));

vi.mock('../../hooks/useResponsive', () => ({
  useResponsive: () => responsive,
}));

vi.mock('../../contexts/ThreadPanelContext', () => ({
  useThreadPanel: () => ({ openThreadId: 'p1', openThread: vi.fn(), closeThread }),
}));
vi.mock('../../hooks/useThreadReplies', () => ({
  useThreadReplies: () => ({
    replies: [],
    continuationToken: null,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../../hooks/useThreadSubscription', () => ({
  useThreadSubscription: () => ({ isSubscribed: false, toggleSubscription: vi.fn() }),
}));
vi.mock('../../components/Message/MessageComponent', () => ({
  default: ({ message }: { message: { id: string } }) => <div data-testid="message">{message.id}</div>,
}));
vi.mock('../../components/Thread/ThreadMessageInput', () => ({
  default: () => <div data-testid="thread-input" />,
}));

const parent = createMessage({ id: 'p1' });

describe('ThreadPanel full-screen (phone) variant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    responsive.shouldUseTouchUI = false;
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('shows a back button (not a close X) with a 44px touch target', async () => {
    const { user } = renderWithProviders(<ThreadPanel parentMessage={parent} channelId="ch1" fullScreen />);

    const back = screen.getByRole('button', { name: /back/i });
    expect(back).toHaveStyle({
      minWidth: `${TOUCH_TARGETS.MINIMUM}px`,
      minHeight: `${TOUCH_TARGETS.MINIMUM}px`,
    });
    expect(screen.queryByRole('button', { name: /close thread/i })).not.toBeInTheDocument();

    const bell = screen.getByRole('button', { name: /notif/i });
    expect(bell).toHaveStyle({ minWidth: `${TOUCH_TARGETS.MINIMUM}px` });

    await user.click(back);
    expect(closeThread).toHaveBeenCalledTimes(1);
  });

  it('pads the header and the reply field for the safe areas', () => {
    renderWithProviders(<ThreadPanel parentMessage={parent} channelId="ch1" fullScreen />);
    expect(screen.getByTestId('thread-panel')).toHaveAttribute('data-variant', 'fullscreen');
    expect(screen.getByTestId('thread-input').parentElement).toHaveStyle({
      paddingBottom: 'env(safe-area-inset-bottom)',
    });
  });

  it('keeps the side-drawer close button when not full-screen', () => {
    renderWithProviders(<ThreadPanel parentMessage={parent} channelId="ch1" />);
    expect(screen.getByTestId('thread-panel')).toHaveAttribute('data-variant', 'drawer');
    expect(screen.getByRole('button', { name: /close thread/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /back/i })).not.toBeInTheDocument();
  });

  it('gives the side-drawer header buttons 44px targets on touch layouts (tablet)', () => {
    responsive.shouldUseTouchUI = true;
    renderWithProviders(<ThreadPanel parentMessage={parent} channelId="ch1" />);
    expect(screen.getByRole('button', { name: /close thread/i })).toHaveStyle({
      minWidth: `${TOUCH_TARGETS.MINIMUM}px`,
      minHeight: `${TOUCH_TARGETS.MINIMUM}px`,
    });
    expect(screen.getByRole('button', { name: /notif/i })).toHaveStyle({ minHeight: `${TOUCH_TARGETS.MINIMUM}px` });
  });

  it('keeps small header buttons on desktop', () => {
    renderWithProviders(<ThreadPanel parentMessage={parent} channelId="ch1" />);
    expect(screen.getByRole('button', { name: /close thread/i })).not.toHaveStyle({
      minWidth: `${TOUCH_TARGETS.MINIMUM}px`,
    });
  });

  it('renders the full-screen variant in every theme', () => {
    renderInEveryTheme(
      () => (
        <QueryClientProvider client={createTestQueryClient()}>
          <ThreadPanel parentMessage={parent} channelId="ch1" fullScreen />
        </QueryClientProvider>
      ),
      () => expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument(),
    );
  });
});
