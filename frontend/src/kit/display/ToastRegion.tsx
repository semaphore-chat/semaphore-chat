import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type JSX,
} from 'react';
import { createPortal } from 'react-dom';
import { keyframes, styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import type { Toast as QueuedToast } from '../behaviour/toastQueue';
import { useBehaviourHost } from '../behaviour/hosts/hostContext';
import type { ToastHost } from '../behaviour/hosts/toasts';
import { layerIndex } from '../overlays/surface';
import { kitTheme } from '../theme/KitProvider';
import { focusRing } from '../theme/states';
import { Toast } from './Toast';

/** Where the region sits, in viewport pixels: its bottom edge is `bottom`, centred over the anchor. */
interface Place {
  left: number;
  width: number;
  bottom: number;
}

const ANCHOR = '[data-kit-toast-anchor]';
const FRAME = '[data-kit-toast-frame]';

const enter = keyframes({
  from: { opacity: 0, transform: `translateY(${tokens.space.sm}px)` },
  to: { opacity: 1, transform: 'none' },
});

const leave = keyframes({
  from: { opacity: 1, transform: 'none' },
  to: { opacity: 0, transform: `translateY(${tokens.space.sm}px)` },
});

const Region = styled('div')(({ theme }) => {
  const { palette } = kitTheme(theme);
  return {
    position: 'fixed',
    // Page level, one below every overlay (Menu, Popover, Select list, Tooltip, Dialog, Sheet): a panel opened
    // from the composer is never covered, and under a dialog the toast is on the dimmed page.
    zIndex: layerIndex(theme, 'panel') - 1,
    boxSizing: 'border-box',
    // The bottom edge sits at `top`: the region grows upwards from it.
    transform: 'translateY(-100%)',
    borderRadius: `${tokens.radius.card}px`,
    outline: 'none',
    '&:focus-visible': focusRing(palette),
    '&[data-leaving]': { pointerEvents: 'none' },
  };
});

const Motion = styled('div')({
  animation: `${enter} ${tokens.motion.base}ms ease-out both`,
  '[data-leaving] > &': { animation: `${leave} ${tokens.motion.base}ms ease-in both` },
  '@media (prefers-reduced-motion: reduce)': {
    animation: 'none',
    '[data-leaving] > &': { animation: 'none' },
  },
});

const noop = () => undefined;

function reducedMotion(win: Window): boolean {
  return win.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** Visible: rendered with a box (a `hidden` pane has none). */
function rendered(element: Element): boolean {
  return element.getClientRects().length > 0;
}

/**
 * The screen's main island (a template marks it), else the frame, else the
 * window: the region sits at its bottom centre, above any clearance in it.
 */
function measure(doc: Document, host: ToastHost): Place {
  const win = doc.defaultView as Window;
  const anchor =
    [...doc.querySelectorAll(ANCHOR)].find(rendered) ?? [...doc.querySelectorAll(FRAME)].find(rendered) ?? null;
  const box = anchor?.getBoundingClientRect() ?? { left: 0, width: win.innerWidth, bottom: win.innerHeight };
  let bottom = box.bottom;
  host.clearances().forEach((element) => {
    if (anchor !== null && !anchor.contains(element)) return;
    if (!rendered(element)) return;
    const rect = element.getBoundingClientRect();
    if (rect.height > 0) bottom = Math.min(bottom, rect.top);
  });
  const { gutter, dialogSm } = tokens.layout;
  const width = Math.max(0, Math.min(box.width - 2 * gutter, dialogSm));
  return { left: box.left + (box.width - width) / 2, width, bottom: bottom - gutter };
}

function samePlace(a: Place | null, b: Place): boolean {
  return a !== null && a.left === b.left && a.width === b.width && a.bottom === b.bottom;
}

/** Measures while `active`, and again whenever the anchor, a clearance, the window or the keyboard changes. */
function usePlace(host: ToastHost, active: boolean): Place | null {
  const [place, setPlace] = useState<Place | null>(null);
  const update = useCallback(() => {
    const next = measure(document, host);
    setPlace((previous) => (samePlace(previous, next) ? previous : next));
  }, [host]);

  useLayoutEffect(() => {
    if (!active) return undefined;
    update();
    const win = window;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    const observe = () => {
      observer?.disconnect();
      document.querySelectorAll(`${ANCHOR}, ${FRAME}`).forEach((element) => observer?.observe(element));
      host.clearances().forEach((element) => observer?.observe(element));
    };
    observe();
    const offLayout = host.onLayout(() => {
      observe();
      update();
    });
    win.addEventListener('resize', update);
    win.visualViewport?.addEventListener('resize', update);
    win.visualViewport?.addEventListener('scroll', update);
    return () => {
      observer?.disconnect();
      offLayout();
      win.removeEventListener('resize', update);
      win.visualViewport?.removeEventListener('resize', update);
      win.visualViewport?.removeEventListener('scroll', update);
    };
  }, [active, host, update]);
  return place;
}

function placeStyle(place: Place | null): CSSProperties {
  if (place === null) return { visibility: 'hidden' };
  return { left: place.left, width: place.width, top: place.bottom };
}

/**
 * The toast area: the one toast showing, at the bottom centre of the screen's
 * main island, above its composer or stage controls (`useToastClearance`).
 * `AppFrame` renders it; a screen never does. It is a landmark region named
 * "Notifications", in the page only while a toast shows, and F6 moves focus
 * into it and back. The host announces each toast, so the Toast itself is quiet.
 */
export function ToastRegion(): JSX.Element | null {
  const { toasts: host, overlay } = useBehaviourHost();
  const state = useSyncExternalStore(host.machine.subscribe, host.machine.getState, host.machine.getState);
  // Under a dialog or sheet the toast is seen on the dimmed page but out of reach. MUI hides the page's body
  // children when a modal opens, not one that mounts while it is open, so the region hides itself.
  const modalOpen = useSyncExternalStore(overlay.machine.subscribe, () =>
    overlay.machine.getState().layers.some((layer) => layer.kind === 'dialog' || layer.kind === 'sheet'),
  );
  const showing = state.showing;
  const [leaving, setLeaving] = useState<QueuedToast | null>(null);
  const last = useRef<QueuedToast | null>(null);

  // The toast that just left fades out, quiet and out of reach, unless motion is reduced.
  useLayoutEffect(() => {
    if (showing !== null) {
      last.current = showing;
      setLeaving(null);
      return;
    }
    if (last.current !== null && !reducedMotion(window)) setLeaving(last.current);
    last.current = null;
  }, [showing]);
  useEffect(() => {
    if (leaving === null) return undefined;
    const timer = setTimeout(() => setLeaving(null), tokens.motion.base);
    return () => clearTimeout(timer);
  }, [leaving]);

  const place = usePlace(host, showing !== null || leaving !== null);

  const regionRef = useCallback(
    (element: HTMLDivElement | null) => {
      host.setRegion(element);
    },
    [host],
  );

  if (showing !== null) {
    const { id } = showing;
    return createPortal(
      <Region
        ref={regionRef}
        role="region"
        aria-label="Notifications"
        tabIndex={-1}
        data-kit-toast-region=""
        aria-hidden={modalOpen || undefined}
        inert={modalOpen}
        style={placeStyle(place)}
        onPointerEnter={(event) => {
          if (event.pointerType !== 'touch') host.setReason('pointer', true);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== 'touch') host.setReason('pointer', false);
        }}
        onFocus={() => host.setReason('focus', true)}
        onBlur={(event) => {
          const next = event.relatedTarget;
          if (!(next instanceof Node && event.currentTarget.contains(next))) host.setReason('focus', false);
        }}
      >
        <Motion key={id}>
          <Toast
            message={showing.message}
            tone={showing.tone}
            announce={false}
            action={showing.action === null ? undefined : { label: showing.action, onClick: () => host.act(id) }}
            onClose={() => host.toasts.dismiss(id)}
          />
        </Motion>
      </Region>,
      document.body,
    );
  }
  if (leaving !== null) {
    return createPortal(
      <Region data-leaving="" aria-hidden inert style={placeStyle(place)}>
        <Motion key={leaving.id}>
          <Toast
            message={leaving.message}
            tone={leaving.tone}
            announce={false}
            action={leaving.action === null ? undefined : { label: leaving.action, onClick: noop }}
            onClose={noop}
          />
        </Motion>
      </Region>,
      document.body,
    );
  }
  return null;
}
