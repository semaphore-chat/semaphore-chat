/**
 * The new shell's banner row (AppFrame `banner`, design §3.7): kit Alerts for what concerns the whole
 * app, most urgent first. The old-look views of the same things (the reconnecting chip, the incoming
 * call strip, the update snackbars, the sign-in snackbar, AppChrome's offline strip, web update toast
 * and install prompt) render nothing while this shell is shown.
 */
import type { JSX } from 'react';
import { Alert } from '../../../kit';
import type { ShellBannersModel } from './shellBannersModel';

export function ShellBanners({ incomingCall, offline, signIn, update, webUpdate, install }: ShellBannersModel): JSX.Element {
  return (
    <>
      {incomingCall && (
        <Alert
          severity="info"
          title={incomingCall.callerName}
          action={{ label: 'Join', onClick: incomingCall.onJoin }}
          secondaryAction={{ label: 'Decline', onClick: incomingCall.onDecline }}
        >
          Incoming voice call
        </Alert>
      )}
      {offline && <Alert severity="warning">You&apos;re offline. Reconnecting…</Alert>}
      {signIn && (
        <Alert severity="warning" onClose={signIn.onDismiss}>
          {signIn.message}
        </Alert>
      )}
      {update?.state === 'downloading' && (
        <Alert severity="info" announce={false}>
          {`Downloading an update (${Math.round(update.progress)}%)`}
        </Alert>
      )}
      {update?.state === 'ready' && (
        <Alert severity="success" title="Update ready" action={{ label: 'Restart now', onClick: update.onRestart }}>
          {update.version
            ? `Version ${update.version} is ready. The app restarts to install it.`
            : 'The update is ready. The app restarts to install it.'}
        </Alert>
      )}
      {update?.state === 'error' && (
        <Alert severity="danger" title="Couldn't download the update" onClose={update.onDismiss}>
          {update.message}
        </Alert>
      )}
      {webUpdate && (
        <Alert severity="info" title="Update available" action={{ label: 'Reload', onClick: webUpdate.onReload }}>
          A new version of Semaphore Chat is ready.
        </Alert>
      )}
      {install && (
        <Alert
          severity="info"
          title="Install Semaphore Chat"
          action={install.ios ? undefined : { label: 'Install', onClick: install.onInstall }}
          onClose={install.onDismiss}
          // Offered on load, not caused by anything the user did: a quiet note, not read out on every visit.
          announce={false}
        >
          {install.ios
            ? 'In Safari, tap Share, then Add to Home Screen.'
            : 'Add it to your home screen to open it like an app.'}
        </Alert>
      )}
    </>
  );
}
