/**
 * The old-look global chrome above AppShell yields while the new design's shell is shown
 * (shell/shownShellKind.ts, design F1 / risk 9), and comes back unchanged when the old shell
 * is shown again: the reconnecting chip, the incoming-call strip, the auto-updater's snackbars,
 * the notification snackbar and the desktop sign-in notice.
 *
 * The flip is `publishShownShellKind`, as LoungeRoot does in a layout effect; LoungeFrame.test
 * covers the real shell publishing it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { ServerEvents } from '@semaphore-chat/shared';
import { renderWithProviders } from '../test-utils';
import { createFakeElectronAPI, emitOnSubscribe } from '../test-utils/fakeElectronAPI';
import { BottomChromeProvider } from '../../contexts/BottomChromeContext';
import { VoiceProvider } from '../../contexts/VoiceProvider';
import { RoomContext } from '../../contexts/RoomContextDef';
import { IncomingCallProvider, useIncomingCall } from '../../contexts/IncomingCallContext';
import { useNotification } from '../../contexts/NotificationContext';
import { ConnectionStatusBanner } from '../../components/ConnectionStatusBanner';
import { IncomingCallBanner } from '../../components/DirectMessage/IncomingCallBanner';
import { AutoUpdater } from '../../components/Electron/AutoUpdater';
import { publishShownShellKind } from '../../shell/shownShellKind';
import { OfflineBanner } from '../../components/PWA/OfflineBanner';
import { UpdateToast } from '../../components/PWA/UpdateToast';
import { PWAInstallPrompt } from '../../components/PWA/PWAInstallPrompt';
import { setUpdateAvailable, _resetSwUpdateForTests } from '../../utils/swUpdate';
import { dismissDesktopSignInNotice, useDesktopSignInBanner } from '../../data/signInNotice';

vi.mock('../../utils/logger', () => ({
  logger: { dev: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// The strip has no file cache here: its fallback avatar (initials).
vi.mock('../../components/Common/AuthenticatedImage', () => ({
  AuthenticatedImage: ({ fallback }: { fallback?: React.ReactNode }) => <>{fallback}</>,
}));

const serverEvent = vi.hoisted(() => ({ handler: undefined as undefined | (() => void), event: '' }));
const installPrompt = vi.hoisted(() => ({ installable: false }));
vi.mock('../../hooks/useInstallPrompt', () => ({
  useInstallPrompt: () => ({
    isInstallable: installPrompt.installable,
    isIOS: false,
    install: async () => false,
    dismiss: () => undefined,
  }),
}));

vi.mock('../../socket-hub/useServerEvent', () => ({
  useServerEvent: (event: string, handler: () => void) => {
    serverEvent.event = event;
    serverEvent.handler = handler;
  },
}));
import { useDesktopSignInNotice } from '../../hooks/useDesktopSignInNotice';

const lounge = () => act(() => publishShownShellKind('lounge'));
const classic = () => act(() => publishShownShellKind('classic'));

beforeEach(() => {
  publishShownShellKind('classic');
  dismissDesktopSignInNotice();
});

afterEach(() => {
  // Still mounted here (cleanup comes after): a flip re-renders them, so inside act.
  act(() => publishShownShellKind('classic'));
});

describe('the old-look global chrome yields to the new shell and comes back', () => {
  it('the reconnecting chip', () => {
    renderWithProviders(
      <BottomChromeProvider>
        <ConnectionStatusBanner />
      </BottomChromeProvider>,
    );
    expect(screen.getByText('Reconnecting...')).toBeInTheDocument();
    lounge();
    expect(screen.queryByText('Reconnecting...')).toBeNull();
    classic();
    expect(screen.getByText('Reconnecting...')).toBeInTheDocument();
  });

  it('the incoming-call strip', () => {
    let ring: ReturnType<typeof useIncomingCall>['showIncomingCall'] = () => undefined;
    function Ringer() {
      ring = useIncomingCall().showIncomingCall;
      return null;
    }
    renderWithProviders(
      <BottomChromeProvider>
        <VoiceProvider>
          <RoomContext.Provider value={{ room: null, setRoom: () => undefined, getRoom: () => null }}>
            <IncomingCallProvider>
              <Ringer />
              <IncomingCallBanner />
            </IncomingCallProvider>
          </RoomContext.Provider>
        </VoiceProvider>
      </BottomChromeProvider>,
    );
    act(() =>
      ring({ dmGroupId: 'dm-1', dmGroupName: 'Hangout', callerName: 'Priya Diallo', callerAvatar: null, startedAt: Date.now() }),
    );
    expect(screen.getByText('Incoming voice call')).toBeInTheDocument();
    lounge();
    expect(screen.queryByText('Incoming voice call')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    classic();
    expect(screen.getByText('Priya Diallo')).toBeInTheDocument();
    expect(screen.getByText('Incoming voice call')).toBeInTheDocument();
  });

  it("the auto-updater's snackbars (the subscription stays)", () => {
    let progress: (p: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void = () => undefined;
    const electronAPI = createFakeElectronAPI({
      onUpdateAvailable: emitOnSubscribe({ version: '1.4.0' }),
      onDownloadProgress: (callback: typeof progress) => {
        progress = callback;
        return () => undefined;
      },
    });
    renderWithProviders(<AutoUpdater />, { electronAPI });
    expect(screen.getByText('Downloading update... 0%')).toBeInTheDocument();
    lounge();
    expect(screen.queryByText(/Downloading update/)).toBeNull();
    // Still subscribed while hidden: progress made meanwhile shows on the way back.
    act(() => progress({ percent: 60, bytesPerSecond: 1, transferred: 6, total: 10 }));
    classic();
    expect(screen.getByText('Downloading update... 60%')).toBeInTheDocument();
  });

  it('the notification snackbar: hidden and closed while the new shell shows, then as before', () => {
    let show: ReturnType<typeof useNotification>['showNotification'] = () => undefined;
    function Notifier() {
      show = useNotification().showNotification;
      return null;
    }
    renderWithProviders(<Notifier />);
    act(() => show('Saved', 'success'));
    expect(screen.getByText('Saved')).toBeInTheDocument();
    lounge();
    expect(screen.queryByText('Saved')).toBeNull();
    classic();
    // Closed, not brought back with a stale message.
    expect(screen.queryByText('Saved')).toBeNull();
    act(() => show('Saved again', 'info'));
    expect(screen.getByText('Saved again')).toBeInTheDocument();
  });

  it("AppChrome's offline strip", () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    try {
      renderWithProviders(
        <BottomChromeProvider>
          <OfflineBanner />
        </BottomChromeProvider>,
      );
      expect(screen.getByText("You're offline")).toBeInTheDocument();
      lounge();
      expect(screen.queryByText("You're offline")).toBeNull();
      classic();
      expect(screen.getByText("You're offline")).toBeInTheDocument();
    } finally {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    }
  });

  it("AppChrome's web update toast", async () => {
    _resetSwUpdateForTests();
    renderWithProviders(
      <BottomChromeProvider>
        <UpdateToast />
      </BottomChromeProvider>,
    );
    act(() => setUpdateAvailable(true));
    expect(screen.getByText('Update available')).toBeInTheDocument();
    lounge();
    // The Snackbar closes with its exit transition.
    await waitFor(() => expect(screen.queryByText('Update available')).toBeNull());
    classic();
    expect(screen.getByText('Update available')).toBeInTheDocument();
    act(() => _resetSwUpdateForTests());
  });

  it("AppChrome's install prompt", () => {
    installPrompt.installable = true;
    try {
      renderWithProviders(
        <BottomChromeProvider>
          <PWAInstallPrompt />
        </BottomChromeProvider>,
      );
      expect(screen.getByText('Install Semaphore Chat')).toBeInTheDocument();
      lounge();
      expect(screen.queryByText('Install Semaphore Chat')).toBeNull();
      classic();
      expect(screen.getByText('Install Semaphore Chat')).toBeInTheDocument();
    } finally {
      installPrompt.installable = false;
    }
  });

  it('the desktop sign-in notice: the snackbar in the old shell, a banner in the new one', () => {
    function SignInNotice() {
      useDesktopSignInNotice();
      return null;
    }
    const notice = renderHook(() => useDesktopSignInBanner());
    renderWithProviders(<SignInNotice />);
    expect(serverEvent.event).toBe(ServerEvents.DESKTOP_SIGN_IN);

    act(() => serverEvent.handler!());
    expect(screen.getByText(/desktop app just signed in/i)).toBeInTheDocument();
    expect(notice.result.current).toBeNull();

    lounge();
    act(() => serverEvent.handler!());
    expect(screen.queryByText(/desktop app just signed in/i)).toBeNull();
    expect(notice.result.current?.message).toMatch(/desktop app just signed in/i);
  });
});
