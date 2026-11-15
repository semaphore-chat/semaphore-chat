import type { Politeness } from '../toastQueue';

/**
 * A pair of visually hidden live regions. The page root has one; each
 * modal-type layer (Dialog, Sheet, Menu) renders one inside itself, because MUI
 * hides everything outside an open modal from assistive technology and a live
 * region out there would be silent. Each slot exists before text arrives.
 */
export interface LiveSlot {
  polite: HTMLElement;
  assertive: HTMLElement;
}

export interface Announcer {
  /**
   * Have screen readers read `text`. It goes to the topmost slot: the one
   * registered last. With no slot registered nothing is said.
   */
  say(text: string, politeness: Politeness): void;
  /** Makes `slot` the topmost one. Returns the function that removes it. */
  registerSlot(slot: LiveSlot): () => void;
}

export interface Frames {
  request(callback: () => void): unknown;
  cancel(handle: unknown): void;
}

const browserFrames: Frames = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle as number),
};

export function createAnnouncer(frames: Frames = browserFrames): Announcer {
  const slots: LiveSlot[] = [];
  const pending = new Map<HTMLElement, unknown>();

  return {
    say(text, politeness) {
      const slot = slots[slots.length - 1];
      if (slot === undefined) return;
      const region = slot[politeness];
      // Clear now and set the text next frame, so the same text is read again.
      const earlier = pending.get(region);
      if (earlier !== undefined) frames.cancel(earlier);
      region.textContent = '';
      pending.set(
        region,
        frames.request(() => {
          pending.delete(region);
          region.textContent = text;
        }),
      );
    },
    registerSlot(slot) {
      slots.push(slot);
      return () => {
        const at = slots.indexOf(slot);
        if (at !== -1) slots.splice(at, 1);
      };
    },
  };
}
