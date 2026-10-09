import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useEffect } from 'react';
import {
  refreshFloatDockRegion,
  resetFloatDockRegionForTests,
  useFloatDockRegion,
  useFloatRegionRef,
} from '../../hooks/useFloatDockRegion';
import type { Rect } from '../../utils/pipPosition';

function stubRect(el: HTMLElement, r: { left: number; top: number; width: number; height: number }) {
  el.getBoundingClientRect = () =>
    ({ ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height, toJSON: () => r }) as DOMRect;
}

let seen: Rect | null = null;
function Reader({ enabled = true }: { enabled?: boolean }) {
  const region = useFloatDockRegion(enabled);
  useEffect(() => {
    seen = region;
  });
  return null;
}

function Column({ chat, composer }: { chat: Rect; composer?: Rect }) {
  const chatRef = useFloatRegionRef('chat');
  const composerRef = useFloatRegionRef('composer', { observe: false });
  return (
    <div
      ref={(el) => {
        if (el) stubRect(el, chat);
        chatRef(el);
      }}
    >
      {composer && (
        <div
          ref={(el) => {
            if (el) stubRect(el, composer);
            composerRef(el);
          }}
        />
      )}
    </div>
  );
}

describe('useFloatDockRegion', () => {
  beforeEach(() => {
    resetFloatDockRegionForTests();
    seen = null;
  });
  afterEach(() => resetFloatDockRegionForTests());

  it('is null with nothing registered (window-based float card)', () => {
    render(<Reader />);
    expect(seen).toBeNull();
  });

  it('is the message column above the composer', () => {
    render(
      <>
        <Reader />
        <Column chat={{ left: 352, top: 56, width: 688, height: 700 }} composer={{ left: 352, top: 640, width: 688, height: 116 }} />
      </>,
    );
    expect(seen).toEqual({ left: 352, top: 56, width: 688, height: 584 });
  });

  it('ignores a zero-size (hidden) column', () => {
    render(
      <>
        <Reader />
        <Column chat={{ left: 0, top: 0, width: 0, height: 0 }} />
      </>,
    );
    expect(seen).toBeNull();
  });

  it('is null when disabled (touch layouts)', () => {
    render(
      <>
        <Reader enabled={false} />
        <Column chat={{ left: 352, top: 56, width: 688, height: 700 }} />
      </>,
    );
    expect(seen).toBeNull();
  });

  it('drops the region when the column unmounts, and follows composer growth on refresh', () => {
    const composer = { left: 352, top: 640, width: 688, height: 116 };
    const { rerender } = render(
      <>
        <Reader />
        <Column chat={{ left: 352, top: 56, width: 688, height: 700 }} composer={composer} />
      </>,
    );
    // The composer grows by 100px: MessageContainer calls refresh after measuring it
    composer.top = 540;
    act(() => refreshFloatDockRegion());
    expect(seen?.height).toBe(484);

    rerender(<Reader />);
    expect(seen).toBeNull();
  });
});
