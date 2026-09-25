/**
 * Task 17 — below 1024px the member list is never an inline third column
 * (the tablet split view keeps at most two columns). It opens as an overlay
 * from the app bar instead (see MobileChatPanelTablet.test.tsx). At 1024px and
 * up the inline column stays. Electron is always the desktop layout, and the
 * same 1024px cut applies there: below it the chat header's members button
 * opens the list as a drawer (MemberListDrawerButton.test.tsx).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import MessageContainer from '../../components/Message/MessageContainer';

const platform = vi.hoisted(() => ({ electron: false }));
vi.mock('../../utils/platform', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isElectron: () => platform.electron,
  isWeb: () => !platform.electron,
}));

vi.mock('../../components/Message/VirtualMessageList', async () => {
  const React = await import('react');
  return {
    default: React.forwardRef((_props: unknown, ref: React.Ref<{ scrollToBottom: () => void }>) => {
      React.useImperativeHandle(ref, () => ({ scrollToBottom: vi.fn() }), []);
      return <div data-testid="virtual-message-list" />;
    }),
  };
});
vi.mock('../../hooks/useMessageVisibility', () => ({
  useMessageVisibility: () => ({ markAsRead: vi.fn() }),
}));
vi.mock('../../hooks/useReadReceipts', () => ({
  useReadReceipts: () => ({ lastReadMessageId: () => undefined, unreadCount: () => 0 }),
}));

/** matchMedia that evaluates min-/max-width queries against `width`. */
function stubViewportWidth(width: number) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => {
      const min = /min-width:\s*(\d+)px/.exec(query);
      const max = /max-width:\s*(\d+)px/.exec(query);
      const matches =
        (min || max) && !query.includes('pointer') && !query.includes('hover')
          ? (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]))
          : false;
      return {
        matches: !!matches,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      };
    }),
  );
}

const renderContainer = () =>
  renderWithProviders(
    <MessageContainer
      messages={[]}
      isLoading={false}
      error={null}
      authorId="me"
      isLoadingMore={false}
      messageInput={<div data-testid="message-input" />}
      memberListComponent={<div data-testid="member-list" />}
    />,
  );

beforeEach(() => {
  platform.electron = false;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MessageContainer inline member column', () => {
  it('is closed at tablet portrait width (820px)', () => {
    stubViewportWidth(820);
    renderContainer();
    expect(screen.getByTestId('message-input')).toBeInTheDocument();
    expect(screen.queryByTestId('member-list')).not.toBeInTheDocument();
  });

  it('is closed at 1023px', () => {
    stubViewportWidth(1023);
    renderContainer();
    expect(screen.queryByTestId('member-list')).not.toBeInTheDocument();
  });

  it('is shown at tablet landscape width (1100px)', () => {
    stubViewportWidth(1100);
    renderContainer();
    expect(screen.getByTestId('member-list')).toBeInTheDocument();
  });

  it('is shown at desktop width', () => {
    stubViewportWidth(1440);
    renderContainer();
    expect(screen.getByTestId('member-list')).toBeInTheDocument();
  });

  it('is shown in Electron at desktop width (Review Focus #1)', () => {
    platform.electron = true;
    stubViewportWidth(1440);
    renderContainer();
    expect(screen.getByTestId('member-list')).toBeInTheDocument();
  });

  // Electron is always the desktop layout; below 1024px the rail and channel
  // sidebar leave no room for the column, so the chat header's members button
  // (MemberListDrawerButton) opens it as a drawer instead.
  it.each([700, 800, 820, 1023])(
    'is closed in an Electron window %ipx wide (desktop layout, members in a drawer)',
    (width) => {
      platform.electron = true;
      stubViewportWidth(width);
      renderContainer();
      expect(screen.getByTestId('message-input')).toBeInTheDocument();
      expect(screen.queryByTestId('member-list')).not.toBeInTheDocument();
    },
  );

  it.each([1024, 1199])('is shown in an Electron window %ipx wide (desktop layout)', (width) => {
    platform.electron = true;
    stubViewportWidth(width);
    renderContainer();
    expect(screen.getByTestId('member-list')).toBeInTheDocument();
  });
});
