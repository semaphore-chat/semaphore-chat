import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import {
  BOTTOM_CHROME_ORDER,
  TOP_CHROME_ORDER,
  TOAST_PRIORITY,
  BottomChromeProvider,
  computeBottomOffset,
  computeChromeOffset,
  computeTopOffset,
  pickActiveToast,
  readKeyboardInset,
  useBottomChromeOffset,
  useChromeItem,
  useMeasuredChromeItem,
  SNACKBAR_GAP,
  snackbarBottomSx,
  useKeyboardInset,
  useToastQueue,
  useTopChromeHost,
  useHasTopChromeHost,
  type ChromeItem,
} from '../../contexts/BottomChromeContext';

const NAV: ChromeItem = { id: 'nav', height: 56, order: BOTTOM_CHROME_ORDER.NAV, edge: 'bottom' };
const VOICE: ChromeItem = { id: 'voice', height: 72, order: BOTTOM_CHROME_ORDER.VOICE_BAR, edge: 'bottom' };
const COMPOSER: ChromeItem = { id: 'composer', height: 90, order: BOTTOM_CHROME_ORDER.COMPOSER, edge: 'bottom' };
const TOAST: ChromeItem = { id: 'toast', height: 48, order: BOTTOM_CHROME_ORDER.TOAST, edge: 'bottom' };

describe('computeBottomOffset — every {nav, voice bar, keyboard} combination (Review Focus #4)', () => {
  // When the keyboard is open the nav hides itself (unregisters), so the
  // "nav + keyboard" rows model what the store actually holds then.
  const KB = 300;
  const cases: Array<{ name: string; items: ChromeItem[]; keyboard: number; toast: number; chip: number; fab: number }> = [
    { name: 'nothing', items: [], keyboard: 0, toast: 0, chip: 0, fab: 0 },
    { name: 'nav', items: [NAV], keyboard: 0, toast: 56, chip: 56, fab: 56 },
    { name: 'voice bar', items: [VOICE], keyboard: 0, toast: 72, chip: 72, fab: 72 },
    { name: 'nav + voice bar', items: [NAV, VOICE], keyboard: 0, toast: 128, chip: 128, fab: 128 },
    { name: 'keyboard', items: [], keyboard: KB, toast: KB, chip: KB, fab: KB },
    { name: 'voice bar + keyboard', items: [VOICE], keyboard: KB, toast: 72 + KB, chip: 72 + KB, fab: 72 + KB },
    {
      name: 'nav + voice bar + composer + toast',
      items: [NAV, VOICE, COMPOSER, TOAST],
      keyboard: 0,
      toast: 56 + 72 + 90,
      chip: 56 + 72 + 90 + 48,
      fab: 56 + 72 + 90 + 48,
    },
    {
      name: 'voice bar + composer + toast + keyboard',
      items: [VOICE, COMPOSER, TOAST],
      keyboard: KB,
      toast: 72 + 90 + KB,
      chip: 72 + 90 + 48 + KB,
      fab: 72 + 90 + 48 + KB,
    },
  ];

  it.each(cases)('$name', ({ items, keyboard, toast, chip, fab }) => {
    expect(computeBottomOffset(items, BOTTOM_CHROME_ORDER.TOAST, keyboard).px).toBe(toast);
    expect(computeBottomOffset(items, BOTTOM_CHROME_ORDER.CHIP, keyboard).px).toBe(chip);
    expect(computeBottomOffset(items, BOTTOM_CHROME_ORDER.FAB, keyboard).px).toBe(fab);
  });

  it('adds the safe area when the keyboard is closed, and not when it is open', () => {
    expect(computeBottomOffset([NAV], BOTTOM_CHROME_ORDER.TOAST, 0).css).toBe(
      'calc(56px + var(--sc-safe-area-bottom, env(safe-area-inset-bottom, 0px)))',
    );
    expect(computeBottomOffset([NAV], BOTTOM_CHROME_ORDER.TOAST, 300).css).toBe('356px');
  });

  it('never counts the item itself or anything above it', () => {
    expect(computeBottomOffset([NAV, VOICE], BOTTOM_CHROME_ORDER.VOICE_BAR, 0).px).toBe(56);
    expect(computeBottomOffset([NAV, VOICE], BOTTOM_CHROME_ORDER.NAV, 0).px).toBe(0);
  });

  it('counts items sharing an order once, at the tallest height', () => {
    const second = { ...COMPOSER, id: 'composer-2', height: 120 };
    expect(computeChromeOffset([COMPOSER, second], BOTTOM_CHROME_ORDER.TOAST)).toBe(120);
  });

  it('ignores top-edge items for bottom offsets and vice versa', () => {
    const offline: ChromeItem = { id: 'offline', height: 32, order: TOP_CHROME_ORDER.OFFLINE, edge: 'top' };
    expect(computeBottomOffset([offline, NAV], BOTTOM_CHROME_ORDER.TOAST, 0).px).toBe(56);
    expect(computeTopOffset([offline, NAV], TOP_CHROME_ORDER.INCOMING_CALL).px).toBe(32);
  });
});

