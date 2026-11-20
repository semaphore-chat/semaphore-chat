import { createContext, useContext } from 'react';

export type ShellKind = 'classic' | 'lounge';

/** Which shell is on screen, for global chrome (banners, toasts) that will pick a kit rendering later. */
export const ShellKindContext = createContext<ShellKind>('classic');

export function useShellKind(): ShellKind {
  return useContext(ShellKindContext);
}
