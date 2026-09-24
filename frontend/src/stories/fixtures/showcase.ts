/**
 * The marketing SHOWCASE scenario — polished, realistic fake data used by
 * the `tour/` stories that the README / docs media are generated from (see
 * docs/superpowers/specs/2026-09-23-readme-media-design.md and
 * `frontend/scripts/media/`).
 *
 * Unlike `buildScenario()`'s randomized filler, everything a viewer can read
 * here is hand-written. The main community is "Couch Co-op", a group of
 * friends who play a (fictional) co-op game, Deep Rift, on a Tuesday evening:
 * patch notes, key binds, sorting out Friday, two of them already in voice.
 * Alex also belongs to "Lumen Studio", the small product team he works at,
 * whose day (the afternoon's #dev, the release group DM) is still there.
 *
 * Display names are per user, not per community (the backend has no
 * per-community nicknames), so everyone goes by their handle everywhere:
 * "dropbear" in Couch Co-op is "dropbear" in Lumen Studio too.
 *
 * `buildScenario()` only provides the base `Scenario` object; every user,
 * community, channel, message, DM, notification, role and voice presence is
 * replaced with curated content, and unread badges are set with `withUnread`.
 *
 * Timestamps are fixed wall-clock times on Tuesday 2026-09-22 in
 * America/New_York (the media scripts pin the browser clock to `SHOWCASE_NOW`
 * and the timezone to match), so "Today at 8:02 PM" never drifts.
 */
import {
  createMessage,
  createChannel,
  createUser,
  createDmGroupMember,
  createSpan,
  createReaction,
  createFriendship,
} from '../../__tests__/test-utils/factories';
import type { Message, Span, LinkPreview } from '../../types/message.type';
import { SpanType } from '../../types/message.type';
import type { Channel } from '../../types/channel.type';
import type { MembershipResponseDto, NotificationDto, RoleDto, VoicePresenceUserDto } from '../../api-client/types.gen';
import { buildScenario } from './builder';
import { withUnread } from './modifiers';
import type { Scenario, ScenarioCommunity, ScenarioUser } from './types';
import {
  HAIR,
  SKIN,
  bannerSvg,
  communityIconSvg,
  deepRiftPatchSvg,
  emptyStateMockSvg,
  illustratedAvatarSvg,
  paletteSvg,
  pitScreenshotSvg,
  prPreviewSvg,
  registerShowcaseFile,
  sunsetPhotoSvg,
  svgDataUri,
  type AvatarLook,
  type CommunityGlyph,
} from './showcaseArt';
import { SHOWCASE_GIFS, showcaseGifUrl } from './showcaseGifs';
import { ADMIN_ACTIONS, MEMBER_ACTIONS } from './edge/voice';

// ─────────────────────────────────────────────────────────────────────────
// Time
// ─────────────────────────────────────────────────────────────────────────

/** "Now" for the showcase: Tuesday 22 Sep 2026, 9:04 PM EDT. */
export const SHOWCASE_NOW = '2026-09-23T01:04:00Z';
/** The browser timezone the media scripts use, so wall-clock times below read as written. */
export const SHOWCASE_TIMEZONE = 'America/New_York';

/** ISO timestamp for a local (EDT, UTC-4) wall-clock time; `daysAgo` shifts the date back. */
export function at(hhmm: string, daysAgo = 0): string {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 8, 22 - daysAgo, h + 4, m, 0)).toISOString();
}

// ─────────────────────────────────────────────────────────────────────────
// People
// ─────────────────────────────────────────────────────────────────────────

interface Persona {
  id: string;
  /** Stable key for this file (`U.priya`); usernames are the handles people chose. */
  key: string;
  username: string;
  /** Global per user: the same in every community. */
  displayName: string;
  /** Most people don't set one. */
  status: string | null;
  /** Online right now (Tuesday 9:04 PM). Everyone in voice is online. */
  online: boolean;
  bio?: string;
  look: AvatarLook;
}

const PERSONAS: Persona[] = [
  {
    id: 'u-priya', key: 'priya', username: 'pri', displayName: 'pri', status: 'downloading 40gb update', online: true,
    bio: 'Product designer. Illustrations, type, and too many color palettes.',
    look: { skin: SKIN.tan, hair: 'long', hairColor: HAIR.black, bg: ['#FFD6E7', '#FF9CC2'], shirt: '#7C5CFF', earrings: true },
  },
  {
    id: 'u-marcus', key: 'marcus', username: 'dropbear', displayName: 'dropbear', status: 'back at 9', online: true,
    bio: 'Backend & infra. Will talk your ear off about backoff strategies.',
    look: { skin: SKIN.deep, hair: 'buzz', hairColor: HAIR.black, bg: ['#C9F2E3', '#6FD6B0'], shirt: '#1F6FEB', beard: true },
  },
  {
    id: 'u-aiko', key: 'aiko', username: 'aiko', displayName: 'aiko', status: null, online: true,
    look: { skin: SKIN.porcelain, hair: 'bob', hairColor: HAIR.black, bg: ['#D8E6FF', '#8FB2FF'], shirt: '#FF8A3D', glasses: true },
  },
  {
    id: 'u-samira', key: 'samira', username: 'samira', displayName: 'Samira', status: null, online: true,
    look: { skin: SKIN.olive, hair: 'bun', hairColor: HAIR.darkBrown, bg: ['#E4DAFF', '#B49CFF'], shirt: '#12B886', earrings: true },
  },
  {
    id: 'u-diego', key: 'diego', username: 'diego', displayName: 'Diego', status: null, online: false,
    look: { skin: SKIN.tan, hair: 'wavy', hairColor: HAIR.darkBrown, bg: ['#FFE7C2', '#FFC06B'], shirt: '#2D2446', beard: true },
  },
  {
    id: 'u-grace', key: 'grace', username: 'gracie', displayName: 'gracie', status: 'work tomorrow 😐', online: true,
    look: { skin: SKIN.brown, hair: 'curly', hairColor: HAIR.black, bg: ['#FFE0D1', '#FF9F7A'], shirt: '#7C5CFF', earrings: true },
  },
  {
    id: 'u-tomas', key: 'tomas', username: 'tomatillo', displayName: 'tomatillo', status: null, online: true,
    look: { skin: SKIN.light, hair: 'wavy', hairColor: HAIR.auburn, bg: ['#D3F4FF', '#7DD3FC'], shirt: '#E0306F', beard: true },
  },
  {
    id: 'u-zara', key: 'zara', username: 'zara', displayName: 'zara', status: null, online: false,
    look: { skin: SKIN.brown, hair: 'ponytail', hairColor: HAIR.darkBrown, bg: ['#FFF1C2', '#FFD35C'], shirt: '#0B7285' },
  },
  {
    id: 'u-kwame', key: 'kwame', username: 'kwam3', displayName: 'kwam3', status: null, online: true,
    look: { skin: SKIN.deep, hair: 'bald', hairColor: HAIR.black, bg: ['#E8E2FF', '#A89BFF'], shirt: '#FFB86B', beard: true, glasses: true },
  },
  {
    id: 'u-chloe', key: 'chloe', username: 'chlo', displayName: 'chlo', status: null, online: true,
    look: { skin: SKIN.porcelain, hair: 'bob', hairColor: HAIR.auburn, bg: ['#DDF3F0', '#7ED9C9'], shirt: '#FF6FB5' },
  },
  {
    id: 'u-noah', key: 'noah', username: 'noahbody', displayName: 'noahbody', status: null, online: false,
    look: { skin: SKIN.porcelain, hair: 'short', hairColor: HAIR.blonde, bg: ['#E2F7D5', '#9BE07A'], shirt: '#3B4252', glasses: true },
  },
  {
    id: 'u-mateo', key: 'mateo', username: 'mateo', displayName: 'mateo', status: null, online: false,
    look: { skin: SKIN.olive, hair: 'short', hairColor: HAIR.black, bg: ['#FFD9D9', '#FF8F8F'], shirt: '#1E1B33', beard: true },
  },
];