describe('pickActiveToast', () => {
  it('shows the update toast ahead of the install prompt, whichever asked first', () => {
    expect(
      pickActiveToast([
        { id: 'install', priority: TOAST_PRIORITY.INSTALL, seq: 0 },
        { id: 'update', priority: TOAST_PRIORITY.UPDATE, seq: 1 },
      ]),
    ).toBe('update');
    expect(pickActiveToast([])).toBeNull();
  });
});

describe('readKeyboardInset', () => {
  const fakeWindow = (innerHeight: number, vvHeight: number, offsetTop = 0) =>
    ({ innerHeight, visualViewport: { height: vvHeight, offsetTop } }) as unknown as Window;

  it('is the part of the layout viewport the visual viewport no longer covers', () => {
    expect(readKeyboardInset(fakeWindow(844, 500))).toBe(344);
  });

  it('ignores small changes (browser toolbars) and missing visualViewport', () => {
    expect(readKeyboardInset(fakeWindow(844, 790))).toBe(0);
    expect(readKeyboardInset({ innerHeight: 800 } as unknown as Window)).toBe(0);
  });
});

// ── Hooks against a real store ───────────────────────────────────────────

const Item: React.FC<{ id: string; order: number; height: number; edge?: 'top' | 'bottom' }> = (props) => {
  useChromeItem(props);
  return null;
};

const Offset: React.FC<{ order: number }> = ({ order }) => {
  const { px, css } = useBottomChromeOffset(order);
  return (
    <div data-testid={`offset-${order}`} data-css={css}>
      {px}
    </div>
  );
};

describe('useBottomChromeOffset', () => {
  it('follows items as they register, resize and unregister', () => {
    const { rerender } = render(
      <BottomChromeProvider>
        <Item id="nav" order={BOTTOM_CHROME_ORDER.NAV} height={56} />
        <Offset order={BOTTOM_CHROME_ORDER.TOAST} />
      </BottomChromeProvider>,
    );
    expect(screen.getByTestId('offset-30')).toHaveTextContent('56');

    rerender(
      <BottomChromeProvider>
        <Item id="nav" order={BOTTOM_CHROME_ORDER.NAV} height={56} />
        <Item id="voice" order={BOTTOM_CHROME_ORDER.VOICE_BAR} height={72} />
        <Offset order={BOTTOM_CHROME_ORDER.TOAST} />
      </BottomChromeProvider>,
    );
    expect(screen.getByTestId('offset-30')).toHaveTextContent('128');

    rerender(
      <BottomChromeProvider>
        <Item id="voice" order={BOTTOM_CHROME_ORDER.VOICE_BAR} height={80} />
        <Offset order={BOTTOM_CHROME_ORDER.TOAST} />
      </BottomChromeProvider>,
    );
    expect(screen.getByTestId('offset-30')).toHaveTextContent('80');
  });

  it('isolates stores per provider', () => {
    render(
      <>
        <BottomChromeProvider>
          <Item id="nav" order={BOTTOM_CHROME_ORDER.NAV} height={56} />
        </BottomChromeProvider>
        <BottomChromeProvider>
          <Offset order={BOTTOM_CHROME_ORDER.TOAST} />
        </BottomChromeProvider>
      </>,
    );
    expect(screen.getByTestId('offset-30')).toHaveTextContent('0');
  });
});

describe('useKeyboardInset', () => {
  const original = Object.getOwnPropertyDescriptor(window, 'visualViewport');
  afterEach(() => {
    if (original) Object.defineProperty(window, 'visualViewport', original);
    else delete (window as unknown as Record<string, unknown>).visualViewport;
  });

  it('updates when the visual viewport shrinks for the keyboard', () => {
    const vv = Object.assign(new EventTarget(), { height: window.innerHeight, offsetTop: 0 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });

    const Probe = () => <div data-testid="kb">{useKeyboardInset()}</div>;
    render(<Probe />);
    expect(screen.getByTestId('kb')).toHaveTextContent('0');

    act(() => {
      vv.height = window.innerHeight - 320;
      vv.dispatchEvent(new Event('resize'));
    });
    expect(screen.getByTestId('kb')).toHaveTextContent('320');
  });
});

