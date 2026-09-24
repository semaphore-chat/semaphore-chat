/**
 * Notifications at 0 / 1 / 150 (130 unread → 99+ badges), mixed types
 * (mention, @everyone, DM, thread reply, channel message) and odd author
 * names/avatars. Paged at 50 like the backend.
 */
import { Box } from '@mui/material';
import { NotificationList } from '../../../components/Notifications/NotificationList';
import { defineComponent } from '../../fixtures/componentStory';
import {
  defineNavScreen,
  navBase,
  navHandlers,
  withNotifications,
  makeOddUsers,
  DM_POOL,
  MAX_DISPLAY_NAME,
  NO_SPACES_NAME,
} from '../../fixtures/edge/nav';

const authors = [...makeOddUsers(), ...DM_POOL];

export const None = defineNavScreen(withNotifications(navBase(), 0, 0, authors), '/notifications');
export const One = defineNavScreen(withNotifications(navBase(), 1, 1, authors), '/notifications');
export const HundredFifty = defineNavScreen(withNotifications(navBase(), 150, 130, authors), '/notifications');

/**
 * Every type label next to a 32-character name, spaced and unbroken. Types
 * cycle every 5 rows and the two authors alternate, so the 10 rows pair each
 * label with both names, once unread (bold, first 5) and once read. The name
 * should truncate; the label ("Mentioned everyone" is the widest) should not.
 */
const longNames = withNotifications(
  navBase(),
  10,
  5,
  makeOddUsers().filter((u) => u.displayName === MAX_DISPLAY_NAME || u.displayName === NO_SPACES_NAME),
);
export const LongNamesEveryType = defineNavScreen(longNames, '/notifications');

/**
 * The same rows in a 320px column, the narrowest phone we support, in the
 * touch layout, where the label and time leave the name the least room.
 * Captured on phone only: desktop would render the pointer layout (inline
 * mark-read/dismiss) squeezed into 320px, which the app never does (pointer
 * layout means ≥1200px, or Electron at ≥800px), and tablet would repeat the
 * phone shot, since the list only varies by touch vs pointer.
 */
export const LongNamesNarrow320 = defineComponent(
  longNames,
  () => (
    <Box sx={{ width: 320, outline: '1px dashed', outlineColor: 'divider' }}>
      <NotificationList />
    </Box>
  ),
  { maxWidth: false, extraHandlers: navHandlers(longNames) },
);
LongNamesNarrow320.meta = { viewports: ['phone'] };
