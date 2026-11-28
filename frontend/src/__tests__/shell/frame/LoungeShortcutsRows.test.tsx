/**
 * Alt+↑/↓ from a focused message row reaches the Lounge's channel walk: the shared list's row keys (a plain arrow
 * moves between rows) leave the Alt, Ctrl and Meta chords to the screen.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { KitProvider } from '../../../kit';
import { LoungeShortcuts } from '../../../shell/lounge/frame/LoungeShortcuts';
import MessageListCore, { type MessageRowContext } from '../../../features/chat/MessageListCore';
import { channelsControllerFindAllForCommunityQueryKey } from '../../../api-client/@tanstack/react-query.gen';
import { createChannel, createMessage, createTestQueryClient, renderWithProviders } from '../../test-utils';
import type { Message } from '../../../types/message.type';

vi.mock('virtua', async () => {
  const ReactMod = await import('react');
  return {
    VList: ReactMod.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
      ReactMod.useImperativeHandle(ref, () => ({ scrollToIndex: vi.fn(), findItemIndex: () => 0, scrollSize: 1000, viewportSize: 400 }), []);
      return <div role={props.role as string}>{props.children as React.ReactNode}</div>;
    }),
  };
});
vi.mock('../../../utils/platform', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isMacPlatform: () => false,
}));

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function renderRow(message: Message, ctx: MessageRowContext) {
  return (
    <div
      role="button"
      data-testid={`row-${message.id}`}
      data-row-focus-target
      tabIndex={ctx.isRovingFocused ? 0 : -1}
      onKeyDown={(event) => ctx.onRovingKeyDown(event, ctx.index)}
      onFocus={() => ctx.onRovingFocus(ctx.index)}
    >
      {message.id}
    </div>
  );
}

function setup() {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(channelsControllerFindAllForCommunityQueryKey({ path: { communityId: 'c-1' } }), [
    createChannel({ id: 'ch-a', name: 'alpha', communityId: 'c-1', position: 0 }),
    createChannel({ id: 'ch-b', name: 'bravo', communityId: 'c-1', position: 1 }),
    createChannel({ id: 'ch-c', name: 'charlie', communityId: 'c-1', position: 2 }),
  ]);
  renderWithProviders(
    <KitProvider base="#8E75FF" mode="dark" intensity="minimal">
      <MessageListCore
        isLoadingMore={false}
        unreadCount={0}
        lastReadIndex={-1}
        renderRow={renderRow}
        orderedMessages={[createMessage({ id: 'm1' }), createMessage({ id: 'm2' })]}
      />
      <LoungeShortcuts communityId="c-1" channelId="ch-b" />
      <Where />
    </KitProvider>,
    { queryClient, routerProps: { initialEntries: ['/community/c-1/channel/ch-b'] } },
  );
}

describe('Alt+arrows from a focused message row', () => {
  it('Alt+↓ goes to the next channel; the row key handler leaves it alone', async () => {
    setup();
    const row = screen.getByTestId('row-m1');
    row.focus();
    expect(row).toHaveFocus();
    // fireEvent returns false only when the default was prevented: the list must not have taken the chord.
    expect(fireEvent.keyDown(row, { key: 'ArrowDown', altKey: true })).toBe(false);
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/community/c-1/channel/ch-c'));
    expect(screen.getByTestId('row-m2')).not.toHaveFocus();
  });

  it('a plain ↓ still moves focus to the next row and goes nowhere', async () => {
    setup();
    screen.getByTestId('row-m1').focus();
    fireEvent.keyDown(screen.getByTestId('row-m1'), { key: 'ArrowDown' });
    await waitFor(() => expect(screen.getByTestId('row-m2')).toHaveFocus());
    expect(screen.getByTestId('where').textContent).toBe('/community/c-1/channel/ch-b');
  });
});
