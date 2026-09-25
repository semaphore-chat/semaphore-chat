/**
 * The notification bell in the desktop app bar is a color="inherit" icon: it
 * takes the app bar's foreground colour. The theme paints the bar as a white
 * or pale accent-tinted surface in light mode and a near-black one in dark
 * mode, so that foreground has to be the theme's text.primary token, never
 * MUI's primary.contrastText (white on the light bar for most accents).
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { ThemeProvider, hexToRgb } from '@mui/material/styles';
import { renderWithProviders, createTestQueryClient } from '../../test-utils';
import { DesktopAppBar } from '../../../components/Desktop/DesktopAppBar';
import { generateTheme } from '../../../theme/themeConfig';
import { accentColors, type AccentColor, type ThemeMode } from '../../../theme/constants';
import { notificationsControllerGetUnreadCountQueryKey } from '../../../api-client/@tanstack/react-query.gen';
import type { User } from '../../../types/auth.type';

vi.mock('../../../api-client/client.gen', () => ({
  client: {
    getConfig: () => ({ baseUrl: 'http://localhost:3000' }),
  },
}));

vi.mock('../../../hooks/useLogout', () => ({
  useLogout: () => ({ handleLogout: vi.fn(), logoutLoading: false }),
}));

vi.mock('../../../components/NavBar/NavigationLinks', () => ({
  default: () => null,
}));

// Not under test here, and it reads useColorScheme()/matchMedia, which this
// plain ThemeProvider + jsdom setup doesn't provide.
vi.mock('../../../components/ThemeToggle/ThemeToggle', () => ({
  default: () => null,
}));

vi.mock('../../../components/Common/UserAvatar', () => ({
  default: () => <div data-testid="user-avatar" />,
}));

const INTENSITIES = ['minimal', 'balanced', 'vibrant'] as const;

function renderAppBar(mode: ThemeMode, accent: AccentColor, intensity: (typeof INTENSITIES)[number]) {
  const theme = generateTheme(mode, accent, intensity);
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(notificationsControllerGetUnreadCountQueryKey(), { count: 3 });
  const result = renderWithProviders(
    <ThemeProvider theme={theme}>
      <DesktopAppBar
        instanceName="Semaphore Chat"
        isLoading={false}
        isError={false}
        userData={{ id: 'user-1', username: 'alice', role: 'USER' } as User}
        onToggleMenu={vi.fn()}
        onNotificationCenterOpen={vi.fn()}
      />
    </ThemeProvider>,
    { queryClient, withTheme: false },
  );
  return { theme, ...result };
}

const CASES = (['light', 'dark'] as const).flatMap((mode) =>
  accentColors.map(({ id: accent }) => ({ mode, accent })),
);

describe('DesktopAppBar icon contrast', () => {
  // Light mode is the bug (white bell on a white / pale-tinted bar); dark
  // mode already resolved to text.primary and must stay that way.
  it.each(CASES)(
    'draws the notification bell in the theme text.primary token ($mode, $accent, every intensity)',
    ({ mode, accent }) => {
      for (const intensity of INTENSITIES) {
        const { theme, unmount } = renderAppBar(mode, accent, intensity);
        const bell = screen.getByRole('button', { name: '3 unread notifications' });
        const expected = hexToRgb(theme.palette.text.primary);

        expect(getComputedStyle(bell).color, intensity).toBe(expected);
        // The icon itself (fill: currentColor) follows the button.
        expect(getComputedStyle(bell.querySelector('svg')!).color, intensity).toBe(expected);
        unmount();
      }
    },
  );
});
