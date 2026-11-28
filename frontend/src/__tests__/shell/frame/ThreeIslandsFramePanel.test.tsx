/**
 * The frame's right region (PR 10e): a screen's panel takes the members' place; the members stay mounted under it,
 * hidden and inert; Escape at wide asks the screen to close the panel; `showRight` moves focus into the island.
 * The shell's own pieces are stand-ins (each has its own tests).
 */
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { KitProvider } from '../../../kit';
import { ThreeIslandsFrame } from '../../../shell/lounge/frame/ThreeIslandsFrame';
import { useScreenChrome, type LoungeScreenProps, type ThreeIslandsScreen } from '../../../shell/lounge/screen';
import { mockViewport, WIDTH } from '../../kit/layout/matchMedia';
import { renderWithProviders } from '../../test-utils';

const membersMounts = vi.hoisted(() => ({ count: 0 }));
vi.mock('../../../shell/lounge/pieces/MembersIsland', async () => {
  const ReactMod = await import('react');
  return {
    MembersIslandConnected: () => {
      ReactMod.useEffect(() => {
        membersMounts.count += 1;
      }, []);
      return <button type="button">a member</button>;
    },
  };
});
vi.mock('../../../shell/lounge/pieces/ShellDock', () => ({ ShellDockConnected: () => <div>dock</div> }));
vi.mock('../../../shell/lounge/pieces/AllCommunitiesSheet', () => ({ AllCommunitiesSheetConnected: () => null }));
vi.mock('../../../shell/lounge/pieces/community/CommunityLeft', () => ({ CommunityLeft: () => <p>channels</p> }));
vi.mock('../../../shell/lounge/pieces/community/UserCard', () => ({ UserCardConnected: () => null }));
vi.mock('../../../shell/lounge/pieces/call/ShellCall', () => ({ ShellCall: () => null }));
vi.mock('../../../shell/lounge/pieces/signOutConfirm', () => ({ SignOutConfirmHost: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../../data/callSlot', () => ({ useCallSlotShown: () => false }));
const marked = vi.hoisted(() => ({ count: 0 }));
vi.mock('../../../utils/markConversationRead', () => ({
  markConversationRead: async () => {
    marked.count += 1;
    return true;
  },
}));

const panelControl = vi.hoisted(() => ({ open: null as null | ((open: boolean) => void), closed: 0 }));
/** Stands for `useComposerDraft`: the thread's field keeps its text outside the component, as the real one does. */
const draftStore = vi.hoisted(() => ({ text: '' }));

function DraftField(): React.JSX.Element {
  const [text, setText] = React.useState(draftStore.text);
  return (
    <textarea
      aria-label="Reply in thread"
      value={text}
      onChange={(event) => {
        draftStore.text = event.target.value;
        setText(event.target.value);
      }}
    />
  );
}

/** A screen whose centre opens a filling panel with a draft field in it. */
function Centre(_props: LoungeScreenProps): React.JSX.Element {
  const { setPanel, panelTarget, showRight } = useScreenChrome();
  const [open, setOpen] = React.useState(false);
  panelControl.open = setOpen;
  useEffect(() => {
    setPanel(
      open
        ? {
            label: 'Thread',
            fill: true,
            onClose: () => {
              panelControl.closed += 1;
              setOpen(false);
            },
          }
        : null,
    );
  }, [open, setPanel]);
  return (
    <div>
      <h1>lobby</h1>
      <button type="button" onClick={showRight}>
        Show members
      </button>
      {open && panelTarget !== null && createPortal(<DraftField />, panelTarget)}
    </div>
  );
}

const SCREEN: ThreeIslandsScreen = {
  template: 'threeIslands',
  place: 'community',
  phonePane: 'centre',
  Centre,
  right: 'members',
  useTitle: () => 'lobby',
};

function setup() {
  return renderWithProviders(
    <KitProvider base="#8E75FF" mode="dark" intensity="minimal">
      <ThreeIslandsFrame screen={SCREEN} params={{ communityId: 'c-1', channelId: 'ch-1' }} resetKey="x" title="lobby" />
    </KitProvider>,
  );
}

describe('ThreeIslandsFrame: the right panel', () => {
  beforeEach(() => {
    membersMounts.count = 0;
    panelControl.closed = 0;
    draftStore.text = '';
  });

  it('at wide the panel takes the island; the members stay mounted but hidden and inert, and come back', async () => {
    mockViewport(WIDTH.wide);
    setup();
    expect(screen.getByRole('complementary', { name: 'Members' })).toBeInTheDocument();
    expect(membersMounts.count).toBe(1);
    act(() => panelControl.open!(true));
    const field = await screen.findByRole('textbox', { name: 'Reply in thread' });
    const island = screen.getByRole('complementary', { name: 'Thread' });
    expect(island).toContainElement(field);
    // Still mounted, but neither shown nor reachable.
    const member = screen.getByRole('button', { name: 'a member', hidden: true });
    const under = member.closest('[data-right-under]') as HTMLElement;
    expect(under).toHaveAttribute('hidden');
    expect(under).toHaveAttribute('inert');
    expect(screen.queryByRole('button', { name: 'a member' })).toBeNull();
    expect(membersMounts.count).toBe(1);
    act(() => panelControl.open!(false));
    expect(await screen.findByRole('button', { name: 'a member' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Members' })).toBeInTheDocument();
    expect(membersMounts.count).toBe(1);
  });

  it('Escape at wide asks the screen to close its panel', async () => {
    mockViewport(WIDTH.wide);
    setup();
    act(() => panelControl.open!(true));
    const field = await screen.findByRole('textbox', { name: 'Reply in thread' });
    field.blur();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(panelControl.closed).toBe(1));
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Thread' })).toBeNull());
  });

  it('below wide the panel is a filling Sheet named after it; its close request goes to the screen', async () => {
    mockViewport(WIDTH.compact);
    setup();
    expect(screen.queryByRole('complementary')).toBeNull();
    act(() => panelControl.open!(true));
    const sheet = await screen.findByRole('dialog', { name: 'Thread' });
    expect(sheet).toContainElement(await screen.findByRole('textbox', { name: 'Reply in thread' }));
    // A filling sheet draws no title row and no Close of its own: the content brings them.
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    fireEvent.keyDown(sheet, { key: 'Escape' });
    await waitFor(() => expect(panelControl.closed).toBe(1));
  });

  it('a width change from wide to compact moves the panel into the Sheet; the content remounts and the draft survives through the draft store', async () => {
    const viewport = mockViewport(WIDTH.wide);
    const { user } = setup();
    act(() => panelControl.open!(true));
    await screen.findByRole('complementary', { name: 'Thread' });
    await user.type(await screen.findByRole('textbox', { name: 'Reply in thread' }), 'half a reply');
    expect(screen.getByRole('textbox', { name: 'Reply in thread' })).toHaveValue('half a reply');
    await viewport.setWidth(WIDTH.compact);
    const field = await screen.findByRole('textbox', { name: 'Reply in thread' });
    expect(await screen.findByRole('dialog', { name: 'Thread' })).toContainElement(field);
    expect(field).toHaveValue('half a reply');
    expect(panelControl.closed).toBe(0);
  });

  it('when the panel clears below wide, the closing Sheet keeps its label until it has exited (no flash of the members)', async () => {
    mockViewport(WIDTH.compact);
    setup();
    act(() => panelControl.open!(true));
    await screen.findByRole('dialog', { name: 'Thread' });
    act(() => panelControl.open!(false));
    // Fading out: still the thread's Sheet, never the members' one.
    expect(screen.getByRole('dialog', { name: 'Thread' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Members' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'a member' })).toBeNull();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Opened again afterwards, the Sheet holds the members.
    fireEvent.click(screen.getByRole('button', { name: 'Show members' }));
    expect(await screen.findByRole('dialog', { name: 'Members' })).toBeInTheDocument();
  });

  it('showRight closes an open panel first, so the members show (the header’s "N around" at wide)', async () => {
    mockViewport(WIDTH.wide);
    setup();
    act(() => panelControl.open!(true));
    await screen.findByRole('complementary', { name: 'Thread' });
    fireEvent.click(screen.getByRole('button', { name: 'Show members' }));
    expect(panelControl.closed).toBe(1);
    expect(await screen.findByRole('complementary', { name: 'Members' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'a member' })).toBeInTheDocument();
  });

  it('showRight opens the members at wide and moves focus into the island', async () => {
    mockViewport(WIDTH.wide);
    setup();
    // The members start shown at wide; close them through Escape's panel step after opening by hand.
    fireEvent.click(screen.getByRole('button', { name: 'Show members' }));
    await waitFor(() => {
      const island = screen.getByRole('complementary', { name: 'Members' });
      expect(island.closest('[tabindex="-1"]')).toBe(document.activeElement);
    });
  });

  it('Escape at wide closes the panel first and marks nothing read; the next Escape marks the channel read', async () => {
    marked.count = 0;
    mockViewport(WIDTH.wide);
    setup();
    act(() => panelControl.open!(true));
    (await screen.findByRole('textbox', { name: 'Reply in thread' })).blur();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(panelControl.closed).toBe(1));
    expect(marked.count).toBe(0);
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Thread' })).toBeNull());
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(marked.count).toBe(1));
  });

  it.each(['compact', 'wide'] as const)('the desktop shortcuts are there at %s (Ctrl+/ opens the sheet)', async (range) => {
    mockViewport(WIDTH[range]);
    setup();
    fireEvent.keyDown(document.body, { key: '/', ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
  });

  it('a phone has no desktop shortcuts: no sheet, and Escape marks nothing read', async () => {
    marked.count = 0;
    mockViewport(WIDTH.phone);
    setup();
    fireEvent.keyDown(document.body, { key: '/', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await act(async () => undefined);
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull();
    expect(marked.count).toBe(0);
  });
});