const ME: Persona = {
  id: 'me', key: 'me', username: 'alexk', displayName: 'alexk', status: null, online: true,
  bio: 'Engineering lead at Lumen Studio. Coffee, synths and small, sharp tools.',
  look: { skin: SKIN.light, hair: 'short', hairColor: HAIR.darkBrown, bg: ['#CDE8FF', '#7C9CFF'], shirt: '#12B886' },
};

function toUser(p: Persona, extra: Partial<ScenarioUser> = {}): ScenarioUser {
  const avatarId = registerShowcaseFile(`sc-avatar-${p.id}`, () => illustratedAvatarSvg(p.id, p.look));
  return {
    ...createUser({
      id: p.id,
      username: p.username,
      displayName: p.displayName,
      status: p.status ?? undefined,
      bio: p.bio ?? null,
      email: `${p.username}@lumen.studio`,
      lastSeen: p.online ? SHOWCASE_NOW : at('17:40'),
    }),
    avatarUrl: avatarId,
    ...extra,
  };
}

const me: ScenarioUser = toUser(ME, {
  role: 'OWNER',
  bannerUrl: registerShowcaseFile('sc-banner-me', () => bannerSvg('#5B6CFF', '#B36BFF')),
});
const users: ScenarioUser[] = PERSONAS.map((p) => toUser(p));
const U = Object.fromEntries([ME, ...PERSONAS].map((p, i) => [p.key, [me, ...users][i]])) as Record<string, ScenarioUser>;

/** Ids of the people who are online (presence is answered from this, not from `status`). */
export const SHOWCASE_ONLINE_IDS: ReadonlySet<string> = new Set([ME, ...PERSONAS].filter((p) => p.online).map((p) => p.id));

// ─────────────────────────────────────────────────────────────────────────
// Message helpers
// ─────────────────────────────────────────────────────────────────────────

const text = (t: string, extra: Partial<Span> = {}): Span => ({ ...createSpan({ text: t }), ...extra });
const mention = (u: ScenarioUser): Span =>
  createSpan({ type: SpanType.USER_MENTION, userId: u.id, text: `@${u.displayName}` });
const code = (t: string): Span => createSpan({ type: SpanType.CODE_BLOCK, text: t });

let seq = 0;
function msg(
  where: { channelId?: string; dmId?: string },
  author: ScenarioUser,
  time: string,
  spans: Span[] | string,
  extra: Partial<Message> = {},
): Message {
  seq += 1;
  return createMessage({
    id: extra.id ?? `sc-msg-${seq}`,
    channelId: where.channelId ?? null,
    directMessageGroupId: where.dmId ?? null,
    authorId: author.id,
    spans: typeof spans === 'string' ? [text(spans)] : spans,
    sentAt: time,
    reactions: [],
    attachments: [],
    ...extra,
  });
}

const react = (emoji: string, ...who: ScenarioUser[]) => createReaction({ emoji, userIds: who.map((u) => u.id) });

function imageAttachment(id: string, filename: string, svg: () => string, size: number) {
  registerShowcaseFile(id, svg);
  return { id, filename, mimeType: 'image/png', fileType: 'IMAGE', size, hasThumbnail: false } as never;
}

// ─────────────────────────────────────────────────────────────────────────
// Communities + channels
// ─────────────────────────────────────────────────────────────────────────

function channel(communityId: string, id: string, name: string, type: 'TEXT' | 'VOICE', position: number): Channel {
  return createChannel({ id, name, communityId, type, position, createdAt: at('09:00', 200) });
}

const COUCH = 'c-couch';
const LUMEN = 'c-lumen';
const TRAIL = 'c-trail';
const SYNTH = 'c-synth';

/** Couch Co-op, the main community. */
export const showcaseChannels = {
  general: channel(COUCH, 'cc-general', 'general', 'TEXT', 0),
  clips: channel(COUCH, 'cc-clips', 'clips', 'TEXT', 1),
  lfg: channel(COUCH, 'cc-lfg', 'lfg', 'TEXT', 2),
  memes: channel(COUCH, 'cc-memes', 'memes', 'TEXT', 3),
  squad: channel(COUCH, 'vc-squad', 'Squad Up', 'VOICE', 4),
  afk: channel(COUCH, 'vc-afk', 'AFK', 'VOICE', 5),
};
const CC = showcaseChannels;

