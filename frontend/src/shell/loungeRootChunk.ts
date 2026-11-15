/**
 * The one loader of the new shell's chunk, shared by AppShell's `lazy()` and the
 * preload in useShellChoice, so both resolve to the same module request.
 */
export const loadLoungeRoot = () => import('./lounge/LoungeRoot');
