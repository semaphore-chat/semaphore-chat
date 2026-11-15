/**
 * useThemeSync Hook
 *
 * Syncs theme settings between the ThemeContext and the server.
 * - On mount: Fetches server settings and applies them (server wins)
 * - On change: Saves the changed fields to the server
 */

import { useEffect, useRef } from 'react';
import { nearestAccent } from '@semaphore-chat/shared';
import { useTheme } from '../contexts/ThemeContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  appearanceSettingsControllerGetSettingsOptions,
  appearanceSettingsControllerUpdateSettingsMutation,
} from '../api-client/@tanstack/react-query.gen';

import {
  isAccentColor,
  isThemeIntensity,
  isThemeMode,
  normalizeBaseColor,
  type ThemeSettings,
} from '../theme/constants';
import type {
  AppearanceSettingsResponseDto,
  UpdateAppearanceSettingsDto,
} from '../api-client/types.gen';

/**
 * The server's row as local settings, one field at a time: a value the server
 * got wrong leaves the local one in place. A valid `baseColor` always wins the
 * accent too, as the server keeps the two in step.
 */
function settingsFromServer(server: AppearanceSettingsResponseDto, local: ThemeSettings): ThemeSettings {
  const baseColor = normalizeBaseColor(server.baseColor);
  const accentColor = isAccentColor(server.accentColor)
    ? server.accentColor
    : baseColor
      ? nearestAccent(baseColor)
      : local.accentColor;
  return {
    mode: isThemeMode(server.themeMode) ? server.themeMode : local.mode,
    accentColor,
    intensity: isThemeIntensity(server.intensity) ? server.intensity : local.intensity,
    baseColor: baseColor ?? local.baseColor,
    matchSystem: typeof server.matchSystem === 'boolean' ? server.matchSystem : local.matchSystem,
    newDesign: typeof server.newDesign === 'boolean' ? server.newDesign : local.newDesign,
  };
}

export function useThemeSync() {
  const { settings, applyServerSettings, registerOnChange } = useTheme();
  const queryClient = useQueryClient();
  const { data: serverSettings, isSuccess } = useQuery(appearanceSettingsControllerGetSettingsOptions());
  const { mutate: updateSettings } = useMutation({
    ...appearanceSettingsControllerUpdateSettingsMutation(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [{ _id: 'appearanceSettingsControllerGetSettings' }] }),
  });
  const hasAppliedServerSettings = useRef(false);
  // The settings the server knows about: changes are sent as a diff against it.
  const syncedSettings = useRef<ThemeSettings | null>(null);

  // Apply server settings on initial load (server wins)
  useEffect(() => {
    if (isSuccess && serverSettings && !hasAppliedServerSettings.current) {
      hasAppliedServerSettings.current = true;
      const applied = settingsFromServer(serverSettings, settings);
      syncedSettings.current = applied;
      applyServerSettings(applied);
    }
  }, [isSuccess, serverSettings, settings, applyServerSettings]);

  // Register callback to sync changes to server
  useEffect(() => {
    const unregister = registerOnChange((next: ThemeSettings) => {
      // Only sync if we've already applied server settings (avoid syncing on initial load)
      if (!hasAppliedServerSettings.current) return;
      const previous = syncedSettings.current ?? next;
      syncedSettings.current = next;

      const body: UpdateAppearanceSettingsDto = {};
      if (next.mode !== previous.mode) body.themeMode = next.mode;
      if (next.intensity !== previous.intensity) body.intensity = next.intensity;
      // A base colour derives the accent server-side, and the server ignores an
      // accent sent beside it, so only one of the two ever goes out.
      if (next.baseColor !== previous.baseColor) body.baseColor = next.baseColor;
      else if (next.accentColor !== previous.accentColor) body.accentColor = next.accentColor;
      if (next.matchSystem !== previous.matchSystem) body.matchSystem = next.matchSystem;
      if (next.newDesign !== previous.newDesign) body.newDesign = next.newDesign;

      if (Object.keys(body).length > 0) updateSettings({ body });
    });

    return unregister;
  }, [registerOnChange, updateSettings]);
}
