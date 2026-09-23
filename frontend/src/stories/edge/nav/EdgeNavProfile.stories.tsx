/**
 * Profile page edge cases: 32-char (max) name + username with a 500-char
 * bio and no banner/avatar; own profile with broken banner + broken avatar;
 * an RTL-named user.
 */
import {
  defineNavScreen,
  navBase,
  withExtraUsers,
  withUserPatch,
  makeOddUsers,
  brokenBannerId,
  MAX_BIO,
  BROKEN_FILE_PREFIX,
} from '../../fixtures/edge/nav';

const odd = makeOddUsers();
const [maxed, noSpaces, arabic] = odd;

/** Other user: max-length name, 500-char bio, long status, no banner, no avatar. */
export const LongBioNoBanner = defineNavScreen(
  withExtraUsers(navBase(), [{ ...maxed, bio: MAX_BIO, bannerUrl: null, avatarUrl: null }]),
  `/profile/${maxed.id}`,
);

/** Own profile with a banner and avatar whose files 404. */
const meBroken = withUserPatch(navBase(), 'me', {
  displayName: noSpaces.displayName,
  bannerUrl: brokenBannerId('me'),
  avatarUrl: `${BROKEN_FILE_PREFIX}avatar-me`,
  bio: 'short bio',
});
export const BrokenBannerOwn = defineNavScreen(meBroken, '/profile/me');

/** RTL (Arabic) name + RTL status + mixed bio. */
export const RtlUser = defineNavScreen(
  withExtraUsers(navBase(), [{ ...arabic, bio: 'مرحبا! أنا مطورة واجهات. I build UIs and test RTL layouts. שלום!' }]),
  `/profile/${arabic.id}`,
);
