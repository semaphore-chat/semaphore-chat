/**
 * The new shell's dock (view): every state's items and accessible names, the links, one Tab stop, the
 * keys, and the callbacks. The connected dock (server list, unread query, live updates) is in
 * ShellDockConnected.test.tsx; the badge rule against the classic sidebar in dockBadgesMatchClassic.test.tsx.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithKit } from '../../test-utils/renderWithKit';
import { ShellDock, type ShellDockProps } from '../../../shell/lounge/pieces/ShellDock';
import { LOUNGE_ROW_ATTRIBUTE } from '../../../shell/lounge/frame/routeMemory';
import { LoungeLinksContext } from '../../../shell/lounge/links';
import { LONG_NAME, MOCKUP_STATES, sampleCommunities } from '../../../stories/fixtures/loungeCommunities';

const noop = () => undefined;
let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

function renderDock(props: Partial<ShellDockProps> = {}) {
  const all: ShellDockProps = {
    communities: sampleCommunities(5, MOCKUP_STATES),
    current: { kind: 'community', id: 'c-1' },
    inboxCount: 9,
    status: 'ready',
    onOpenInbox: noop,
    onOpenAll: noop,
    bottomBar: false,
    ...props,
  };
  const result = renderWithKit(<ShellDock {...all} />);
  const nav = screen.getByRole('navigation', { name: 'Communities' });
  return { ...result, nav };
}

/** The bar's items in order, by accessible name. */
function itemNames(nav: HTMLElement): string[] {
  return [...nav.querySelectorAll<HTMLElement>('a, button')].map((element) => element.getAttribute('aria-label') ?? '');
}

