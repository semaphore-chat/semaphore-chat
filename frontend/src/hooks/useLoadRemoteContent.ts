import { useQuery } from '@tanstack/react-query';
import { appearanceSettingsControllerGetSettingsOptions } from '../api-client/@tanstack/react-query.gen';

/**
 * Whether pictures from other sites load on their own: link-preview pictures and site icons, a lone GIF link drawn
 * as the GIF, and webhook avatars (the user's "Load pictures and previews from other sites" setting). Off means
 * text only, so the reader's IP address does not reach those sites.
 *
 * It reads the appearance settings the app shell already loads at start (`useThemeSync`): the same query, never a
 * request of its own (`staleTime: Infinity` keeps a mounting row from refetching it), and `select` makes a row
 * re-render only when the answer changes. Until the settings are known it answers false: a user who turned it off
 * never sends a request on the first paint.
 */
export function useLoadRemoteContent(): boolean {
  const { data } = useQuery({
    ...appearanceSettingsControllerGetSettingsOptions(),
    staleTime: Infinity,
    select: (settings) => settings.loadRemoteContent === true,
  });
  return data === true;
}
