/**
 * The overlay stack's rules on the real kit overlays, driven through the DOM:
 * one test per rule of `design/behaviour/overlay-stack.json` (named by its
 * number), then replays of the pattern's scenarios that DOM actions can make.
 * The reducer vectors prove the state; these prove the host's translation:
 * the events it sends and the effects it carries out (onClose called, focus
 * moved, the key used or passed on).
 */
import { useRef, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import {
  Button,
  Dialog,
  ESCAPE_PRIORITY,
  IconButton,
  Menu,
  Popover,
  SelectField,
  Sheet,
  TextField,
  Tooltip,
  useScreenEscape,
  useScreenFocusTarget,
  type MenuEntry,
  type ModalCloseReason,
} from '../../../../kit';
import { useBehaviourHost } from '../../../../kit/behaviour/hosts/hostContext';
import type { BehaviourHostValue } from '../../../../kit/behaviour/hosts/hostContext';
import { tokens } from '../../../../theme/generated/tokens';
import { renderWithKit } from '../../../test-utils/renderWithKit';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

let host: BehaviourHostValue;
function Probe() {
  host = useBehaviourHost();
  return null;
}
const layers = () => host.overlay.machine.getState().layers;
const kinds = () => layers().map((layer) => layer.kind);

/** Escape on the focused element (or the body); false when a listener used the key (preventDefault). */
function escape(init: KeyboardEventInit = {}): boolean {
  return fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape', ...init });
}
function tab(): boolean {
  return fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab' });
}
/** A press: down and up on the same element, as a mouse does. */
function press(element: Element, up: Element = element): void {
  // What a mouse sends (jsdom's PointerEvent defaults isPrimary to false).
  const mouse = { button: 0, pointerType: 'mouse', isPrimary: true };
  fireEvent.pointerDown(element, mouse);
  fireEvent.pointerUp(up, mouse);
}
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const scrimOf = (name: string) => screen.getByRole('dialog', { name }).parentElement as HTMLElement;
/** MUI's invisible layer under a menu: the menu root's first child. */
const menuBackdrop = () => screen.getByRole('menu').closest('[role="presentation"]')?.firstElementChild as HTMLElement;
const tooltipShown = () => screen.queryByRole('tooltip') !== null;

/** A Popover with its own button, as a screen would own one. */
function OwnPopover({
  name,
  onClose,
  children,
  refuse = false,
}: {
  name: string;
  onClose?: () => void;
  children?: ReactNode;
  refuse?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <Button ref={setAnchor} onClick={() => setOpen(true)}>
        {name}
      </Button>
      <Popover
        open={open}
        anchor={anchor}
        label={`${name} panel`}
        onClose={() => {
          onClose?.();
          if (!refuse) setOpen(false);
        }}
      >
        {children ?? <Button>{`${name} inside`}</Button>}
      </Popover>
    </>
  );
}

function OwnMenu({ name, onClose, items }: { name: string; onClose?: () => void; items?: MenuEntry[] }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <Button ref={setAnchor} onClick={() => setOpen(true)}>
        {name}
      </Button>
      <Menu
        open={open}
        anchor={anchor}
        label={`${name} menu`}
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
        items={items ?? [{ id: 'a', label: 'Archive', onSelect: () => {} }]}
      />
    </>
  );
}

function OwnDialog({
  name,
  onClose,
  refuse = false,
  children,
}: {
  name: string;
  onClose?: (reason?: ModalCloseReason) => void;
  refuse?: boolean;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>{name}</Button>
      <Dialog
        open={open}
        title={`${name} dialog`}
        onClose={(reason) => {
          onClose?.(reason);
          if (!refuse) setOpen(false);
        }}
        actions={<Button onClick={() => setOpen(false)}>{`Close ${name}`}</Button>}
      >
        {children}
      </Dialog>
    </>
  );
}

/** Opens a button's overlay from the keyboard: no press is made. */
async function activate(name: string | RegExp): Promise<void> {
  act(() => button(name).focus());
  fireEvent.click(button(name));
  await act(async () => {});
}

