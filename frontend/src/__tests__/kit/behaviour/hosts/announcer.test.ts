import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAnnouncer, type LiveSlot } from '../../../../kit/behaviour/hosts/announcer';

function makeSlot(): LiveSlot {
  const polite = document.createElement('div');
  const assertive = document.createElement('div');
  document.body.append(polite, assertive);
  return { polite, assertive };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('announcer', () => {
  it('writes into the polite or the assertive region of the only slot, in the next frame', () => {
    const announcer = createAnnouncer();
    const slot = makeSlot();
    announcer.registerSlot(slot);
    announcer.say('Saved', 'polite');
    expect(slot.polite.textContent).toBe('');
    vi.advanceTimersToNextFrame();
    expect(slot.polite.textContent).toBe('Saved');
    expect(slot.assertive.textContent).toBe('');
    announcer.say('Failed', 'assertive');
    vi.advanceTimersToNextFrame();
    expect(slot.assertive.textContent).toBe('Failed');
    expect(slot.polite.textContent).toBe('Saved');
  });

  it('writes into the topmost slot: the last one registered', () => {
    const announcer = createAnnouncer();
    const root = makeSlot();
    const modal = makeSlot();
    announcer.registerSlot(root);
    const offModal = announcer.registerSlot(modal);
    announcer.say('In the dialog', 'polite');
    vi.advanceTimersToNextFrame();
    expect(modal.polite.textContent).toBe('In the dialog');
    expect(root.polite.textContent).toBe('');

    offModal();
    announcer.say('Back on the page', 'polite');
    vi.advanceTimersToNextFrame();
    expect(root.polite.textContent).toBe('Back on the page');
  });

  it('reads repeated identical text again: clears the region, then sets the same text next frame', () => {
    const announcer = createAnnouncer();
    const slot = makeSlot();
    announcer.registerSlot(slot);
    const writes: string[] = [];
    new MutationObserver(() => {}).observe(slot.polite, { childList: true });
    const record = () => writes.push(slot.polite.textContent ?? '');
    announcer.say('Message deleted', 'polite');
    vi.advanceTimersToNextFrame();
    record();
    announcer.say('Message deleted', 'polite');
    record(); // cleared synchronously
    vi.advanceTimersToNextFrame();
    record();
    expect(writes).toEqual(['Message deleted', '', 'Message deleted']);
  });

  it('a second say before the frame replaces the first: only the last text is written', () => {
    const announcer = createAnnouncer();
    const slot = makeSlot();
    announcer.registerSlot(slot);
    announcer.say('one', 'polite');
    announcer.say('two', 'polite');
    vi.advanceTimersToNextFrame();
    expect(slot.polite.textContent).toBe('two');
  });

  it('says nothing, and does not throw, with no slot registered', () => {
    const announcer = createAnnouncer();
    expect(() => announcer.say('Lost', 'polite')).not.toThrow();
    vi.advanceTimersToNextFrame();
  });

  it('unregistering the same slot twice, or a slot that is not there, does nothing', () => {
    const announcer = createAnnouncer();
    const a = makeSlot();
    const b = makeSlot();
    announcer.registerSlot(a);
    const off = announcer.registerSlot(b);
    off();
    off();
    announcer.say('x', 'polite');
    vi.advanceTimersToNextFrame();
    expect(a.polite.textContent).toBe('x');
  });
});
