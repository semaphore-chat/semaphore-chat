/**
 * What the new shell's banner row shows, from the headless state both shells share (data/), and which
 * of it fits (review I7). The view (ShellBanners) takes the model as closed props, so stories render
 * every state without a store.
 */
import { useEffect, useState } from 'react';
import type { WidthRange } from '../../../kit';
import { useConnectionState } from '../../../data/connection';
import { useIncomingCallPrompt } from '../../../data/incomingCall';
import { useAppUpdate } from '../../../data/appUpdate';
import { useDesktopSignInBanner } from '../../../data/signInNotice';
import { useBrowserOnline, useInstallOffer, useWebUpdate } from '../../../data/pwa';

/** Why the app cannot talk to the server: the browser has no network, the server cannot be reached, or the first connect is slow. */
export type ConnectionProblem = 'offline' | 'unreachable' | 'connecting';

export interface ShellBannersModel {
  /** A direct-message call ringing. */
  incomingCall: { callerName: string; groupName: string; onJoin(): void; onDecline(): void } | null;
  connection: ConnectionProblem | null;
  /** A desktop app signed in to the account. */
  signIn: { message: string; onDismiss(): void } | null;
  /** The desktop app's update, while there is one to tell about. */
  update:
    | { state: 'downloading'; progress: number }
    | { state: 'ready'; version: string | null; onRestart(): void }
    | { state: 'error'; onDismiss(): void }
    | null;
  /** A new web version is waiting (the service worker); never during a call. */
  webUpdate: { onReload(): void } | null;
  /** The offer to install the app; on iOS the manual steps instead of Install. */
  install: { ios: boolean; onInstall(): void; onDismiss(): void } | null;
}

export const NO_BANNERS: ShellBannersModel = {
  incomingCall: null,
  connection: null,
  signIn: null,
  update: null,
  webUpdate: null,
  install: null,
};

/** One banner of the row, most urgent first (the order of this list). */
export type BannerKind =
  | 'incomingCall'
  | 'connection'
  | 'signIn'
  | 'updateError'
  | 'updateReady'
  | 'webUpdate'
  | 'install'
  | 'downloading';

/** Quiet notes: shown only when nothing else is. */
const QUIET: ReadonlySet<BannerKind> = new Set(['install', 'downloading']);

/** Most banners at once: two below wide (a phone, a tablet), three at wide. */
export function bannerCap(range: WidthRange): number {
  return range === 'wide' ? 3 : 2;
}

/**
 * The banners that show, in order (the rule in design/guide/layouts.md, "The banner row"): by priority,
 * at most `bannerCap(range)`; the quiet ones (install offer, download progress) only when nothing else
 * shows; the web update's Reload waits while offline (it would fail). What does not fit stays pending
 * and shows when a higher one goes.
 */
export function visibleBanners(model: ShellBannersModel, range: WidthRange): BannerKind[] {
  const present = presentBanners(model);
  const loud = present.filter((kind) => !QUIET.has(kind));
  return (loud.length > 0 ? loud : present).slice(0, bannerCap(range));
}

/** Every banner the model holds, by priority, before the cap. */
export function presentBanners(model: ShellBannersModel): BannerKind[] {
  const present: BannerKind[] = [];
  if (model.incomingCall) present.push('incomingCall');
  if (model.connection) present.push('connection');
  if (model.signIn) present.push('signIn');
  if (model.update?.state === 'error') present.push('updateError');
  if (model.update?.state === 'ready') present.push('updateReady');
  if (model.webUpdate && model.connection !== 'offline') present.push('webUpdate');
  if (model.install) present.push('install');
  if (model.update?.state === 'downloading') present.push('downloading');
  return present;
}

/** How long a reconnect or a first connect may take before the row says so (a blip pushes nothing). */
export const CONNECTION_GRACE_MS = 1500;

/** The connection problem, after the grace period for the server ones; the browser offline at once. */
function useConnectionProblem(): ConnectionProblem | null {
  const online = useBrowserOnline();
  const state = useConnectionState();
  const [lasting, setLasting] = useState<'connecting' | 'reconnecting' | null>(null);
  useEffect(() => {
    if (state === 'connected') {
      setLasting(null);
      return undefined;
    }
    const timer = setTimeout(() => setLasting(state), CONNECTION_GRACE_MS);
    return () => clearTimeout(timer);
  }, [state]);
  if (!online) return 'offline';
  if (state === 'connected' || lasting !== state) return null;
  return state === 'reconnecting' ? 'unreachable' : 'connecting';
}

export function useShellBannersModel(): ShellBannersModel {
  const call = useIncomingCallPrompt();
  const connection = useConnectionProblem();
  const signIn = useDesktopSignInBanner();
  const update = useAppUpdate();
  const webUpdate = useWebUpdate();
  const installOffer = useInstallOffer();
  return {
    incomingCall: call && {
      callerName: call.callerName,
      groupName: call.groupName,
      onJoin: () => void call.accept(),
      onDecline: call.decline,
    },
    connection,
    signIn: signIn && { message: signIn.message, onDismiss: signIn.dismiss },
    update:
      update.state === 'ready'
        ? { state: 'ready', version: update.version, onRestart: update.install }
        : update.state === 'error'
          ? { state: 'error', onDismiss: update.dismissError }
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
