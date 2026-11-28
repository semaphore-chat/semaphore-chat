/**
 * The frame's `settings` and `stage` templates (#848 C4, S1): the shell's pieces around a settings screen (the dock,
 * the user's card, the call bar at the nav island's foot, the footer slot, a phone's Back) and around a room (the
 * stage in the three islands' centre at compact and wide, the full stage on a phone without the dock bar, and
 * without the call bar while the room is the call you are in). The pieces are stand-ins with mount counters (each
 * has its own tests).
 */
import React, { useEffect, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { KitProvider, StageLayout } from '../../../kit';
import { ThreeIslandsFrame } from '../../../shell/lounge/frame/ThreeIslandsFrame';
import { SettingsFrame } from '../../../shell/lounge/frame/SettingsFrame';
import {
  useSettingsChrome,
  type LoungeScreenProps,
  type SettingsScreen,
  type StageScreen,
  type ThreeIslandsScreen,
} from '../../../shell/lounge/screen';
import { mockViewport, WIDTH } from '../../kit/layout/matchMedia';
import { renderWithProviders } from '../../test-utils';

const mounts = vi.hoisted(() => ({ dock: 0, left: 0, call: 0, members: 0 }));
const call = vi.hoisted(() => ({ shown: true }));

vi.mock('../../../shell/lounge/pieces/ShellDock', async () => {
  const { useEffect: useMountEffect } = await import('react');
  return {
    ShellDockConnected: ({ current }: { current: { kind: string; id?: string } | null }) => {
      useMountEffect(() => {
        mounts.dock += 1;
      }, []);
      return <div data-testid="dock">{current === null ? 'dock, nothing current' : `dock, ${current.kind} ${current.id ?? ''}`}</div>;
    },
  };
});
vi.mock('../../../shell/lounge/pieces/community/CommunityLeft', async () => {
  const { useEffect: useMountEffect } = await import('react');
  return {
    CommunityLeft: () => {
      useMountEffect(() => {
        mounts.left += 1;
      }, []);
      return <p>channels and rooms</p>;
    },
  };
});
vi.mock('../../../shell/lounge/pieces/MembersIsland', async () => {
  const { useEffect: useMountEffect } = await import('react');
  return {
    MembersIslandConnected: () => {
      useMountEffect(() => {
        mounts.members += 1;
      }, []);
      return <p>the members</p>;
    },
  };
});
vi.mock('../../../shell/lounge/pieces/call/ShellCall', async () => {
  const { useEffect: useMountEffect } = await import('react');
  return {
    ShellCall: () => {
      useMountEffect(() => {
        mounts.call += 1;
      }, []);
      return <button type="button">Deafen</button>;
    },
  };
});
vi.mock('../../../shell/lounge/pieces/community/UserCard', () => ({ UserCardConnected: () => <p>your card</p> }));
vi.mock('../../../shell/lounge/pieces/AllCommunitiesSheet', () => ({ AllCommunitiesSheetConnected: () => null }));
vi.mock('../../../shell/lounge/pieces/signOutConfirm', () => ({
  SignOutConfirmHost: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../shell/lounge/frame/LoungeShortcuts', () => ({ LoungeShortcuts: () => null }));
vi.mock('../../../data/callSlot', () => ({ useCallSlotShown: () => call.shown }));

function Where(): React.JSX.Element {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

const wrap = (node: React.ReactNode) => (
  <KitProvider base="#8E75FF" mode="dark" intensity="minimal">
    {node}
    <Where />
  </KitProvider>
);

beforeEach(() => {
  mounts.dock = 0;
  mounts.left = 0;
  mounts.call = 0;
  mounts.members = 0;
  call.shown = true;
});

// --- settings -------------------------------------------------------------------

/** Footer control from outside the section. */
const footerControl = vi.hoisted(() => ({ set: null as null | ((dirty: boolean) => void) }));

function Section({ params }: LoungeScreenProps): React.JSX.Element {
  const { setFooter } = useSettingsChrome();
  const [dirty, setDirty] = useState(false);
  footerControl.set = setDirty;
  useEffect(() => setFooter(dirty ? <span>1 unsaved change</span> : null), [dirty, setFooter]);
  useEffect(() => () => setFooter(null), [setFooter]);
  return <h2>{`Section ${params.section ?? 'none'}`}</h2>;
}

const settingsScreen = (phonePane: 'nav' | 'content', place: 'none' | 'community' = 'none'): SettingsScreen => ({
  template: 'settings',
  place,
  phonePane,
  Nav: () => <a href="#/fx/settings/roles">Roles</a>,
  Content: Section,
  phoneBackTo: () => '/fx/settings',
  useTitle: () => 'Settings',
});

function renderSettings(screenDescriptor: SettingsScreen, params = { section: 'roles' }) {
  return renderWithProviders(
    wrap(<SettingsFrame screen={screenDescriptor} params={params} resetKey="/fx/settings/roles" title="Settings" />),
    { routerProps: { initialEntries: ['/fx/settings/roles'] } },
  );
}

describe('SettingsFrame', () => {
  it.each([
    ['wide', WIDTH.wide],
    ['compact', WIDTH.compact],
  ])('at %s: the dock above the nav, the user card at its foot, the section in the main, the call bar in the left column', (_name, width) => {
    mockViewport(width);
    renderSettings(settingsScreen('content'));
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(nav).toHaveTextContent('Settings');
    expect(nav).toHaveTextContent('your card');
    expect(screen.getByRole('main', { name: 'Settings' })).toHaveTextContent('Section roles');
    expect(screen.getByTestId('dock')).toHaveTextContent('dock, nothing current');
    const bar = screen.getByRole('button', { name: 'Deafen' });
    expect(bar.closest('[data-slot="call-bar"]')).not.toBeNull();
    // The call bar sits in the left column, under the nav island: after it, before the content.
    expect(nav.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bar.compareDocumentPosition(screen.getByRole('main')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("a community's settings name their community in the dock", () => {
    mockViewport(WIDTH.wide);
    renderSettings(settingsScreen('content', 'community'), { section: 'roles', communityId: 'c-1' } as never);
    expect(screen.getByTestId('dock')).toHaveTextContent('dock, community c-1');
  });

  it('out of a call there is no call bar', () => {
    mockViewport(WIDTH.wide);
    call.shown = false;
    renderSettings(settingsScreen('content'));
    expect(screen.queryByRole('button', { name: 'Deafen' })).toBeNull();
    expect(document.querySelector('[data-slot="call-bar"]')).toBeNull();
  });

  it('on a phone: no dock bar and no card, but the call bar stays; the section has Back to the list', async () => {
    mockViewport(WIDTH.phone);
    const { user } = renderSettings(settingsScreen('content'));
    expect(screen.queryByTestId('dock')).toBeNull();
    expect(screen.queryByText('your card')).toBeNull();
    expect(screen.getByRole('button', { name: 'Deafen' })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Settings' })).toHaveTextContent('Section roles');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/fx/settings');
  });

  it('on a phone the list path shows the list as the main, with the call bar', () => {
    mockViewport(WIDTH.phone);
    renderSettings(settingsScreen('nav'));
    expect(screen.getByRole('main')).toHaveTextContent('Roles');
    expect(screen.getByRole('button', { name: 'Deafen' })).toBeInTheDocument();
  });

  it('a section pins its bar to the content island and takes it away', () => {
    mockViewport(WIDTH.wide);
    renderSettings(settingsScreen('content'));
    expect(document.querySelector('[data-slot="footer"]')).toBeNull();
    act(() => footerControl.set!(true));
    const footer = document.querySelector('[data-slot="footer"]');
    expect(footer).toHaveTextContent('1 unsaved change');
    expect(screen.getByRole('main')).toContainElement(footer as HTMLElement);
    act(() => footerControl.set!(false));
    expect(document.querySelector('[data-slot="footer"]')).toBeNull();
  });
});

// --- stage ------------------------------------------------------------------------

const shows = vi.hoisted(() => ({ value: true }));

function Room(): React.JSX.Element {
  return (
    <StageLayout
      inIsland
      stageLabel="Squad Up"
      header={<h1>Squad Up</h1>}
      stage={<p>the shares</p>}
      controls={<button type="button">Leave</button>}
    />
  );
}

const stageScreen: StageScreen = {
  template: 'stage',
  place: 'community',
  Stage: Room,
  useShowsCall: () => shows.value,
  useTitle: () => 'Squad Up',
};

const chatScreen: ThreeIslandsScreen = {
  template: 'threeIslands',
  place: 'community',
  phonePane: 'centre',
  Centre: () => <h1>general</h1>,
  right: 'members',
  useTitle: () => 'general',
};

const frame = (screenDescriptor: ThreeIslandsScreen | StageScreen, showsCall: boolean, channelId = 'vc-1') => (
  <ThreeIslandsFrame
    screen={screenDescriptor}
    params={{ communityId: 'c-1', channelId }}
    resetKey={`/c/${channelId}`}
    title={screenDescriptor.template === 'stage' ? 'Squad Up' : 'general'}
    showsCall={showsCall}
  />
);

describe('ThreeIslandsFrame: the stage template', () => {
  beforeEach(() => {
    shows.value = true;
  });

  it.each([
    ['wide', WIDTH.wide],
    ['compact', WIDTH.compact],
  ])('at %s the room is the centre beside the community, with the dock and the call bar, and no members', (_name, width) => {
    mockViewport(width);
    renderWithProviders(wrap(frame(stageScreen, true)));
    const main = screen.getByRole('main', { name: 'Squad Up' });
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(main).toHaveTextContent('the shares');
    expect(main).toContainElement(screen.getByRole('button', { name: 'Leave' }));
    expect(screen.getByRole('navigation', { name: 'Community' })).toHaveTextContent('channels and rooms');
    expect(screen.getByTestId('dock')).toBeInTheDocument();
    // Beside the room the call bar stays, also while the room is the call you are in.
    expect(screen.getByRole('button', { name: 'Deafen' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.queryByText('the members')).toBeNull();
  });

  it('at wide, a channel and a room share the frame: the dock, the left island and the call bar stay mounted', () => {
    mockViewport(WIDTH.wide);
    const { rerender } = renderWithProviders(wrap(frame(chatScreen, false, 'ch-1')));
    expect(screen.getByRole('heading', { name: 'general' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Community' });
    rerender(wrap(frame(stageScreen, true)));
    expect(screen.getByRole('heading', { name: 'Squad Up' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Community' })).toBe(nav);
    rerender(wrap(frame(chatScreen, false, 'ch-1')));
    expect(screen.getByRole('heading', { name: 'general' })).toBeInTheDocument();
    expect(mounts).toMatchObject({ dock: 1, left: 1, call: 1 });
  });

  it('on a phone it is the full stage: no dock bar, and no call bar while it is the call you are in', () => {
    mockViewport(WIDTH.phone);
    renderWithProviders(wrap(frame(stageScreen, true)));
    expect(screen.getByRole('main', { name: 'Squad Up' })).toHaveTextContent('the shares');
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.queryByTestId('dock')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Deafen' })).toBeNull();
    // The room's own controls are the call's.
    expect(screen.getByRole('button', { name: 'Leave' })).toBeInTheDocument();
  });

  it('on a phone, a room that is not your call keeps the call bar (your call is elsewhere)', () => {
    mockViewport(WIDTH.phone);
    renderWithProviders(wrap(frame(stageScreen, false)));
    expect(screen.queryByTestId('dock')).toBeNull();
    expect(screen.getByRole('button', { name: 'Deafen' })).toBeInTheDocument();
  });

  it('on a phone a chat keeps its dock bar and call bar (the stage rule is the stage only)', () => {
    mockViewport(WIDTH.phone);
    renderWithProviders(wrap(frame(chatScreen, true, 'ch-1')));
    expect(screen.getByTestId('dock')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deafen' })).toBeInTheDocument();
  });
});
