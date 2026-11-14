/**
 * Which URLs are the app itself, where the main window may navigate, and
 * which IPC senders are trusted. Pure (no Electron imports) so it can be
 * unit-tested; main.ts builds one policy from the app's paths.
 */
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

/** The Vite dev server `pnpm run electron-dev` loads (unpackaged builds only). */
export const DEV_SERVER_ORIGIN = 'http://localhost:5173';

export interface AppUrlPolicyOptions {
  /** The directory production loads `index.html` from (`<appPath>/dist`). */
  distDir: string;
  /** Whether the dev server counts as the app: true only in unpackaged builds. */
  devServerAllowed: boolean;
  /** Resolves symlinks; injectable for tests. Defaults to fs.realpathSync. */
  realPath?: (p: string) => string;
}

/** The parts of Electron's WebFrameMain the sender check reads. */
export interface FrameLike {
  url: string;
  processId: number;
  routingId: number;
}

export interface AppUrlPolicy {
  isAppOrigin(urlOrOrigin: string): boolean;
  isAllowedNavigation(url: string): boolean;
  isTrustedSender(senderFrame: FrameLike | null | undefined, mainFrame: FrameLike | null | undefined): boolean;
}

export function createAppUrlPolicy(options: AppUrlPolicyOptions): AppUrlPolicy {
  const realPath = options.realPath ?? fs.realpathSync;

  /**
   * The resolved real path, falling back to the normalized path when it
   * can't be resolved (e.g. doesn't exist).
   */
  const toRealPath = (p: string): string => {
    try {
      return realPath(p);
    } catch {
      return path.resolve(p);
    }
  };

  /**
   * Whether a filesystem path lives inside the app's `dist` directory.
   * Compared on resolved real paths so symlinks, `..` segments and Windows
   * drive-letter casing can't bypass the check (Node's win32 `path.relative`
   * compares case-insensitively).
   */
  const isPathInsideAppDist = (fsPath: string): boolean => {
    const rel = path.relative(toRealPath(options.distDir), toRealPath(fsPath));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  };

  /**
   * Whether a URL belongs to the app itself, as opposed to a remote page
   * loaded via window-open/will-navigate. Gates media/display-capture/
   * fullscreen permission grants and IPC senders.
   *
   * - Production: `loadFile(<appPath>/dist/index.html)` → a `file://` URL
   *   whose path must resolve inside `dist`. An arbitrary `file:` URL (or a
   *   bare `file://` origin, which carries no path) is NOT the app.
   * - Development: `http://localhost:5173`.
   */
  const isAppOrigin = (urlOrOrigin: string): boolean => {
    if (!urlOrOrigin) return false;
    try {
      const parsed = new URL(urlOrOrigin);
      if (parsed.protocol === 'file:') {
        // fileURLToPath handles platform normalization (Windows drive
        // letters, percent-decoding). It throws for a pathless origin like
        // 'file://', which correctly fails closed below.
        return isPathInsideAppDist(fileURLToPath(parsed));
      }
      return options.devServerAllowed && parsed.origin === DEV_SERVER_ORIGIN;
    } catch {
      return false;
    }
  };

  /**
   * Where the main window may navigate: only the app's own entry, i.e. the
   * packaged `dist/index.html` (any hash route or query), or the dev server
   * in unpackaged builds. Hash-route changes don't fire will-navigate.
   */
  const isAllowedNavigation = (url: string): boolean => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'file:') {
        const rel = path.relative(
          toRealPath(options.distDir),
          toRealPath(fileURLToPath(parsed)),
        );
        return rel === 'index.html';
      }
      return options.devServerAllowed && parsed.origin === DEV_SERVER_ORIGIN;
    } catch {
      return false;
    }
  };

  /**
   * Whether an IPC message comes from the app's own page: the main window's
   * top frame (not a subframe), currently showing the app.
   */
  const isTrustedSender = (
    senderFrame: FrameLike | null | undefined,
    mainFrame: FrameLike | null | undefined,
  ): boolean => {
    if (!senderFrame || !mainFrame) return false;
    if (senderFrame.processId !== mainFrame.processId || senderFrame.routingId !== mainFrame.routingId) {
      return false;
    }
    return isAppOrigin(senderFrame.url);
  };

  return { isAppOrigin, isAllowedNavigation, isTrustedSender };
}
