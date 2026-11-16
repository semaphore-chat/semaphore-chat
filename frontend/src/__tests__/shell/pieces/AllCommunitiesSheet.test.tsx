/**
 * The "All communities" sheet (view): the heading, the rows and their state lines, the current one,
 * the filter above 8, no match, Create only when permitted, Settings and Your profile on a phone, the
 * keyboard list, and loading, empty and error through LoadState. The connected sheet is in
 * AllCommunitiesSheetConnected.test.tsx.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { useState } from 'react';
import { screen, within } from '@testing-library/react';
import { renderWithKit } from '../../test-utils/renderWithKit';
import { AllCommunitiesSheet, type AllCommunitiesSheetProps } from '../../../shell/lounge/pieces/AllCommunitiesSheet';
import { stateLine } from '../../../shell/lounge/pieces/communitiesModel';
import { LoungeLinksContext } from '../../../shell/lounge/links';
import { fixedLoad, LONG_NAME, MOCKUP_STATES, sampleCommunities } from '../../../stories/fixtures/loungeCommunities';

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

type Props = Omit<AllCommunitiesSheetProps, 'filter' | 'onFilterChange'> & { initialFilter?: string };

function Harness({ initialFilter = '', ...props }: Props) {
  const [filter, setFilter] = useState(initialFilter);
  return <AllCommunitiesSheet {...props} filter={filter} onFilterChange={setFilter} />;
}

function renderSheet(props: Partial<Props> = {}) {
  const all: Props = {
    open: true,
    onClose: () => undefined,
    instanceName: 'moss.social',
    username: 'alexk',
    communities: sampleCommunities(5, MOCKUP_STATES),
    currentId: 'c-1',
    canCreate: true,
    useLoad: fixedLoad('ready'),
    showSettings: false,
    onSignOut: () => undefined,
    ...props,
  };
  return renderWithKit(<Harness {...all} />);
}

const dialog = () => screen.getByRole('dialog', { name: 'All communities' });

describe('AllCommunitiesSheet (the view)', () => {
  it('heads the list with the instance and who you are there', async () => {
    renderSheet();
    expect(await within(dialog()).findByText('moss.social')).toBeInTheDocument();
    expect(within(dialog()).getByText('as alexk')).toBeInTheDocument();
  });

  it('lists every community as a link with its state line; the current one is the page; mentions carry a badge', async () => {
    renderSheet();
    const couch = await screen.findByRole('link', { name: /^Couch Co-op/ });
    expect(couch).toHaveAttribute('href', '#/community/c-1');
    expect(couch).toHaveAttribute('aria-current', 'page');
    expect(couch).toHaveTextContent("You're in a call here");
    expect(screen.getByRole('link', { name: /^Trailheads/ })).toHaveTextContent('Quiet');
    expect(screen.getByRole('link', { name: /^Lumen Studio/ })).toHaveTextContent('2 mentions');
    expect(screen.getByRole('link', { name: /^Friday LAN/ })).toHaveTextContent('New messages');
    expect(screen.getByRole('link', { name: /^Wavelength/ })).toHaveTextContent('3 mentions');
    expect(screen.getByLabelText('2 mentions')).toHaveTextContent('2');
    expect(screen.queryByRole('link', { name: /Trailheads/ })?.getAttribute('aria-current')).toBeNull();
  });

  it('state line order: your call, then mentions, then new messages, then quiet', () => {
    expect(stateLine({ inYourCall: true, mentions: 4, newMessages: true })).toBe("You're in a call here");
    expect(stateLine({ inYourCall: false, mentions: 1, newMessages: true })).toBe('1 mention');
    expect(stateLine({ inYourCall: false, mentions: 0, newMessages: true })).toBe('New messages');
    expect(stateLine({ inYourCall: false, mentions: 0, newMessages: false })).toBe('Quiet');
  });

  it('shows no filter for 8 communities, and a filter above 8 that narrows by name', async () => {
    const { unmount } = renderSheet({ communities: sampleCommunities(8) });
    await screen.findByRole('link', { name: /^Couch Co-op/ });
    expect(screen.queryByRole('searchbox', { name: 'Find a community' })).toBeNull();
    unmount();

    const { user } = renderSheet({ communities: sampleCommunities(12) });
    const field = await screen.findByRole('searchbox', { name: 'Find a community' });
    await user.type(field, 'lan');
    const links = within(dialog()).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['#/community/c-4', '#/community/create']);
  });

  it('a filter that matches nothing says so', async () => {
    renderSheet({ communities: sampleCommunities(12), initialFilter: 'zzz' });
    expect(await screen.findByText('No community called “zzz”')).toBeInTheDocument();
  });

  it('offers "Create a community" only when the user may create one', async () => {
    const { unmount } = renderSheet({ canCreate: true });
    expect(await screen.findByRole('link', { name: 'Create a community' })).toHaveAttribute('href', '#/community/create');
    unmount();
    renderSheet({ canCreate: false });
    await screen.findByRole('link', { name: /^Couch Co-op/ });
    expect(screen.queryByRole('link', { name: 'Create a community' })).toBeNull();
    expect(screen.queryByText(/create/i)).toBeNull();
  });

  it('on a phone, Settings, Your profile and Sign out… at the foot', async () => {
    const onSignOut = vi.fn();
    const { unmount, user } = renderSheet({ showSettings: true, onSignOut });
    expect(await screen.findByRole('link', { name: 'Settings' })).toHaveAttribute('href', '#/settings');
    expect(screen.getByRole('link', { name: 'Your profile' })).toHaveAttribute('href', '#/profile');
    await user.click(screen.getByRole('button', { name: 'Sign out…' }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
    unmount();
    renderSheet({ showSettings: false });
    await screen.findByRole('link', { name: /^Couch Co-op/ });
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign out…' })).toBeNull();
  });

  it('on a phone, Notifications with its unread count leads to the notifications page; at 0 no count', async () => {
    const { unmount } = renderSheet({ showSettings: true, notificationCount: 3 });
    const row = await screen.findByRole('link', { name: 'Notifications, 3 unread' });
    expect(row).toHaveAttribute('href', '#/notifications');
    expect(screen.getByRole('img', { name: '3 unread' })).toHaveTextContent('3');
    unmount();
    const zero = renderSheet({ showSettings: true, notificationCount: 0 });
    expect(await screen.findByRole('link', { name: 'Notifications' })).toHaveAttribute('href', '#/notifications');
    expect(screen.queryByRole('img', { name: /unread/ })).toBeNull();
    zero.unmount();
    renderSheet({ showSettings: false, notificationCount: 3 });
    await screen.findByRole('link', { name: /^Couch Co-op/ });
    expect(screen.queryByRole('link', { name: /^Notifications/ })).toBeNull();
  });

  it("links each community to its route, or where the frame's links context says (a test fixture)", async () => {
    const { unmount } = renderSheet();
    expect(await screen.findByRole('link', { name: /^Trailheads/ })).toHaveAttribute('href', '#/community/c-2');
    unmount();
    const all = {
      open: true,
      onClose: () => undefined,
      instanceName: 'moss.social',
      username: 'alexk',
      communities: sampleCommunities(5, MOCKUP_STATES),
      currentId: 'c-1',
      canCreate: false,
      useLoad: fixedLoad('ready'),
      showSettings: false,
      onSignOut: () => undefined,
    };
    renderWithKit(
      <LoungeLinksContext value={{ community: (id) => `#/__lounge/community/${id}` }}>
        <Harness {...all} />
      </LoungeLinksContext>,
    );
    expect(await screen.findByRole('link', { name: /^Trailheads/ })).toHaveAttribute('href', '#/__lounge/community/c-2');
  });

  it('is one keyboard list: one Tab stop on the current row, Up and Down, typeahead, the foot rows included', async () => {
    const { user } = renderSheet({ showSettings: true });
    await screen.findByRole('link', { name: /^Couch Co-op/ });
    const links = within(dialog()).getAllByRole('link');
    expect(links.filter((link) => link.getAttribute('tabindex') === '0')).toEqual([
      screen.getByRole('link', { name: /^Couch Co-op/ }),
    ]);
    // Focus starts on Close (no actions row); the next Tab enters the list on the current row
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('link', { name: /^Couch Co-op/ })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('link', { name: /^Trailheads/ })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('button', { name: 'Sign out…' })).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('link', { name: 'Your profile' })).toHaveFocus();
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(screen.getByRole('link', { name: 'Notifications' })).toHaveFocus();
    await user.keyboard('{Home}w');
    expect(screen.getByRole('link', { name: /^Wavelength/ })).toHaveFocus();
  });

  it('a chosen row is reported with its id', async () => {
    const onActivate = vi.fn();
    const { user } = renderSheet({ onActivate });
    await user.click(await screen.findByRole('link', { name: /^Lumen Studio/ }));
    expect(onActivate).toHaveBeenCalledWith('c-3');
  });

  it('Escape asks to close', async () => {
    const onClose = vi.fn();
    const { user } = renderSheet({ onClose });
    await screen.findByRole('link', { name: /^Couch Co-op/ });
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledWith('escape');
  });

  it('loading: names the region as loading, no rows yet', async () => {
    renderSheet({ useLoad: fixedLoad('loading') });
    expect(await screen.findByText('Loading communities')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Couch Co-op/ })).toBeNull();
  });

  it('error: "Couldn\'t load your communities" with Try again', async () => {
    renderSheet({ useLoad: fixedLoad('error') });
    expect(await screen.findByText("Couldn't load your communities")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('empty: says how to start, with Create when permitted, without it otherwise', async () => {
    const { unmount } = renderSheet({ useLoad: fixedLoad('empty'), communities: [] });
    expect(await screen.findByText(/You're not in any community yet\. Create one/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create a community' })).toBeInTheDocument();
    unmount();
    renderSheet({ useLoad: fixedLoad('empty'), communities: [], canCreate: false });
    expect(await screen.findByText("You're not in any community yet. Join one with an invite link.")).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Create a community' })).toBeNull();
  });

  it('a long name is the row link name and is cut on screen, not wrapped', async () => {
    renderSheet({ communities: [{ id: 'long', name: LONG_NAME, mentions: 0, newMessages: false, inYourCall: false }], currentId: null });
    expect(await screen.findByRole('link', { name: new RegExp(`^${LONG_NAME}`) })).toBeInTheDocument();
  });

  it('sixty communities: every row is there', async () => {
    renderSheet({ communities: sampleCommunities(60), currentId: 'c-60' });
    await screen.findByRole('link', { name: 'Couch Co-op Quiet' });
    expect(within(dialog()).getAllByRole('link').filter((link) => link.getAttribute('href')?.startsWith('#/community/c-'))).toHaveLength(60);
  });
});
