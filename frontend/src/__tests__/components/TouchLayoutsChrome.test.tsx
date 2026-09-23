/**
 * Task 10 follow-up — the touch layouts themselves (MobileLayout,
 * TabletLayout) with the edge chrome in them, plus Layout's choice of layout
 * under Electron (Review Focus #1): a narrow Electron window must stay on the
 * desktop layout, so none of the in-flow voice bar / auto-hiding nav leaks in.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import {
  BOTTOM_CHROME_ORDER,
  BottomChromeProvider,
  TOP_CHROME_ORDER,
  useChromeItem,
} from '../../contexts/BottomChromeContext';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const platform = vi.hoisted(() => ({ electron: false }));
vi.mock('../../utils/platform', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isElectron: () => platform.electron,
  isWeb: () => !platform.electron,
}));

const nav = vi.hoisted(() => ({ currentScreen: 'channels' as string }));
vi.mock('../../components/Mobile/Navigation/MobileNavigationContext', () => ({
  MobileNavigationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useMobileNavigation: () => ({
    activeTab: 'home',
    setActiveTab: vi.fn(),
    state: { currentScreen: nav.currentScreen, communityId: 'c-1' },
  }),
}));

const voice = vi.hoisted(() => ({ connected: false }));
vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => ({
    state: {
      isConnected: voice.connected,
      isConnecting: false,
      currentChannelId: voice.connected ? 'ch-1' : null,
      currentDmGroupId: null,
      room: null,
    },
    actions: { joinDmVoice: vi.fn(), joinVoiceChannel: vi.fn() },
  }),
}));
vi.mock('../../components/Voice/VoiceBottomBarContent', () => ({
  default: () => <div data-testid="voice-bar-content">bar</div>,
}));

vi.mock('../../hooks/useSocket', () => ({
  useSocket: vi.fn(() => null),
  useSocketConnected: () => false,
}));

// Everything in the layouts that isn't edge chrome is a stub.
vi.mock('../../hooks/useVoiceRecovery', () => ({ useVoiceRecovery: vi.fn() }));
vi.mock('../../components/Voice/AudioRenderer', () => ({ AudioRenderer: () => null }));
vi.mock('../../components/Voice/PersistentVideoOverlay', () => ({ PersistentVideoOverlay: () => null }));
vi.mock('../../components/Voice/TrackSubscriptionProvider', () => ({
  TrackSubscriptionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../hooks/useVoiceEventLog', () => ({
  VoiceEventLogProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../features/voice/VoiceTestHooks', () => ({ VoiceTestHooks: () => null }));
vi.mock('../../components/Mobile/Navigation/MobileCommunityDrawer', () => ({ default: () => null }));
vi.mock('../../components/Mobile/Screens/MobileScreenContainer', () => ({
  MobileScreenContainer: () => <div data-testid="screen">screen</div>,
}));
vi.mock('../../components/Mobile/Tablet/TabletSidebar', () => ({
  TabletSidebar: () => <div data-testid="tablet-sidebar" />,
}));
vi.mock('../../components/Mobile/Tablet/TabletContentArea', () => ({
  TabletContentArea: () => <div data-testid="screen">content</div>,
}));

// Layout.tsx: stub the three layouts and its hooks; keep the real useResponsive.
vi.mock('../../components/Desktop/DesktopLayout', () => ({
  DesktopLayout: () => <div data-testid="desktop-layout" />,
}));
vi.mock('../../components/LayoutProviders', () => ({
  LayoutProviders: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: undefined, isLoading: false, isError: false }),
}));
vi.mock('../../hooks/useVoiceForegroundResync', () => ({ useVoiceForegroundResync: vi.fn() }));
vi.mock('../../hooks/useThemeSync', () => ({ useThemeSync: vi.fn() }));
vi.mock('../../hooks/useAppBadge', () => ({ useAppBadge: vi.fn() }));
vi.mock('../../hooks/usePushResync', () => ({ usePushResync: vi.fn() }));

import { MobileLayout } from '../../components/Mobile/MobileLayout';
import { TabletLayout } from '../../components/Mobile/Tablet/TabletLayout';
import Layout from '../../Layout';
import { ConnectionStatusBanner } from '../../components/ConnectionStatusBanner';

const TopItem: React.FC<{ height: number }> = ({ height }) => {
  useChromeItem({ id: 'top', edge: 'top', order: TOP_CHROME_ORDER.OFFLINE, height });
  return null;
};

const Bottom: React.FC<{ id: string; order: number; height: number }> = (p) => {
  useChromeItem(p);
  return null;
};

const inStore = (ui: React.ReactNode) => renderWithProviders(<BottomChromeProvider>{ui}</BottomChromeProvider>);

/** The layout's outer column: the nearest ancestor of the screen with a fixed position. */
function layoutColumn(): HTMLElement {
  let el: HTMLElement | null = screen.getByTestId('screen');
  while (el && getComputedStyle(el).position !== 'fixed') el = el.parentElement;
  if (!el) throw new Error('no fixed layout column');
  return el;
}

/** matchMedia that evaluates min-/max-width queries against `width`. */
function stubViewportWidth(width: number) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => {
      const min = /min-width:\s*(\d+)px/.exec(query);
      const max = /max-width:\s*(\d+)px/.exec(query);
      const matches =
        (min || max) && !query.includes('pointer') && !query.includes('hover')
          ? (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]))
          : false;
      return {
        matches: !!matches,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      };
    }),
  );
}

