/**
 * The system Back on the web (kit/behaviour/hosts/systemBack.ts), on the real kit overlays and jsdom's
 * session history: one entry per open layer, Back closes the top one, other closes consume their entry,
 * refusals keep it, and dead entries (left under a route, or from before a reload) are stepped over.
 */
import { StrictMode, useState, type ReactNode } from 'react';
import { HashRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { Button, Dialog, Menu, Sheet, Tooltip, useSystemBack, type MenuEntry } from '../../../../kit';
import { SYSTEM_BACK_KEY, TRAVERSAL_TIMEOUT_MS } from '../../../../kit/behaviour/hosts/systemBack';
import { useBehaviourHost, type BehaviourHostValue } from '../../../../kit/behaviour/hosts/hostContext';
import { renderWithKit } from '../../../test-utils/renderWithKit';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
  // Every test starts on a fresh pair of entries: 'before' (another page) under 'screen'.
  window.history.replaceState({ page: 'before', idx: 0, key: 'k0' }, '', '#/before');
  window.history.pushState({ page: 'screen', idx: 1, key: 'k1' }, '', '#/screen');
});
afterEach(async () => {
  // Unmounting with layers open steps back over their entries: let that land before the next test.
  cleanup();
  await settle();
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

const page = () => (window.history.state as { page?: string } | null)?.page;
const marker = (): unknown[] =>
  ((window.history.state as Record<string, unknown> | null)?.[SYSTEM_BACK_KEY] as unknown[] | undefined) ?? [];

/** The next popstate (the bridge's own traversals included). */
function nextPop(): Promise<void> {
  return new Promise((resolve) => window.addEventListener('popstate', () => resolve(), { once: true }));
}

/** Waits until history is still: no traversal started by the bridge is in flight. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    // jsdom runs a traversal in a task: give it (and the bridge's reaction to it) a few turns.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

/** The user presses Back once; resolves once history has settled. */
async function pressBack(): Promise<void> {
  const popped = nextPop();
  window.history.back();
  await act(async () => {
    await popped;
  });
  await settle();
}

function Bridge({ enabled = true, locationKey = 'k', children }: { enabled?: boolean; locationKey?: string; children: ReactNode }) {
  useSystemBack(enabled, locationKey);
  return <>{children}</>;
}

interface ScreenProps {
  onSheetClose?: (reason: string) => void;
  /** The dialog refuses every close but its own button. */
  refuse?: boolean;
}

function TestScreen({ onSheetClose, refuse = false }: ScreenProps) {
  const [sheet, setSheet] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const entries: MenuEntry[] = [
    { id: 'one', label: 'One', onSelect: () => undefined },
    { id: 'dialog', label: 'Dialog from menu', onSelect: () => setDialog(true) },
  ];
  return (
    <>
      <Button onClick={() => setSheet(true)}>Open sheet</Button>
      <Button onClick={() => setDialog(true)}>Open dialog</Button>
      <Button onClick={(event) => setMenuAnchor(event.currentTarget)}>Open menu</Button>
      <Tooltip label="Hint">
        <Button>Hinted</Button>
      </Tooltip>
      <Sheet
        open={sheet}
        title="Sheet"
        onClose={(reason) => {
          onSheetClose?.(reason);
          setSheet(false);
        }}
      >
        <Button onClick={() => setDialog(true)}>Open inner dialog</Button>
      </Sheet>
      <Dialog
        open={dialog}
        title="Dialog"
        onClose={() => {
          if (!refuse) setDialog(false);
        }}
        actions={<Button onClick={() => setDialog(false)}>Done</Button>}
      >
        Body
      </Dialog>
      <Menu anchor={menuAnchor} open={menuAnchor !== null} onClose={() => setMenuAnchor(null)} items={entries} label="More" />
    </>
  );
}

function open(name: string): void {
  fireEvent.click(screen.getByRole('button', { name }));
}

describe('useSystemBack', () => {
  it('pushes one entry with the same URL per open layer, and Back closes the top one as an Escape', async () => {
    const onSheetClose = vi.fn();
    const href = window.location.href;
    renderWithKit(
      <Bridge>
        <TestScreen onSheetClose={onSheetClose} />
      </Bridge>,
    );
    await settle();
    expect(marker()).toEqual([]);
    open('Open sheet');
    await settle();
    expect(marker()).toHaveLength(1);
    expect(page()).toBe('screen'); // the router's state is kept
    expect(window.location.href).toBe(href);

    // The close is committed inside the Back (flushSync): the bridge never pushes the entry again.
    const push = vi.spyOn(window.history, 'pushState');
    await pressBack();
    expect(push).not.toHaveBeenCalled();
    push.mockRestore();
    expect(onSheetClose).toHaveBeenCalledWith('escape');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sheet' })).toBeNull());
    expect(page()).toBe('screen');
    expect(marker()).toEqual([]);

    // A second Back leaves the screen.
    await pressBack();
    expect(page()).toBe('before');
  });

  it('closes nested layers innermost first, one per Back', async () => {
    renderWithKit(
      <Bridge>
        <TestScreen />
      </Bridge>,
    );
    open('Open sheet');
    await settle();
    open('Open inner dialog');
    await settle();
    expect(marker()).toHaveLength(2);

    await pressBack();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Dialog' })).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Sheet' })).toBeInTheDocument();
    expect(marker()).toHaveLength(1);

    await pressBack();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sheet' })).toBeNull());
    expect(page()).toBe('screen');
  });

  it('a menu takes a Back too; a tooltip gets no entry', async () => {
    const { user } = renderWithKit(
      <Bridge>
        <TestScreen />
      </Bridge>,
    );
    await user.hover(screen.getByRole('button', { name: /Hinted/ }));
    expect(await screen.findByRole('tooltip')).toBeInTheDocument();
    await settle();
    expect(marker()).toEqual([]);
    open('Open menu');
    await settle();
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(marker()).toHaveLength(1);
    await pressBack();
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(page()).toBe('screen');
  });

  it('a layer closed some other way consumes its entry: the next Back leaves the screen', async () => {
    renderWithKit(
      <Bridge>
        <TestScreen />
      </Bridge>,
    );
    open('Open dialog');
    await settle();
    expect(marker()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await settle();
    expect(marker()).toEqual([]);
    expect(page()).toBe('screen');
    await pressBack();
    expect(page()).toBe('before');
  });

  it('an owner that refuses keeps its layer and gets its entry back', async () => {
    renderWithKit(
      <Bridge>
        <TestScreen refuse />
      </Bridge>,
    );
    open('Open dialog');
    await settle();
    // The refused layer goes forward onto the entry it just left: no entry pushed after the traversal.
    const push = vi.spyOn(window.history, 'pushState');
    await pressBack();
    expect(screen.getByRole('dialog', { name: 'Dialog' })).toBeInTheDocument();
    expect(marker()).toHaveLength(1);
    // A second Back, no tap in between: refused again, the same way.
    await pressBack();
    expect(screen.getByRole('dialog', { name: 'Dialog' })).toBeInTheDocument();
    expect(marker()).toHaveLength(1);
    expect(push).not.toHaveBeenCalled();
    push.mockRestore();
    // Its own button still closes it, and the entry goes with it.
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await settle();
    expect(marker()).toEqual([]);
    await pressBack();
    expect(page()).toBe('before');
  });

  it('steps over an entry left under a route: Back from the route lands on the screen, not a dead entry', async () => {
    renderWithKit(
      <Bridge>
        <TestScreen />
      </Bridge>,
    );
    open('Open dialog');
    await settle();
    // An action in the dialog navigates (the route is pushed first), then the dialog closes.
    window.history.pushState({ page: 'route', idx: 2, key: 'k2' }, '', '#/route');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await settle();
    expect(page()).toBe('route');

    await pressBack();
    expect(page()).toBe('screen');
    expect(marker()).toEqual([]);
    await pressBack();
    expect(page()).toBe('before');
  });

  it('steps over a dead entry once, even when the router\'s popstate listener (first) steps the stack', async () => {
    let host: BehaviourHostValue | null = null;
    function Probe() {
      host = useBehaviourHost();
      return null;
    }
    // Like the router: a listener added before the bridge's whose re-render steps the stack, so a sync is
    // scheduled for the microtask right after it.
    const routerLike = () => host?.overlay.machine.send({ tab: {} });
    window.addEventListener('popstate', routerLike);
    try {
      renderWithKit(
        <Bridge>
          <Probe />
          <TestScreen />
        </Bridge>,
      );
      open('Open dialog');
      await settle();
      window.history.pushState({ page: 'route', idx: 2, key: 'k2' }, '', '#/route');
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      await settle();
      const go = vi.spyOn(window.history, 'go');
      await pressBack();
      expect(go).toHaveBeenCalledTimes(1);
      go.mockRestore();
      expect(page()).toBe('screen');
      await pressBack();
      expect(page()).toBe('before');
    } finally {
      window.removeEventListener('popstate', routerLike);
    }
  });

  it('leaves a dead entry the browser landed on to its popstate, even when the stack steps before it arrives', async () => {
    let host: BehaviourHostValue | null = null;
    function Probe() {
      host = useBehaviourHost();
      return null;
    }
    renderWithKit(
      <Bridge>
        <Probe />
        <TestScreen />
      </Bridge>,
    );
    open('Open dialog');
    await settle();
    const dead = window.history.state as Record<string, unknown>;
    window.history.pushState({ page: 'route', idx: 2, key: 'k2' }, '', '#/route');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await settle();
    // Chrome: the traversal has put the dead entry's state in place, and a stack step runs before its popstate.
    window.history.replaceState(dead, '');
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => undefined);
    await act(async () => {
      host?.overlay.machine.send({ tab: {} });
      await Promise.resolve();
    });
    expect(go).not.toHaveBeenCalled();
    window.dispatchEvent(new PopStateEvent('popstate', { state: dead }));
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith(-1);
    go.mockRestore();
  });

  it('a route replace while a layer is open leaves the screen one entry: Back closes the layer, then leaves', async () => {
    const view = renderWithKit(
      <Bridge locationKey="a">
        <TestScreen />
      </Bridge>,
    );
    open('Open sheet');
    await settle();
    window.history.replaceState({ page: 'replaced', idx: 1, key: 'kr' }, '', '#/screen?highlight=1');
    view.rerender(
      <Bridge locationKey="b">
        <TestScreen />
      </Bridge>,
    );
    await settle();
    expect(page()).toBe('replaced');
    expect(marker()).toHaveLength(1);
    expect(window.location.hash).toBe('#/screen?highlight=1');
    await pressBack();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sheet' })).toBeNull());
    expect(page()).toBe('replaced');
    expect(window.location.hash).toBe('#/screen?highlight=1');
    // The old screen entry is gone: the next Back leaves.
    await pressBack();
    expect(page()).toBe('before');
  });

  it('steps back over entries left from before a reload', async () => {
    window.history.pushState({ page: 'screen', idx: 1, [SYSTEM_BACK_KEY]: ['gone:layer-1'] }, '');
    window.history.pushState({ page: 'screen', idx: 1, [SYSTEM_BACK_KEY]: ['gone:layer-1', 'gone:layer-2'] }, '');
    renderWithKit(
      <Bridge>
        <TestScreen />
      </Bridge>,
    );
    await settle();
    expect(page()).toBe('screen');
    expect(marker()).toEqual([]);
    await pressBack();
    expect(page()).toBe('before');
  });

  it('does nothing when off (Electron, a mouse)', async () => {
    renderWithKit(
      <Bridge enabled={false}>
        <TestScreen />
      </Bridge>,
    );
    open('Open sheet');
    await settle();
    expect(marker()).toEqual([]);
    await pressBack();
    expect(page()).toBe('before');
    expect(screen.getByRole('dialog', { name: 'Sheet' })).toBeInTheDocument();
  });

  it('a menu item that opens a dialog rewrites the menu entry in place: no traversal, no push; then Back, Back', async () => {
    renderWithKit(
      <Bridge>
        <TestScreen />
      </Bridge>,
    );
    open('Open menu');
    await settle();
    expect(marker()).toHaveLength(1);
    const push = vi.spyOn(window.history, 'pushState');
    const go = vi.spyOn(window.history, 'go');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Dialog from menu' }));
    await settle();
    expect(screen.getByRole('dialog', { name: 'Dialog' })).toBeInTheDocument();
    expect(marker()).toHaveLength(1);
    expect(push).not.toHaveBeenCalled();
    expect(go).not.toHaveBeenCalled();
    push.mockRestore();
    go.mockRestore();
    await pressBack();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Dialog' })).toBeNull());
    expect(page()).toBe('screen');
    await pressBack();
    expect(page()).toBe('before');
  });

  it('Forward onto a dead entry steps on forward, to the route above it', async () => {
    renderWithKit(
      <Bridge>
        <TestScreen />
      </Bridge>,
    );
    open('Open dialog');
    await settle();
    window.history.pushState({ page: 'route', idx: 2, key: 'k2' }, '', '#/route');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await settle();
    await pressBack();
    expect(page()).toBe('screen');
    const popped = nextPop();
    window.history.forward();
    await act(async () => {
      await popped;
    });
    await settle();
    expect(page()).toBe('route');
    expect(window.location.hash).toBe('#/route');
  });

  it('a traversal that never lands is given up after a while, and the rule is restored', async () => {
    renderWithKit(
      <Bridge>
        <TestScreen />
      </Bridge>,
    );
    open('Open dialog');
    await settle();
    const go = vi.spyOn(window.history, 'go').mockImplementationOnce(() => undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await settle();
    expect(go).toHaveBeenCalledTimes(1);
    expect(marker()).toHaveLength(1); // the lost traversal left the entry
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, TRAVERSAL_TIMEOUT_MS + 50));
    });
    await settle();
    expect(go).toHaveBeenCalledTimes(2);
    go.mockRestore();
    expect(marker()).toEqual([]);
    await pressBack();
    expect(page()).toBe('before');
  });

  it('steps back over reload leftovers once under StrictMode (two bridges made in a row)', async () => {
    window.history.pushState({ page: 'screen', idx: 1, key: 'k1', [SYSTEM_BACK_KEY]: ['gone:layer-1'] }, '');
    window.history.pushState({ page: 'screen', idx: 1, key: 'k1', [SYSTEM_BACK_KEY]: ['gone:layer-1', 'gone:layer-2'] }, '');
    renderWithKit(
      <StrictMode>
        <Bridge>
          <TestScreen />
        </Bridge>
      </StrictMode>,
    );
    await settle();
    expect(page()).toBe('screen');
    await pressBack();
    expect(page()).toBe('before');
  });

  it('turned off with a layer open, it steps back over that layer\'s entry', async () => {
    const view = renderWithKit(
      <Bridge>
        <TestScreen />
      </Bridge>,
    );
    open('Open sheet');
    await settle();
    expect(marker()).toHaveLength(1);
    view.rerender(
      <Bridge enabled={false}>
        <TestScreen />
      </Bridge>,
    );
    await settle();
    expect(marker()).toEqual([]);
    expect(page()).toBe('screen');
    await pressBack();
    expect(page()).toBe('before');
  });
});

