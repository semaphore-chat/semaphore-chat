/**
 * The reader's notification settings as a form (Settings > Notifications), shared by both shells: the server's
 * values, a local draft, whether the draft differs, and Save / Reset. Lifted from the old `NotificationSettings`
 * card; the query and its cache key are the generated ones, so the chat header's `useChannelNotifications` and this
 * form read one cache entry.
 *
 * Headless: no UI imports (see the `src/data` lint block in eslint.config.js).
 */
import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  notificationsControllerGetSettingsOptions,
  notificationsControllerUpdateSettingsMutation,
  pushNotificationsControllerSendTestPushToSelfMutation,
} from '../api-client/@tanstack/react-query.gen';
import type { UserNotificationSettingsDto } from '../api-client/types.gen';
import type { UpdateNotificationSettingsDto } from '../types/notification.type';

/** The fields the form edits. Every one is always set (the update DTO's are optional). */
export type NotificationSettingsValues = Required<
  Pick<
    UpdateNotificationSettingsDto,
    | 'desktopEnabled'
    | 'playSound'
    | 'soundType'
    | 'doNotDisturb'
    | 'dndStartTime'
    | 'dndEndTime'
    | 'defaultChannelLevel'
    | 'dmNotifications'
  >
>;

/** The form before the server answers (the old card's defaults). */
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettingsValues = {
  desktopEnabled: true,
  playSound: true,
  soundType: 'default',
  doNotDisturb: false,
  dndStartTime: '22:00',
  dndEndTime: '08:00',
  defaultChannelLevel: 'mentions',
  dmNotifications: true,
};

const SOUND_TYPES = ['default', 'mention', 'dm'] as const;
const CHANNEL_LEVELS = ['all', 'mentions', 'none'] as const;
const oneOf = <T extends string>(choices: readonly T[], value: unknown, fallback: T): T =>
  (choices as readonly unknown[]).includes(value) ? (value as T) : fallback;

/** The server's row as form values. The GET DTO types the unions as plain strings; anything else keeps the default. */
export function valuesFromServer(server: UserNotificationSettingsDto): NotificationSettingsValues {
  const d = DEFAULT_NOTIFICATION_SETTINGS;
  return {
    desktopEnabled: server.desktopEnabled,
    playSound: server.playSound,
    soundType: oneOf(SOUND_TYPES, server.soundType, d.soundType),
    doNotDisturb: server.doNotDisturb,
    dndStartTime: server.dndStartTime || d.dndStartTime,
    dndEndTime: server.dndEndTime || d.dndEndTime,
    defaultChannelLevel: oneOf(CHANNEL_LEVELS, server.defaultChannelLevel, d.defaultChannelLevel),
    dmNotifications: server.dmNotifications,
  };
}

const sameValues = (a: NotificationSettingsValues, b: NotificationSettingsValues): boolean =>
  (Object.keys(a) as (keyof NotificationSettingsValues)[]).every((key) => a[key] === b[key]);

export interface NotificationSettingsForm {
  /** The draft: what the form shows. The defaults until the server answers. */
  values: NotificationSettingsValues;
  /** The last values the server holds (null while loading). */
  saved: NotificationSettingsValues | null;
  /** The draft differs from the saved values. Never while loading. */
  dirty: boolean;
  /** How many fields differ (for "2 unsaved changes"). */
  changes: number;
  loading: boolean;
  /** The settings could not be loaded. */
  error: boolean;
  saving: boolean;
  change<K extends keyof NotificationSettingsValues>(key: K, value: NotificationSettingsValues[K]): void;
  /** Back to the saved values. */
  reset(): void;
  /** Sends the draft with the device's time zone (the DND window is the reader's local time). Rejects on failure. */
  save(): Promise<void>;
}

export function useNotificationSettingsForm(): NotificationSettingsForm {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery(notificationsControllerGetSettingsOptions());
  const { mutateAsync: update, isPending: saving } = useMutation({
    ...notificationsControllerUpdateSettingsMutation(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [{ _id: 'notificationsControllerGetSettings' }] }),
  });
  const [values, setValues] = useState<NotificationSettingsValues>(DEFAULT_NOTIFICATION_SETTINGS);
  const [saved, setSaved] = useState<NotificationSettingsValues | null>(null);

  // Each new server row replaces the draft (as the old card did).
  useEffect(() => {
    if (!data) return;
    const loaded = valuesFromServer(data);
    setValues(loaded);
    setSaved(loaded);
  }, [data]);

  const change = useCallback(
    <K extends keyof NotificationSettingsValues>(key: K, value: NotificationSettingsValues[K]) =>
      setValues((previous) => ({ ...previous, [key]: value })),
    [],
  );
  const reset = useCallback(() => {
    if (saved) setValues(saved);
  }, [saved]);
  const save = useCallback(async () => {
    const sent = values;
    const dndTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    await update({ body: { ...sent, dndTimezone } });
    setSaved(sent);
  }, [update, values]);

  const changes = saved
    ? (Object.keys(values) as (keyof NotificationSettingsValues)[]).filter((key) => values[key] !== saved[key]).length
    : 0;
  return {
    values,
    saved,
    dirty: saved !== null && !sameValues(values, saved),
    changes,
    loading: isLoading,
    error: isError,
    saving,
    change,
    reset,
    save,
  };
}

export interface TestPushResult {
  success: boolean;
  message: string;
}

/** Sends a test push to the reader's own devices. Never rejects: a failure is a result with `success: false`. */
export function useTestPush(): { send(): Promise<TestPushResult>; sending: boolean } {
  const { mutateAsync, isPending } = useMutation(pushNotificationsControllerSendTestPushToSelfMutation());
  const send = useCallback(async (): Promise<TestPushResult> => {
    try {
      const result = await mutateAsync({});
      return { success: result.success, message: result.message };
    } catch {
      return { success: false, message: 'Failed to send test push notification' };
    }
  }, [mutateAsync]);
  return { send, sending: isPending };
}
