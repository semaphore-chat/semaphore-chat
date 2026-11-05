import type { QueryClient } from '@tanstack/react-query';
import type { ServerEvents, VoicePresenceUser } from '@semaphore-chat/shared';
import {
  voicePresenceControllerGetChannelPresenceQueryKey,
  dmVoicePresenceControllerGetDmPresenceQueryKey,
} from '../../api-client/@tanstack/react-query.gen';
import type { VoicePresenceUserDto, ChannelVoicePresenceResponseDto, DmVoicePresenceResponseDto } from '../../api-client/types.gen';
import type { SocketEventHandler } from './types';

function invalidateVoiceQueries(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: [{ _id: 'voicePresenceControllerGetChannelPresence' }] });
  queryClient.invalidateQueries({ queryKey: [{ _id: 'userVoicePresenceControllerGetMyVoiceChannels' }] });
  queryClient.invalidateQueries({ queryKey: [{ _id: 'dmVoicePresenceControllerGetDmPresence' }] });
}

/**
 * Normalizes the WebSocket presence-user payload into the REST DTO shape used
 * in the presence query caches. Over the wire joinedAt is always a serialized
 * ISO string and the flags are always present, so this is a type-level
 * normalization with no observable runtime change.
 */
function toPresenceUserDto(user: VoicePresenceUser): VoicePresenceUserDto {
  return {
    ...user,
    isDeafened: user.isDeafened ?? false,
    isServerMuted: user.isServerMuted ?? false,
  };
}

export const handleVoiceUserJoined: SocketEventHandler<typeof ServerEvents.VOICE_CHANNEL_USER_JOINED> = (
  data,
  queryClient: QueryClient,
) => {
  const queryKey = voicePresenceControllerGetChannelPresenceQueryKey({ path: { channelId: data.channelId } });
  const existing = queryClient.getQueryData<ChannelVoicePresenceResponseDto>(queryKey);

  if (existing) {
    const user = toPresenceUserDto(data.user);
    queryClient.setQueryData<ChannelVoicePresenceResponseDto>(queryKey, (draft) => {
      if (!draft) return draft;
      const existingIndex = draft.users.findIndex((u) => u.id === user.id);
      if (existingIndex === -1) {
        const newUsers = [...draft.users, user];
        return { ...draft, users: newUsers, count: newUsers.length };
      }
      return draft;
    });
  } else {
    invalidateVoiceQueries(queryClient);
  }
};

export const handleVoiceUserLeft: SocketEventHandler<typeof ServerEvents.VOICE_CHANNEL_USER_LEFT> = (
  data: { channelId: string; userId: string },
  queryClient: QueryClient,
) => {
  const queryKey = voicePresenceControllerGetChannelPresenceQueryKey({ path: { channelId: data.channelId } });
  const existing = queryClient.getQueryData<ChannelVoicePresenceResponseDto>(queryKey);

  if (existing) {
    queryClient.setQueryData<ChannelVoicePresenceResponseDto>(queryKey, (draft) => {
      if (!draft) return draft;
      const newUsers = draft.users.filter((u) => u.id !== data.userId);
      return { ...draft, users: newUsers, count: newUsers.length };
    });
  } else {
    invalidateVoiceQueries(queryClient);
  }
};

export const handleVoiceUserUpdated: SocketEventHandler<typeof ServerEvents.VOICE_CHANNEL_USER_UPDATED> = (
  data,
  queryClient: QueryClient,
) => {
  const queryKey = voicePresenceControllerGetChannelPresenceQueryKey({ path: { channelId: data.channelId } });
  const existing = queryClient.getQueryData<ChannelVoicePresenceResponseDto>(queryKey);

  if (existing) {
    const user = toPresenceUserDto(data.user);
    queryClient.setQueryData<ChannelVoicePresenceResponseDto>(queryKey, (draft) => {
      if (!draft) return draft;
      const index = draft.users.findIndex((u) => u.id === user.id);
      if (index !== -1) {
        const newUsers = [...draft.users];
        newUsers[index] = user;
        return { ...draft, users: newUsers };
      }
      return draft;
    });
  } else {
    invalidateVoiceQueries(queryClient);
  }
};

// =============================================================================
// DM Voice Presence Handlers
// =============================================================================

export const handleDmVoiceCallStarted: SocketEventHandler<typeof ServerEvents.DM_VOICE_CALL_STARTED> = (
  _data,
  queryClient: QueryClient,
) => {
  invalidateVoiceQueries(queryClient);
};

export const handleDmVoiceUserJoined: SocketEventHandler<typeof ServerEvents.DM_VOICE_USER_JOINED> = (
  data,
  queryClient: QueryClient,
) => {
  const queryKey = dmVoicePresenceControllerGetDmPresenceQueryKey({ path: { dmGroupId: data.dmGroupId } });
  const existing = queryClient.getQueryData<DmVoicePresenceResponseDto>(queryKey);

  if (existing) {
    const user = toPresenceUserDto(data.user);
    queryClient.setQueryData<DmVoicePresenceResponseDto>(queryKey, (draft) => {
      if (!draft) return draft;
      const existingIndex = draft.users.findIndex((u) => u.id === user.id);
      if (existingIndex === -1) {
        const newUsers = [...draft.users, user];
        return { ...draft, users: newUsers, count: newUsers.length };
      }
      return draft;
    });
  } else {
    invalidateVoiceQueries(queryClient);
  }
};

export const handleDmVoiceUserLeft: SocketEventHandler<typeof ServerEvents.DM_VOICE_USER_LEFT> = (
  data: { dmGroupId: string; userId: string },
  queryClient: QueryClient,
) => {
  const queryKey = dmVoicePresenceControllerGetDmPresenceQueryKey({ path: { dmGroupId: data.dmGroupId } });
  const existing = queryClient.getQueryData<DmVoicePresenceResponseDto>(queryKey);

  if (existing) {
    queryClient.setQueryData<DmVoicePresenceResponseDto>(queryKey, (draft) => {
      if (!draft) return draft;
      const newUsers = draft.users.filter((u) => u.id !== data.userId);
      return { ...draft, users: newUsers, count: newUsers.length };
    });
  } else {
    invalidateVoiceQueries(queryClient);
  }
};

export const handleDmVoiceUserUpdated: SocketEventHandler<typeof ServerEvents.DM_VOICE_USER_UPDATED> = (
  data,
  queryClient: QueryClient,
) => {
  const queryKey = dmVoicePresenceControllerGetDmPresenceQueryKey({ path: { dmGroupId: data.dmGroupId } });
  const existing = queryClient.getQueryData<DmVoicePresenceResponseDto>(queryKey);

  if (existing) {
    const user = toPresenceUserDto(data.user);
    queryClient.setQueryData<DmVoicePresenceResponseDto>(queryKey, (draft) => {
      if (!draft) return draft;
      const index = draft.users.findIndex((u) => u.id === user.id);
      if (index !== -1) {
        const newUsers = [...draft.users];
        newUsers[index] = user;
        return { ...draft, users: newUsers };
      }
      return draft;
    });
  } else {
    invalidateVoiceQueries(queryClient);
  }
};
