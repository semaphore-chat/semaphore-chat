/**
 * The classic Home tab returns to the community last opened, in either shell: the new shell's community home
 * writes it through utils/lastCommunity, and MobileNavigationContext reads the same key when it mounts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { renderWithProviders } from '../test-utils';
import { MobileNavigationProvider, useMobileNavigation } from '../../components/Mobile/Navigation/MobileNavigationContext';
import { LAST_COMMUNITY_KEY, readLastCommunity, rememberLastCommunity } from '../../utils/lastCommunity';

vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: undefined }),
}));

const probe: { nav?: ReturnType<typeof useMobileNavigation>; path?: string } = {};
function Probe() {
  probe.nav = useMobileNavigation();
  probe.path = useLocation().pathname;
  return null;
}

beforeEach(() => {
  localStorage.clear();
  probe.nav = undefined;
  probe.path = undefined;
});

describe('the last community', () => {
  it('the Home tab uses a last community written by the Lounge', () => {
    rememberLastCommunity('c-lounge');
    renderWithProviders(
      <MobileNavigationProvider>
        <Probe />
      </MobileNavigationProvider>,
      { routerProps: { initialEntries: ['/direct-messages'] } },
    );
    expect(probe.nav?.lastCommunityId).toBe('c-lounge');
    act(() => probe.nav!.setActiveTab('home'));
    expect(probe.path).toBe('/community/c-lounge');
  });

  it('the classic layout still writes it on a community route, under the same key', () => {
    renderWithProviders(
      <MobileNavigationProvider>
        <Probe />
      </MobileNavigationProvider>,
      { routerProps: { initialEntries: ['/community/c-classic/channel/ch-1'] } },
    );
    expect(localStorage.getItem(LAST_COMMUNITY_KEY)).toBe('c-classic');
    expect(readLastCommunity()).toBe('c-classic');
  });

  it('a storage that throws reads as none and ignores writes', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readLastCommunity()).toBeNull();
    expect(() => rememberLastCommunity('c-1')).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });
});
