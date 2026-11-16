import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, screen, cleanup } from '@testing-library/react';
import { renderWithProviders, runAxe, expectNoAxeViolations } from '../test-utils';
import VirtualMessageList from '../../components/Message/VirtualMessageList';
import { createMessage, resetFactoryCounter } from '../test-utils/factories';
import { SpanType } from '../../types/message.type';

/**
 * Roving row-focus keyboard navigation + list semantics.
 *
 * Unlike VirtualMessageList.test.tsx (which mocks MessageComponent to a
 * plain stub, keeping the unit boundary at "does VirtualMessageList wire
 * virtua correctly"), this file renders the REAL MessageComponent so the
 * full roving-focus path — Container's tabIndex/onKeyDown/onFocus wiring,
 * guarded against bubbled events from descendant controls, and the
 * Enter/ContextMenu-opens-menu integration — is exercised end-to-end.
 * `virtua` is still mocked (jsdom can't do real layout/virtualization),
 * rendering every row unconditionally — which also means the rAF-retry loop
 * in moveFocus succeeds on its first attempt here (the target row is always
 * already present), consistent with how VirtualMessageList.test.tsx already
 * runs requestAnimationFrame synchronously.
 *
 * Exception: the "rAF-retry supersession" describe below re-stubs rAF with a
 * manually-flushed queue (NOT synchronous) — interleaving two overlapping
 * moveFocus retry loops requires controlling exactly when each frame fires.
 */

vi.mock('../../utils/platform', () => ({
  isElectron: vi.fn(() => false),
  isWeb: vi.fn(() => true),
}));
vi.mock('../../utils/clipboard', () => ({
  copyToClipboard: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'current-user', username: 'alice' } }),
}));
vi.mock('../../contexts/UserProfileContext', () => ({
  useUserProfile: () => ({ openProfile: vi.fn() }),
}));
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

vi.mock('virtua', async () => {
  const ReactMod = await import('react');
  return {
    VList: ReactMod.forwardRef(
      (props: Record<string, unknown>, ref: React.Ref<unknown>) => {
        ReactMod.useImperativeHandle(
          ref,
          () => ({
            scrollToIndex: vi.fn(),
            scrollTo: vi.fn(),
            scrollBy: vi.fn(),
            findItemIndex: vi.fn(() => 0),
            getItemOffset: vi.fn(() => 0),
            getItemSize: vi.fn(() => 0),
            scrollOffset: 0,
            scrollSize: 1000,
            viewportSize: 400,
            cache: {},
          }),
          [],
        );
        return (
          <div
            data-testid="vlist"
            role={props.role as string | undefined}
            aria-label={props['aria-label'] as string | undefined}
          >
            {props.children as React.ReactNode}
          </div>
        );
      },
    ),
  };
});

function msg(id: string, text: string) {
  return createMessage({ id, spans: [{ type: SpanType.PLAINTEXT, text }] });
}

function rowFor(text: string): HTMLElement {
  const node = screen.getByText(text);
  const row = node.closest('[data-row-focus-target]');
  if (!row) throw new Error(`row focus target not found for "${text}"`);
  return row as HTMLElement;
}

const baseProps = {
  authorId: 'current-user',
  isLoadingMore: false,
  unreadCount: 0,
  lastReadIndex: -1,
};