/** Lumen Studio, Alex's work community. */
export const lumenChannels = {
  announcements: channel(LUMEN, 'ch-announcements', 'announcements', 'TEXT', 0),
  general: channel(LUMEN, 'ch-general', 'general', 'TEXT', 1),
  dev: channel(LUMEN, 'ch-dev', 'dev', 'TEXT', 2),
  design: channel(LUMEN, 'ch-design', 'design', 'TEXT', 3),
  random: channel(LUMEN, 'ch-random', 'random', 'TEXT', 4),
  lounge: channel(LUMEN, 'vc-lounge', 'Lounge', 'VOICE', 5),
  standup: channel(LUMEN, 'vc-standup', 'Standup', 'VOICE', 6),
};
const C = lumenChannels;

// Samira started Couch Co-op; Alex runs Lumen Studio's instance and community.
const couchMembers = [U.samira, me, U.marcus, U.aiko, U.grace, U.priya, U.kwame, U.tomas, U.chloe, U.noah, U.zara, U.diego];
const lumenMembers = [me, ...users];
// Tomás runs the hiking community and Kwame the synth one; Alex just joined them.
const trailMembers = [U.tomas, me, U.grace, U.noah, U.zara, U.mateo, U.chloe];
const synthMembers = [U.kwame, me, U.diego, U.aiko, U.mateo];

/** How long ago (days) each community was created — its creator joined that day. */
const COMMUNITY_AGE_DAYS = 400;

function community(
  id: string,
  name: string,
  description: string,
  glyph: CommunityGlyph,
  banner: [string, string],
  channels: Channel[],
  /** Creator first (the community's owner / Community Admin). */
  members: ScenarioUser[],
): ScenarioCommunity {
  return {
    id,
    name,
    description,
    avatar: registerShowcaseFile(`sc-community-${glyph}`, () => communityIconSvg(glyph)),
    banner: registerShowcaseFile(`sc-community-banner-${glyph}`, () => bannerSvg(banner[0], banner[1])),
    createdAt: at('09:00', COMMUNITY_AGE_DAYS),
    channels,
    memberIds: members.map((u) => u.id),
    ownerId: members[0].id,
  };
}

const communities: ScenarioCommunity[] = [
  community(COUCH, 'Couch Co-op', 'Friday nights, mostly Deep Rift.', 'couch', ['#3B5BDB', '#15AABF'], Object.values(CC), couchMembers),
  community(
    LUMEN,
    'Lumen Studio',
    'A small product team building in the open.',
    'lumen',
    ['#7C5CFF', '#FF6FB5'],
    Object.values(C),
    lumenMembers,
  ),
  community(
    TRAIL,
    'Trailheads',
    'Weekend hikes, gear talk and trail photos.',
    'trail',
    ['#12B886', '#0B7285'],
    [
      channel(TRAIL, 'tr-general', 'general', 'TEXT', 0),
      channel(TRAIL, 'tr-trips', 'trip-planning', 'TEXT', 1),
      channel(TRAIL, 'tr-photos', 'photos', 'TEXT', 2),
      channel(TRAIL, 'tr-campfire', 'Campfire', 'VOICE', 3),
    ],
    trailMembers,
  ),
  community(
    SYNTH,
    'Synth Club',
    'Patches, gear and Friday night jams.',
    'synth',
    ['#FF8A3D', '#E0306F'],
    [
      channel(SYNTH, 'sy-general', 'general', 'TEXT', 0),
      channel(SYNTH, 'sy-patches', 'patches', 'TEXT', 1),
      channel(SYNTH, 'sy-jam', 'Jam Room', 'VOICE', 2),
    ],
    synthMembers,
  ),
];

// ─────────────────────────────────────────────────────────────────────────
// Couch Co-op #general — the hero conversation
// ─────────────────────────────────────────────────────────────────────────

const cg = { channelId: CC.general.id };

const patchPreview: LinkPreview = {
  url: 'https://deeprift.gg/patch/6-2',
  title: 'Deep Rift 6.2: driller changes, new cave biome, bug fixes',
  description: 'The full patch notes for Deep Rift 6.2.',
  siteName: 'Deep Rift',
  imageUrl: svgDataUri(deepRiftPatchSvg()),
};

/** The thread parent in #general (5 replies) — the Thread story opens it. */
export const SHOWCASE_THREAD_PARENT_ID = 'sc-cc-friday';
/** gracie's "found this from last time" (the pit screenshot's caption, 😂 ×4). */
export const SHOWCASE_PIT_CAPTION_ID = 'sc-cc-pit-caption';

const generalMessages: Message[] = [
  msg(cg, U.marcus, at('20:02'), 'patch notes are up deeprift.gg/patch/6-2', { linkPreviews: [patchPreview] }),
  msg(cg, U.aiko, at('20:04'), 'they finally nerfed the fire thing'),
  msg(cg, U.grace, at('20:04'), 'good'),
  msg(cg, U.marcus, at('20:05'), 'that was my whole build'),
  msg(cg, U.grace, at('20:05'), 'we know'),
  msg(cg, U.priya, at('20:09'), [
    text('reinstalled and lost all my binds again. putting them here so i stop doing this'),
    code('dig     mouse4\nping    mouse5\nflare   f\nemote   v'),
  ]),
  msg(cg, U.kwame, at('20:10'), 'why is emote on v'),
  msg(cg, U.priya, at('20:10'), 'priorities', { reactions: [react('👍', U.aiko, U.grace)] }),
  msg(cg, U.samira, at('20:14'), 'are we doing friday or not', {
    id: SHOWCASE_THREAD_PARENT_ID,
    replyCount: 5,
    lastReplyAt: at('20:20'),
  }),
  msg(cg, me, at('20:16'), [mention(U.marcus), text(' you still have my headset btw')]),
  msg(cg, U.marcus, at('20:21'), "yeah i'll bring it friday"),
  msg(cg, U.grace, at('20:22'), [], {
    id: 'sc-cc-pit',
    attachments: [imageAttachment('sc-img-pit', 'deep-rift-pit.png', pitScreenshotSvg, 356_812)],
  }),
  msg(cg, U.grace, at('20:22'), 'found this from last time', {
    id: SHOWCASE_PIT_CAPTION_ID,
    reactions: [react('😂', U.aiko, U.priya, U.kwame, U.samira)],
  }),
  // A GIF message is just the GIF's URL (what the picker sends); the app embeds it.
  msg(cg, U.kwame, at('20:23'), showcaseGifUrl(SHOWCASE_GIFS.pitFall), { id: 'sc-cc-pit-gif' }),
];

