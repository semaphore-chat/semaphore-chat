/**
 * Which shell is on screen right now, for the global chrome that sits above AppShell and so cannot
 * read `ShellKindContext`: the reconnecting chip and the notification snackbar (AuthGate), the
 * auto-updater (App), the incoming-call banner (LayoutProviders). Those old-look views render
 * nothing while the new design's shell is shown; the new shell draws its own (ShellBanners, kit toasts).
 *
 * "Shown" means the new shell has committed to the screen: its ShellEffects (shell/lounge/frame) publishes
 * `'lounge'` in a layout effect when it mounts and `'classic'` when it unmounts (or when Suspense hides it). While the new
 * shell's chunk loads, or after it crashed, the old-look fallbacks show and the value stays `'classic'`.
 * With the new design off nothing ever publishes, so it is `'classic'` for good.
 *
 * Eager and tiny: no React tree, no kit.
 */
import { useSyncExternalStore } from 'react';
import type { ShellKind } from './shellKind';

let shown: ShellKind = 'classic';
const listeners = new Set<() => void>();

export function publishShownShellKind(kind: ShellKind): void {
  if (kind === shown) return;
  shown = kind;
  listeners.forEach((listener) => listener());
}

export function readShownShellKind(): ShellKind {
  return shown;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The shell on screen. `'classic'` unless the new design's shell is mounted and shown. */
export function useShownShellKind(): ShellKind {
  return useSyncExternalStore(subscribe, readShownShellKind, () => 'classic');
}
