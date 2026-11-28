/**
 * A channel's notification level for the reader (the old `ChannelNotificationMenu`'s queries, lifted for the new
 * shell's chat header): the channel's own override ("all", "mentions" or "none"), or "default", which follows the
 * reader's default channel level. Setting "default" removes the override.
 *
 * Headless: no UI imports (see the `src/data` lint block in eslint.config.js).
 */
import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  notificationsControllerDeleteChannelOverrideMutation,
  notificationsControllerGetChannelOverrideOptions,
  notificationsControllerGetSettingsOptions,
  notificationsControllerSetChannelOverrideMutation,
} from '../api-client/@tanstack/react-query.gen';

export type ChannelLevel = 'all' | 'mentions' | 'none';
export type ChannelLevelChoice = ChannelLevel | 'default';

/** The level's words, as the old menu's. */
export const CHANNEL_LEVEL_TEXT: Record<ChannelLevel, string> = {
  all: 'All messages',
  mentions: 'Only @mentions',
  none: 'Nothing',
};

export interface ChannelNotifications {
  /** The channel's own choice; "default" while it has none (or it is loading). */
  choice: ChannelLevelChoice;
  /** The reader's default channel level (the old menu's fallback: mentions). */
  defaultLevel: ChannelLevel;
  /** What applies: the choice, or the default. */
  effective: ChannelLevel;
  loading: boolean;
  busy: boolean;
  /** Sets the channel's level; rejects when the server refuses. */
  setChoice(choice: ChannelLevelChoice): Promise<void>;
}

const isLevel = (value: unknown): value is ChannelLevel => value === 'all' || value === 'mentions' || value === 'none';

export function useChannelNotifications(channelId: string, enabled = true): ChannelNotifications {
  const queryClient = useQueryClient();
  const { data: override, isLoading } = useQuery({ ...notificationsControllerGetChannelOverrideOptions({ path: { channelId } }), enabled });
  const { data: settings } = useQuery({ ...notificationsControllerGetSettingsOptions(), enabled });
  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: [{ _id: 'notificationsControllerGetChannelOverride' }] }),
    [queryClient],
  );
  const set = useMutation({ ...notificationsControllerSetChannelOverrideMutation(), onSuccess: invalidate });
  const remove = useMutation({ ...notificationsControllerDeleteChannelOverrideMutation(), onSuccess: invalidate });
  const choice: ChannelLevelChoice = isLevel(override?.level) ? override.level : 'default';
  const defaultLevel: ChannelLevel = isLevel(settings?.defaultChannelLevel) ? settings.defaultChannelLevel : 'mentions';
  const { mutateAsync: setOverride } = set;
  const { mutateAsync: deleteOverride } = remove;
  const setChoice = useCallback(
    async (next: ChannelLevelChoice) => {
      if (next === 'default') await deleteOverride({ path: { channelId } });
      else await setOverride({ path: { channelId }, body: { level: next } });
    },
    [channelId, deleteOverride, setOverride],
  );
  return {
    choice,
    defaultLevel,
    effective: choice === 'default' ? defaultLevel : choice,
    loading: isLoading,
    busy: set.isPending || remove.isPending,
    setChoice,
  };
}
