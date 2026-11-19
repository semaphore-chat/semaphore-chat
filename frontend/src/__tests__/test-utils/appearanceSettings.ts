import type { QueryClient } from '@tanstack/react-query';
import { appearanceSettingsControllerGetSettingsQueryKey } from '../../api-client/@tanstack/react-query.gen';
import type { AppearanceSettingsResponseDto } from '../../api-client/types.gen';

/** Appearance settings as the server returns them for a new user (pictures from other sites on). */
export function createAppearanceSettings(
  overrides: Partial<AppearanceSettingsResponseDto> = {},
): AppearanceSettingsResponseDto {
  return {
    id: 'appearance-test',
    userId: 'user-1',
    themeMode: 'dark',
    accentColor: 'purple',
    intensity: 'minimal',
    baseColor: '#8e75ff',
    matchSystem: false,
    newDesign: false,
    loadRemoteContent: true,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

/**
 * Puts the appearance settings in the cache, as the app shell has them once it started: `useLoadRemoteContent()`
 * then answers at once (without them it answers false until they load).
 */
export function seedAppearanceSettings(
  queryClient: QueryClient,
  overrides: Partial<AppearanceSettingsResponseDto> = {},
): void {
  queryClient.setQueryData(appearanceSettingsControllerGetSettingsQueryKey(), createAppearanceSettings(overrides));
}
