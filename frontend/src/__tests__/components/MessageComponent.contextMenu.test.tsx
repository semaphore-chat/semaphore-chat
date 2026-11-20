import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { renderWithProviders, runAxe, expectNoAxeViolations } from '../test-utils';
import MessageComponent from '../../components/Message/MessageComponent';
import { createMessage } from '../test-utils/factories';
import { SpanType } from '../../types/message.type';

// Mock platform detection — web, to prove the context menu works outside Electron
vi.mock('../../utils/platform', () => ({
  isElectron: vi.fn(() => false),
  isWeb: vi.fn(() => true),
}));

vi.mock('../../utils/clipboard', () => ({
  copyToClipboard: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'user-1', username: 'alice' } }),
}));

vi.mock('../../contexts/UserProfileContext', () => ({
  useUserProfile: () => ({ openProfile: vi.fn() }),
}));

// UserAvatar requires FileCacheProvider; stub it out
vi.mock('../../components/Common/UserAvatar', () => ({
  default: () => <div data-testid="avatar" />,
}));

const mockPermissions = {
  canEdit: true,
  canDelete: true,
  canPin: true,
  canReact: true,
  isOwnMessage: true,
};
vi.mock('../../hooks/useMessagePermissions', () => ({
  useMessagePermissions: () => mockPermissions,
}));

const mockActions = {
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
};
vi.mock('../../data/chat/useMessageActions', () => ({
  useMessageActions: () => mockActions,
}));

function renderMessage() {
  const message = createMessage({
    spans: [{ type: SpanType.PLAINTEXT, text: 'Right-click me' }],
  });
  return {
    message,
    ...renderWithProviders(<MessageComponent message={message} />),
  };
}

describe('MessageComponent context menu (web)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens the custom context menu on right-click and prevents the native menu', () => {
    renderMessage();

    const messageText = screen.getByText('Right-click me');
    const notPrevented = fireEvent.contextMenu(messageText, {
      clientX: 120,
      clientY: 240,
    });

    // fireEvent returns false when preventDefault was called
    expect(notPrevented).toBe(false);
    expect(screen.getByText('Copy Message Content')).toBeInTheDocument();
    expect(screen.getByText('Edit Message')).toBeInTheDocument();
    expect(screen.getByText('Delete Message')).toBeInTheDocument();
  });

  it('closes the context menu on Escape', async () => {
    renderMessage();

    fireEvent.contextMenu(screen.getByText('Right-click me'));
    const menu = await screen.findByRole('menu');

    fireEvent.keyDown(menu, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByText('Copy Message Content')).not.toBeInTheDocument(),
    );
  });

  it('invokes the edit action from the context menu', async () => {
    const { user } = renderMessage();

    fireEvent.contextMenu(screen.getByText('Right-click me'));
    await user.click(screen.getByText('Edit Message'));

    expect(mockActions.handleEditClick).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('restores focus to the message row on Escape (anchorPosition menus have no anchorEl for MUI to auto-restore to)', async () => {
    renderMessage();

    const messageText = screen.getByText('Right-click me');
    // The message row is the nearest ancestor with tabIndex=-1 — added
    // specifically so it can receive focus programmatically after the
    // context menu (opened via right-click, not a focusable button) closes.
    const messageRow = messageText.closest('[tabindex="-1"]');
    expect(messageRow).not.toBeNull();

    fireEvent.contextMenu(messageText, { clientX: 10, clientY: 10 });
    const menu = await screen.findByRole('menu');

    fireEvent.keyDown(menu, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(messageRow);
    });
  });

  it('falls back to the list container when the row unmounts before the deferred focus-restore frame runs', async () => {
    // Mirrors MemberList.contextMenuFocusRestore.test.tsx's "detached-node"
    // case: a message row can disappear from the loaded window (pagination
    // cap eviction) while its context menu is still in the middle of
    // closing — restoreFocus's fallback must land on the list container
    // instead of silently dropping focus to <body>.
    //
    // Unlike MemberList (whose menu is owned by the LIST, decoupled from
    // the row), MessageContextMenu is a child of MessageComponent itself —
    // removing the row also tears down the menu, so the row can't be
    // removed *before* Escape the way MemberList's test does (there'd be no
    // menu left to fire Escape on). Instead this pins down the actual race:
    // restoreFocus's requestAnimationFrame is captured (not run) so the row
    // can be removed in the gap between "Escape closed the menu" and "the
    // deferred frame actually executes" — real rAF fires within ~1 frame,
    // too fast to reliably interleave a synchronous rerender otherwise.
    const rafCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });

    try {
      const message = createMessage({
        spans: [{ type: SpanType.PLAINTEXT, text: 'Removable message' }],
      });

      function Wrapper({ show }: { show: boolean }) {
        const listRef = React.useRef<HTMLDivElement>(null);
        return (
          <div ref={listRef} tabIndex={-1} data-testid="list-container">
            {show && <MessageComponent message={message} listContainerRef={listRef} />}
          </div>
        );
      }

      const { rerender } = renderWithProviders(<Wrapper show={true} />);

      fireEvent.contextMenu(screen.getByText('Removable message'), {
        clientX: 10,
        clientY: 10,
      });
      const menu = await screen.findByRole('menu');

      // MUI calls onClose synchronously for Escape (ahead of the exit
      // transition), so handleCloseContextMenu — and the requestAnimationFrame
      // it schedules — has already run by the time this returns.
      fireEvent.keyDown(menu, { key: 'Escape' });
      expect(rafCallbacks.length).toBeGreaterThan(0);

      // The row is removed from the tree before the deferred frame runs.
      rerender(<Wrapper show={false} />);
      expect(screen.queryByText('Removable message')).not.toBeInTheDocument();

      act(() => {
        rafCallbacks.forEach((cb) => cb(0));
      });

      expect(document.activeElement).toBe(screen.getByTestId('list-container'));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('has no axe violations while the context menu is open', async () => {
    // MUI's Menu enters via a Grow transition whose "entered" state update
    // lands on internal timers. axe's scan below is slow (multi-second under
    // load) and is NOT act-wrapped, so any timer firing mid-scan logs an
    // "update not wrapped in act(...)" warning. Flush all pending transition
    // timers deterministically in virtual time first — fake timers must be
    // installed BEFORE the contextmenu event (that's when the Menu mounts and
    // schedules them; timers already sitting in the real queue can't be
    // advanced virtually). Same pattern as EmojiPickerPopover.test.tsx's axe
    // test. getByRole (not findByRole) because the act-wrapped fireEvent
    // renders the menu synchronously, and RTL's waitFor shouldn't run under
    // fake timers.
    vi.useFakeTimers();
    try {
      renderMessage();
      fireEvent.contextMenu(screen.getByText('Right-click me'), {
        clientX: 10,
        clientY: 10,
      });
      screen.getByRole('menu');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    } finally {
      vi.useRealTimers();
    }

    // MUI's Menu portals into document.body (outside RTL's `container`), so
    // scan the whole document to actually include the open menu.
    const results = await runAxe(document.body);
    expectNoAxeViolations(results);
  });
});