const threadReplies: Message[] = [
  msg(cg, U.aiko, at('20:15'), "can't til 9", { parentMessageId: SHOWCASE_THREAD_PARENT_ID }),
  msg(cg, U.marcus, at('20:17'), '9 works', { parentMessageId: SHOWCASE_THREAD_PARENT_ID }),
  msg(cg, U.priya, at('20:17'), 'same', { parentMessageId: SHOWCASE_THREAD_PARENT_ID }),
  msg(cg, U.samira, at('20:19'), 'ok 9. hop in voice a bit before', {
    id: 'sc-thread-ok-9',
    parentMessageId: SHOWCASE_THREAD_PARENT_ID,
  }),
  msg(cg, me, at('20:20'), '👍', { parentMessageId: SHOWCASE_THREAD_PARENT_ID }),
];

const clips = { channelId: CC.clips.id };
const clipsMessages: Message[] = [
  msg(clips, U.tomas, at('22:47', 1), 'from last night https://clips.deeprift.gg/c/k2f9q', {
    reactions: [react('🔥', U.marcus, U.chloe)],
  }),
  msg(clips, U.chloe, at('20:31'), 'https://clips.deeprift.gg/c/p77xm'),
  msg(clips, U.chloe, at('20:31'), 'the ending'),
];

const lfg = { channelId: CC.lfg.id };
const lfgMessages: Message[] = [
  msg(lfg, U.noah, at('19:40', 1), 'need one more, starting in 10'),
  msg(lfg, U.zara, at('19:42', 1), 'me'),
  msg(lfg, U.kwame, at('20:40'), 'anyone up for a couple runs tonight'),
];

const memes = { channelId: CC.memes.id };
const memesMessages: Message[] = [msg(memes, U.zara, at('18:12', 1), showcaseGifUrl(SHOWCASE_GIFS.nod))];

// ─────────────────────────────────────────────────────────────────────────
// Lumen Studio #dev — the afternoon
// ─────────────────────────────────────────────────────────────────────────

const dev = { channelId: C.dev.id };

const prPreview: LinkPreview = {
  url: 'https://github.com/lumen-studio/lumen/pull/482',
  title: 'Retry socket reconnects with jittered backoff · Pull Request #482',
  description: 'Reconnects now back off exponentially with jitter, so a flaky network no longer stampedes the gateway.',
  siteName: 'GitHub',
  imageUrl: svgDataUri(prPreviewSvg(PERSONAS.find((p) => p.id === 'u-marcus')!.look)),
};

const devPriyaImage = msg(dev, U.priya, at('13:40'), 'New empty states are ready for review ✨ here\'s the channel one', {
  id: 'sc-dev-empty-states',
  attachments: [imageAttachment('sc-img-empty-state', 'empty-state-v3.png', emptyStateMockSvg, 184_320)],
  reactions: [react('😍', U.aiko, U.samira, U.tomas, U.grace), react('🎉', U.marcus, me)],
});

/** The release thread in Lumen's #dev (5 replies). */
const LUMEN_THREAD_PARENT_ID = 'sc-dev-release-thread';

const devMessages: Message[] = [
  msg(dev, U.grace, at('13:31'), 'Afternoon all 👋 on-call handoff done, pager has been quiet'),
  devPriyaImage,
  msg(dev, U.diego, at('13:44'), 'These are so good. The illustration style matches onboarding perfectly', {
    replyToId: devPriyaImage.id,
    replyTo: { id: devPriyaImage.id, authorId: U.priya.id, spans: devPriyaImage.spans, sentAt: devPriyaImage.sentAt },
  }),
  msg(dev, U.marcus, at('13:58'), [text('Reconnect fix is up for review 👉 https://github.com/lumen-studio/lumen/pull/482')], {
    linkPreviews: [prPreview],
  }),
  msg(dev, U.aiko, at('14:01'), 'Nice! Does it cover the laptop-sleeps-mid-call case?'),
  msg(
    dev,
    U.marcus,
    at('14:02'),
    [
      text('Yep, that was the main one. Backoff looks like this:'),
      code('const delay = Math.min(30_000, 500 * 2 ** attempt);\nawait sleep(delay / 2 + Math.random() * (delay / 2));'),
    ],
    { reactions: [react('🔥', U.aiko, U.grace, me), react('🙌', U.samira)] },
  ),
  msg(dev, U.samira, at('14:20'), "Should the reconnect fix go out in Thursday's release, or wait for the mobile pass?", {
    id: LUMEN_THREAD_PARENT_ID,
    replyCount: 5,
    lastReplyAt: at('14:41'),
  }),
  msg(dev, me, at('14:43'), [mention(U.marcus), text(' approved ✅ merging as soon as CI is green')]),
  msg(dev, U.grace, at('14:47'), 'CI is green on all three runners 🟢', {
    id: 'sc-dev-ci-green',
    reactions: [react('💚', U.marcus, U.samira, U.priya)],
  }),
];