beforeEach(() => {
  resetFactoryCounter();
  // rAF runs synchronously — the mocked VList renders every row
  // unconditionally, so moveFocus's retry loop always finds its target on
  // the first attempt.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('VirtualMessageList roving row focus', () => {
  it('lands the initial roving-tabindex target on the newest row', () => {
    renderWithProviders(
      <VirtualMessageList
        {...baseProps}
        orderedMessages={[msg('m1', 'one'), msg('m2', 'two'), msg('m3', 'three')]}
      />,
    );
    expect(rowFor('three')).toHaveAttribute('tabindex', '0');
    expect(rowFor('one')).toHaveAttribute('tabindex', '-1');
    expect(rowFor('two')).toHaveAttribute('tabindex', '-1');
  });

  it('ArrowUp moves the roving target and DOM focus to the previous row', () => {
    renderWithProviders(
      <VirtualMessageList
        {...baseProps}
        orderedMessages={[msg('m1', 'one'), msg('m2', 'two'), msg('m3', 'three')]}
      />,
    );
    fireEvent.keyDown(rowFor('three'), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(rowFor('two'));
    expect(rowFor('two')).toHaveAttribute('tabindex', '0');
    expect(rowFor('three')).toHaveAttribute('tabindex', '-1');
  });

  it('ArrowDown moves focus forward', () => {
    renderWithProviders(
      <VirtualMessageList
        {...baseProps}
        orderedMessages={[msg('m1', 'one'), msg('m2', 'two'), msg('m3', 'three')]}
      />,
    );
    fireEvent.keyDown(rowFor('three'), { key: 'ArrowUp' }); // now on 'two'
    fireEvent.keyDown(rowFor('two'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rowFor('three'));
  });

  it('clamps at the top and bottom edges (no-op past the first/last row)', () => {
    renderWithProviders(
      <VirtualMessageList {...baseProps} orderedMessages={[msg('m1', 'one'), msg('m2', 'two')]} />,
    );
    fireEvent.keyDown(rowFor('two'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rowFor('two'));

    fireEvent.keyDown(rowFor('two'), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(rowFor('one'));
    fireEvent.keyDown(rowFor('one'), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(rowFor('one'));
  });

  it('Home moves focus to the oldest-loaded row, End to the newest', () => {
    renderWithProviders(
      <VirtualMessageList
        {...baseProps}
        orderedMessages={[msg('m1', 'one'), msg('m2', 'two'), msg('m3', 'three')]}
      />,
    );
    fireEvent.keyDown(rowFor('three'), { key: 'Home' });
    expect(document.activeElement).toBe(rowFor('one'));
    fireEvent.keyDown(rowFor('one'), { key: 'End' });
    expect(document.activeElement).toBe(rowFor('three'));
  });

  it('keeps the roving target on the same message across a re-render (new message appended)', () => {
    const { rerender } = renderWithProviders(
      <VirtualMessageList
        {...baseProps}
        orderedMessages={[msg('m1', 'one'), msg('m2', 'two'), msg('m3', 'three')]}
      />,
    );
    fireEvent.keyDown(rowFor('three'), { key: 'ArrowUp' }); // -> 'two'
    expect(rowFor('two')).toHaveAttribute('tabindex', '0');

    rerender(
      <VirtualMessageList
        {...baseProps}
        orderedMessages={[
          msg('m1', 'one'),
          msg('m2', 'two'),
          msg('m3', 'three'),
          msg('m4', 'four'),
        ]}
      />,
    );
    // Still 'two' — not reset to the new newest row just because a message arrived.
    expect(rowFor('two')).toHaveAttribute('tabindex', '0');
    expect(rowFor('four')).toHaveAttribute('tabindex', '-1');

    fireEvent.keyDown(rowFor('two'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rowFor('three'));
  });

  it('Escape (no menu open) calls onEscapeToInput', () => {
    const onEscapeToInput = vi.fn();
    renderWithProviders(
      <VirtualMessageList
        {...baseProps}
        orderedMessages={[msg('m1', 'one')]}
        onEscapeToInput={onEscapeToInput}
      />,
    );
    fireEvent.keyDown(rowFor('one'), { key: 'Escape' });
    expect(onEscapeToInput).toHaveBeenCalledTimes(1);
  });

  it('Enter opens the row context menu', async () => {
    renderWithProviders(
      <VirtualMessageList {...baseProps} orderedMessages={[msg('m1', 'one')]} />,
    );
    fireEvent.keyDown(rowFor('one'), { key: 'Enter' });
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    expect(screen.getByText('Edit Message')).toBeInTheDocument();
  });

  it('ContextMenu key also opens the row context menu', async () => {
    renderWithProviders(
      <VirtualMessageList {...baseProps} orderedMessages={[msg('m1', 'one')]} />,
    );
    fireEvent.keyDown(rowFor('one'), { key: 'ContextMenu' });
    expect(await screen.findByRole('menu')).toBeInTheDocument();
  });

  it('does not hijack keys bubbling from a descendant control (only the row itself is a valid target)', () => {
    const onEscapeToInput = vi.fn();
    renderWithProviders(
      <VirtualMessageList
        {...baseProps}
        orderedMessages={[msg('m1', 'one')]}
        onEscapeToInput={onEscapeToInput}
      />,
    );
    const textNode = screen.getByText('one');
    fireEvent.keyDown(textNode, { key: 'Escape' });
    expect(onEscapeToInput).not.toHaveBeenCalled();
  });

  it('mode switch resets roving focus to the mode default even when the focused row id still resolves', () => {
    const messages = [
      msg('m1', 'one'),
      msg('m2', 'two'),
      msg('m3', 'three'),
      msg('m4', 'four'),
      msg('m5', 'five'),
    ];
    const { rerender } = renderWithProviders(
      <VirtualMessageList {...baseProps} orderedMessages={messages} />,
    );
    fireEvent.keyDown(rowFor('five'), { key: 'Home' }); // -> 'one'
    expect(rowFor('one')).toHaveAttribute('tabindex', '0');

    rerender(
      <VirtualMessageList {...baseProps} orderedMessages={messages} mode="anchored" />,
    );

    // 'm1' still resolves in the new data window (same array), but the mode
    // switch must reset the roving target to anchored mode's own default
    // (the centered row), not silently carry the stale key over.
    expect(rowFor('one')).toHaveAttribute('tabindex', '-1');
    expect(rowFor('three')).toHaveAttribute('tabindex', '0');
  });

  it('applies a themed :focus-visible outline rule to the row container', () => {
    renderWithProviders(
      <VirtualMessageList {...baseProps} orderedMessages={[msg('m1', 'one')]} />,
    );
    const row = rowFor('one');
    // Emotion inserts component styles as <style> tags; assert the row's own
    // generated class carries a :focus-visible outline (the themed focus
    // ring), rather than relying on the browser default outline.
    const css = Array.from(document.querySelectorAll('style'))
      .map(
        (tag) =>
          tag.textContent ||
          Array.from(tag.sheet?.cssRules ?? [])
            .map((rule) => rule.cssText)
            .join('\n'),
      )
      .join('\n');
    const hasFocusRing = Array.from(row.classList).some((cls) => {
      const idx = css.indexOf(`.${cls}:focus-visible`);
      return idx !== -1 && css.slice(idx, idx + 300).includes('outline');
    });
    expect(hasFocusRing).toBe(true);
  });

  describe('rAF-retry supersession', () => {
    /** Replaces the synchronous rAF stub with a manually-flushed queue so
     * two moveFocus retry loops can be genuinely interleaved. Returns the
     * queue plus a helper that diffs which frame ids a callback scheduled. */
    function installRafQueue({ inertCancel }: { inertCancel: boolean }) {
      const queue = new Map<number, FrameRequestCallback>();
      const cancelled = new Set<number>();
      let nextRafId = 1;
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        const id = nextRafId++;
        queue.set(id, cb);
        return id;
      });
      vi.stubGlobal('cancelAnimationFrame', (id: number) => {
        cancelled.add(id);
        if (!inertCancel) queue.delete(id);
      });
      const newFramesSince = (before: Set<number>) =>
        [...queue.keys()].filter((id) => !before.has(id));
      const snapshot = () => new Set(queue.keys());
      const scheduledCount = () => nextRafId - 1;
      return { queue, cancelled, snapshot, newFramesSince, scheduledCount };
    }

    it('a superseded moveFocus loop never applies focus, even when its frame resolves last', () => {
      // cancelAnimationFrame is deliberately INERT here: it simulates the
      // stale frame having already been dequeued past the point of
      // cancellation, proving the seq guard ALONE prevents the stale focus
      // (cancellation is only an optimization on top of it).
      const { queue, snapshot, newFramesSince, scheduledCount } = installRafQueue({
        inertCancel: true,
      });

      renderWithProviders(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={[msg('m1', 'one'), msg('m2', 'two'), msg('m3', 'three')]}
        />,
      );

      // First navigation: targets 'two', schedules its retry frame (queued,
      // NOT yet run).
      const beforeFirst = snapshot();
      fireEvent.keyDown(rowFor('three'), { key: 'ArrowUp' });
      const staleFrames = newFramesSince(beforeFirst);
      expect(staleFrames).toHaveLength(1);
      const staleId = staleFrames[0];

      // Second navigation lands before the first loop's frame ever fires:
      // targets 'one', supersedes the first loop.
      const beforeSecond = snapshot();
      fireEvent.keyDown(rowFor('two'), { key: 'ArrowUp' });
      const liveFrames = newFramesSince(beforeSecond).filter((id) => id !== staleId);
      expect(liveFrames).toHaveLength(1);
      const liveId = liveFrames[0];

      // Record every element that actually receives DOM focus from here on
      // (focusin bubbles to document), so an intermediate stale focus can't
      // hide behind a later correct activeElement.
      const focusedTargets: EventTarget[] = [];
      const recordFocus = (event: FocusEvent) => {
        if (event.target) focusedTargets.push(event.target);
      };
      document.addEventListener('focusin', recordFocus);
      try {
        // The NEWER loop's frame resolves first and focuses its target...
        act(() => queue.get(liveId)!(0));
        expect(document.activeElement).toBe(rowFor('one'));

        // ...then the SUPERSEDED loop's frame fires last (worst-case order —
        // exactly the race where "last writer wins" would corrupt focus).
        const scheduledBeforeStale = scheduledCount();
        act(() => queue.get(staleId)!(0));

        // The stale loop must abort: no focus applied to its old target, no
        // reschedule of further frames, roving state still on the new target.
        expect(focusedTargets).not.toContain(rowFor('two'));
        expect(document.activeElement).toBe(rowFor('one'));
        expect(scheduledCount()).toBe(scheduledBeforeStale);
        expect(rowFor('one')).toHaveAttribute('tabindex', '0');
        expect(rowFor('two')).toHaveAttribute('tabindex', '-1');
      } finally {
        document.removeEventListener('focusin', recordFocus);
      }
    });

    it('a superseding call cancels the previous pending retry frame outright', () => {
      const { cancelled, snapshot, newFramesSince } = installRafQueue({
        inertCancel: false,
      });

      renderWithProviders(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={[msg('m1', 'one'), msg('m2', 'two'), msg('m3', 'three')]}
        />,
      );

      const before = snapshot();
      fireEvent.keyDown(rowFor('three'), { key: 'ArrowUp' });
      const [staleId] = newFramesSince(before);

      fireEvent.keyDown(rowFor('two'), { key: 'ArrowUp' });
      expect(cancelled.has(staleId)).toBe(true);
    });

    it('unmount cancels the pending moveFocus retry frame', () => {
      const { cancelled, snapshot, newFramesSince } = installRafQueue({
        inertCancel: false,
      });

      const { unmount } = renderWithProviders(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={[msg('m1', 'one'), msg('m2', 'two')]}
        />,
      );

      const before = snapshot();
      fireEvent.keyDown(rowFor('two'), { key: 'ArrowUp' });
      const [pendingFocusFrame] = newFramesSince(before);
      expect(pendingFocusFrame).toBeDefined();

      unmount();
      expect(cancelled.has(pendingFocusFrame)).toBe(true);
    });
  });

  describe('list semantics', () => {
    it('uses role="list" with an accessible name, and role="listitem" per row', () => {
      renderWithProviders(
        <VirtualMessageList {...baseProps} orderedMessages={[msg('m1', 'one'), msg('m2', 'two')]} />,
      );
      expect(screen.getByRole('list', { name: 'Messages' })).toBeInTheDocument();
      expect(screen.getAllByRole('listitem').length).toBe(2);
    });

    it('has no axe violations across a small rendered list', async () => {
      renderWithProviders(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={[msg('m1', 'one'), msg('m2', 'two'), msg('m3', 'three')]}
        />,
      );
      // Bounded to WCAG A/AA tags — see EmojiPickerPopover.test.tsx for why
      // (axe's full default rule set is too slow per-node under coverage).
      const results = await runAxe(document.body, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
      });
      expectNoAxeViolations(results);
    }, 60000);
  });
});
