/**
 * The voice channels the new shell has seen, so `chooseShell` leaves their route to the old shell.
 *
 * `/community/:communityId/channel/:channelId` is one pattern for text and voice channels. The new shell's chat
 * serves a text channel only; a voice channel's route is the old shell's call view (the classic phone's stage with
 * Join, or the call's video), which the call bar's "Open call view" leads to. The path alone cannot tell them apart,
 * so the new shell's community pieces note the voice channels of each channel list they load (`noteVoiceChannels`),
 * and a real route whose `:channelId` is one of them is the old shell's. A cold link to a voice channel shows the new
 * shell until the community's channel list is in, then the old shell.
 *
 * Eager and dependency-free (React only): `useShellChoice` reads it on the first page load. It holds channel ids, so
 * the shared session teardown forgets it (`clearShellSessionState`).
 */
import { useSyncExternalStore } from 'react';

let known: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Adds voice channel ids. A new snapshot (and a re-render of the shell choice) only when one was not known. */
export function noteVoiceChannels(ids: Iterable<string>): void {
  let next: Set<string> | null = null;
  for (const id of ids) {
    if (known.has(id) || next?.has(id)) continue;
    next ??= new Set(known);
    next.add(id);
  }
  if (next === null) return;
  known = next;
  emit();
}

/** The voice channel ids noted so far (an immutable snapshot). */
export function knownVoiceChannels(): ReadonlySet<string> {
  return known;
}

/** Forgets every noted id (the session ended). */
export function forgetVoiceChannels(): void {
  if (known.size === 0) return;
  known = new Set();
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The noted voice channel ids, re-rendering when one is added or the session ends. */
export function useKnownVoiceChannels(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, knownVoiceChannels, knownVoiceChannels);
}
