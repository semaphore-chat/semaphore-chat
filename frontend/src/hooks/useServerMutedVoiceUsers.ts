import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { voicePresenceControllerGetChannelPresenceOptions } from '../api-client/@tanstack/react-query.gen';

const EMPTY: ReadonlySet<string> = new Set();

/**
 * User ids a moderator has server-muted in a voice channel. LiveKit doesn't
 * carry server-mute, so this reads the REST voice-presence cache, which the
 * socket hub keeps current from `voiceChannelUserUpdated` (see
 * socket-hub/handlers/voiceHandlers.ts). `channelId` null (DM call, not
 * connected) disables it.
 */
export function useServerMutedVoiceUsers(channelId: string | null | undefined): ReadonlySet<string> {
  const { data } = useQuery({
    ...voicePresenceControllerGetChannelPresenceOptions({ path: { channelId: channelId ?? '' } }),
    enabled: !!channelId,
  });
  return useMemo(() => {
    if (!data?.users) return EMPTY;
    const muted = data.users.filter((u) => u.isServerMuted).map((u) => u.id);
    return muted.length ? new Set(muted) : EMPTY;
  }, [data]);
}
