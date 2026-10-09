import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useScrollSpy } from '../../hooks/useScrollSpy';

type Callback = (entries: Partial<IntersectionObserverEntry>[]) => void;

describe('useScrollSpy', () => {
  const originalIO = globalThis.IntersectionObserver;
  afterEach(() => {
    globalThis.IntersectionObserver = originalIO;
    document.body.innerHTML = '';
  });

  function setup() {
    for (const id of ['one', 'two', 'three']) {
      const el = document.createElement('section');
      el.id = id;
      document.body.appendChild(el);
    }
    let callback: Callback = () => {};
    const observe = vi.fn();
    globalThis.IntersectionObserver = vi.fn(function (this: unknown, cb: Callback) {
      callback = cb;
      return { observe, disconnect: vi.fn(), unobserve: vi.fn() };
    }) as unknown as typeof IntersectionObserver;
    const hook = renderHook(() => useScrollSpy(['one', 'two', 'three']));
    return { hook, observe, fire: (entries: Partial<IntersectionObserverEntry>[]) => act(() => callback(entries)) };
  }

  it('starts on the first section and observes every section', () => {
    const { hook, observe } = setup();
    expect(hook.result.current[0]).toBe('one');
    expect(observe).toHaveBeenCalledTimes(3);
  });

  it('marks the first visible section, in page order', () => {
    const { hook, fire } = setup();
    const el = (id: string) => document.getElementById(id)!;
    fire([
      { target: el('three'), isIntersecting: true },
      { target: el('two'), isIntersecting: true },
    ]);
    expect(hook.result.current[0]).toBe('two');
    fire([{ target: el('two'), isIntersecting: false }]);
    expect(hook.result.current[0]).toBe('three');
  });

  it('scrollTo scrolls the section into view and marks it active', () => {
    const { hook } = setup();
    const scrollIntoView = vi.fn();
    document.getElementById('three')!.scrollIntoView = scrollIntoView;
    act(() => hook.result.current[1]('three'));
    expect(hook.result.current[0]).toBe('three');
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });
});