const lumenThreadReplies: Message[] = [
  msg(dev, U.marcus, at('14:24'), 'Thursday. The mobile pass can land in 2.4.1', { parentMessageId: LUMEN_THREAD_PARENT_ID }),
  msg(dev, U.priya, at('14:26'), "+1, the empty states don't depend on it either", {
    parentMessageId: LUMEN_THREAD_PARENT_ID,
    reactions: [react('👍', U.samira, U.marcus)],
  }),
  msg(dev, U.aiko, at('14:29'), "I'll do a final QA pass on iOS and Android tonight 📱", { parentMessageId: LUMEN_THREAD_PARENT_ID }),
  msg(dev, U.samira, at('14:33'), "Perfect. Drafting the changelog now, I'll tag the release Thursday morning", {
    parentMessageId: LUMEN_THREAD_PARENT_ID,
  }),
  msg(dev, me, at('14:41'), 'Ship it 🚀', {
    parentMessageId: LUMEN_THREAD_PARENT_ID,
    reactions: [react('🚀', U.samira, U.marcus, U.priya, U.aiko)],
  }),
];

// ─────────────────────────────────────────────────────────────────────────
// Lumen Studio's other channels
// ─────────────────────────────────────────────────────────────────────────

const general = { channelId: C.general.id };
const lumenGeneralMessages: Message[] = [
  msg(general, U.chloe, at('09:12'), 'Morning! The new docs site search is live, let me know if anything looks off 🔍', {
    reactions: [react('🙌', U.priya, U.diego, me)],
  }),
  msg(general, U.kwame, at('10:03'), 'Episode 12 of the team podcast is recorded 🎙️ we talk about the redesign and why we moved to self-hosting'),
  msg(general, U.zara, at('11:47'), 'Lunch spot recommendations near the office? The taco place closed 😢'),
  msg(general, U.tomas, at('11:49'), 'The ramen place on 5th. Trust me.', { reactions: [react('🍜', U.zara, U.grace, U.aiko)] }),
  msg(general, U.tomas, at('13:15'), 'View from the lake this weekend, couldn\'t resist sharing', {
    attachments: [imageAttachment('sc-img-sunset', 'lake-sunset.jpg', sunsetPhotoSvg, 412_004)],
    reactions: [react('😍', U.priya, U.zara, U.chloe), react('🌅', U.grace, me)],
  }),
  msg(general, U.grace, at('13:18'), 'Okay that is unreal. Where is this?'),
  msg(general, U.tomas, at('13:20'), 'Lake Placid! Trail notes are in Trailheads if anyone wants to go'),
];

const design = { channelId: C.design.id };
const designMessages: Message[] = [
  msg(design, U.priya, at('11:05'), 'Palette exploration for the 2.4 marketing page — thoughts?', {
    attachments: [imageAttachment('sc-img-palette', 'palette-v2.png', paletteSvg, 96_512)],
    reactions: [react('🎨', U.diego, U.chloe)],
  }),
  msg(design, U.diego, at('11:12'), 'The coral + violet combo is 🔥 maybe a touch less saturation on the green?'),
  msg(design, U.priya, at('11:20'), [mention(me), text(' can we use the violet as the default accent in the app too?')], {
    id: 'sc-design-accent',
  }),
];

const announcements = { channelId: C.announcements.id };
const releaseAnnouncement = msg(announcements, U.samira, at('09:30', 1), [
  text('Lumen 2.3.2 is out 🎉', { bold: true }),
  text(' Faster uploads, fixed notification sounds on Android, and a much nicer settings page. Full notes are on the blog.'),
], {
  reactions: [react('🎉', U.marcus, U.priya, U.aiko, U.grace, U.tomas, me)],
  pinned: true,
  pinnedAt: at('09:31', 1),
  pinnedBy: U.samira.id,
});
const announcementMessages: Message[] = [releaseAnnouncement];

/** The pins panel's view of the pinned announcement (same message). */
const pinnedByChannel: Scenario['pinnedByChannel'] = {
  [C.announcements.id]: [
    {
      id: releaseAnnouncement.id,
      channelId: C.announcements.id,
      directMessageGroupId: null,
      authorId: U.samira.id,
      spans: releaseAnnouncement.spans as never,
      reactions: releaseAnnouncement.reactions as never,
      sentAt: releaseAnnouncement.sentAt,
      editedAt: null,
      deletedAt: null,
      pinned: true,
      pinnedAt: at('09:31', 1),
      pinnedBy: U.samira.id,
      replyCount: 0,
      lastReplyAt: null,
      searchText: null,
      pendingAttachments: 0,
      deletedBy: null,
      deletedByReason: null,
      parentMessageId: null,
      attachments: [],
      author: { id: U.samira.id, username: U.samira.username, displayName: U.samira.displayName, avatarUrl: U.samira.avatarUrl },
    } as Scenario['pinnedByChannel'][string][number],
  ],
};

const random = { channelId: C.random.id };
const randomMessages: Message[] = [
  msg(random, U.kwame, at('12:02'), 'hot take: dark mode is the only mode'),
  msg(random, U.chloe, at('12:04'), 'counterpoint: the light theme with the teal accent is gorgeous'),
];

const messagesByChannel: Record<string, Message[]> = {
  [CC.general.id]: generalMessages,
  [CC.clips.id]: clipsMessages,
  [CC.lfg.id]: lfgMessages,
  [CC.memes.id]: memesMessages,
  [CC.squad.id]: [],
  [CC.afk.id]: [],
  [C.announcements.id]: announcementMessages,
  [C.general.id]: lumenGeneralMessages,
  [C.dev.id]: devMessages,
  [C.design.id]: designMessages,
  [C.random.id]: randomMessages,
  [C.lounge.id]: [],
  [C.standup.id]: [],
  'tr-general': [msg({ channelId: 'tr-general' }, U.grace, at('10:10'), 'Who is in for the ridge loop on Saturday? 🥾', { id: 'sc-trail-ridge' })],
  'tr-trips': [],
  'tr-photos': [],
  'tr-campfire': [],
  'sy-general': [msg({ channelId: 'sy-general' }, U.kwame, at('09:40'), 'Jam night Friday, bring patches!')],
  'sy-patches': [],
  'sy-jam': [],
};

// ─────────────────────────────────────────────────────────────────────────
// DMs
// ─────────────────────────────────────────────────────────────────────────

