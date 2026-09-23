/**
 * Back closes bottom sheets (MobileSheet, and so MessageActionsSheet which is
 * built on it) before it leaves the screen.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, act, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { createMessage } from '../test-utils/factories';
import { MobileSheet } from '../../components/Mobile/common/MobileSheet';
import MessageActionsSheet from '../../components/Message/MessageActionsSheet';
import { TOUCH_TARGETS } from '../../utils/breakpoints';

vi.mock('../../utils/clipboard', () => ({
  copyToClipboard: vi.fn().mockResolvedValue(undefined),
}));

const overlayDepth = () =>
  ((window.history.state as Record<string, unknown> | null)?.__overlayStack as unknown[] | undefined)?.length ?? 0;

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

describe('bottom sheets and back', () => {
  afterEach(async () => {
    while ((window.history.state as Record<string, unknown> | null)?.__overlayStack) {
      window.history.back();
      await flush();
    }
  });

  it('MobileSheet: opening pushes history and back calls onClose', async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <MobileSheet open onClose={onClose} title="Sheet">
        body
      </MobileSheet>,
    );
    expect(overlayDepth()).toBe(1);

    act(() => window.history.back());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('MobileSheet: the close button is a 44px touch target', () => {
    renderWithProviders(
      <MobileSheet open onClose={vi.fn()} title="Sheet">
        body
      </MobileSheet>,
    );
    expect(screen.getByRole('button', { name: 'Close' })).toHaveStyle({
      minWidth: `${TOUCH_TARGETS.MINIMUM}px`,
      minHeight: `${TOUCH_TARGETS.MINIMUM}px`,
    });
  });

  it('MessageActionsSheet: back closes the sheet', async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <MessageActionsSheet
        anchorPosition={null}
        open
        onClose={onClose}
        message={createMessage()}
        canEdit={false}
        canDelete={false}
        canPin={false}
        canReact={false}
        canThread={false}
        isPinned={false}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onPin={vi.fn()}
        onUnpin={vi.fn()}
        onReplyInThread={vi.fn()}
        onAddReaction={vi.fn()}
        onEmojiSelect={vi.fn()}
      />,
    );

    act(() => window.history.back());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
