/**
 * MSW handlers that put the Lounge mock-ups' people and places (lounge-canvas STYLE.md) behind the real
 * data hooks, for the stories that mount the connected shell pieces (the frame stories). Layered over a
 * scenario with `extraHandlers` (they win): the user is alexk (the scenario's `me` id, so its permissions
 * still apply), the first community is Couch Co-op with general / clips / lfg / memes and the voice rooms
 * Squad Up (dropbear, pri, alexk) and AFK (kwam3), and the members are the mock-up's. No avatars: initials
 * on the kit's default fill, as the shell shows people without a picture.
 */
import { http, HttpResponse, type HttpHandler } from 'msw';

const ME = 'me';
const COMMUNITY = 'community-1';
const AT = '2026-01-01T00:00:00.000Z';

/** "Seen 2h ago" stays "2h ago" whenever the story is captured. */
const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

const user = (id: string, username: string, status: string | null = null, lastSeen: string | null = null) => ({
  id,
  username,
  displayName: null,
  avatarUrl: null,
  bannerUrl: null,
  status,
  lastSeen,
  bio: null,
  createdAt: AT,
});

const PEOPLE = {
  alexk: user(ME, 'alexk', 'keeping it chill'),
  samira: user('u-samira', 'Samira', 'keeping the server warm'),
  dropbear: user('u-dropbear', 'dropbear', 'back at 9'),
  gracie: user('u-gracie', 'gracie', 'work tomorrow'),
  aiko: user('u-aiko', 'aiko', 'needs her headset back'),
  chlo: user('u-chlo', 'chlo', 'listening to lo-fi'),
  kwam3: user('u-kwam3', 'kwam3'),
  pri: user('u-pri', 'pri', 'downloading 40gb update'),
  tomatillo: user('u-tomatillo', 'tomatillo', 'playing Deep Rock'),
  diego: user('u-diego', 'Diego', null, ago(2)),
  noahbody: user('u-noahbody', 'noahbody', null, ago(26)),
  zara: user('u-zara', 'zara', null, ago(74)),
};
const ONLINE = ['me', 'u-samira', 'u-dropbear', 'u-gracie', 'u-aiko', 'u-chlo', 'u-kwam3', 'u-pri', 'u-tomatillo'];

const memberRole = { id: 'r-member', name: 'Member', position: 100, isDefault: true };
const role = (id: string, name: string, position: number) => ({ id, name, position, isDefault: false });
const ROLES: Record<string, unknown[]> = {
  'u-samira': [memberRole, role('r-admin', 'admin', 1)],
  'u-dropbear': [memberRole, role('r-mod', 'mod', 5)],
  'u-gracie': [memberRole, role('r-mod', 'mod', 5)],
};

const channel = (id: string, name: string, type: 'TEXT' | 'VOICE', position: number) => ({
  id,
  name,
  communityId: COMMUNITY,
  type,
  isPrivate: false,
  createdAt: AT,
  position,
  slowmodeSeconds: 0,
  preset: 'NORMAL',
});

const CHANNELS = [
  channel('ch-general', 'general', 'TEXT', 0),
  channel('ch-clips', 'clips', 'TEXT', 1),
  channel('ch-lfg', 'lfg', 'TEXT', 2),
  channel('ch-memes', 'memes', 'TEXT', 3),
  channel('vc-squad', 'Squad Up', 'VOICE', 0),
  channel('vc-afk', 'AFK', 'VOICE', 1),
];

const inRoom = (person: ReturnType<typeof user>) => ({
  id: person.id,
  username: person.username,
  displayName: person.displayName,
  avatarUrl: null,
  joinedAt: AT,
  isDeafened: false,
  isServerMuted: false,
});
const ROOMS: Record<string, ReturnType<typeof inRoom>[]> = {
  'vc-squad': [inRoom(PEOPLE.dropbear), inRoom(PEOPLE.pri), inRoom(PEOPLE.alexk)],
  'vc-afk': [inRoom(PEOPLE.kwam3)],
};

const community = (id: string, name: string) => ({ id, name, description: null, avatar: null, banner: null, createdAt: AT });
const COMMUNITIES = [
  community(COMMUNITY, 'Couch Co-op'),
  community('community-2', 'Trailheads'),
  community('community-3', 'Lumen Studio'),
];

export const loungeCommunityHandlers: HttpHandler[] = [
  http.get('/api/users/profile', () => HttpResponse.json({ ...PEOPLE.alexk, email: 'alexk@example.invalid' })),
  http.get('/api/community/mine', () => HttpResponse.json(COMMUNITIES)),
  http.get('/api/community/:id', ({ params }) =>
    HttpResponse.json(COMMUNITIES.find((c) => c.id === params.id) ?? community(String(params.id), 'Couch Co-op')),
  ),
  http.get(`/api/channels/community/${COMMUNITY}`, () => HttpResponse.json(CHANNELS)),
  http.get('/api/channels/:channelId/voice-presence', ({ params }) => {
    const users = ROOMS[String(params.channelId)] ?? [];
    return HttpResponse.json({ channelId: params.channelId, users, count: users.length });
  }),
  http.get('/api/read-receipts/unread-counts', () =>
    HttpResponse.json([
      { channelId: 'ch-clips', communityId: COMMUNITY, channelType: 'TEXT', unreadCount: 4, mentionCount: 2 },
      { channelId: 'ch-1', communityId: 'community-3', channelType: 'TEXT', unreadCount: 2, mentionCount: 2 },
    ]),
  ),
  http.get(`/api/membership/community/${COMMUNITY}`, () =>
    HttpResponse.json({
      members: Object.values(PEOPLE).map((person, i) => ({
        id: `m-${i}`,
        userId: person.id,
        communityId: COMMUNITY,
        joinedAt: AT,
        roles: ROLES[person.id] ?? [memberRole],
        user: person,
      })),
    }),
  ),
  // Every room and channel open to alexk (the scenario's capabilities name its own channels, not these).
  http.get(`/api/channels/community/${COMMUNITY}/permissions/me`, () =>
    HttpResponse.json({
      communityId: COMMUNITY,
      channels: CHANNELS.map((c) => ({
        channelId: c.id,
        view: true, post: true, attach: true, react: true, threadReply: true, connect: true, speak: true,
        video: true, share: true, managePermissions: false, pin: false, deleteAny: false, seeRemoved: false,
        timedOutUntil: null, postingRoleNames: [],
      })),
    }),
  ),
  http.get('/api/presence/users/bulk', () => HttpResponse.json({ presence: Object.fromEntries(ONLINE.map((id) => [id, true])) })),
  http.get(`/api/presence/community/${COMMUNITY}`, () =>
    HttpResponse.json({ communityId: COMMUNITY, onlineUserIds: ONLINE, onlineCount: ONLINE.length, memberCount: Object.keys(PEOPLE).length }),
  ),
];

/** The mock-up community's id (the scenario's first community). */
export const LOUNGE_COMMUNITY_ID = COMMUNITY;
