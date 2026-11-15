/**
 * The new shell's banner row (shell/lounge/pieces/ShellBanners.tsx) in AppFrame's `banner` slot:
 * an incoming call, offline, a desktop sign-in, the desktop app's update (downloading, ready,
 * failed), the web app's update, the offer to install it, and several at once, which stack most
 * urgent first. The island below stands for the
 * screen the row sits above.
 */
import type { JSX } from 'react';
import { AppFrame, Island, Text } from '../../kit';
import { ShellBanners } from '../../shell/lounge/pieces/ShellBanners';
import { NO_BANNERS, type ShellBannersModel } from '../../shell/lounge/pieces/shellBannersModel';
import type { ModeName } from '../../theme/derive/derivePalette';
import { KitFrameStage } from '../fixtures/kitStory';

const noop = () => undefined;

const incomingCall: ShellBannersModel['incomingCall'] = { callerName: 'pri', onJoin: noop, onDecline: noop };
const signIn: ShellBannersModel['signIn'] = {
  message: "A desktop app just signed in to your account. If this wasn't you, change your password.",
  onDismiss: noop,
};
const downloading: ShellBannersModel['update'] = { state: 'downloading', progress: 42 };
const ready: ShellBannersModel['update'] = { state: 'ready', version: '0.11.0', onRestart: noop };
const failed: ShellBannersModel['update'] = { state: 'error', message: 'Cannot download update', onDismiss: noop };
const webUpdate: ShellBannersModel['webUpdate'] = { onReload: noop };
const install: ShellBannersModel['install'] = { ios: false, onInstall: noop, onDismiss: noop };
const installIos: ShellBannersModel['install'] = { ios: true, onInstall: noop, onDismiss: noop };

function Row({ mode, model }: { mode: ModeName; model: Partial<ShellBannersModel> }): JSX.Element {
  return (
    <KitFrameStage mode={mode}>
      <AppFrame banner={<ShellBanners {...NO_BANNERS} {...model} />}>
        <Island as="main" label="Couch Co-op" scroll>
          <Text variant="title" as="h1">
            Couch Co-op
          </Text>
          <Text tone="secondary">The screen below the banner row keeps the rest of the frame.</Text>
        </Island>
      </AppFrame>
    </KitFrameStage>
  );
}

/** A direct-message call ringing: Join and Decline. */
export const Incoming = () => <Row mode="dark" model={{ incomingCall }} />;

/** The connection is down. */
export const Offline = () => <Row mode="dark" model={{ offline: true }} />;

/** A desktop app signed in to the account: stays until dismissed. */
export const SignIn = () => <Row mode="dark" model={{ signIn }} />;

/** The desktop app's update downloading (a quiet note). */
export const UpdateDownloading = () => <Row mode="dark" model={{ update: downloading }} />;

/** The update downloaded: Restart now. */
export const UpdateReady = () => <Row mode="dark" model={{ update: ready }} />;

/** The download failed. */
export const UpdateError = () => <Row mode="dark" model={{ update: failed }} />;

/** Two at once: the call above the offline notice. */
export const TwoAtOnce = () => <Row mode="dark" model={{ incomingCall, offline: true }} />;

/** Two at once, light. */
export const TwoAtOnceLight = () => <Row mode="light" model={{ incomingCall, offline: true }} />;

/** Every kind at once, light: the order, and how much of the frame the row can take. */
export const AllLight = () => (
  <Row mode="light" model={{ incomingCall, offline: true, signIn, update: ready, webUpdate, install }} />
);

/** A new web version is waiting (the browser app): Reload. */
export const WebUpdate = () => <Row mode="dark" model={{ webUpdate }} />;

/** The web update, light. */
export const WebUpdateLight = () => <Row mode="light" model={{ webUpdate }} />;

/** The offer to install the app: a quiet note with Install and Dismiss. */
export const Install = () => <Row mode="dark" model={{ install }} />;

/** The install offer on iOS: the manual steps, no Install button. */
export const InstallIos = () => <Row mode="dark" model={{ install: installIos }} />;

/** The install offer, light. */
export const InstallLight = () => <Row mode="light" model={{ install }} />;

/** The update downloading, light. */
export const UpdateDownloadingLight = () => <Row mode="light" model={{ update: downloading }} />;

/** The download failed, light. */
export const UpdateErrorLight = () => <Row mode="light" model={{ update: failed }} />;
