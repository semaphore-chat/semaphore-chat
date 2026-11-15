/**
 * What the new shell's banner row shows, from the headless state both shells share (data/). The
 * view (ShellBanners) takes this as closed props, so stories render every state without a store.
 */
import { useConnectionState } from '../../../data/connection';
import { useIncomingCallPrompt } from '../../../data/incomingCall';
import { useAppUpdate } from '../../../data/appUpdate';
import { useDesktopSignInBanner } from '../../../data/signInNotice';
import { useBrowserOnline, useInstallOffer, useWebUpdate } from '../../../data/pwa';

export interface ShellBannersModel {
  /** A direct-message call ringing. */
  incomingCall: { callerName: string; onJoin(): void; onDecline(): void } | null;
  /** The connection to the server is down, or the browser has no network. */
  offline: boolean;
  /** A desktop app signed in to the account. */
  signIn: { message: string; onDismiss(): void } | null;
  /** The desktop app's update, while there is one to tell about. */
  update:
    | { state: 'downloading'; progress: number }
    | { state: 'ready'; version: string | null; onRestart(): void }
    | { state: 'error'; message: string; onDismiss(): void }
    | null;
  /** A new web version is waiting (the service worker); never during a call. */
  webUpdate: { onReload(): void } | null;
  /** The offer to install the app; on iOS the manual steps instead of Install. */
  install: { ios: boolean; onInstall(): void; onDismiss(): void } | null;
}

export const NO_BANNERS: ShellBannersModel = {
  incomingCall: null,
  offline: false,
  signIn: null,
  update: null,
  webUpdate: null,
  install: null,
};

/** Whether the row has anything: the frame leaves the row (and its gap) out otherwise. */
export function hasBanners(model: ShellBannersModel): boolean {
  return (
    model.incomingCall !== null ||
    model.offline ||
    model.signIn !== null ||
    model.update !== null ||
    model.webUpdate !== null ||
    model.install !== null
  );
}

export function useShellBannersModel(): ShellBannersModel {
  const call = useIncomingCallPrompt();
  const connection = useConnectionState();
  const signIn = useDesktopSignInBanner();
  const update = useAppUpdate();
  const online = useBrowserOnline();
  const webUpdate = useWebUpdate();
  const installOffer = useInstallOffer();
  return {
    incomingCall: call && {
      callerName: call.callerName,
      onJoin: () => void call.accept(),
      onDecline: call.decline,
    },
    offline: connection === 'reconnecting' || !online,
    signIn: signIn && { message: signIn.message, onDismiss: signIn.dismiss },
    update:
      update.state === 'ready'
        ? { state: 'ready', version: update.version, onRestart: update.install }
        : update.state === 'error'
          ? { state: 'error', message: update.errorMessage ?? '', onDismiss: update.dismissError }
          : update.state === 'downloading'
            ? { state: 'downloading', progress: update.progress }
            : null,
    webUpdate: webUpdate && { onReload: webUpdate.reload },
    install: installOffer && {
      ios: installOffer.ios,
      onInstall: () => {
        if (!installOffer.installing) void installOffer.install();
      },
      onDismiss: installOffer.dismiss,
    },
  };
}