describe('useToastQueue', () => {
  const Toast: React.FC<{ id: string; priority: number; want: boolean }> = ({ id, priority, want }) => {
    const show = useToastQueue(id, priority, want);
    return show ? <div>{id} showing</div> : null;
  };

  it('shows one toast at a time, update ahead of install, then the next in line', () => {
    const tree = (update: boolean) => (
      <BottomChromeProvider>
        <Toast id="install" priority={TOAST_PRIORITY.INSTALL} want />
        <Toast id="update" priority={TOAST_PRIORITY.UPDATE} want={update} />
      </BottomChromeProvider>
    );
    const { rerender } = render(tree(true));
    expect(screen.getByText('update showing')).toBeInTheDocument();
    expect(screen.queryByText('install showing')).not.toBeInTheDocument();

    rerender(tree(false));
    expect(screen.getByText('install showing')).toBeInTheDocument();
    expect(screen.queryByText('update showing')).not.toBeInTheDocument();
  });
});

describe('top chrome host', () => {
  it('reports the total top chrome height and whether a host is mounted', () => {
    const Host = () => <div data-testid="top">{useTopChromeHost()}</div>;
    const HasHost = () => <div data-testid="has">{String(useHasTopChromeHost())}</div>;
    const { rerender } = render(
      <BottomChromeProvider>
        <HasHost />
      </BottomChromeProvider>,
    );
    expect(screen.getByTestId('has')).toHaveTextContent('false');

    rerender(
      <BottomChromeProvider>
        <Host />
        <HasHost />
        <Item id="offline" order={TOP_CHROME_ORDER.OFFLINE} height={32} edge="top" />
        <Item id="call" order={TOP_CHROME_ORDER.INCOMING_CALL} height={64} edge="top" />
      </BottomChromeProvider>,
    );
    expect(screen.getByTestId('has')).toHaveTextContent('true');
    expect(screen.getByTestId('top')).toHaveTextContent('96');
  });
});

describe('review follow-ups', () => {
  it('snackbarBottomSx sets bottom at xs AND sm (MUI sets its own inside an sm media query)', () => {
    const sx = snackbarBottomSx({ px: 56, css: 'calc(56px + 0px)' }, SNACKBAR_GAP.sm);
    expect(sx.bottom.xs).toBe('calc(calc(56px + 0px) + 24px)');
    expect(sx.bottom.sm).toBe(sx.bottom.xs);
  });

  it('a pinch-zoom (visualViewport.scale > 1) is not mistaken for the keyboard', () => {
    const win = {
      innerHeight: 800,
      visualViewport: { height: 400, offsetTop: 0, scale: 2 },
    } as unknown as Window;
    expect(readKeyboardInset(win)).toBe(0);
    const keyboard = { innerHeight: 800, visualViewport: { height: 450, offsetTop: 0, scale: 1 } } as unknown as Window;
    expect(readKeyboardInset(keyboard)).toBe(350);
  });

  it('skipOrders leaves a level out (the chip over the sidebar ignores the composer)', () => {
    const items = [NAV, VOICE, COMPOSER, TOAST];
    expect(computeBottomOffset(items, BOTTOM_CHROME_ORDER.CHIP, 0).px).toBe(56 + 72 + 90 + 48);
    expect(computeBottomOffset(items, BOTTOM_CHROME_ORDER.CHIP, 0, [BOTTOM_CHROME_ORDER.COMPOSER]).px).toBe(
      56 + 72 + 48,
    );
  });

  it('floating video surfaces clear the nav and voice bar (offset at the composer level)', () => {
    expect(computeBottomOffset([NAV, VOICE, COMPOSER], BOTTOM_CHROME_ORDER.COMPOSER, 0).px).toBe(56 + 72);
  });

  it('a toast registered with its snackbar gap pushes the chip clear of the gap too', () => {
    const Toast: React.FC = () => {
      const ref = useMeasuredChromeItem({
        id: 'toast',
        order: BOTTOM_CHROME_ORDER.TOAST,
        fallbackHeight: 48,
        extraHeight: SNACKBAR_GAP.sm,
      });
      return <div ref={ref} />;
    };
    const Probe: React.FC = () => <div data-testid="chip">{useBottomChromeOffset(BOTTOM_CHROME_ORDER.CHIP).px}</div>;
    render(
      <BottomChromeProvider>
        <Toast />
        <Probe />
      </BottomChromeProvider>,
    );
    expect(screen.getByTestId('chip')).toHaveTextContent(String(48 + SNACKBAR_GAP.sm));
  });
});
