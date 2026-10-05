/**
 * Handlers for composer stories whose state comes from the channel
 * capabilities (useComposerAvailability → useChannelPermissions): a
 * read-only/announcement channel, attachments turned off.
 * Plain `.ts`: exports data and functions only.
 */
import { http, HttpResponse, type HttpHandler } from 'msw';
import type { ChannelDto } from '../../api-client/types.gen';
import { ALL_CAPS, channelPermissionsHandler, type Caps } from './channelPermissions';
import { bigCommunityScenario, generalChannel, primaryCommunity } from './scenarios';

/** `generalChannel` served with a different preset/name (the notice copy reads both). */
function channelAs(preset: ChannelDto['preset'], name: string): HttpHandler {
  return http.get(`/api/channels/${generalChannel.id}`, () =>
    HttpResponse.json({ ...generalChannel, preset, name } satisfies ChannelDto));
}

function capsHandler(caps: Partial<Caps>): HttpHandler {
  return channelPermissionsHandler(bigCommunityScenario, primaryCommunity.id, () => ({ ...ALL_CAPS, ...caps }));
}

/** #announcements where only Moderator and Community Admin may post. */
export const announcementComposerHandlers: HttpHandler[] = [
  channelAs('ANNOUNCEMENT', 'announcements'),
  capsHandler({
    post: false,
    attach: false,
    threadReply: false,
    managePermissions: false,
    postingRoleNames: ['Moderator', 'Community Admin'],
  }),
];

/** A normal channel with "Members can attach files" off. */
export const noAttachmentsComposerHandlers: HttpHandler[] = [
  channelAs('NORMAL', 'general'),
  capsHandler({ attach: false, managePermissions: false }),
];
