import { useMobileNavigation, type ScreenType } from './MobileNavigationContext';
import { useKeyboardInset } from '../../../contexts/BottomChromeContext';

/**
 * Screens that own the whole height on a phone: the composer (or search
 * field) sits at the bottom, and the app bar's back button replaces the tabs.
 * Voice channels open as `chat` too.
 */
const FULL_HEIGHT_SCREENS: ReadonlySet<ScreenType> = new Set<ScreenType>(['chat', 'dm-chat', 'search']);

/**
 * Whether the bottom nav is hidden right now: always while the on-screen
 * keyboard is open, and on chat/search screens when `hideOnDetailScreens`
 * (phone layout). Exported so the layout can pad the safe area itself when
 * the nav — which normally pads it — isn't there.
 */
export function useBottomNavHidden(hideOnDetailScreens = false): boolean {
  const { state } = useMobileNavigation();
  const keyboardOpen = useKeyboardInset() > 0;
  const screen = state?.currentScreen;
  return keyboardOpen || (hideOnDetailScreens && !!screen && FULL_HEIGHT_SCREENS.has(screen));
}

