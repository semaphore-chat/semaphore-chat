/**
 * Linux password-store selection for Electron's `safeStorage` (issue #549).
 *
 * On Linux, Chromium picks the backend `safeStorage` encrypts with from the
 * desktop environment alone: GNOME/Unity/XFCE/... get `gnome-libsecret`,
 * KDE gets KWallet, and every desktop it doesn't know (Hyprland, Sway, i3,
 * niri, ...) gets `basic`, a plain-text store that `safeStorage` reports as
 * unavailable. It never checks whether a Secret Service is actually running,
 * so on those desktops the refresh token ends up unencrypted even though
 * gnome-keyring or KeePassXC is serving `org.freedesktop.secrets`.
 *
 * `choosePasswordStore()` decides, before `app` is ready, whether to pass
 * `--password-store=gnome-libsecret`: only on Linux, only when the user didn't
 * choose a store themselves, only when Chromium would fall back to `basic`,
 * and only when a Secret Service is on the session bus. Anything else leaves
 * Chromium's choice alone (KDE keeps KWallet; no keyring stays `basic` and the
 * app's "secure storage unavailable" warning still appears).
 *
 * Kept free of `electron` imports so it can be unit tested from the frontend
 * vitest suite; the D-Bus probe is injected.
 */
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';

/** The Secret Service API's well-known D-Bus name. */
export const SECRET_SERVICE_NAME = 'org.freedesktop.secrets';

export type Env = Readonly<Record<string, string | undefined>>;

/**
 * Whether Chromium would choose its plain-text `basic` store for this
 * environment, i.e. no keyring backend.
 *
 * Mirrors Chromium's `base::nix::GetDesktopEnvironment()` (base/nix/xdg_util.cc)
 * and `os_crypt::SelectBackend()` (components/os_crypt/sync/key_storage_util_linux.cc):
 * - XDG_CURRENT_DESKTOP, a colon-separated list, first recognised entry wins:
 *   Unity, Deepin, GNOME, X-Cinnamon, Pantheon, XFCE, UKUI, COSMIC -> libsecret;
 *   KDE -> KWallet; LXQt -> basic.
 * - Then DESKTOP_SESSION: deepin, gnome, mate, *xfce*, xubuntu, ukui -> libsecret;
 *   kde4, kde-plasma, kde (with KDE_SESSION_VERSION) -> KWallet; kde -> KDE3 (basic).
 * - Then GNOME_DESKTOP_SESSION_ID -> libsecret; KDE_FULL_SESSION -> KWallet
 *   (with KDE_SESSION_VERSION) or KDE3 (basic).
 * - Anything else -> basic.
 */
export function chromiumUsesBasicStore(env: Env): boolean {
  const xdg = (env.XDG_CURRENT_DESKTOP ?? '')
    .split(':')
    .map((value) => value.trim())
    .filter(Boolean);
  for (const value of xdg) {
    switch (value) {
      case 'Unity':
      case 'Deepin':
      case 'GNOME':
      case 'X-Cinnamon':
      case 'KDE':
      case 'Pantheon':
      case 'XFCE':
      case 'UKUI':
      case 'COSMIC':
        return false;
      case 'LXQt':
        return true;
    }
  }

  const session = env.DESKTOP_SESSION ?? '';
  if (['deepin', 'gnome', 'mate', 'kde4', 'kde-plasma', 'xubuntu', 'ukui'].includes(session)) {
    return false;
  }
  if (session.includes('xfce')) return false;
  if (session === 'kde') return env.KDE_SESSION_VERSION === undefined; // KDE3 -> basic

  if (env.GNOME_DESKTOP_SESSION_ID !== undefined) return false;
  if (env.KDE_FULL_SESSION !== undefined) return env.KDE_SESSION_VERSION === undefined;

  return true;
}

export interface PasswordStoreInput {
  platform: NodeJS.Platform;
  env: Env;
  /** True when the user passed `--password-store` on the command line. */
  hasUserPasswordStore: boolean;
  /** Is a Secret Service on the session bus? `null` when that can't be determined. */
  probeSecretService: () => boolean | null;
}

export interface PasswordStoreDecision {
  /** The `--password-store` value to append, or null to leave Chromium's choice. */
  passwordStore: 'gnome-libsecret' | null;
  reason: string;
}

export function choosePasswordStore(input: PasswordStoreInput): PasswordStoreDecision {
  if (input.platform !== 'linux') {
    return { passwordStore: null, reason: 'not Linux' };
  }
  if (input.hasUserPasswordStore) {
    return { passwordStore: null, reason: '--password-store passed by the user' };
  }
  if (!chromiumUsesBasicStore(input.env)) {
    return { passwordStore: null, reason: 'Chromium picks a keyring for this desktop' };
  }
  const desktop = input.env.XDG_CURRENT_DESKTOP || 'unset';
  const secretService = input.probeSecretService();
  if (secretService === null) {
    return {
      passwordStore: null,
      reason: `desktop ${desktop}: could not query the session bus for ${SECRET_SERVICE_NAME}`,
    };
  }
  if (!secretService) {
    return { passwordStore: null, reason: `desktop ${desktop}: no ${SECRET_SERVICE_NAME} on the session bus` };
  }
  return {
    passwordStore: 'gnome-libsecret',
    reason: `desktop ${desktop} is unknown to Chromium but ${SECRET_SERVICE_NAME} is on the session bus`,
  };
}

/** Runs `dbus-send`; returns its stdout, or null on any failure. */
export type DbusSend = (args: string[]) => string | null;

const DBUS_TIMEOUT_MS = 1000;

const runDbusSend: DbusSend = (args) => {
  try {
    const result = spawnSync('dbus-send', [`--reply-timeout=${DBUS_TIMEOUT_MS}`, ...args], {
      encoding: 'utf8',
      timeout: DBUS_TIMEOUT_MS + 500,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.error || result.status !== 0) return null;
    return result.stdout;
  } catch {
    return null;
  }
};

const BUS_ARGS = [
  '--session',
  '--print-reply',
  '--dest=org.freedesktop.DBus',
  '/org/freedesktop/DBus',
];

/**
 * Is a Secret Service running (`NameHasOwner`) or D-Bus-activatable
 * (`ListActivatableNames`, e.g. gnome-keyring started on demand)?
 * Returns null when `dbus-send` is missing, errors or times out, or there is
 * no session bus.
 */
export function probeSecretService(
  env: Env,
  dbusSend: DbusSend = runDbusSend,
  fileExists: (path: string) => boolean = existsSync,
): boolean | null {
  // No session bus to talk to (neither an address nor the systemd user bus
  // socket that libdbus/GDBus fall back to): don't let dbus-send try X11
  // autolaunch.
  const userBus = env.XDG_RUNTIME_DIR ? `${env.XDG_RUNTIME_DIR}/bus` : null;
  if (!env.DBUS_SESSION_BUS_ADDRESS && !(userBus && fileExists(userBus))) return null;

  const owned = dbusSend([...BUS_ARGS, 'org.freedesktop.DBus.NameHasOwner', `string:${SECRET_SERVICE_NAME}`]);
  if (owned === null) return null;
  if (/\bboolean\s+true\b/.test(owned)) return true;

  const activatable = dbusSend([...BUS_ARGS, 'org.freedesktop.DBus.ListActivatableNames']);
  if (activatable === null) return false;
  return activatable.includes(`"${SECRET_SERVICE_NAME}"`);
}
