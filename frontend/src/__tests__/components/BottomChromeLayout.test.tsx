/**
 * Task 10 — the edge chrome as one system: each piece registers with
 * BottomChromeContext and positions itself from it, the nav hides on chat
 * screens and while the keyboard is open, the voice bar sits in flow on
 * touch layouts, and only one snackbar shows at a time.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act, screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import {
  BOTTOM_CHROME_ORDER,
  BottomChromeProvider,
  useBottomChromeOffset,
  useChromeItem,
  useTopChromeHost,
  useTopChromeOffset,
  TOP_CHROME_ORDER,
} from '../../contexts/BottomChromeContext';
import { setUpdateAvailable, _resetSwUpdateForTests } from '../../utils/swUpdate';
import { renderInEveryTheme } from '../test-utils/themeMatrix';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const nav = vi.hoisted(() => ({ currentScreen: 'channels' as string }));
vi.mock('../../components/Mobile/Navigation/MobileNavigationContext', () => ({
  useMobileNavigation: () => ({
    activeTab: 'home',
    setActiveTab: vi.fn(),
    state: { currentScreen: nav.currentScreen },
  }),
}));

const install = vi.hoisted(() => ({ isInstallable: false }));
vi.mock('../../hooks/useInstallPrompt', () => ({
  useInstallPrompt: () => ({
    isInstallable: install.isInstallable,
    isIOS: false,
    install: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const socket = vi.hoisted(() => ({ connected: true }));
vi.mock('../../hooks/useSocket', () => ({
  useSocket: vi.fn(() => null),
  useSocketConnected: () => socket.connected,
}));

const voice = vi.hoisted(() => ({ connected: false }));
vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => ({
    state: {
      isConnected: voice.connected,
      isConnecting: false,
      currentChannelId: voice.connected ? 'ch-1' : null,
      currentDmGroupId: null,
    },
    actions: { joinDmVoice: vi.fn() },
  }),
}));
vi.mock('../../components/Voice/VoiceBottomBarContent', () => ({
  default: () => <div data-testid="voice-bar-content">bar</div>,
}));

const call = vi.hoisted(() => ({ incoming: null as null | Record<string, string> }));
vi.mock('../../contexts/IncomingCallContext', () => ({
  useIncomingCall: () => ({ incomingCall: call.incoming, dismissCall: vi.fn() }),
}));

vi.mock('../../components/Common/AuthenticatedImage', () => ({
  AuthenticatedImage: ({ fallback }: { fallback?: React.ReactNode }) => <>{fallback}</>,
}));

const platform = vi.hoisted(() => ({ electron: false }));
vi.mock('../../utils/platform', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isElectron: () => platform.electron,
  isWeb: () => !platform.electron,
}));

import { MobileBottomNavigation } from '../../components/Mobile/Navigation/MobileBottomNavigation';
import { VoiceBottomBar } from '../../components/Voice/VoiceBottomBar';
import { ConnectionStatusBanner } from '../../components/ConnectionStatusBanner';
import { UpdateToast } from '../../components/PWA/UpdateToast';
import { PWAInstallPrompt } from '../../components/PWA/PWAInstallPrompt';
import { OfflineBanner } from '../../components/PWA/OfflineBanner';
import { IncomingCallBanner } from '../../components/DirectMessage/IncomingCallBanner';

const OffsetProbe: React.FC<{ order: number }> = ({ order }) => (
  <div data-testid={`offset-${order}`}>{useBottomChromeOffset(order).px}</div>
);
const TopProbe: React.FC = () => <div data-testid="top-host">{useTopChromeHost()}</div>;
const TopOffsetProbe: React.FC<{ order: number }> = ({ order }) => (
  <div data-testid={`top-offset-${order}`}>{useTopChromeOffset(order).px}</div>
);
const Fixed: React.FC<{ id: string; order: number; height: number }> = (p) => {
  useChromeItem(p);
  return null;
};

const inStore = (ui: React.ReactNode) => renderWithProviders(<BottomChromeProvider>{ui}</BottomChromeProvider>);

function setOnLine(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
}

beforeEach(() => {
  nav.currentScreen = 'channels';
  install.isInstallable = false;
  socket.connected = true;
  voice.connected = false;
  call.incoming = null;
  platform.electron = false;
  _resetSwUpdateForTests();
  setOnLine(true);
});

describe('MobileBottomNavigation', () => {
  it.each(['chat', 'dm-chat', 'search'])('is hidden on the %s screen when auto-hiding (phone)', (screenName) => {
    nav.currentScreen = screenName;
    inStore(
      <>
        <MobileBottomNavigation hideOnDetailScreens />
        <OffsetProbe order={BOTTOM_CHROME_ORDER.TOAST} />
      </>,
    );
    expect(screen.queryByText('Home')).not.toBeInTheDocument();
    expect(screen.getByTestId('offset-30')).toHaveTextContent('0');
  });

  it.each(['channels', 'dm-list', 'notifications', 'profile'])('is shown on %s and registers its height', (screenName) => {
    nav.currentScreen = screenName;
    inStore(
      <>
        <MobileBottomNavigation hideOnDetailScreens />
        <OffsetProbe order={BOTTOM_CHROME_ORDER.TOAST} />
      </>,
    );
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByTestId('offset-30')).toHaveTextContent('56');
  });

  it('stays visible on chat when not auto-hiding (tablet)', () => {
    nav.currentScreen = 'chat';
    inStore(<MobileBottomNavigation />);
    expect(screen.getByText('Home')).toBeInTheDocument();
  });

  it('sits in normal flow instead of being fixed over the content', () => {
    inStore(<MobileBottomNavigation />);
    const paper = screen.getByText('Home').closest('.MuiPaper-root') as HTMLElement;
    expect(getComputedStyle(paper).position).not.toBe('fixed');
  });

  describe('with the on-screen keyboard open', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'visualViewport');
    afterEach(() => {
      if (original) Object.defineProperty(window, 'visualViewport', original);
      else delete (window as unknown as Record<string, unknown>).visualViewport;
    });

    it('hides, and comes back when the keyboard closes', () => {
      const vv = Object.assign(new EventTarget(), { height: window.innerHeight, offsetTop: 0 });
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
      inStore(<MobileBottomNavigation />);
      expect(screen.getByText('Home')).toBeInTheDocument();

      act(() => {
        vv.height = window.innerHeight - 300;
        vv.dispatchEvent(new Event('resize'));
      });
      expect(screen.queryByText('Home')).not.toBeInTheDocument();

      act(() => {
        vv.height = window.innerHeight;
        vv.dispatchEvent(new Event('resize'));
      });
      expect(screen.getByText('Home')).toBeInTheDocument();
    });
  });
});

describe('VoiceBottomBar', () => {
  it('on touch layouts (inline) sits in normal flow and registers as the voice-bar level', async () => {
    voice.connected = true;
    inStore(
      <>
        <VoiceBottomBar inline />
        <OffsetProbe order={BOTTOM_CHROME_ORDER.TOAST} />
      </>,
    );
    await screen.findByTestId('voice-bar-content');
    const wrapper = screen.getByTestId('voice-bottom-bar');
    expect(getComputedStyle(wrapper).position).not.toBe('fixed');
    // jsdom has no ResizeObserver → the declared mobile bar height is used.
    expect(Number(screen.getByTestId('offset-30').textContent)).toBeGreaterThan(0);
  });

  it('on desktop (and in Electron at any width) stays fixed to the bottom', async () => {
    platform.electron = true;
    voice.connected = true;
    inStore(<VoiceBottomBar />);
    await screen.findByTestId('voice-bar-content');
    expect(getComputedStyle(screen.getByTestId('voice-bottom-bar')).position).toBe('fixed');
  });

  it('registers nothing when not in a call', () => {
    inStore(
      <>
        <VoiceBottomBar inline />
        <OffsetProbe order={BOTTOM_CHROME_ORDER.TOAST} />
      </>,
    );
    expect(screen.queryByTestId('voice-bottom-bar')).not.toBeInTheDocument();
    expect(screen.getByTestId('offset-30')).toHaveTextContent('0');
  });
});

describe('ConnectionStatusBanner', () => {
  it('sits above everything registered below the chip level', () => {
    socket.connected = false;
    inStore(
      <>
        <Fixed id="nav" order={BOTTOM_CHROME_ORDER.NAV} height={56} />
        <Fixed id="voice" order={BOTTOM_CHROME_ORDER.VOICE_BAR} height={72} />
        <Fixed id="toast" order={BOTTOM_CHROME_ORDER.TOAST} height={48} />
        <ConnectionStatusBanner />
      </>,
    );
    const chip = screen.getByText('Reconnecting...').closest('.MuiChip-root') as HTMLElement;
    expect(chip.dataset.chromeOffset).toBe(String(56 + 72 + 48));
  });
});

describe('toast queue', () => {
  it('shows only the update toast while both want to show, then the install prompt', () => {
    install.isInstallable = true;
    act(() => setUpdateAvailable(true));
    inStore(
      <>
        <PWAInstallPrompt />
        <UpdateToast />
      </>,
    );
    expect(screen.getByText('Update available')).toBeInTheDocument();
    expect(screen.queryByText('Install Semaphore Chat')).not.toBeInTheDocument();

    act(() => setUpdateAvailable(false));
    expect(screen.getByText('Install Semaphore Chat')).toBeInTheDocument();
  });

  it('places the toast above the registered chrome', () => {
    act(() => setUpdateAvailable(true));
    inStore(
      <>
        <Fixed id="nav" order={BOTTOM_CHROME_ORDER.NAV} height={56} />
        <Fixed id="composer" order={BOTTOM_CHROME_ORDER.COMPOSER} height={90} />
        <UpdateToast />
      </>,
    );
    const snackbar = screen.getByText('Update available').closest('.MuiSnackbar-root') as HTMLElement;
    expect(snackbar.dataset.chromeOffset).toBe(String(56 + 90));
  });
});

describe('top chrome', () => {
  it('on touch layouts the offline banner is a strip that pushes content down', () => {
    setOnLine(false);
    inStore(
      <>
        <TopProbe />
        <OfflineBanner />
        <TopOffsetProbe order={TOP_CHROME_ORDER.INCOMING_CALL} />
      </>,
    );
    const strip = screen.getByText("You're offline").closest('[data-testid="offline-strip"]');
    expect(strip).toBeInTheDocument();
    expect(Number(screen.getByTestId('top-host').textContent)).toBeGreaterThan(0);
    // The call banner (next level down) sits below the strip.
    expect(Number(screen.getByTestId('top-offset-10').textContent)).toBeGreaterThan(0);
  });

  it('on touch layouts the incoming-call banner registers as top chrome', () => {
    call.incoming = { dmGroupId: 'dm-1', dmGroupName: 'Pat', callerName: 'Pat', callerAvatar: '' };
    inStore(
      <>
        <TopProbe />
        <IncomingCallBanner />
      </>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(Number(screen.getByTestId('top-host').textContent)).toBeGreaterThan(0);
  });

  it('with no touch layout mounted (desktop / Electron) both keep their overlay presentation', () => {
    platform.electron = true;
    setOnLine(false);
    call.incoming = { dmGroupId: 'dm-1', dmGroupName: 'Pat', callerName: 'Pat', callerAvatar: '' };
    inStore(
      <>
        <OfflineBanner />
        <IncomingCallBanner />
      </>,
    );
    expect(screen.queryByTestId('offline-strip')).not.toBeInTheDocument();
    expect(screen.getByText("You're offline").closest('.MuiSnackbar-root')).toBeInTheDocument();
    const banner = screen.getByText('Incoming voice call').closest('[role="alert"]') as HTMLElement;
    expect(getComputedStyle(banner).top).toBe('0px');
  });
});

describe('theme matrix (Review Focus #2)', () => {
  it('the offline strip, call banner, chip and queued toasts render in every mode × intensity', () => {
    setOnLine(false);
    socket.connected = false;
    install.isInstallable = true;
    act(() => setUpdateAvailable(true));
    call.incoming = { dmGroupId: 'dm-1', dmGroupName: 'Pat', callerName: 'Pat', callerAvatar: '' };
    renderInEveryTheme(
      () => (
        <BottomChromeProvider>
          <TopProbe />
          <OfflineBanner />
          <IncomingCallBanner />
          <ConnectionStatusBanner />
          <PWAInstallPrompt />
          <UpdateToast />
        </BottomChromeProvider>
      ),
      () => {
        expect(screen.getByTestId('offline-strip')).toBeInTheDocument();
        expect(screen.getByText('Incoming voice call')).toBeInTheDocument();
        expect(screen.getByText('Reconnecting...')).toBeInTheDocument();
        expect(screen.getByText('Update available')).toBeInTheDocument();
      },
    );
  });
});
