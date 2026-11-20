import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDocumentRouter, type RouterHandlers } from '../../../../kit/behaviour/hosts/router';

function setup() {
  const router = createDocumentRouter(window);
  const spies = () => ({ keydown: vi.fn(), pointerdown: vi.fn(), pointerup: vi.fn(), focusin: vi.fn() }) satisfies RouterHandlers;
  return { router, spies };
}

afterEach(() => document.body.replaceChildren());

describe('document router', () => {
  it('adds no document listener until a host registers, and removes them with the last host', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const { router, spies } = setup();
    expect(add).not.toHaveBeenCalled();
    const off = router.register({}, spies());
    expect(add).toHaveBeenCalled();
    off();
    expect(remove.mock.calls.map(([type]) => type).sort()).toEqual(add.mock.calls.map(([type]) => type).sort());
    add.mockRestore();
    remove.mockRestore();
  });

  it('sends Escape to the host touched most recently only', () => {
    const { router, spies } = setup();
    const a = {};
    const b = {};
    const sa = spies();
    const sb = spies();
    const offA = router.register(a, sa);
    const offB = router.register(b, sb);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(sb.keydown).toHaveBeenCalledTimes(1);
    expect(sa.keydown).not.toHaveBeenCalled();
    router.touch(a);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(sa.keydown).toHaveBeenCalledTimes(1);
    expect(sb.keydown).toHaveBeenCalledTimes(1);
    offA();
    offB();
  });

  it('falls back to the latest registered host when the touched one leaves', () => {
    const { router, spies } = setup();
    const a = {};
    const b = {};
    const sa = spies();
    const sb = spies();
    const offA = router.register(a, sa);
    const offB = router.register(b, sb);
    router.touch(a);
    offA();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(sb.keydown).toHaveBeenCalledTimes(1);
    offB();
  });

  it('sends presses and focus events to every host', () => {
    const { router, spies } = setup();
    const sa = spies();
    const sb = spies();
    const offA = router.register({}, sa);
    const offB = router.register({}, sb);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    document.body.dispatchEvent(new Event('pointerup', { bubbles: true }));
    document.body.dispatchEvent(new Event('focusin', { bubbles: true }));
    for (const s of [sa, sb]) {
      expect(s.pointerdown).toHaveBeenCalledTimes(1);
      expect(s.pointerup).toHaveBeenCalledTimes(1);
      expect(s.focusin).toHaveBeenCalledTimes(1);
    }
    offA();
    offB();
  });

  it('listens to presses in the capture phase, before the page can stop them', () => {
    const { router, spies } = setup();
    const s = spies();
    const off = router.register({}, s);
    const button = document.createElement('button');
    button.addEventListener('pointerdown', (event) => event.stopPropagation());
    document.body.append(button);
    button.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(s.pointerdown).toHaveBeenCalledTimes(1);
    off();
  });

  it('does nothing for a handler a host did not give', () => {
    const { router } = setup();
    const off = router.register({}, {});
    expect(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))).not.toThrow();
    off();
  });
});
