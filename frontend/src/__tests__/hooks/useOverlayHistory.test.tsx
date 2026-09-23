import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useOverlayHistory, navigateAfterOverlays } from '../../hooks/useOverlayHistory';

const OVERLAY_KEY = '__overlayStack';

function overlayStack(): string[] {
  const state = window.history.state as Record<string, unknown> | null;
  return (state?.[OVERLAY_KEY] as string[] | undefined) ?? [];
}

/** Wait until any pending programmatic history.back() has settled. */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

describe('useOverlayHistory', () => {
  afterEach(async () => {
    // Unwind any overlay entries a test left behind.
    while (overlayStack().length > 0) {
      window.history.back();
      await settle();
    }
  });

  it('pushes a history entry when the overlay opens, keeping the URL', () => {
    const href = window.location.href;
    const before = window.history.length;
    const onClose = vi.fn();

    renderHook(({ open }) => useOverlayHistory(open, onClose), {
      initialProps: { open: true },
    });

    expect(window.history.length).toBe(before + 1);
    expect(overlayStack()).toHaveLength(1);
    expect(window.location.href).toBe(href);
  });

  it('does not push anything while closed or disabled', () => {
    const before = window.history.length;
    renderHook(() => useOverlayHistory(false, vi.fn()));
    renderHook(() => useOverlayHistory(true, vi.fn(), { enabled: false }));
    expect(window.history.length).toBe(before);
    expect(overlayStack()).toHaveLength(0);
  });

  it('back (popstate) closes the overlay without navigating away', async () => {
    const href = window.location.href;
    const onClose = vi.fn();
    renderHook(({ open }) => useOverlayHistory(open, onClose), {
      initialProps: { open: true },
    });

    act(() => window.history.back());

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(window.location.href).toBe(href);
    expect(overlayStack()).toHaveLength(0);
  });

  it('closing from the UI removes its own history entry without calling onClose', async () => {
    const onClose = vi.fn();
    const { rerender } = renderHook(({ open }) => useOverlayHistory(open, onClose), {
      initialProps: { open: true },
    });
    expect(overlayStack()).toHaveLength(1);

    rerender({ open: false });
    await settle();

    expect(overlayStack()).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('back closes only the top-most of two stacked overlays', async () => {
    const closeBottom = vi.fn();
    const closeTop = vi.fn();
    renderHook(() => useOverlayHistory(true, closeBottom));
    renderHook(() => useOverlayHistory(true, closeTop));
    expect(overlayStack()).toHaveLength(2);

    act(() => window.history.back());
    await waitFor(() => expect(closeTop).toHaveBeenCalledTimes(1));
    expect(closeBottom).not.toHaveBeenCalled();
    expect(overlayStack()).toHaveLength(1);
  });

  it('an overlay opened right after another closed from the UI stays open', async () => {
    const closeSheet = vi.fn();
    const closeThread = vi.fn();
    const sheet = renderHook(({ open }) => useOverlayHistory(open, closeSheet), {
      initialProps: { open: true },
    });

    // e.g. "Reply in thread" in the action sheet: sheet closes, thread opens.
    sheet.rerender({ open: false });
    renderHook(() => useOverlayHistory(true, closeThread));
    await settle();

    expect(closeThread).not.toHaveBeenCalled();
    expect(overlayStack()).toHaveLength(1);
  });

  it('does not go back if a route navigation was pushed on top of the overlay', async () => {
    const onClose = vi.fn();
    const { rerender } = renderHook(({ open }) => useOverlayHistory(open, onClose), {
      initialProps: { open: true },
    });
    // A link inside the overlay navigates (router pushState without our marker).
    window.history.pushState({ idx: 99 }, '', window.location.href);
    const lengthAfterNav = window.history.length;

    rerender({ open: false });
    await settle();

    expect(window.history.state).toEqual({ idx: 99 });
    expect(window.history.length).toBe(lengthAfterNav);
    // Clean up: pop the fake navigation entry, then the orphaned overlay entry.
    window.history.back();
    await settle();
  });

  describe('navigateAfterOverlays', () => {
    it('navigates right away when no overlay entry is on top', () => {
      const run = vi.fn();
      navigateAfterOverlays(run);
      expect(run).toHaveBeenCalledTimes(1);
    });

    it('unwinds the overlay entry before navigating, so no dead entry is left', async () => {
      const onClose = vi.fn();
      const { rerender } = renderHook(({ open }) => useOverlayHistory(open, onClose), {
        initialProps: { open: true },
      });
      const baseLength = window.history.length - 1;
      const run = vi.fn(() => window.history.pushState({ idx: 42 }, '', window.location.href));

      // Same order as the sheet actions: navigate, then close from the UI.
      act(() => navigateAfterOverlays(run));
      expect(run).not.toHaveBeenCalled();
      rerender({ open: false });

      await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
      // The route replaced the overlay entry's slot: back goes to the screen.
      expect(window.history.state).toEqual({ idx: 42 });
      expect(window.history.length).toBe(baseLength + 1);
      window.history.back();
      await settle();
      expect(overlayStack()).toHaveLength(0);
    });

    it('unwinds two stacked overlays (drawer + dialog) and closes both', async () => {
      const closeDrawer = vi.fn();
      const closeDialog = vi.fn();
      renderHook(() => useOverlayHistory(true, closeDrawer));
      renderHook(() => useOverlayHistory(true, closeDialog));
      expect(overlayStack()).toHaveLength(2);
      const run = vi.fn();

      act(() => navigateAfterOverlays(run));

      await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
      expect(closeDrawer).toHaveBeenCalledTimes(1);
      expect(closeDialog).toHaveBeenCalledTimes(1);
      expect(overlayStack()).toHaveLength(0);
    });
  });
});
