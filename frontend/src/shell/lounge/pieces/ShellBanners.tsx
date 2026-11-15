/**
 * The new shell's banner row (AppFrame `banner`, design §3.7): kit Alerts for what concerns the whole
 * app, most urgent first, as many as fit (`visibleBanners`). The old-look views of the same things (the
 * reconnecting chip, the incoming call strip, the update snackbars, the sign-in snackbar, AppChrome's
 * offline strip, web update toast and install prompt) render nothing while this shell is shown.
 *
 * Read out once: a banner that mounts again after a shell flip is shown quietly (shell/bannerMemory.ts).
 * The connection banners are always quiet notes, said politely once when they appear: only a danger state
 * interrupts.
 */
import { useEffect, useState, type JSX } from 'react';
import { Alert, useAnnounce, useWidthRange } from '../../../kit';
import { forgetAnnouncementsExcept, takeFirstAnnouncement } from '../../bannerMemory';
import { presentBanners, visibleBanners, type BannerKind, type ConnectionProblem, type ShellBannersModel } from './shellBannersModel';

const CONNECTION_TEXT: Record<ConnectionProblem, { severity: 'warning' | 'info'; text: string }> = {
  offline: { severity: 'warning', text: "You're offline. Semaphore Chat reconnects when your network is back." },
  unreachable: { severity: 'warning', text: "Can't reach the server. Reconnecting…" },
  connecting: { severity: 'info', text: 'Connecting…' },
};

/** The key a notice is remembered by: a different call, or a different connection problem, is a new notice. */
function announcementKey(kind: BannerKind, model: ShellBannersModel): string {
  if (kind === 'incomingCall') return `call:${model.incomingCall?.callerName}:${model.incomingCall?.groupName}`;
  if (kind === 'connection') return `connection:${model.connection}`;
  return kind;
}

/** Whether this mount of a banner is the first time its notice shows (then it is announced). */
function useFirstShowing(key: string): boolean {
  const [first] = useState(() => takeFirstAnnouncement(key));
  return first;
}

function ConnectionBanner({ problem }: { problem: ConnectionProblem }): JSX.Element {
  const first = useFirstShowing(`connection:${problem}`);
  const announce = useAnnounce();
  const { severity, text } = CONNECTION_TEXT[problem];
  useEffect(() => {
    if (first) announce(text, 'polite');
  }, [first, announce, text]);
  return (
    <Alert severity={severity} announce={false}>
      {text}
    </Alert>
  );
}

function CallBanner({ call }: { call: NonNullable<ShellBannersModel['incomingCall']> }): JSX.Element {
  const first = useFirstShowing(`call:${call.callerName}:${call.groupName}`);
  return (
    <Alert
      severity="info"
      title={`${call.callerName} is calling`}
      action={{ label: 'Join', onClick: call.onJoin }}
      secondaryAction={{ label: 'Decline', onClick: call.onDecline }}
      announce={first}
    >
      {call.groupName && call.groupName !== call.callerName ? `Voice call in ${call.groupName}` : 'Voice call'}
    </Alert>
  );
}

/** A banner read out on its first showing only. */
function OnceAlert(props: Parameters<typeof Alert>[0] & { memory: string }): JSX.Element {
  const { memory, ...alert } = props;
  const first = useFirstShowing(memory);
  return <Alert {...alert} announce={alert.announce === false ? false : first} />;
}

export function ShellBanners(model: ShellBannersModel): JSX.Element {
  const range = useWidthRange();
  const visible = visibleBanners(model, range);
  const { incomingCall, connection, signIn, update, webUpdate, install } = model;

  // A notice that went is new again when it comes back.
  const presentSignature = presentBanners(model)
    .map((kind) => announcementKey(kind, model))
    .sort()
    .join('|');
  useEffect(() => {
    forgetAnnouncementsExcept(new Set(presentSignature.split('|')));
  }, [presentSignature]);

  return (
    <>
      {visible.map((kind) => {
        switch (kind) {
          case 'incomingCall':
            return incomingCall && <CallBanner key={kind} call={incomingCall} />;
          case 'connection':
            return connection && <ConnectionBanner key={`${kind}:${connection}`} problem={connection} />;
          case 'signIn':
            return (
              signIn && (
                <OnceAlert key={kind} memory={kind} severity="warning" onClose={signIn.onDismiss}>
                  {signIn.message}
                </OnceAlert>
              )
            );
          case 'updateError':
            return (
              update?.state === 'error' && (
                <OnceAlert
                  key={kind}
                  memory={kind}
                  severity="danger"
                  title="Couldn't download the update"
                  onClose={update.onDismiss}
                >
                  It tries again the next time the app starts.
                </OnceAlert>
              )
            );
          case 'updateReady':
            return (
              update?.state === 'ready' && (
                <OnceAlert
                  key={kind}
                  memory={kind}
                  severity="success"
                  title="Update ready"
                  action={{ label: 'Restart now', onClick: update.onRestart }}
                >
                  {update.version
                    ? `Version ${update.version} is ready. The app restarts to install it.`
                    : 'The update is ready. The app restarts to install it.'}
                </OnceAlert>
              )
            );
          case 'webUpdate':
            return (
              webUpdate && (
                <OnceAlert
                  key={kind}
                  memory={kind}
                  severity="info"
                  title="Update available"
                  action={{ label: 'Reload', onClick: webUpdate.onReload }}
                >
                  A new version of Semaphore Chat is ready.
                </OnceAlert>
              )
            );
          case 'install':
            return (
              install && (
                <Alert
                  key={kind}
                  severity="info"
                  title="Install Semaphore Chat"
                  action={install.ios ? undefined : { label: 'Install', onClick: install.onInstall }}
                  onClose={install.onDismiss}
                  // Offered on load, not caused by anything the user did: a quiet note.
                  announce={false}
                >
                  {install.ios
                    ? 'In Safari, tap Share, then Add to Home Screen.'
                    : 'Add it to your home screen to open it like an app.'}
                </Alert>
              )
            );
          case 'downloading':
            return (
              update?.state === 'downloading' && (
                <Alert key={kind} severity="info" announce={false}>
                  {`Downloading an update (${Math.round(update.progress)}%)`}
                </Alert>
              )
            );
        }
      })}
    </>
  );
}