function dmGroup(id: string, members: ScenarioUser[], name: string | null, messages: Message[]) {
  const last = messages[messages.length - 1];
  return {
    id,
    name,
    isGroup: members.length > 2,
    createdAt: at('10:00', 60),
    members: members.map((u) =>
      createDmGroupMember({
        id: `dmm-${id}-${u.id}`,
        userId: u.id,
        joinedAt: at('10:00', 60),
        user: { id: u.id, username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl },
      }),
    ),
    lastMessage: last ? { id: last.id, authorId: last.authorId, spans: last.spans as never, sentAt: last.sentAt } : null,
  } as Scenario['dmGroups'][number];
}

export const SHOWCASE_DM_PRI = 'dm-priya';
export const SHOWCASE_DM_LAUNCH = 'dm-launch';

const dmPriya = { dmId: SHOWCASE_DM_PRI };
const dmLaunch = { dmId: SHOWCASE_DM_LAUNCH };
const dmMarcus = { dmId: 'dm-marcus' };
const dmGrace = { dmId: 'dm-grace' };
const dmKwame = { dmId: 'dm-kwame' };

const messagesByDmGroup: Record<string, Message[]> = {
  [SHOWCASE_DM_PRI]: [
    // pri works with Alex at Lumen too: yesterday's and this afternoon's
    // messages are about work, tonight's about the pit screenshot.
    msg(dmPriya, U.priya, at('16:05', 1), 'first pass at the empty states, still rough but you get the idea'),
    msg(dmPriya, me, at('16:30', 1), 'love the direction, the channel one especially'),
    msg(dmPriya, U.priya, at('16:31', 1), 'that one took the longest 😅'),
    msg(dmPriya, me, at('16:32', 1), 'can you share them in #dev tomorrow so the team can weigh in?'),
    msg(dmPriya, U.priya, at('16:33', 1), 'will do 👍'),
    msg(dmPriya, U.priya, at('15:20'), 'the onboarding copy is up in the doc, no rush', { id: 'sc-dm-priya-copy' }),
    msg(dmPriya, me, at('15:48'), 'looks good, two small comments'),
    msg(dmPriya, U.priya, at('20:58'), 'did you see gracie posted the pit screenshot', { id: 'sc-dm-pri-pit' }),
    msg(dmPriya, U.priya, at('20:58'), 'lmao', { id: 'sc-dm-pri-lmao' }),
    msg(dmPriya, U.priya, at('20:59'), 'dropbear is never living that down', { id: 'sc-dm-pri-never' }),
  ],
  [SHOWCASE_DM_LAUNCH]: [
    msg(dmLaunch, U.samira, at('16:48', 1), "Launch is Thursday 🚀 who's taking what?"),
    msg(dmLaunch, U.diego, at('16:55', 1), 'Blog post and landing page copy. Aiko has QA and the store screenshots'),
    msg(dmLaunch, U.samira, at('17:10', 1), 'Launch checklist is in the release doc, shout if I missed anything'),
    msg(dmLaunch, U.aiko, at('17:24', 1), 'Looks complete to me 👌'),
    msg(dmLaunch, U.diego, at('17:31', 1), "Blog post draft is ready too, I'll share it in the morning ✍️"),
    msg(dmLaunch, U.samira, at('14:55'), 'Status check for Thursday: ✅ QA plan ✅ release notes ⏳ changelog sign-off'),
    msg(dmLaunch, U.diego, at('15:02'), 'Landing page copy is final, preview link is in the doc', {
      id: 'sc-dm-launch-copy',
      reactions: [react('🎉', U.samira, U.aiko)],
    }),
    msg(dmLaunch, U.aiko, at('15:05'), 'Store screenshots updated for 2.4 📸', {
      id: 'sc-dm-launch-screens',
      reactions: [react('🙌', U.samira, U.diego)],
    }),
    msg(dmLaunch, U.samira, at('15:12'), [mention(me), text(' can you sign off on the changelog before Thursday?')], {
      id: 'sc-dm-launch-signoff',
    }),
  ],
  'dm-marcus': [
    msg(dmMarcus, U.marcus, at('11:02'), 'pairing tomorrow at 10 still good?', { id: 'sc-dm-marcus-pairing' }),
    msg(dmMarcus, me, at('11:05'), '👍 I’ll bring coffee'),
  ],
  'dm-grace': [
    msg(dmGrace, me, at('16:40', 1), 'thanks for covering on-call last night!'),
    msg(dmGrace, U.grace, at('16:52', 1), 'anytime, it was quiet 😴'),
  ],
  'dm-kwame': [msg(dmKwame, U.kwame, at('10:15', 2), 'new episode drops Friday, want to be a guest? 🎙️')],
};

const dmGroups: Scenario['dmGroups'] = [
  dmGroup(SHOWCASE_DM_PRI, [me, U.priya], null, messagesByDmGroup[SHOWCASE_DM_PRI]),
  dmGroup(SHOWCASE_DM_LAUNCH, [me, U.samira, U.aiko, U.diego], 'Launch crew 🚀', messagesByDmGroup[SHOWCASE_DM_LAUNCH]),
  dmGroup('dm-marcus', [me, U.marcus], null, messagesByDmGroup['dm-marcus']),
  dmGroup('dm-grace', [me, U.grace], null, messagesByDmGroup['dm-grace']),
  dmGroup('dm-kwame', [me, U.kwame], null, messagesByDmGroup['dm-kwame']),
];

// ─────────────────────────────────────────────────────────────────────────
// Notifications, friends, roles, voice
// ─────────────────────────────────────────────────────────────────────────

const everyMessage = (): Message[] => [
  ...Object.values(messagesByChannel).flat(),
  ...threadReplies,
  ...lumenThreadReplies,
  ...Object.values(messagesByDmGroup).flat(),
];

