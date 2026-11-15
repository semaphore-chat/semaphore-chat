import { useEffect, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { screen, within } from '@testing-library/react';
import { AppFrame, Button, Dock, DockItem, TextField, ThreeIslands, type ThreeIslandsProps } from '../../../kit';
import { renderWithKit } from '../../test-utils/renderWithKit';
import { WIDTH, mockViewport } from './matchMedia';

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

function renderChat(props: Partial<ThreeIslandsProps> = {}) {
  return renderWithKit(
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
    </AppFrame>,
  );
}

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

  it('hides the other pane with hidden and inert, so it cannot take focus', () => {
    renderChat();
    const hiddenPane = document.querySelector('[inert]');
    expect(hiddenPane).not.toBeNull();
    expect(hiddenPane).toHaveAttribute('hidden');
    expect(hiddenPane?.querySelector('input')).not.toBeNull();
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

    viewport.setWidth(WIDTH.compact);
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('hello there');
    viewport.setWidth(WIDTH.phone);
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('hello there');
    viewport.setWidth(WIDTH.wide);
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('hello there');
    expect(mounts.centre).toBe(1);
  });

  it('keeps the state of the left slot while it is the hidden pane on a phone', async () => {
    const viewport = mockViewport(WIDTH.compact);
    const { user } = renderChat();
    await user.type(screen.getByRole('textbox', { name: 'Find a channel' }), 'gen');
    viewport.setWidth(WIDTH.phone);
    expect(screen.queryByRole('textbox', { name: 'Find a channel' })).toBeNull();
    viewport.setWidth(WIDTH.compact);
    expect(screen.getByRole('textbox', { name: 'Find a channel' })).toHaveValue('gen');
    expect(mounts.left).toBe(1);
  });

  it('keeps the state of the centre slot while it is the hidden pane on a phone', async () => {
    const viewport = mockViewport(WIDTH.phone);
    const view = renderChat({ phonePane: 'left' });
    viewport.setWidth(WIDTH.wide);
    await view.user.type(screen.getByRole('textbox', { name: 'Message' }), 'draft');
    viewport.setWidth(WIDTH.phone);
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();
    viewport.setWidth(WIDTH.compact);
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
    viewport.setWidth(WIDTH.wide);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(screen.getByRole('complementary', { name: 'Members' })).getByText('Member list')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('abc');
    expect(mounts.centre).toBe(1);
  });
});