describe('ShellDock (the view)', () => {
  it("links each community to its route, or where the frame's links context says (a test fixture)", () => {
    const { nav, unmount } = renderDock();
    expect(within(nav).getByRole('link', { name: /^Trailheads/ })).toHaveAttribute('href', '#/community/c-2');
    unmount();
    renderWithKit(
      <LoungeLinksContext value={{ community: (id) => `#/__lounge/community/${id}` }}>
        <ShellDock
          communities={sampleCommunities(5, MOCKUP_STATES)}
          current={{ kind: 'community', id: 'c-1' }}
          inboxCount={0}
          status="ready"
          onOpenInbox={noop}
          onOpenAll={noop}
          bottomBar={false}
        />
      </LoungeLinksContext>,
    );
    const fixtureNav = screen.getByRole('navigation', { name: 'Communities' });
    expect(within(fixtureNav).getByRole('link', { name: /^Trailheads/ })).toHaveAttribute('href', '#/__lounge/community/c-2');
  });

  it('names every item by what it shows: Inbox with its count, communities with current, mentions or new messages, then All', () => {
    const { nav } = renderDock();
    expect(itemNames(nav)).toEqual([
      'Inbox, 9 unread',
      'Couch Co-op, current',
      'Trailheads',
      'Lumen Studio, 2 mentions',
      'Friday LAN, new messages',
      // Mentions and new messages: the count wins (the dot would say the same thing twice)
      'Wavelength, 3 mentions',
      'All communities',
    ]);
  });

  it('draws the mention count and the new-messages dot', () => {
    const { nav } = renderDock();
    expect(within(screen.getByRole('link', { name: 'Lumen Studio, 2 mentions' })).getByText('2')).toBeInTheDocument();
    const friday = screen.getByRole('link', { name: 'Friday LAN, new messages' });
    expect(friday.querySelector('[data-kit-new-messages]')).not.toBeNull();
    const wavelength = screen.getByRole('link', { name: 'Wavelength, 3 mentions' });
    expect(wavelength.querySelector('[data-kit-new-messages]')).toBeNull();
    expect(nav.querySelectorAll('[data-kit-new-messages]')).toHaveLength(1);
  });

  it('makes each community a real link to its route, and marks the current one as the page', () => {
    renderDock();
    const lumen = screen.getByRole('link', { name: 'Lumen Studio, 2 mentions' });
    expect(lumen).toHaveAttribute('href', '#/community/c-3');
    expect(screen.getByRole('link', { name: 'Couch Co-op, current' })).toHaveAttribute('aria-current', 'page');
    expect(lumen).not.toHaveAttribute('aria-current');
    // The remembered-row mark RouteFocus finds after Back from the old shell
    expect(lumen).toHaveAttribute(LOUNGE_ROW_ATTRIBUTE, 'dock:c-3');
  });

  it('is one Tab stop, on the current community', () => {
    const { nav } = renderDock();
    const stops = [...nav.querySelectorAll('a, button')].filter((element) => element.getAttribute('tabindex') !== '-1');
    expect(stops).toEqual([screen.getByRole('link', { name: 'Couch Co-op, current' })]);
    expect(nav.querySelector('[data-kit-dock-scroll]')).toHaveAttribute('tabindex', '-1');
  });

  it('moves with Left, Right, Home, End and typing a name', async () => {
    const { user } = renderDock();
    await user.tab();
    expect(screen.getByRole('link', { name: 'Couch Co-op, current' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('link', { name: 'Trailheads' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('button', { name: 'Inbox, 9 unread' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('button', { name: 'All communities' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('button', { name: 'Inbox, 9 unread' })).toHaveFocus();
    await user.keyboard('fr');
    expect(screen.getByRole('link', { name: 'Friday LAN, new messages' })).toHaveFocus();
  });

  it('with the inbox current: the Inbox says so, is the page and the Tab stop; no community is current', () => {
    const { nav } = renderDock({ current: { kind: 'inbox' }, inboxCount: 4 });
    const inbox = screen.getByRole('button', { name: 'Inbox, current, 4 unread' });
    expect(inbox).toHaveAttribute('tabindex', '0');
    expect(inbox).toHaveAttribute('aria-current', 'page');
    expect(nav.querySelectorAll('[aria-current]')).toHaveLength(1);
  });

  it('draws the inbox count, and keeps Inbox and All outside the scrolling region', () => {
    const { nav } = renderDock();
    const inbox = screen.getByRole('button', { name: 'Inbox, 9 unread' });
    expect(inbox).toHaveTextContent('9');
    const region = nav.querySelector('[data-kit-dock-scroll]')!;
    expect(region).not.toContainElement(inbox);
    expect(region).not.toContainElement(screen.getByRole('button', { name: 'All communities' }));
    expect(region.querySelectorAll('a')).toHaveLength(5);
  });

  it('All opens the sheet and says whether it is open; Inbox opens the inbox', async () => {
    const onOpenAll = vi.fn();
    const onOpenInbox = vi.fn();
    const onActivate = vi.fn();
    const { user, rerender } = renderDock({ onOpenAll, onOpenInbox, onActivate });
    const all = screen.getByRole('button', { name: 'All communities' });
    expect(all).toHaveAttribute('aria-expanded', 'false');
    expect(all).toHaveAttribute('aria-haspopup', 'dialog');
    await user.click(all);
    expect(onOpenAll).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Inbox, 9 unread' }));
    expect(onOpenInbox).toHaveBeenCalledTimes(1);
    expect(onActivate.mock.calls.map(([id]) => id)).toEqual(['all', 'inbox']);
    rerender(
      <ShellDock
        communities={[]}
        current={null}
        inboxCount={0}
        status="ready"
        onOpenInbox={noop}
        onOpenAll={noop}
        allOpen
        bottomBar={false}
      />,
    );
    expect(screen.getByRole('button', { name: 'All communities' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('a community chosen with the keyboard or a click is reported with its id', async () => {
    const onActivate = vi.fn();
    const { user } = renderDock({ onActivate });
    // jsdom does not follow hash links; the click and Enter still reach the list
    await user.click(screen.getByRole('link', { name: 'Trailheads' }));
    expect(onActivate).toHaveBeenLastCalledWith('c-2');
  });

  it('loading: Inbox, three placeholder circles, All', () => {
    const { nav } = renderDock({ status: 'loading', communities: [] });
    expect(itemNames(nav)).toEqual(['Inbox, 9 unread', 'All communities']);
    // The scrolling region holds only the three circles (the dividers sit with Inbox and All)
    const placeholders = nav.querySelectorAll('[data-kit-dock-scroll] > [aria-hidden="true"]');
    expect(placeholders).toHaveLength(3);
  });

  it('error, and no communities: only Inbox and All (the sheet offers Create)', () => {
    const { nav, unmount } = renderDock({ status: 'error', communities: sampleCommunities(3) });
    expect(itemNames(nav)).toEqual(['Inbox, 9 unread', 'All communities']);
    unmount();
    const none = renderDock({ communities: [], current: null, inboxCount: 0 });
    expect(itemNames(none.nav)).toEqual(['Inbox', 'All communities']);
  });

  it('one, twelve and sixty communities: all on the bar, still one Tab stop', () => {
    for (const count of [1, 12, 60]) {
      const { nav, unmount } = renderDock({ communities: sampleCommunities(count), current: { kind: 'community', id: `c-${count}` } });
      expect(nav.querySelectorAll('a')).toHaveLength(count);
      expect([...nav.querySelectorAll('a, button')].filter((element) => element.getAttribute('tabindex') === '0')).toHaveLength(1);
      expect(screen.getByRole('link', { name: new RegExp(', current$') })).toHaveAttribute('href', `#/community/c-${count}`);
      unmount();
    }
  });

  it('a long name is the whole accessible name (shown only as a tooltip)', () => {
    renderDock({ communities: [{ id: 'long', name: LONG_NAME, mentions: 0, newMessages: false }], current: null });
    expect(screen.getByRole('link', { name: LONG_NAME })).toBeInTheDocument();
    expect(screen.queryByText(LONG_NAME)).toBeNull();
  });
});