beforeEach(() => {
  platform.electron = false;
  nav.currentScreen = 'channels';
  voice.connected = false;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each([
  ['MobileLayout', MobileLayout],
  ['TabletLayout', TabletLayout],
])('%s edge chrome', (name, LayoutUnderTest) => {
  it('stacks screen → voice bar (→ nav on phone) in normal flow', async () => {
    voice.connected = true;
    inStore(<LayoutUnderTest />);
    const bar = await screen.findByTestId('voice-bottom-bar');
    const content = screen.getByTestId('screen');

    expect(content.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(getComputedStyle(bar).position).not.toBe('fixed');
    if (name === 'MobileLayout') {
      // Phone: the voice bar sits directly above the nav.
      const navEl = screen.getByText('Home').closest('.MuiPaper-root') as HTMLElement;
      expect(bar.compareDocumentPosition(navEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(getComputedStyle(navEl).position).not.toBe('fixed');
    }
    // Above the floating video surfaces (FloatCard / phone overlay at 1200).
    expect(Number(getComputedStyle(bar).zIndex)).toBeGreaterThan(1200);
  });

  it('pads the top of the column by the registered top chrome', () => {
    inStore(
      <>
        <TopItem height={40} />
        <LayoutUnderTest />
      </>,
    );
    expect(getComputedStyle(layoutColumn()).paddingTop).toContain('40px');
  });

  it('adds no top chrome padding when nothing is registered', () => {
    inStore(<LayoutUnderTest />);
    expect(getComputedStyle(layoutColumn()).paddingTop).toContain('0px');
    expect(getComputedStyle(layoutColumn()).paddingTop).not.toContain('40px');
  });
});

describe('MobileLayout safe area', () => {
  it('the nav pads the home-indicator area while it is showing', () => {
    inStore(<MobileLayout />);
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(getComputedStyle(layoutColumn()).paddingBottom).not.toContain('safe-area');
  });

  it('pads it on the column itself when the nav is hidden (chat screen)', () => {
    nav.currentScreen = 'chat';
    inStore(<MobileLayout />);
    expect(screen.queryByText('Home')).not.toBeInTheDocument();
    expect(getComputedStyle(layoutColumn()).paddingBottom).toContain('safe-area-inset-bottom');
  });
});

describe('TabletLayout nav (task 17: sidebar navigation only)', () => {
  it.each(['channels', 'chat'])('has no bottom nav on the %s screen', (currentScreen) => {
    nav.currentScreen = currentScreen;
    inStore(<TabletLayout />);
    expect(document.querySelector('.MuiBottomNavigation-root')).toBeNull();
    expect(screen.getByTestId('tablet-sidebar')).toBeInTheDocument();
  });

  it('pads the home-indicator area on the column itself', () => {
    inStore(<TabletLayout />);
    expect(getComputedStyle(layoutColumn()).paddingBottom).toContain('safe-area-inset-bottom');
  });
});

describe('Layout choice (Review Focus #1)', () => {
  it('a phone-width browser gets the mobile layout (sanity check for the Electron case)', () => {
    stubViewportWidth(390);
    inStore(<Layout />);
    expect(screen.queryByTestId('desktop-layout')).not.toBeInTheDocument();
    expect(screen.getByTestId('screen')).toBeInTheDocument();
  });

  it('a narrow Electron window stays on the desktop layout — no in-flow bar or auto-hiding nav', () => {
    platform.electron = true;
    voice.connected = true;
    stubViewportWidth(390);
    inStore(<Layout />);
    expect(screen.getByTestId('desktop-layout')).toBeInTheDocument();
    expect(screen.queryByTestId('screen')).not.toBeInTheDocument();
    expect(screen.queryByText('Home')).not.toBeInTheDocument();
  });

  it('a desktop-width browser gets the desktop layout', () => {
    stubViewportWidth(1400);
    inStore(<Layout />);
    expect(screen.getByTestId('desktop-layout')).toBeInTheDocument();
  });
});

describe('Reconnecting chip placement by layout', () => {
  const renderChip = () => {
    inStore(
      <>
        <Bottom id="voice" order={BOTTOM_CHROME_ORDER.VOICE_BAR} height={70} />
        <Bottom id="composer" order={BOTTOM_CHROME_ORDER.COMPOSER} height={90} />
        <Bottom id="toast" order={BOTTOM_CHROME_ORDER.TOAST} height={80} />
        <ConnectionStatusBanner />
      </>,
    );
    return Number((screen.getByText('Reconnecting...').closest('.MuiChip-root') as HTMLElement).dataset.chromeOffset);
  };

  it('phone: clears the full-width composer and the toast', () => {
    stubViewportWidth(390);
    expect(renderChip()).toBe(70 + 90 + 80);
  });

  it('tablet: the chip is over the sidebar, so the composer is skipped (the toast may still reach it)', () => {
    stubViewportWidth(820);
    expect(renderChip()).toBe(70 + 80);
  });

  it('desktop: only the full-width voice bar counts', () => {
    stubViewportWidth(1400);
    expect(renderChip()).toBe(70);
  });

  it('narrow Electron window (desktop layout): the composer is skipped', () => {
    platform.electron = true;
    stubViewportWidth(390);
    expect(renderChip()).toBe(70 + 80);
  });
});
