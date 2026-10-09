import { getInstanceUrl } from '../config/env';

/** Link a channel member can open to land in this voice channel (HashRouter path). */
export function voiceChannelLink(communityId: string, channelId: string): string {
  return `${getInstanceUrl()}/#/community/${communityId}/channel/${channelId}`;
}
