/**
 * Settings > Privacy, shared by both shells: whether pictures from other sites load on their own (link-preview
 * pictures and site icons, GIF links drawn as the GIF, webhook avatars). Stored with the appearance settings
 * (`loadRemoteContent`), the query both shells already load at start, with its cache key. The switch moves at once
 * and goes back if the save fails. Lifted from the old Settings page.
 *
 * Headless: no UI imports (see the `src/data` lint block in eslint.config.js).
 */
import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  appearanceSettingsControllerGetSettingsOptions,
  appearanceSettingsControllerGetSettingsQueryKey,
  appearanceSettingsControllerUpdateSettingsMutation,
} from '../api-client/@tanstack/react-query.gen';
import type { AppearanceSettingsResponseDto } from '../api-client/types.gen';

/** An older server does not know the setting: nothing to switch, and its pictures stay on. */
export const privacyUnsupported = (data: unknown, isError: boolean): boolean =>
  !isError && !!data && typeof (data as { loadRemoteContent?: unknown }).loadRemoteContent !== 'boolean';

export interface PrivacySettings {
  /** False on a server that does not know the setting: show no Privacy section. True while loading or on an error. */
  supported: boolean;
  /** The current value; undefined while loading or on an error. */
  loadRemoteContent: boolean | undefined;
  loading: boolean;
  /** The settings could not be loaded. */
  error: boolean;
  saving: boolean;
  /** The last save failed (the switch went back). */
  saveFailed: boolean;
  setLoadRemoteContent(value: boolean): void;
}

export function usePrivacySettings(): PrivacySettings {
  const queryClient = useQueryClient();
  const queryKey = appearanceSettingsControllerGetSettingsQueryKey();
  const { data, isPending, isError } = useQuery(appearanceSettingsControllerGetSettingsOptions());
  const { mutate, isError: saveFailed, isPending: saving } = useMutation({
    ...appearanceSettingsControllerUpdateSettingsMutation(),
    onMutate: async ({ body }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<AppearanceSettingsResponseDto>(queryKey);
      if (previous && body?.loadRemoteContent !== undefined) {
        queryClient.setQueryData<AppearanceSettingsResponseDto>(queryKey, {
          ...previous,
          loadRemoteContent: body.loadRemoteContent,
        });
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });
  const setLoadRemoteContent = useCallback(
    (value: boolean) => mutate({ body: { loadRemoteContent: value } }),
    [mutate],
  );
  const supported = !privacyUnsupported(data, isError);
  return {
    supported,
    loadRemoteContent: supported && data ? data.loadRemoteContent : undefined,
    loading: isPending,
    error: isError,
    saving,
    saveFailed,
    setLoadRemoteContent,
  };
}
