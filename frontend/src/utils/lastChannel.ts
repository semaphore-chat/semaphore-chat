/**
 * Last-visited text channel per user and community, so opening a community
 * lands on a channel instead of an empty placeholder. Kept in localStorage
 * (best effort: storage can be blocked or full, and the app works without it).
 */
import { ChannelType } from '../types/channel.type';
import type { Channel } from '../types/channel.type';

const keyFor = (userId: string, communityId: string) => `lastChannel:${userId}:${communityId}`;

export function getLastChannelId(userId: string | undefined, communityId: string): string | null {
  if (!userId) return null;
  try {
    return localStorage.getItem(keyFor(userId, communityId));
  } catch {
    return null;
  }
}

export function setLastChannelId(userId: string | undefined, communityId: string, channelId: string): void {
  if (!userId) return;
  try {
    localStorage.setItem(keyFor(userId, communityId), channelId);
  } catch {
    // Storage blocked or full: the redirect just falls back to the first channel.
  }
}

/**
 * The channel to open when a community is opened with none selected: the
 * remembered one if it is still a visible text channel, else the first
 * visible text channel by position. Null when there is none to open.
 */
export function pickInitialChannel(
  channels: readonly Channel[] | undefined,
  lastChannelId: string | null,
): Channel | null {
  const text = (channels ?? [])
    .filter((c) => c.type === ChannelType.TEXT)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  return text.find((c) => c.id === lastChannelId) ?? text[0] ?? null;
}