/** A notification for a message that exists in the scenario (same author, text, time and context). */
function notification(type: NotificationDto['type'], messageId: string, read = false): NotificationDto {
  const m = everyMessage().find((x) => x.id === messageId);
  if (!m) throw new Error(`showcase notification: no message ${messageId}`);
  const author = [me, ...users].find((u) => u.id === m.authorId)!;
  const communityId = m.channelId ? (communities.find((c) => c.channels.some((ch) => ch.id === m.channelId))?.id ?? null) : null;
  return {
    id: `sc-notif-${m.id}`,
    type,
    userId: me.id,
    messageId: m.id,
    channelId: m.channelId ?? null,
    directMessageGroupId: m.directMessageGroupId ?? null,
    communityId,
    authorId: author.id,
    parentMessageId: m.parentMessageId ?? null,
    read,
    dismissed: false,
    createdAt: m.sentAt,
    author: { id: author.id, username: author.username, displayName: author.displayName, avatarUrl: author.avatarUrl },
    message: {
      id: m.id,
      spans: m.spans as never,
      channelId: m.channelId ?? null,
      directMessageGroupId: m.directMessageGroupId ?? null,
    },
  };
}

/**
 * What the backend would have created (notifications.service.ts): one
 * DIRECT_MESSAGE per DM message — a mention inside a DM is still
 * DIRECT_MESSAGE — a USER_MENTION for the channel mention, a THREAD_REPLY for
 * the watched Friday thread (read: Alex replied after it). Unread ones match
 * the unread DMs/mention below (bell = 3 + 3 + 1); older read ones were
 * cleared from the inbox. Newest first, like the API.
 */
const notifications: NotificationDto[] = [
  notification('DIRECT_MESSAGE', 'sc-dm-pri-never'),
  notification('DIRECT_MESSAGE', 'sc-dm-pri-lmao'),
  notification('DIRECT_MESSAGE', 'sc-dm-pri-pit'),
  notification('THREAD_REPLY', 'sc-thread-ok-9', true),
  notification('DIRECT_MESSAGE', 'sc-dm-priya-copy', true),
  notification('DIRECT_MESSAGE', 'sc-dm-launch-signoff'),
  notification('DIRECT_MESSAGE', 'sc-dm-launch-screens'),
  notification('DIRECT_MESSAGE', 'sc-dm-launch-copy'),
  notification('USER_MENTION', 'sc-design-accent'),
  notification('DIRECT_MESSAGE', 'sc-dm-marcus-pairing', true),
  notification('CHANNEL_MESSAGE', 'sc-trail-ridge', true),
].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

const friendships = [U.priya, U.marcus, U.aiko, U.grace, U.kwame, U.chloe].map((u, i) =>
  createFriendship({
    id: `sc-friend-${u.id}`,
    userAId: i === 5 ? u.id : me.id,
    userBId: i === 5 ? me.id : u.id,
    userA: (i === 5 ? u : me) as never,
    userB: (i === 5 ? me : u) as never,
    status: i === 5 ? 'PENDING' : 'ACCEPTED',
    createdAt: at('10:00', 30 + i),
  }),
);

/** `DEFAULT_MODERATOR_ROLE` (backend/src/roles/default-roles.config.ts). */
const MODERATOR_ACTIONS: RoleDto['actions'] = [
  'READ_COMMUNITY', 'READ_CHANNEL', 'READ_MEMBER', 'READ_MESSAGE', 'READ_ROLE', 'CREATE_MESSAGE', 'DELETE_MESSAGE',
  'CREATE_CHANNEL', 'UPDATE_CHANNEL', 'JOIN_CHANNEL', 'CREATE_MEMBER', 'UPDATE_MEMBER', 'CREATE_REACTION',
  'DELETE_REACTION', 'READ_ALIAS_GROUP', 'READ_ALIAS_GROUP_MEMBER', 'CAPTURE_REPLAY', 'KICK_USER', 'TIMEOUT_USER',
  'PIN_MESSAGE', 'UNPIN_MESSAGE', 'DELETE_ANY_MESSAGE', 'VIEW_BAN_LIST', 'MUTE_PARTICIPANT', 'READ_SOUNDBOARD_SOUND',
  'CREATE_SOUNDBOARD_SOUND', 'DELETE_SOUNDBOARD_SOUND',
];

/**
 * Like the real backend: every community gets the default "Community Admin",
 * "Moderator" and "Member" roles (isDefault, created with the community;
 * `createDefaultCommunityRoles`, and default role names can't be changed),
 * and the creator is its Community Admin. Couch Co-op added one custom role,
 * "mods" (dropbear and gracie); Lumen Studio added Release Manager and Designer.
 */
function role(
  communityId: string,
  name: string,
  actions: RoleDto['actions'],
  position: number,
  custom?: { createdDaysAgo: number },
): RoleDto {
  return {
    id: `role-${name.toLowerCase().replace(/\W+/g, '-')}-${communityId}`,
    name,
    actions,
    createdAt: at('09:00', custom?.createdDaysAgo ?? COMMUNITY_AGE_DAYS),
    isDefault: !custom,
    position,
  };
}

const rolesByCommunity: Record<string, RoleDto[]> = {};
const membershipsByCommunity: Record<string, MembershipResponseDto[]> = {};
for (const c of communities) {
  const admin = role(c.id, 'Community Admin', ADMIN_ACTIONS, 10);
  const moderator = role(c.id, 'Moderator', MODERATOR_ACTIONS, 20);
  const member = role(c.id, 'Member', MEMBER_ACTIONS, 100);
  let custom: RoleDto[] = [];
  let rolesOf = (_id: string): RoleDto[] => [member];
  if (c.id === LUMEN) {
    const release = role(c.id, 'Release Manager', [...MEMBER_ACTIONS, 'PIN_MESSAGE', 'UNPIN_MESSAGE', 'CREATE_INVITE'], 30, { createdDaysAgo: 142 });
    const designer = role(c.id, 'Designer', [...MEMBER_ACTIONS, 'MANAGE_EMOJIS', 'CREATE_SOUNDBOARD_SOUND'], 40, { createdDaysAgo: 96 });
    custom = [release, designer];
    rolesOf = (id) =>
      id === U.grace.id || id === U.marcus.id
        ? [moderator]
        : id === U.samira.id
          ? [release]
          : id === U.priya.id || id === U.diego.id
            ? [designer]
            : [member];
  } else if (c.id === COUCH) {
    const mods = role(
      c.id,
      'mods',
      [...MEMBER_ACTIONS, 'PIN_MESSAGE', 'UNPIN_MESSAGE', 'DELETE_ANY_MESSAGE', 'MUTE_PARTICIPANT', 'KICK_USER', 'CREATE_INVITE'],
      30,
      { createdDaysAgo: 310 },
    );
    custom = [mods];
    rolesOf = (id) => (id === U.marcus.id || id === U.grace.id ? [mods] : [member]);
  }
  rolesByCommunity[c.id] = [admin, moderator, ...custom, member];
  membershipsByCommunity[c.id] = c.memberIds.map((id, i) => {
    const user = id === me.id ? me : users.find((u) => u.id === id)!;
    return {
      id: `sc-membership-${c.id}-${i}`,
      userId: id,
      communityId: c.id,
      // The creator joined the day the community was made; everyone else after.
      joinedAt: i === 0 ? c.createdAt : at('10:00', COMMUNITY_AGE_DAYS - 20 - i * 23),
      roles: id === c.ownerId ? [admin] : rolesOf(id),
      user: user as never,
    };
  });
}