describe('overlay stack rules on the kit overlays', () => {
  it('rule 1: every overlay joins the stack with its kind, parent, opener and opener layer; a tooltip stays on top', async () => {
    const { user } = renderWithKit(
      <>
        <Probe />
        <OwnDialog name="Edit">
          <Tooltip label="Help text">
            <IconButton icon="Info" label="Help" />
          </Tooltip>
          <OwnPopover name="Colour">
            <SelectField
              label="Shade"
              value=""
              onChange={() => {}}
              options={[{ value: 'dark', label: 'Dark' }]}
            />
          </OwnPopover>
        </OwnDialog>
      </>,
    );
    const editButton = button('Edit');
    await user.click(editButton);
    await user.hover(await screen.findByRole('button', { name: 'Help' }));
    await screen.findByRole('tooltip');
    // Opened with the pointer still on Help, so the tooltip stays up.
    const colour = button('Colour');
    fireEvent.click(colour);
    const combobox = await screen.findByRole('combobox', { name: 'Shade' });
    fireEvent.mouseDown(combobox, { button: 0 });
    await screen.findByRole('listbox');

    const [dialog, popover, list, tip] = layers();
    expect(kinds()).toEqual(['dialog', 'popover', 'menu', 'tooltip']);
    expect(dialog).toMatchObject({ parent: null, opener: host.ids.forElement(editButton), openerLayer: null });
    expect(popover).toMatchObject({ parent: dialog.id, opener: host.ids.forElement(colour), openerLayer: dialog.id });
    expect(list).toMatchObject({ parent: popover.id, opener: host.ids.forElement(combobox), openerLayer: popover.id });
    expect(tip).toMatchObject({ parent: dialog.id, opener: null, openerLayer: null });
  });

  it('rule 2: an open layer is in the stack once; re-rendering it does not open it again or move focus', async () => {
    function Typing() {
      const [open, setOpen] = useState(false);
      const [anchor, setAnchor] = useState<HTMLElement | null>(null);
      const [name, setName] = useState('');
      return (
        <>
          <Button ref={setAnchor} onClick={() => setOpen(true)}>
            Rename
          </Button>
          <Popover open={open} anchor={anchor} onClose={() => setOpen(false)} label={`Rename ${name}`}>
            <TextField label="Name" value={name} onChange={setName} />
          </Popover>
        </>
      );
    }
    const { user } = renderWithKit(
      <>
        <Probe />
        <Typing />
      </>,
    );
    await user.click(button('Rename'));
    const field = await screen.findByRole('textbox', { name: 'Name' });
    await waitFor(() => expect(field).toHaveFocus());
    const before = layers();
    await user.type(field, 'memes');
    expect(field).toHaveFocus();
    expect(field).toHaveValue('memes');
    expect(layers()).toEqual(before);
    expect(layers()).toHaveLength(1);
  });

  it('rule 3: Escape asks the topmost layer, one per press, wherever focus is', async () => {
    const onDialog = vi.fn();
    const onMenu = vi.fn();
    const { user } = renderWithKit(
      <OwnDialog name="Edit" onClose={onDialog}>
        <OwnMenu name="More" onClose={onMenu} />
      </OwnDialog>,
    );
    await user.click(button('Edit'));
    await user.click(await screen.findByRole('button', { name: 'More' }));
    await screen.findByRole('menu');
    // Focus on the body, not in any layer: the topmost still gets the key.
    act(() => (document.activeElement as HTMLElement).blur());
    expect(escape()).toBe(false);
    expect(onMenu).toHaveBeenCalledTimes(1);
    expect(onDialog).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    escape();
    expect(onDialog).toHaveBeenCalledWith('escape');
  });

  it('rule 4: Escape over a hover tooltip closes only the tooltip, is used up, and it stays hidden until re-entered', async () => {
    const onDialog = vi.fn();
    const onScreen = vi.fn(() => true);
    function ScreenEscape() {
      useScreenEscape(onScreen, ESCAPE_PRIORITY.panel);
      return null;
    }
    const { user } = renderWithKit(
      <>
        <ScreenEscape />
        <OwnDialog name="Edit" onClose={onDialog}>
          <TextField label="Name" value="" onChange={() => {}} />
          <Tooltip label="Help text">
            <IconButton icon="Info" label="Help" />
          </Tooltip>
        </OwnDialog>
      </>,
    );
    await user.click(button('Edit'));
    act(() => screen.getByRole('textbox', { name: 'Name' }).focus());
    await user.hover(button('Help'));
    await screen.findByRole('tooltip');
    expect(escape()).toBe(false);
    await waitFor(() => expect(tooltipShown()).toBe(false));
    expect(onDialog).not.toHaveBeenCalled();
    expect(onScreen).not.toHaveBeenCalled();
    // Still under the pointer: no new hover, and a fresh enter is ignored until it leaves.
    fireEvent.pointerEnter(button('Help'), { pointerType: 'mouse' });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(tooltipShown()).toBe(false);
    await user.unhover(button('Help'));
    await user.hover(button('Help'));
    await screen.findByRole('tooltip');
  });

  it('rule 5: Escape with nothing open runs the screen chain by priority until a step uses it', async () => {
    const calls: string[] = [];
    function Steps() {
      useScreenEscape(() => {
        calls.push('read');
        return true;
      }, ESCAPE_PRIORITY.conversation);
      useScreenEscape(() => {
        calls.push('panel');
        return false;
      }, ESCAPE_PRIORITY.panel);
      useScreenEscape(() => {
        calls.push('never');
        return true;
      }, 200);
      return null;
    }
    const { user } = renderWithKit(
      <>
        <Steps />
        <OwnPopover name="Emoji" />
      </>,
    );
    expect(escape()).toBe(false);
    expect(calls).toEqual(['panel', 'read']);
    calls.length = 0;
    await user.click(button('Emoji'));
    await screen.findByRole('dialog', { name: 'Emoji panel' });
    escape();
    expect(calls).toEqual([]);
  });

  it('rule 5: a screen chain that uses nothing leaves the key alone', () => {
    function Steps() {
      useScreenEscape(() => false, ESCAPE_PRIORITY.panel);
      return null;
    }
    renderWithKit(<Steps />);
    expect(escape()).toBe(true);
  });

  it('rule 6: a press in a layer owned by a popover is inside the popover too', async () => {
    const onOuter = vi.fn();
    const onInner = vi.fn();
    const { user } = renderWithKit(
      <OwnPopover name="Status" onClose={onOuter}>
        <OwnPopover name="Mood" onClose={onInner} />
      </OwnPopover>,
    );
    await user.click(button('Status'));
    await user.click(await screen.findByRole('button', { name: 'Mood' }));
    await screen.findByRole('dialog', { name: 'Mood panel' });
    press(button('Mood inside'));
    // The inner popover's anchor sits in the outer panel, and counts as inside the inner one.
    press(button('Mood'));
    expect(onOuter).not.toHaveBeenCalled();
    expect(onInner).not.toHaveBeenCalled();
    press(screen.getByRole('dialog', { name: 'Status panel' }));
    expect(onInner).toHaveBeenCalledTimes(1);
    expect(onOuter).not.toHaveBeenCalled();
  });

  it('rule 7: a press outside a popover closes it and carries on to the control below and the popovers below', async () => {
    const onFirst = vi.fn();
    const onSecond = vi.fn();
    const onAfter = vi.fn();
    const { user } = renderWithKit(
      <>
        <OwnPopover name="Emoji" onClose={onFirst} />
        <OwnPopover name="Gif" onClose={onSecond} />
        <Button onClick={onAfter}>After</Button>
      </>,
    );
    await user.click(button('Emoji'));
    await activate('Gif');
    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    await user.click(button('After'));
    expect(onSecond).toHaveBeenCalledTimes(1);
    expect(onFirst).toHaveBeenCalledTimes(1);
    expect(onAfter).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(button('After')).toHaveFocus();
  });

  it('rule 8: a press outside a menu closes only the menu: a popover below stays open', async () => {
    const onPopover = vi.fn();
    const onMenu = vi.fn();
    const { user } = renderWithKit(
      <>
        <OwnPopover name="Profile" onClose={onPopover} />
        <OwnMenu name="More" onClose={onMenu} />
      </>,
    );
    await user.click(button('Profile'));
    await activate('More');
    await screen.findByRole('menu');
    await user.click(menuBackdrop());
    expect(onMenu).toHaveBeenCalledTimes(1);
    expect(onPopover).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Profile panel' })).toBeInTheDocument();
  });

  it('rule 9: a press that starts and ends on the scrim closes the dialog and goes no further', async () => {
    const onDialog = vi.fn();
    const onPopover = vi.fn();
    const { user } = renderWithKit(
      <>
        <OwnPopover name="Invite" onClose={onPopover} />
        <OwnDialog name="Create" onClose={onDialog} />
      </>,
    );
    await user.click(button('Invite'));
    await activate('Create');
    const panel = screen.getByRole('dialog', { name: 'Create dialog' });
    // A drag from the panel to the scrim, and from the scrim into the panel, is not a press on the scrim.
    press(panel, scrimOf('Create dialog'));
    press(scrimOf('Create dialog'), panel);
    expect(onDialog).not.toHaveBeenCalled();
    press(scrimOf('Create dialog'));
    expect(onDialog).toHaveBeenCalledWith('scrim');
    expect(onDialog).toHaveBeenCalledTimes(1);
    expect(onPopover).not.toHaveBeenCalled();
  });

  it('rule 9: only the main button, or a primary touch or pen contact, is a press; a right or middle press does nothing', async () => {
    const onDialog = vi.fn();
    const onPopover = vi.fn();
    const onMenu = vi.fn();
    const { user } = renderWithKit(
      <>
        <OwnPopover name="Invite" onClose={onPopover} />
        <OwnMenu name="More" onClose={onMenu} />
        <OwnDialog name="Create" onClose={onDialog} />
      </>,
    );
    const pressWith = (element: Element, init: PointerEventInit) => {
      fireEvent.pointerDown(element, { isPrimary: true, pointerType: 'mouse', ...init });
      fireEvent.pointerUp(element, { isPrimary: true, pointerType: 'mouse', ...init });
    };
    await user.click(button('Invite'));
    for (const init of [{ button: 2 }, { button: 1 }, { pointerType: 'touch', isPrimary: false }]) {
      pressWith(document.body, init);
    }
    expect(onPopover).not.toHaveBeenCalled();
    await activate('More');
    pressWith(menuBackdrop(), { button: 2 });
    pressWith(menuBackdrop(), { button: 1 });
    expect(onMenu).not.toHaveBeenCalled();
    pressWith(menuBackdrop(), { button: 0, pointerType: 'pen', isPrimary: true });
    expect(onMenu).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    await activate('Create');
    pressWith(scrimOf('Create dialog'), { button: 2 });
    pressWith(scrimOf('Create dialog'), { button: 1 });
    pressWith(scrimOf('Create dialog'), { pointerType: 'touch', isPrimary: false });
    expect(onDialog).not.toHaveBeenCalled();
    pressWith(scrimOf('Create dialog'), { button: 0, pointerType: 'touch', isPrimary: true });
    expect(onDialog).toHaveBeenCalledWith('scrim');
  });

  it('rule 10: a press never closes a tooltip', async () => {
    const { user } = renderWithKit(
      <>
        <Tooltip label="Help text">
          <IconButton icon="Info" label="Help" />
        </Tooltip>
        <OwnPopover name="Emoji" />
      </>,
    );
    await activate('Emoji');
    await user.hover(button('Help'));
    await screen.findByRole('tooltip');
    press(document.body);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(tooltipShown()).toBe(true);
  });

  it('rule 11: Tab closes a menu and is used up; in a dialog or popover it moves focus as usual', async () => {
    const onMenu = vi.fn();
    const onDialog = vi.fn();
    const { user } = renderWithKit(
      <OwnDialog name="Edit" onClose={onDialog}>
        <OwnMenu name="More" onClose={onMenu} />
      </OwnDialog>,
    );
    await user.click(button('Edit'));
    expect(tab()).toBe(true);
    expect(onDialog).not.toHaveBeenCalled();
    await user.click(button('More'));
    await screen.findByRole('menu');
    expect(tab()).toBe(false);
    expect(onMenu).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(button('More')).toHaveFocus();
    expect(onDialog).not.toHaveBeenCalled();
  });

  it('rule 12: a refused close keeps the layer open and in the stack', async () => {
    const onDialog = vi.fn();
    const { user } = renderWithKit(
      <>
        <Probe />
        <OwnDialog name="Edit" onClose={onDialog} refuse />
      </>,
    );
    await user.click(button('Edit'));
    escape();
    escape();
    press(scrimOf('Edit dialog'));
    expect(onDialog.mock.calls).toEqual([['escape'], ['escape'], ['scrim']]);
    expect(screen.getByRole('dialog', { name: 'Edit dialog' })).toBeInTheDocument();
    expect(kinds()).toEqual(['dialog']);
  });

  it('rule 13: when a dialog closes, a popover it owns is told to close and stays closed', async () => {
    const onPopover = vi.fn();
    function Screen() {
      const [dialog, setDialog] = useState(false);
      const [anchor, setAnchor] = useState<HTMLElement | null>(null);
      return (
        <>
          <Probe />
          <Button onClick={() => setDialog(true)}>Edit</Button>
          <Button ref={setAnchor}>Colour</Button>
          <Dialog
            open={dialog}
            onClose={() => setDialog(false)}
            title="Edit dialog"
            actions={<Button onClick={() => setDialog(false)}>Close Edit</Button>}
          >
            {/* Owned by the dialog; its owner keeps it open on purpose: parentClosed is a command, not a request. */}
            <Popover open anchor={anchor} onClose={onPopover} label="Colour panel">
              <Button>Red</Button>
            </Popover>
          </Dialog>
        </>
      );
    }
    const { user } = renderWithKit(<Screen />);
    await user.click(button('Edit'));
    await screen.findByRole('dialog', { name: 'Colour panel' });
    expect(kinds()).toEqual(['dialog', 'popover']);
    vi.useFakeTimers();
    try {
      // From the keyboard: a press on Close would be a press outside the popover (rule 7).
      const close = screen.getByText('Close Edit').closest('button') as HTMLElement;
      act(() => close.focus());
      fireEvent.click(close);
      expect(onPopover).toHaveBeenCalledTimes(1);
      expect(layers()).toEqual([]);
      // Its owner keeps `open` true, yet it has faded out while the dialog is still fading.
      act(() => {
        vi.advanceTimersByTime(tokens.motion.fast + 20);
      });
      expect(screen.queryByText('Red')).not.toBeInTheDocument();
      expect(screen.getByText('Edit dialog')).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(tokens.motion.base);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('rule 14: focus goes to the opener, else the layer it was in, else the screen target; never when the user moved it', async () => {
    function Screen() {
      const composer = useRef<HTMLInputElement>(null);
      useScreenFocusTarget(composer);
      const [more, setMore] = useState(true);
      return (
        <>
          <TextField ref={composer} label="Message" value="" onChange={() => {}} />
          <OwnDialog name="Edit">
            <TextField label="Topic" value="" onChange={() => {}} />
            {more && <OwnMenu name="More" items={[{ id: 'r', label: 'Remove this button', onSelect: () => setMore(false) }]} />}
          </OwnDialog>
          <OwnPopover name="Emoji" />
          <Button>Other</Button>
        </>
      );
    }
    const { user } = renderWithKit(<Screen />);
    // Opener present: back to it.
    await user.click(button('Edit'));
    await user.click(button('More'));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(button('More')).toHaveFocus());
    // Opener gone: the layer it was in (the dialog's first control).
    await user.click(button('More'));
    await user.click(await screen.findByRole('menuitem', { name: 'Remove this button' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Topic' })).toHaveFocus());
    // The dialog's opener is there: back to Edit.
    await user.keyboard('{Escape}');
    await waitFor(() => expect(button('Edit')).toHaveFocus());
    // Focus moved by the user: it stays.
    await user.click(button('Emoji'));
    await user.click(button('Other'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(button('Other')).toHaveFocus();
  });

  it('rule 14: with the opener and its layer gone, focus goes to the screen focus target', async () => {
    function Screen() {
      const composer = useRef<HTMLInputElement>(null);
      useScreenFocusTarget(composer);
      const [row, setRow] = useState(true);
      const [open, setOpen] = useState(false);
      const [anchor, setAnchor] = useState<HTMLElement | null>(null);
      return (
        <>
          <TextField ref={composer} label="Message" value="" onChange={() => {}} />
          {row && (
            <Button ref={setAnchor} onClick={() => setOpen(true)}>
              Row actions
            </Button>
          )}
          <Popover open={open} anchor={anchor} onClose={() => setOpen(false)} label="Row panel">
            <Button
              onClick={() => {
                setRow(false);
                setOpen(false);
              }}
            >
              Delete row
            </Button>
          </Popover>
        </>
      );
    }
    const { user } = renderWithKit(<Screen />);
    await user.click(button('Row actions'));
    await user.click(await screen.findByRole('button', { name: 'Delete row' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus());
  });

  it('rule 15: closing a tooltip moves no focus', async () => {
    function Screen() {
      const composer = useRef<HTMLInputElement>(null);
      useScreenFocusTarget(composer);
      return (
        <>
          <TextField ref={composer} label="Message" value="" onChange={() => {}} />
          <TextField label="Search" value="" onChange={() => {}} />
          <Tooltip label="Help text">
            <IconButton icon="Info" label="Help" />
          </Tooltip>
        </>
      );
    }
    const { user } = renderWithKit(<Screen />);
    act(() => screen.getByRole('textbox', { name: 'Search' }).focus());
    await user.hover(button('Help'));
    await screen.findByRole('tooltip');
    await user.unhover(button('Help'));
    await waitFor(() => expect(tooltipShown()).toBe(false));
    expect(screen.getByRole('textbox', { name: 'Search' })).toHaveFocus();
    await user.hover(button('Help'));
    await screen.findByRole('tooltip');
    escape();
    await waitFor(() => expect(tooltipShown()).toBe(false));
    expect(screen.getByRole('textbox', { name: 'Search' })).toHaveFocus();
    // With focus lost (on the body), closing a tooltip still moves none.
    await user.unhover(button('Help'));
    act(() => (document.activeElement as HTMLElement).blur());
    await user.hover(button('Help'));
    await screen.findByRole('tooltip');
    await user.unhover(button('Help'));
    await waitFor(() => expect(tooltipShown()).toBe(false));
    expect(document.activeElement).toBe(document.body);
  });

  it('rule 16: a menu item that opens a dialog never puts focus back on the menu button under it', async () => {
    const { user } = renderWithKit(<MenuToDialog />);
    const trigger = button('Options');
    await user.click(trigger);
    const focused = vi.fn();
    trigger.addEventListener('focus', focused);
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await screen.findByRole('dialog', { name: 'Delete it?' });
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    await waitFor(() => expect(button('Cancel')).toHaveFocus());
    expect(focused).not.toHaveBeenCalled();
  });

  it('rule 16: a popover that closes under an open sheet restores no focus', async () => {
    function Screen() {
      const [popover, setPopover] = useState(false);
      const [sheet, setSheet] = useState(false);
      const [anchor, setAnchor] = useState<HTMLElement | null>(null);
      return (
        <>
          <Button ref={setAnchor} onClick={() => setPopover(true)}>
            Status
          </Button>
          <Popover open={popover} anchor={anchor} onClose={() => setPopover(false)} label="Status panel">
            <Button onClick={() => setSheet(true)}>All statuses</Button>
          </Popover>
          <Sheet open={sheet} onClose={() => setSheet(false)} title="Statuses">
            <Button onClick={() => setPopover(false)}>Clear status</Button>
          </Sheet>
        </>
      );
    }
    const { user } = renderWithKit(<Screen />);
    const status = button('Status');
    await user.click(status);
    await user.click(await screen.findByRole('button', { name: 'All statuses' }));
    await screen.findByRole('dialog', { name: 'Statuses' });
    const focused = vi.fn();
    status.addEventListener('focus', focused);
    // Focus lost as the popover closes: it would go back to Status, under the sheet.
    act(() => (document.activeElement as HTMLElement).blur());
    fireEvent.click(screen.getByRole('button', { name: 'Clear status' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Status panel' })).not.toBeInTheDocument());
    expect(focused).not.toHaveBeenCalled();
  });

  it('rule 17: a dialog opened from a menu item takes over the menu opener: focus returns to the menu button', async () => {
    const { user } = renderWithKit(<MenuToDialog withComposer />);
    await user.click(button('Options'));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await screen.findByRole('dialog', { name: 'Delete it?' });
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(button('Options')).toHaveFocus());
  });

  it('rule 18: Escape while composing, or used by the focused control, never reaches the stack', async () => {
    const onPopover = vi.fn();
    const fieldSaw = vi.fn();
    const { user } = renderWithKit(
      <OwnPopover name="Edit" onClose={onPopover}>
        <TextField
          label="Mention"
          value=""
          onChange={() => {}}
          onKeyDown={(event) => {
            fieldSaw(event.key);
            if (event.key === 'Escape' && event.shiftKey) event.preventDefault();
          }}
        />
      </OwnPopover>,
    );
    await user.click(button('Edit'));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Mention' })).toHaveFocus());
    escape({ isComposing: true });
    escape({ keyCode: 229 });
    // The field "uses" Escape (an open mention list) by preventing its default.
    escape({ shiftKey: true });
    expect(fieldSaw).toHaveBeenCalledTimes(3);
    expect(onPopover).not.toHaveBeenCalled();
    escape();
    expect(onPopover).toHaveBeenCalledTimes(1);
  });

  it('rule 19: a layer that opens inside a layer that already left the stack has no parent', async () => {
    const matches = Element.prototype.matches;
    const spy = vi
      .spyOn(Element.prototype, 'matches')
      .mockImplementation(function (this: Element, selector: string) {
        return selector === ':focus-visible' ? this === document.activeElement : matches.call(this, selector);
      });
    try {
      const { user } = renderWithKit(
        <>
          <Probe />
          <OwnDialog name="Edit">
            <Tooltip label="Help text">
              <IconButton icon="Info" label="Help" />
            </Tooltip>
          </OwnDialog>
        </>,
      );
      await user.click(button('Edit'));
      const help = screen.getByRole('button', { name: 'Help' });
      fireEvent.click(button('Close Edit'));
      // The dialog has left the stack; its content is still fading out.
      expect(layers()).toEqual([]);
      act(() => help.focus());
      expect(kinds()).toEqual(['tooltip']);
      expect(layers()[0].parent).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('overlay stack scenarios, replayed through the DOM', () => {
  // design/behaviour/overlay-stack.json, in file order. Each performs the
  // scenario's events with real overlays and checks the executed effects.

  it("scenario 'escape closes the innermost first'", async () => {
    const onDialog = vi.fn();
    const onMenu = vi.fn();
    const { user } = renderWithKit(
      <OwnDialog name="Delete" onClose={onDialog}>
        <OwnMenu name="More" onClose={onMenu} />
      </OwnDialog>,
    );
    const deleteButton = button('Delete');
    await user.click(deleteButton);
    await user.click(button('More'));
    await screen.findByRole('menu');
    escape();
    expect(onMenu).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(button('More')).toHaveFocus());
    escape();
    expect(onDialog).toHaveBeenCalledWith('escape');
    await waitFor(() => expect(deleteButton).toHaveFocus());
  });

  it("scenario 'empty stack hands Escape to the screen'", () => {
    const onScreen = vi.fn(() => true);
    function Steps() {
      useScreenEscape(onScreen, ESCAPE_PRIORITY.panel);
      return null;
    }
    renderWithKit(<Steps />);
    escape();
    expect(onScreen).toHaveBeenCalledTimes(1);
  });

  it("scenario 'a refused close keeps the layer'", async () => {
    const onDialog = vi.fn();
    const { user } = renderWithKit(<OwnDialog name="Edit" onClose={onDialog} refuse />);
    await user.click(button('Edit'));
    escape();
    escape();
    expect(onDialog.mock.calls).toEqual([['escape'], ['escape']]);
    expect(screen.getByRole('dialog', { name: 'Edit dialog' })).toBeInTheDocument();
  });

  it("scenario 'a tooltip stays on top and takes the Escape'", async () => {
    const onDialog = vi.fn();
    const onPopover = vi.fn();
    const { user } = renderWithKit(
      <OwnDialog name="Settings" onClose={onDialog}>
        <Tooltip label="Help text">
          <IconButton icon="Info" label="Help" />
        </Tooltip>
        <OwnPopover name="Colour" onClose={onPopover} />
      </OwnDialog>,
    );
    await user.click(button('Settings'));
    await user.hover(button('Help'));
    await screen.findByRole('tooltip');
    fireEvent.click(button('Colour'));
    await screen.findByRole('dialog', { name: 'Colour panel' });
    escape();
    await waitFor(() => expect(tooltipShown()).toBe(false));
    expect(onPopover).not.toHaveBeenCalled();
    escape();
    expect(onPopover).toHaveBeenCalledTimes(1);
    expect(onDialog).not.toHaveBeenCalled();
  });

  it("scenario 'a lone tooltip takes the Escape from the screen'", async () => {
    const onScreen = vi.fn(() => true);
    function Steps() {
      useScreenEscape(onScreen, ESCAPE_PRIORITY.panel);
      return null;
    }
    const { user } = renderWithKit(
      <>
        <Steps />
        <Tooltip label="Help text">
          <IconButton icon="Info" label="Help" />
        </Tooltip>
      </>,
    );
    await user.hover(button('Help'));
    await screen.findByRole('tooltip');
    escape();
    await waitFor(() => expect(tooltipShown()).toBe(false));
    expect(onScreen).not.toHaveBeenCalled();
    escape();
    expect(onScreen).toHaveBeenCalledTimes(1);
  });

  it("scenario 'opening an open layer again does nothing'", async () => {
    function Moving() {
      const [open, setOpen] = useState(false);
      const [emoji, setEmoji] = useState<HTMLElement | null>(null);
      const [other, setOther] = useState<HTMLElement | null>(null);
      const [onOther, setOnOther] = useState(false);
      return (
        <>
          <Button ref={setEmoji} onClick={() => setOpen(true)}>
            Emoji
          </Button>
          <Button ref={setOther}>Other</Button>
          <Popover open={open} anchor={onOther ? other : emoji} onClose={() => setOpen(false)} label="Picker">
            <Button onClick={() => setOnOther(true)}>Move</Button>
          </Popover>
        </>
      );
    }
    const { user } = renderWithKit(<Moving />);
    await user.click(button('Emoji'));
    await user.click(await screen.findByRole('button', { name: 'Move' }));
    escape();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(button('Emoji')).toHaveFocus();
  });

  it("scenario 'a press inside a child counts as inside its parents'", async () => {
    const onStatus = vi.fn();
    const onMood = vi.fn();
    const onFilter = vi.fn();
    const { user } = renderWithKit(
      <>
        <OwnPopover name="Status" onClose={onStatus}>
          <OwnPopover name="Mood" onClose={onMood} />
        </OwnPopover>
        <OwnPopover name="Filter" onClose={onFilter} />
      </>,
    );
    await user.click(button('Status'));
    await user.click(await screen.findByRole('button', { name: 'Mood' }));
    await activate('Filter');
    press(button('Mood inside'));
    expect([onStatus, onMood, onFilter].map((fn) => fn.mock.calls.length)).toEqual([0, 0, 1]);
    // The inner popover's anchor, drawn in the outer panel: inside the inner one.
    press(button('Mood'));
    expect([onStatus, onMood, onFilter].map((fn) => fn.mock.calls.length)).toEqual([0, 0, 1]);
    press(screen.getByRole('dialog', { name: 'Status panel' }));
    expect([onStatus, onMood, onFilter].map((fn) => fn.mock.calls.length)).toEqual([0, 1, 1]);
    press(document.body);
    expect([onStatus, onMood, onFilter].map((fn) => fn.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it("scenario 'a menu swallows a press outside it'", async () => {
    const onProfile = vi.fn();
    const onMenu = vi.fn();
    const { user } = renderWithKit(
      <OwnPopover name="Profile" onClose={onProfile}>
        <OwnMenu name="More" onClose={onMenu} />
      </OwnPopover>,
    );
    await user.click(button('Profile'));
    await user.click(await screen.findByRole('button', { name: 'More' }));
    await screen.findByRole('menu');
    await user.click(menuBackdrop());
    expect(onMenu).toHaveBeenCalledTimes(1);
    expect(onProfile).not.toHaveBeenCalled();
  });

  it("scenario 'a press on the scrim'", async () => {
    const onInvite = vi.fn();
    const onCreate = vi.fn();
    const onSheet = vi.fn();
    function SheetButton() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Button onClick={() => setOpen(true)}>Browse</Button>
          <Sheet
            open={open}
            title="Browse sheet"
            onClose={(reason) => {
              onSheet(reason);
              setOpen(false);
            }}
          >
            Rows
          </Sheet>
        </>
      );
    }
    const { user } = renderWithKit(
      <>
        <OwnPopover name="Invite" onClose={onInvite}>
          <OwnDialog name="Create" onClose={onCreate}>
            <Tooltip label="Help text">
              <IconButton icon="Info" label="Help" />
            </Tooltip>
          </OwnDialog>
        </OwnPopover>
        <SheetButton />
      </>,
    );
    await user.click(button('Invite'));
    const invitePanel = screen.getByRole('dialog', { name: 'Invite panel' });
    await user.click(button('Create'));
    await user.hover(await screen.findByRole('button', { name: 'Help' }));
    await screen.findByRole('tooltip');
    press(screen.getByRole('dialog', { name: 'Create dialog' }));
    expect(onCreate).not.toHaveBeenCalled();
    // A press that lands in the popover the dialog belongs to is still outside the dialog.
    press(invitePanel);
    expect(onCreate).toHaveBeenCalledWith('scrim');
    expect(onInvite).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Create dialog' })).not.toBeInTheDocument());
    await activate('Browse');
    press(scrimOf('Browse sheet'));
    expect(onSheet).toHaveBeenCalledWith('scrim');
    expect(onInvite).not.toHaveBeenCalled();
  });

  it("scenario 'tab closes a menu only' (the tooltip on the menu cannot be made: menu items take no tooltip)", async () => {
    const onDialog = vi.fn();
    const onMenu = vi.fn();
    const { user } = renderWithKit(
      <OwnDialog name="Rename" onClose={onDialog}>
        <OwnMenu name="More" onClose={onMenu} />
      </OwnDialog>,
    );
    await user.click(button('Rename'));
    expect(tab()).toBe(true);
    await user.click(button('More'));
    await screen.findByRole('menu');
    expect(tab()).toBe(false);
    expect(onMenu).toHaveBeenCalledTimes(1);
    expect(onDialog).not.toHaveBeenCalled();
  });

  it("scenario 'closing a parent commands its children to close'", async () => {
    const onDevice = vi.fn();
    const onSelect = vi.fn();
    const onOther = vi.fn();
    const { user } = renderWithKit(
      <>
        <OwnDialog name="Call">
          <OwnPopover name="Device" onClose={onDevice} refuse>
            <OwnMenu name="Select device" onClose={onSelect} />
          </OwnPopover>
        </OwnDialog>
        <OwnPopover name="Other" onClose={onOther} />
      </>,
    );
    const call = button('Call');
    await user.click(call);
    await user.click(button('Device'));
    await user.click(await screen.findByRole('button', { name: 'Select device' }));
    await screen.findByRole('menu');
    // Hidden from assistive technology under the open menu, so found by its text.
    fireEvent.click(screen.getByText('Other').closest('button') as HTMLElement);
    await waitFor(() => expect(screen.getByText('Other inside')).toBeInTheDocument());
    // The owner closes the dialog from the keyboard (no press, no Escape).
    const close = screen.getByText('Close Call').closest('button') as HTMLElement;
    act(() => close.focus());
    fireEvent.click(close);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onDevice).toHaveBeenCalledTimes(1);
    expect(onOther).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Device panel' })).not.toBeInTheDocument());
    await waitFor(() => expect(call).toHaveFocus());
  });

  it("scenario 'focus falls back when the opener is gone'", async () => {
    function Screen() {
      const composer = useRef<HTMLInputElement>(null);
      useScreenFocusTarget(composer);
      const [row, setRow] = useState(true);
      const [more, setMore] = useState(true);
      const [open, setOpen] = useState(false);
      return (
        <>
          <TextField ref={composer} label="Message" value="" onChange={() => {}} />
          {row && <Button onClick={() => setOpen(true)}>Row menu</Button>}
          <Dialog
            open={open}
            onClose={() => setOpen(false)}
            title="Row"
            actions={<Button onClick={() => setRow(false)}>Hide row</Button>}
          >
            {more && (
              <OwnMenu name="More" items={[{ id: 'x', label: 'Remove More', onSelect: () => setMore(false) }]} />
            )}
          </Dialog>
        </>
      );
    }
    const { user } = renderWithKit(<Screen />);
    await user.click(button('Row menu'));
    await activate('Hide row');
    await user.click(button('More'));
    await user.click(await screen.findByRole('menuitem', { name: 'Remove More' }));
    // The menu's opener is gone: the dialog it was in takes focus.
    await waitFor(() => expect(button('Hide row')).toHaveFocus());
    escape();
    // The dialog's opener is gone too, and it was in no layer: the screen's focus target.
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus());
  });

  it("scenario 'a press outside a popover keeps the focus it gave'", async () => {
    const { user } = renderWithKit(
      <>
        <OwnPopover name="Emoji" />
        <OwnPopover name="Gif" />
        <Button>After</Button>
      </>,
    );
    await user.click(button('Emoji'));
    await user.click(button('After'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(button('After')).toHaveFocus();
    await user.click(button('Gif'));
    await screen.findByRole('dialog', { name: 'Gif panel' });
    act(() => (document.activeElement as HTMLElement).blur());
    escape();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(button('Gif')).toHaveFocus();
  });

  it("scenario 'a menu item opens a confirm dialog'", async () => {
    const { user } = renderWithKit(<MenuToDialog withComposer />);
    await user.click(button('Options'));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(button('Cancel')).toHaveFocus());
    escape();
    await waitFor(() => expect(button('Options')).toHaveFocus());
  });

  it("scenario 'a layer under an open sheet restores no focus'", async () => {
    function Screen() {
      const [popover, setPopover] = useState(false);
      const [sheet, setSheet] = useState(false);
      const [status, setStatus] = useState<HTMLElement | null>(null);
      return (
        <>
          <Button ref={setStatus} onClick={() => setPopover(true)}>
            Status
          </Button>
          <Button onClick={() => setSheet(true)}>More</Button>
          <Popover open={popover} anchor={status} onClose={() => setPopover(false)} label="Status panel">
            <Button>Busy</Button>
          </Popover>
          <Sheet open={sheet} onClose={() => setSheet(false)} title="More sheet">
            <Button onClick={() => setPopover(false)}>Clear</Button>
          </Sheet>
        </>
      );
    }
    const { user } = renderWithKit(<Screen />);
    const status = button('Status');
    const more = button('More');
    await user.click(status);
    await activate('More');
    await screen.findByRole('dialog', { name: 'More sheet' });
    const focused = vi.fn();
    status.addEventListener('focus', focused);
    act(() => (document.activeElement as HTMLElement).blur());
    fireEvent.click(button('Clear'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Status panel' })).not.toBeInTheDocument());
    expect(focused).not.toHaveBeenCalled();
    escape();
    await waitFor(() => expect(more).toHaveFocus());
  });

  it("scenario 'escape while composing or owned by the focused control'", async () => {
    const onScreen = vi.fn(() => true);
    const onDialog = vi.fn();
    function Steps() {
      useScreenEscape(onScreen, ESCAPE_PRIORITY.panel);
      return null;
    }
    const { user } = renderWithKit(
      <>
        <Steps />
        <OwnDialog name="Edit" onClose={onDialog}>
          <TextField
            label="Message"
            value=""
            onChange={() => {}}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && event.shiftKey) event.preventDefault();
            }}
          />
        </OwnDialog>
      </>,
    );
    escape({ isComposing: true });
    expect(onScreen).not.toHaveBeenCalled();
    await user.click(button('Edit'));
    act(() => screen.getByRole('textbox', { name: 'Message' }).focus());
    escape({ shiftKey: true });
    escape({ shiftKey: true, isComposing: true });
    expect(onDialog).not.toHaveBeenCalled();
    escape();
    expect(onDialog).toHaveBeenCalledWith('escape');
  });

  // 'an unknown parent or opener layer is dropped': the DOM's way to make a
  // parent that is not in the stack is rule 19's test above (a layer opening
  // inside a dialog that is fading out); the scenario's other events are covered there.
});

function MenuToDialog({ withComposer = false }: { withComposer?: boolean }) {
  const composer = useRef<HTMLInputElement>(null);
  useScreenFocusTarget(composer);
  const [menu, setMenu] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      {withComposer && <TextField ref={composer} label="Message" value="" onChange={() => {}} />}
      <Button ref={setAnchor} onClick={() => setMenu(true)}>
        Options
      </Button>
      <Menu
        open={menu}
        anchor={anchor}
        onClose={() => setMenu(false)}
        label="Options"
        items={[{ id: 'del', label: 'Delete', onSelect: () => setDialog(true) }]}
      />
      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title="Delete it?"
        actions={<Button onClick={() => setDialog(false)}>Cancel</Button>}
      />
    </>
  );
}