describe('useSystemBack with a real HashRouter', () => {
  function Where() {
    const location = useLocation();
    return <output data-testid="where">{`${location.pathname}${location.search}`}</output>;
  }

  /** A chat screen: a pinned sheet whose items jump (a replace) or open a thread (a push), and a header back arrow. */
  function Chat({ after }: { after: (run: () => void) => void }) {
    const navigate = useNavigate();
    const [sheet, setSheet] = useState(false);
    return (
      <>
        <Button onClick={() => navigate(-1)}>Header back</Button>
        <Button onClick={() => setSheet(true)}>Pinned</Button>
        <Sheet open={sheet} title="Pinned" onClose={() => setSheet(false)}>
          <Button
            onClick={() => {
              setSheet(false);
              navigate('/chat?highlight=m1', { replace: true });
            }}
          >
            Plain pin
          </Button>
          <Button
            onClick={() => {
              setSheet(false);
              navigate('/chat?highlight=m2&thread=m2');
            }}
          >
            Thread pin
          </Button>
          <Button
            onClick={() => {
              setSheet(false);
              // As the Lounge does (navigateAfterLayers): the jump, then its `?highlight=` clean-up right after.
              after(() => {
                navigate('/chat?highlight=m3', { replace: true });
                after(() => navigate('/chat', { replace: true }));
              });
            }}
          >
            Deferred pin
          </Button>
        </Sheet>
      </>
    );
  }

  function App() {
    const location = useLocation();
    const navigate = useNavigate();
    const after = useSystemBack(true, location.key);
    return (
      <>
        <Where />
        <Button onClick={() => navigate('/chat')}>Go to chat</Button>
        <Chat after={after} />
      </>
    );
  }

  const where = () => screen.getByTestId('where').textContent;

  /** `link`: a plain `<a href="#/chat">`, as the community's channel rows are: the browser makes the entry, state null. */
  async function openChat(via: 'navigate' | 'link' = 'navigate'): Promise<void> {
    window.history.replaceState(null, '', '#/home');
    renderWithKit(
      <HashRouter>
        <App />
      </HashRouter>,
    );
    await settle();
    if (via === 'navigate') {
      fireEvent.click(screen.getByRole('button', { name: 'Go to chat' }));
    } else {
      window.location.hash = '#/chat';
    }
    await settle();
    expect(where()).toBe('/chat');
  }

  it.each(['navigate', 'link'] as const)('a plain pin (a replace from the closing sheet): one Back leaves the chat (chat opened by %s)', async (via) => {
    await openChat(via);
    fireEvent.click(screen.getByRole('button', { name: 'Pinned' }));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Plain pin' }));
    await settle();
    expect(where()).toBe('/chat?highlight=m1');
    expect(window.location.hash).toBe('#/chat?highlight=m1');
    await pressBack();
    expect(where()).toBe('/home');
  });

  it('a jump through afterEntries lands on the chat\'s entry, and its clean-up replace right after is kept: one Back leaves', async () => {
    await openChat('link');
    fireEvent.click(screen.getByRole('button', { name: 'Pinned' }));
    await settle();
    const go = vi.spyOn(window.history, 'go');
    fireEvent.click(screen.getByRole('button', { name: 'Deferred pin' }));
    await settle();
    // One traversal: the sheet's entry stepped back over, before the jump; no repair needed after it.
    expect(go).toHaveBeenCalledTimes(1);
    go.mockRestore();
    expect(where()).toBe('/chat');
    expect(window.location.hash).toBe('#/chat');
    await pressBack();
    expect(where()).toBe('/home');
  });

  it('a plain pin: the header back arrow works on the first tap', async () => {
    await openChat();
    fireEvent.click(screen.getByRole('button', { name: 'Pinned' }));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Plain pin' }));
    await settle();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const popped = nextPop();
    fireEvent.click(screen.getByRole('button', { name: 'Header back' }));
    await act(async () => {
      await popped;
    });
    await settle();
    expect(where()).toBe('/home');
  });

  it('a thread pin (a push): Back returns to the chat, the next Back leaves, and Forward reaches the thread again', async () => {
    await openChat();
    fireEvent.click(screen.getByRole('button', { name: 'Pinned' }));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Thread pin' }));
    await settle();
    expect(where()).toBe('/chat?highlight=m2&thread=m2');
    await pressBack();
    expect(where()).toBe('/chat');
    const popped = nextPop();
    window.history.forward();
    await act(async () => {
      await popped;
    });
    await settle();
    expect(where()).toBe('/chat?highlight=m2&thread=m2');
    await pressBack();
    expect(where()).toBe('/chat');
    await pressBack();
    expect(where()).toBe('/home');
  });
});
