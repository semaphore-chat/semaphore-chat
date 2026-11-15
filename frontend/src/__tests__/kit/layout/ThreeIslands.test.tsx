import { useEffect, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { screen, within } from '@testing-library/react';
import { AppFrame, Button, Dock, DockItem, TextField, ThreeIslands, type ThreeIslandsProps } from '../../../kit';
import { renderWithKit } from '../../test-utils/renderWithKit';
import { WIDTH, mockViewport } from './matchMedia';
import { fakeVisualViewport } from './visualViewport';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

const mounts = { centre: 0, left: 0 };
beforeEach(() => {
  mounts.centre = 0;
  mounts.left = 0;
});

function Centre(): ReactNode {
  const [draft, setDraft] = useState('');
  useEffect(() => {
    mounts.centre += 1;
  }, []);
  return <TextField label="Message" value={draft} onChange={setDraft} />;
}

function Left(): ReactNode {
  const [query, setQuery] = useState('');
  useEffect(() => {
    mounts.left += 1;
  }, []);
  return <TextField label="Find a channel" value={query} onChange={setQuery} />;
}

const dock = (
  <Dock label="Communities">
    <DockItem name="Couch Co-op" current />
  </Dock>
);

const chat = (props: Partial<ThreeIslandsProps> = {}) => (
  <AppFrame>
    <ThreeIslands
      dock={dock}
      left={<Left />}
      leftLabel="Channels"
      centre={<Centre />}
      centreLabel="general"
      right={<p>Member list</p>}
      rightLabel="Members"
      {...props}
    />
  </AppFrame>
);

const renderChat = (props: Partial<ThreeIslandsProps> = {}) => renderWithKit(chat(props));

/** The names of the navigation, main and complementary landmarks, in document order. */
const landmarkOrder = () =>
  ['navigation', 'main', 'complementary']
    .flatMap((role) => screen.queryAllByRole(role))
    .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
    .map((element) => element.getAttribute('aria-label'));

describe('ThreeIslands at wide', () => {
  beforeEach(() => {
    mockViewport(WIDTH.wide);
  });

  it('has the left, centre and right landmarks, named, in reading order after the dock', () => {
    renderChat();
    expect(screen.getByRole('navigation', { name: 'Channels' })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'general' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Members' })).toBeInTheDocument();
    expect(landmarkOrder()).toEqual(['Communities', 'Channels', 'general', 'Members']);
  });

  it('has exactly one main', () => {
    renderChat();
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('shows the right content in its island, not in a dialog', () => {
    renderChat();
    expect(within(screen.getByRole('complementary', { name: 'Members' })).getByText('Member list')).toBeVisible();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('leaves no complementary region without a right slot', () => {
    renderChat({ right: undefined, rightLabel: undefined });
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('leaves no dock landmark without a dock', () => {
    renderChat({ dock: undefined });
    expect(landmarkOrder()).toEqual(['Channels', 'general', 'Members']);
  });

  it('names the right island when it has no label', () => {
    renderChat({ rightLabel: undefined });
    expect(screen.getByRole('complementary', { name: 'Details' })).toBeInTheDocument();
  });
});

describe('ThreeIslands at compact', () => {
  beforeEach(() => {
    mockViewport(WIDTH.compact);
  });

  it('shows the left and centre islands and the dock, and keeps the right out until opened', () => {
    renderChat();
    expect(landmarkOrder()).toEqual(['Communities', 'Channels', 'general']);
    expect(screen.queryByText('Member list')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the right content in a dialog named by rightLabel when rightOpen', () => {
    renderChat({ rightOpen: true });
    const dialog = screen.getByRole('dialog', { name: 'Members' });
    expect(within(dialog).getByText('Member list')).toBeInTheDocument();
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('Escape calls onRightClose', async () => {
    const onRightClose = vi.fn();
    const { user } = renderChat({ rightOpen: true, onRightClose });
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    expect(onRightClose).toHaveBeenCalledTimes(1);
  });

  it('Close in the dialog calls onRightClose', async () => {
    const onRightClose = vi.fn();
    const { user } = renderChat({ rightOpen: true, onRightClose });
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    expect(onRightClose).toHaveBeenCalledTimes(1);
  });

  it('has no dialog without a right slot, even when rightOpen', () => {
    renderChat({ right: undefined, rightOpen: true });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('ThreeIslands at phone', () => {
  beforeEach(() => {
    mockViewport(WIDTH.phone);
  });

  it('shows the centre pane and the dock, after it, and hides the left pane from the tree', () => {
    renderChat();
    expect(landmarkOrder()).toEqual(['general', 'Communities']);
    expect(screen.queryByRole('navigation', { name: 'Channels' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Find a channel' })).toBeNull();
    expect(document.querySelectorAll('[inert]')).toHaveLength(1);
  });

  it('with phonePane left shows the place list, still under exactly one main', () => {
    renderChat({ phonePane: 'left' });
    expect(screen.getByRole('navigation', { name: 'Channels' })).toBeInTheDocument();
    expect(screen.queryByRole('main', { name: 'general' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(within(screen.getByRole('main')).getByRole('navigation', { name: 'Channels' })).toBeInTheDocument();
  });

  // jsdom ignores `inert` for focus and for the accessibility tree, so each mechanism is pinned by its own
  // assertion: the attribute (fails if `inert` is removed), `hidden`, and the role queries finding nothing.
  it('hides the other pane with both hidden and inert, and the role queries find nothing in it', () => {
    renderChat();
    const hiddenPanes = document.querySelectorAll('[inert]');
    expect(hiddenPanes).toHaveLength(1);
    expect(hiddenPanes[0]).toHaveAttribute('inert');
    expect(hiddenPanes[0]).toHaveAttribute('hidden');
    expect(hiddenPanes[0].querySelector('input')).not.toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Find a channel' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Channels' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Message' }).closest('[inert]')).toBeNull();
  });

  it('shows the right content in a dialog when rightOpen', () => {
    renderChat({ rightOpen: true });
    expect(within(screen.getByRole('dialog', { name: 'Members' })).getByText('Member list')).toBeInTheDocument();
  });

  it('puts only one dock in the tree', () => {
    renderChat();
    expect(screen.getAllByRole('navigation', { name: 'Communities' })).toHaveLength(1);
  });
});

describe('ThreeIslands across width changes', () => {
  it('keeps a typed draft in the centre slot, with no remount, from wide to compact to phone and back', async () => {
    const viewport = mockViewport(WIDTH.wide);
    const { user } = renderChat();
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'hello there');
    expect(mounts.centre).toBe(1);

    await viewport.setWidth(WIDTH.compact);
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('hello there');
    await viewport.setWidth(WIDTH.phone);
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('hello there');
    await viewport.setWidth(WIDTH.wide);
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('hello there');
    expect(mounts.centre).toBe(1);
  });

  it('keeps the state of the left slot while it is the hidden pane on a phone', async () => {
    const viewport = mockViewport(WIDTH.compact);
    const { user } = renderChat();
    await user.type(screen.getByRole('textbox', { name: 'Find a channel' }), 'gen');
    await viewport.setWidth(WIDTH.phone);
    expect(screen.queryByRole('textbox', { name: 'Find a channel' })).toBeNull();
    await viewport.setWidth(WIDTH.compact);
    expect(screen.getByRole('textbox', { name: 'Find a channel' })).toHaveValue('gen');
    expect(mounts.left).toBe(1);
  });

  it('keeps the state of the centre slot while it is the hidden pane on a phone', async () => {
    const viewport = mockViewport(WIDTH.phone);
    const view = renderChat({ phonePane: 'left' });
    await viewport.setWidth(WIDTH.wide);
    await view.user.type(screen.getByRole('textbox', { name: 'Message' }), 'draft');
    await viewport.setWidth(WIDTH.phone);
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();
    await viewport.setWidth(WIDTH.compact);
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('draft');
    expect(mounts.centre).toBe(1);
  });

  it('keeps the draft when the right island opens as a dialog and the width then grows', async () => {
    const viewport = mockViewport(WIDTH.compact);
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <AppFrame>
          <ThreeIslands
            left={<Button onClick={() => setOpen(true)}>Show members</Button>}
            leftLabel="Channels"
            centre={<Centre />}
            centreLabel="general"
            right={<p>Member list</p>}
            rightLabel="Members"
            rightOpen={open}
            onRightClose={() => setOpen(false)}
          />
        </AppFrame>
      );
    }
    const { user } = renderWithKit(<Harness />);
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'abc');
    await user.click(screen.getByRole('button', { name: 'Show members' }));
    expect(screen.getByRole('dialog', { name: 'Members' })).toBeInTheDocument();
    await viewport.setWidth(WIDTH.wide);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(screen.getByRole('complementary', { name: 'Members' })).getByText('Member list')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('abc');
    expect(mounts.centre).toBe(1);
  });
});

describe('ThreeIslands: rightOpen means the right content is showing, at every width', () => {
  it('shows the island at wide by default', () => {
    mockViewport(WIDTH.wide);
    renderChat();
    expect(screen.getByRole('complementary', { name: 'Members' })).toBeInTheDocument();
  });

  it('shows no island at wide when rightOpen is false, and leaves two columns and no landmark', () => {
    mockViewport(WIDTH.wide);
    renderChat({ rightOpen: false });
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.queryByText('Member list')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(landmarkOrder()).toEqual(['Communities', 'Channels', 'general']);
  });

  it('shows the island at wide when rightOpen is true, not a dialog', () => {
    mockViewport(WIDTH.wide);
    renderChat({ rightOpen: true });
    expect(screen.getByRole('complementary', { name: 'Members' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is closed below wide by default, and narrowing from the default island opens no modal', async () => {
    const viewport = mockViewport(WIDTH.wide);
    renderChat();
    await viewport.setWidth(WIDTH.compact);
    expect(screen.queryByRole('dialog')).toBeNull();
    await viewport.setWidth(WIDTH.phone);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps what the user asked for across a resize: closed stays closed, open stays showing', async () => {
    const viewport = mockViewport(WIDTH.wide);
    const view = renderChat({ rightOpen: false });
    await viewport.setWidth(WIDTH.compact);
    await viewport.setWidth(WIDTH.wide);
    expect(screen.queryByRole('complementary')).toBeNull();
    view.rerender(chat({ rightOpen: true }));
    expect(screen.getByRole('complementary')).toBeInTheDocument();
    await viewport.setWidth(WIDTH.compact);
    expect(screen.getByRole('dialog', { name: 'Members' })).toBeInTheDocument();
  });

  it('does not call onRightClose by itself when the width changes', async () => {
    const onRightClose = vi.fn();
    const viewport = mockViewport(WIDTH.wide);
    renderChat({ rightOpen: true, onRightClose });
    await viewport.setWidth(WIDTH.compact);
    await viewport.setWidth(WIDTH.wide);
    expect(onRightClose).not.toHaveBeenCalled();
  });
});

describe('ThreeIslands: slots that are not there', () => {
  beforeEach(() => {
    mockViewport(WIDTH.wide);
  });

  it.each([null, false, ''])('right=%j leaves no landmark, column or dialog', (right) => {
    renderChat({ right });
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each([null, false])('dock=%j leaves no dock landmark', (value) => {
    renderChat({ dock: value });
    expect(landmarkOrder()).toEqual(['Channels', 'general', 'Members']);
  });

  it.each([null, false])('callBar=%j leaves no element', (callBar) => {
    renderChat({ callBar });
    expect(document.querySelector('[data-slot="call-bar"]')).toBeNull();
  });

  it('right=false below wide opens no empty dialog even when rightOpen', () => {
    mockViewport(WIDTH.compact);
    renderChat({ right: false, rightOpen: true });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('ThreeIslands: callBar', () => {
  const bar = <p>In Squad Up</p>;
  const callBar = () => screen.getByText('In Squad Up').closest('[data-slot="call-bar"]') as HTMLElement;
  const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  it('sits under the left island and before the centre at wide and compact', () => {
    for (const width of [WIDTH.wide, WIDTH.compact]) {
      mockViewport(width);
      const { unmount } = renderChat({ callBar: bar });
      expect(before(screen.getByRole('navigation', { name: 'Channels' }), callBar())).toBe(true);
      expect(before(callBar(), screen.getByRole('main'))).toBe(true);
      unmount();
    }
  });

  it('sits between the shown pane and the dock bar on a phone, whichever pane shows', () => {
    mockViewport(WIDTH.phone);
    const view = renderChat({ callBar: bar });
    expect(before(screen.getByRole('main'), callBar())).toBe(true);
    expect(before(callBar(), screen.getByRole('navigation', { name: 'Communities' }))).toBe(true);
    view.rerender(chat({ callBar: bar, phonePane: 'left' }));
    expect(before(screen.getByRole('navigation', { name: 'Channels' }), callBar())).toBe(true);
    expect(callBar()).toBeVisible();
  });

  it('is in the tree once at every width', async () => {
    const viewport = mockViewport(WIDTH.wide);
    renderChat({ callBar: bar });
    for (const width of [WIDTH.compact, WIDTH.phone, WIDTH.wide]) {
      await viewport.setWidth(width);
      expect(screen.getAllByText('In Squad Up')).toHaveLength(1);
    }
  });
});

describe('ThreeIslands: the on-screen keyboard on a phone', () => {
  it('takes the dock bar out while the keyboard is up, and brings it back', () => {
    mockViewport(WIDTH.phone);
    const viewport = fakeVisualViewport(800);
    renderChat();
    expect(screen.getByRole('navigation', { name: 'Communities' })).toBeInTheDocument();
    viewport.cover(300);
    expect(screen.queryByRole('navigation', { name: 'Communities' })).toBeNull();
    viewport.cover(0);
    expect(screen.getByRole('navigation', { name: 'Communities' })).toBeInTheDocument();
  });

  it('keeps the call bar while the keyboard is up', () => {
    mockViewport(WIDTH.phone);
    const viewport = fakeVisualViewport(800);
    renderChat({ callBar: <p>In Squad Up</p> });
    viewport.cover(300);
    expect(screen.getByText('In Squad Up')).toBeInTheDocument();
  });

  it('leaves the dock alone below the phone range', () => {
    mockViewport(WIDTH.compact);
    const viewport = fakeVisualViewport(800);
    renderChat();
    viewport.cover(300);
    expect(screen.getByRole('navigation', { name: 'Communities' })).toBeInTheDocument();
  });
});

describe('ThreeIslands: focus follows the shown pane', () => {
  const centrePane = () => screen.getByRole('main', { name: 'general' }).parentElement as HTMLElement;

  it('moves into the centre when the phone pane changes from left to centre', async () => {
    mockViewport(WIDTH.phone);
    const view = renderChat({ phonePane: 'left' });
    await view.user.click(screen.getByRole('textbox', { name: 'Find a channel' }));
    expect(screen.getByRole('textbox', { name: 'Find a channel' })).toHaveFocus();
    view.rerender(chat({ phonePane: 'centre' }));
    expect(centrePane()).toHaveFocus();
  });

  it('moves into the left pane when the phone pane changes from centre to left', async () => {
    mockViewport(WIDTH.phone);
    const view = renderChat();
    await view.user.click(screen.getByRole('textbox', { name: 'Message' }));
    view.rerender(chat({ phonePane: 'left' }));
    expect(screen.getByRole('navigation', { name: 'Channels' }).parentElement).toHaveFocus();
  });

  it('moves into the shown pane when the width crosses into the phone range with focus in the other', async () => {
    const viewport = mockViewport(WIDTH.compact);
    const view = renderChat();
    await view.user.click(screen.getByRole('textbox', { name: 'Find a channel' }));
    await viewport.setWidth(WIDTH.phone);
    expect(centrePane()).toHaveFocus();
  });

  it('moves into the centre when the right island goes away with focus inside it', async () => {
    const viewport = mockViewport(WIDTH.wide);
    const view = renderChat({ right: <input aria-label="Reply" /> });
    await view.user.click(screen.getByRole('textbox', { name: 'Reply' }));
    await viewport.setWidth(WIDTH.compact);
    expect(centrePane()).toHaveFocus();
  });

  it('does not take focus when it was elsewhere', async () => {
    mockViewport(WIDTH.phone);
    const view = renderChat({ phonePane: 'left' });
    view.rerender(chat({ phonePane: 'centre' }));
    expect(centrePane()).not.toHaveFocus();
  });

  it('leaves focus where it is when the pane it is in stays shown', async () => {
    const viewport = mockViewport(WIDTH.wide);
    const view = renderChat();
    await view.user.click(screen.getByRole('textbox', { name: 'Message' }));
    await viewport.setWidth(WIDTH.compact);
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus();
  });
});