function presence(entries: [ScenarioUser, string][]): VoicePresenceUserDto[] {
  return entries.map(([u, joinedAt]) => ({
    id: u.id,
    username: u.username,
    displayName: u.displayName ?? undefined,
    avatarUrl: u.avatarUrl ?? undefined,
    joinedAt,
    isDeafened: false,
    isServerMuted: false,
  }));
}

/**
 * Who's in which voice channel, before Alex joins anything: dropbear and pri
 * in Squad Up, kwam3 idle in AFK. Lumen Studio's voice channels are empty
 * (it's 9 PM). Each person is in at most one channel, and everyone in voice
 * is online. The Voice story adds Alex to Squad Up (`showcaseWithMeInVoice`)
 * and keeps everyone else where they are.
 */
export const showcaseSquadCrew: ScenarioUser[] = [U.marcus, U.priya];
const voicePresenceByChannel: Record<string, VoicePresenceUserDto[]> = {
  [CC.squad.id]: presence([
    [U.marcus, at('21:00')],
    [U.priya, at('21:01')],
  ]),
  [CC.afk.id]: presence([[U.kwame, at('20:48')]]),
};

// ─────────────────────────────────────────────────────────────────────────
// Assemble
// ─────────────────────────────────────────────────────────────────────────

const base = buildScenario({ seed: 'showcase', userCount: 0, communityCount: 0, dmGroupCount: 0, notificationCount: 0 });

let assembled: Scenario = {
  ...base,
  seed: 'showcase',
  me,
  users,
  communities,
  messagesByChannel,
  threadRepliesByParent: { [SHOWCASE_THREAD_PARENT_ID]: threadReplies, [LUMEN_THREAD_PARENT_ID]: lumenThreadReplies },
  pinnedByChannel,
  voicePresenceByChannel,
  dmGroups,
  messagesByDmGroup,
  unreadByContextId: {},
  notifications,
  friendships,
  membershipsByCommunity,
  rolesByCommunity,
  instanceName: 'Semaphore Chat',
};
// Unread = the newest N messages of each context (the DM ones match the
// unread DIRECT_MESSAGE notifications above; #design's mention is 11:20).
assembled = withUnread(assembled, CC.clips.id, 2);
assembled = withUnread(assembled, CC.lfg.id, 1);
assembled = withUnread(assembled, C.general.id, 4);
assembled = withUnread(assembled, C.design.id, 3, 1);
assembled = withUnread(assembled, C.announcements.id, 1);
assembled = withUnread(assembled, 'tr-general', 1);
assembled = withUnread(assembled, SHOWCASE_DM_PRI, 3);
assembled = withUnread(assembled, SHOWCASE_DM_LAUNCH, 3, 1);

export const showcaseScenario: Scenario = assembled;

/**
 * The showcase as it is once Alex has read `contextId` (a channel or DM the
 * story opens): no unread badge, and its notifications read. The app clears
 * both itself when a conversation scrolls into view; stories that open a
 * conversation short enough not to scroll start from this state instead.
 */
export function showcaseWithRead(contextId: string, scenario: Scenario = showcaseScenario): Scenario {
  return {
    ...withUnread(scenario, contextId, 0),
    notifications: scenario.notifications.map((n) =>
      n.channelId === contextId || n.directMessageGroupId === contextId ? { ...n, read: true } : n,
    ),
  };
}

/** The showcase with Alex connected to a voice channel: joins the people already there (last, at `joinedAt`). */
export function showcaseWithMeInVoice(
  channelId: string,
  scenario: Scenario = showcaseScenario,
  joinedAt: string = at('21:03'),
): Scenario {
  const already = scenario.voicePresenceByChannel[channelId] ?? [];
  return {
    ...scenario,
    voicePresenceByChannel: {
      ...scenario.voicePresenceByChannel,
      [channelId]: [...already, ...presence([[me, joinedAt]])],
    },
  };
}
export const showcaseMe = me;
/** Showcase users by key (`priya`, `marcus`, `aiko`, ...; usernames are the handles: `pri`, `dropbear`, ...). */
export const showcaseUsers = U;
export const SHOWCASE_COMMUNITY_ID = COUCH;

export const showcasePaths = {
  general: `/community/${COUCH}/channel/${CC.general.id}`,
  squad: `/community/${COUCH}/channel/${CC.squad.id}`,
  community: `/community/${COUCH}`,
  lumenDev: `/community/${LUMEN}/channel/${C.dev.id}`,
  lumenSettings: `/community/${LUMEN}/edit`,
  dms: '/direct-messages',
  dmPri: `/direct-messages/${SHOWCASE_DM_PRI}`,
  dmLaunch: `/direct-messages/${SHOWCASE_DM_LAUNCH}`,
  notifications: '/notifications',
  settings: '/settings',
  profile: `/profile/${U.priya.id}`,
  home: '/',
};
