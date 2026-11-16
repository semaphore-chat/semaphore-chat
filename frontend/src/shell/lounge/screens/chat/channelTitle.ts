/**
 * The chat screen's title (`useTitle`): "# name", the centre's label and what RouteFocus announces. Null while the
 * channel list loads, or for a channel the reader cannot see.
 */
import { useCommunityChannels } from '../../../../data/channels';
import type { Channel } from '../../../../types/channel.type';
import type { LoungeParams } from '../../screen';

/** The channel of the route, from the community's channel list (the left island's query, so no extra request). */
export function useRouteChannel(params: LoungeParams): { channel: Channel | null; loaded: boolean } {
  const channels = useCommunityChannels(params.communityId ?? '');
  const channel = channels.all?.find((c) => c.id === params.channelId) ?? null;
  return { channel, loaded: channels.status === 'success' };
}

export function channelTitle(channel: Pick<Channel, 'name'>): string {
  return `# ${channel.name}`;
}

export function useChannelTitle(params: LoungeParams): string | null {
  const { channel } = useRouteChannel(params);
  return channel === null ? null : channelTitle(channel);
}
