/**
 * Channel list markers: the leading icon is the channel TYPE (# text,
 * megaphone announcement, speaker voice) and the trailing slot is ACCESS
 * (lock = private; the encrypted-voice shield will join it later), so the
 * two never compete. Read-only channels get no icon of their own. Includes
 * a private announcement channel and one with a 100-character name.
 */
import { defineNavScreen } from '../../fixtures/edge/nav';
import { CHANNEL_MARKERS_PATH, channelMarkersScenario } from '../../fixtures/edge/channelMarkers';

/** General, announcement, read-only, private, private announcement, long private announcement, voice. */
export const AnnouncementAndPrivate = defineNavScreen(channelMarkersScenario(), CHANNEL_MARKERS_PATH);
