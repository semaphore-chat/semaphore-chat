/**
 * useThemeSync Hook
 *
 * Syncs theme settings between the ThemeContext and the server.
 * - On mount: Fetches server settings and applies them (server wins)
 * - On change: Saves the changed fields to the server
 */

import { useEffect, useRef } from 'react';
import { ACCENT_PRIMARY, nearestAccent } from '@semaphore-chat/shared';
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
 * got wrong leaves the local one in place.
 *
 * A valid `baseColor` always wins the accent too, as the server keeps the two
 * in step. A server older than the base colour still names the accent it
 * stores, so that accent wins instead: the local base moves to its primary
 * unless it already shows that accent.
 */
function settingsFromServer(server: AppearanceSettingsResponseDto, local: ThemeSettings): ThemeSettings {
  const mode = isThemeMode(server.themeMode) ? server.themeMode : local.mode;
  const intensity = isThemeIntensity(server.intensity) ? server.intensity : local.intensity;
  const matchSystem = typeof server.matchSystem === 'boolean' ? server.matchSystem : local.matchSystem;
  const newDesign = typeof server.newDesign === 'boolean' ? server.newDesign : local.newDesign;

  const baseColor = normalizeBaseColor(server.baseColor);
  if (baseColor) {
    return { mode, accentColor: nearestAccent(baseColor), intensity, baseColor, matchSystem, newDesign };
  }

  if (isAccentColor(server.accentColor)) {
    const accentColor = server.accentColor;
    return {
      mode,
      accentColor,
      intensity,
      baseColor: nearestAccent(local.baseColor) === accentColor ? local.baseColor : ACCENT_PRIMARY[accentColor],
      matchSystem,
      newDesign,
    };
  }

  return {
    mode,
    accentColor: local.accentColor,
    intensity,
    baseColor: local.baseColor,
    matchSystem,
    newDesign,
  };
}

/**
 * The fields that differ, never both colour fields. A named pick goes out as
 * the accent alone: the server derives its primary, and a server without
 * `baseColor` understands it. Any other base colour goes out as the base
 * alone, which both servers understand.
 */
function changedFields(previous: ThemeSettings, next: ThemeSettings): UpdateAppearanceSettingsDto {
  const body: UpdateAppearanceSettingsDto = {};
  if (next.mode !== previous.mode) body.themeMode = next.mode;
  if (next.intensity !== previous.intensity) body.intensity = next.intensity;
  if (next.baseColor !== previous.baseColor) {
    const namedPick = next.accentColor !== previous.accentColor && next.baseColor === ACCENT_PRIMARY[next.accentColor];
    if (namedPick) body.accentColor = next.accentColor;
    else body.baseColor = next.baseColor;
  } else if (next.accentColor !== previous.accentColor) {
    body.accentColor = next.accentColor;
  }
  if (next.matchSystem !== previous.matchSystem) body.matchSystem = next.matchSystem;
  if (next.newDesign !== previous.newDesign) body.newDesign = next.newDesign;
  return body;
}

/** The settings the server now holds after accepting `body`, merged onto `base`. */
function acknowledgedSettings(base: ThemeSettings, body: UpdateAppearanceSettingsDto): ThemeSettings {
  const next = { ...base };
  if (body.themeMode !== undefined) next.mode = body.themeMode;
  if (body.intensity !== undefined) next.intensity = body.intensity;
  if (body.baseColor !== undefined) {
    next.baseColor = body.baseColor;
    next.accentColor = nearestAccent(body.baseColor);
  } else if (body.accentColor !== undefined) {
    next.accentColor = body.accentColor;
    next.baseColor = ACCENT_PRIMARY[body.accentColor];
  }
  if (body.matchSystem !== undefined) next.matchSystem = body.matchSystem;
  if (body.newDesign !== undefined) next.newDesign = body.newDesign;
  return next;
}

export function useThemeSync() {
  const { settings, applyServerSettings, registerOnChange } = useTheme();
  const queryClient = useQueryClient();
  const { data: serverSettings, isSuccess } = useQuery(appearanceSettingsControllerGetSettingsOptions());
  const { mutateAsync: updateSettings } = useMutation({
    ...appearanceSettingsControllerUpdateSettingsMutation(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [{ _id: 'appearanceSettingsControllerGetSettings' }] }),
  });
  const hasAppliedServerSettings = useRef(false);
  // The settings the server acknowledged: changes are sent as a diff against it,
  // and it only moves once a request succeeds, so a failed one is resent.
  const syncedSettings = useRef<ThemeSettings | null>(null);
  // The newest local settings, for the apply effect and the sync queue.
  const latestSettings = useRef(settings);

  useEffect(() => {
    latestSettings.current = settings;
  }, [settings]);

  // Apply server settings on initial load (server wins)
  useEffect(() => {
    if (isSuccess && serverSettings && !hasAppliedServerSettings.current) {
      hasAppliedServerSettings.current = true;
      const applied = settingsFromServer(serverSettings, latestSettings.current);
      syncedSettings.current = applied;
      applyServerSettings(applied);
    }
  }, [isSuccess, serverSettings, applyServerSettings]);

  // Register callback to sync changes to server
  useEffect(() => {
    // One request at a time, so every acknowledgement lands in order; a change
    // made while a request is in flight is sent when it settles.
    let syncing = false;
    let queued: ThemeSettings | null = null;

    const flush = () => {
      if (syncing) return;
      const next = queued;
      const previous = syncedSettings.current;
      if (!next || !previous) return;
      const body = changedFields(previous, next);
      if (Object.keys(body).length === 0) {
        queued = null;
        return;
      }

      syncing = true;
      queued = null;
      void updateSettings({ body })
        .then(() => {
          syncedSettings.current = acknowledgedSettings(syncedSettings.current ?? previous, body);
          syncing = false;
          flush();
        })
        .catch(() => {
          // The server kept its old values: leave the acknowledged settings
          // behind, so the next change (or the one already queued) resends them.
          syncing = false;
          if (latestSettings.current !== next) {
            queued = latestSettings.current;
            flush();
          }
        });
    };

    const unregister = registerOnChange((next: ThemeSettings) => {
      // Only sync if we've already applied server settings (avoid syncing on initial load)
      if (!hasAppliedServerSettings.current) return;
      queued = next;
      flush();
    });

    return unregister;
  }, [registerOnChange, updateSettings]);
}
