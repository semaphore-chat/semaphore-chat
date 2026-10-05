/**
 * Fixtures for GET /api/channels/community/:communityId/permissions/me, the
 * only thing the UI reads channel capabilities from (useChannelPermissions).
 */
import { http, HttpResponse, type HttpHandler } from 'msw';
import type {
  ChannelCapabilitiesDto,
  CommunityChannelCapabilitiesDto,
} from '../../api-client/types.gen';
import type { Scenario } from './types';

export type Caps = Omit<ChannelCapabilitiesDto, 'channelId'>;

export const ALL_CAPS: Caps = {
  view: true,
  post: true,
  attach: true,
  react: true,
  threadReply: true,
  connect: true,
  speak: true,
  video: true,
  share: true,
  managePermissions: true,
  timedOutUntil: null,
  postingRoleNames: [],
};

/** Capabilities a role's community actions give in a channel without overwrites. */
export function capsFromActions(actions: readonly string[]): Caps {
  const has = (a: string) => actions.includes(a);
  return {
    view: true,
    post: has('CREATE_MESSAGE'),
    attach: has('ATTACH_FILES'),
    react: has('CREATE_REACTION'),
    threadReply: has('CREATE_MESSAGE'),
    connect: has('JOIN_CHANNEL'),
    speak: has('SPEAK'),
    video: has('VIDEO'),
    share: has('SCREEN_SHARE'),
    managePermissions: has('MANAGE_CHANNEL_PERMISSIONS'),
    timedOutUntil: null,
    postingRoleNames: [],
  };
}

/** A timed-out member: read, connect and listen only. */
export function timedOutCaps(until: string, base: Caps = ALL_CAPS): Caps {
  return {
    ...base,
    post: false,
    attach: false,
    react: false,
    threadReply: false,
    speak: false,
    video: false,
    share: false,
    timedOutUntil: until,
  };
}

/** Serves permissions/me for one community; `capsFor` per channel id. */
export function channelPermissionsHandler(
  scenario: Scenario,
  communityId: string,
  capsFor: (channelId: string) => Caps | null,
): HttpHandler {
  return http.get(`/api/channels/community/${communityId}/permissions/me`, () => {
    const channels = scenario.communities.find((c) => c.id === communityId)?.channels ?? [];
    const body: CommunityChannelCapabilitiesDto = {
      communityId,
      channels: channels.flatMap((c) => {
        const caps = capsFor(c.id);
        return caps ? [{ channelId: c.id, ...caps }] : [];
      }),
    };
    return HttpResponse.json(body);
  });
}
