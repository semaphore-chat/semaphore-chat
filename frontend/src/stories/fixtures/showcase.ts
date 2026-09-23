/**
 * The marketing SHOWCASE scenario — polished, realistic fake data used by
 * the `tour/` stories that the README / docs media are generated from (see
 * docs/superpowers/specs/2026-09-23-readme-media-design.md and
 * `frontend/scripts/media/`).
 *
 * Unlike `buildScenario()`'s randomized filler, everything a viewer can read
 * here is hand-written: a small product team ("Lumen Studio") shipping a
 * release on a Tuesday afternoon. `buildScenario()` only provides the base
 * `Scenario` object; every user, community, channel, message, DM,
 * notification, role and voice presence is replaced with curated content,
 * and unread badges are set with the `withUnread` modifier.
 *
 * Timestamps are fixed wall-clock times on Tuesday 2026-09-22 in
 * America/New_York (the media scripts pin the browser clock to `SHOWCASE_NOW`
 * and the timezone to match), so "Today at 2:05 PM" never drifts.
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
  emptyStateMockSvg,
  illustratedAvatarSvg,
  paletteSvg,
  prPreviewSvg,
  registerShowcaseFile,
  sunsetPhotoSvg,
  svgDataUri,
  type AvatarLook,
} from './showcaseArt';
import { ADMIN_ACTIONS, MEMBER_ACTIONS } from './edge/voice';

// ─────────────────────────────────────────────────────────────────────────
// Time
// ─────────────────────────────────────────────────────────────────────────

/** "Now" for the showcase: Tuesday 22 Sep 2026, 3:42 PM EDT. */
export const SHOWCASE_NOW = '2026-09-22T19:42:00Z';
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
  username: string;
  displayName: string;
  /** Online iff a status is set (see `isFixtureUserOnline` in handlers.ts). */
  status: string | null;
  bio?: string;
  look: AvatarLook;
}

const PERSONAS: Persona[] = [
  {
    id: 'u-priya', username: 'priya', displayName: 'Priya Raman', status: 'Sketching empty states ✏️',
    bio: 'Product designer. Illustrations, type, and too many color palettes.',
    look: { skin: SKIN.tan, hair: 'long', hairColor: HAIR.black, bg: ['#FFD6E7', '#FF9CC2'], shirt: '#7C5CFF', earrings: true },
  },
  {
    id: 'u-marcus', username: 'marcus', displayName: 'Marcus Okafor', status: 'Reviewing PRs',
    bio: 'Backend & infra. Will talk your ear off about backoff strategies.',
    look: { skin: SKIN.deep, hair: 'buzz', hairColor: HAIR.black, bg: ['#C9F2E3', '#6FD6B0'], shirt: '#1F6FEB', beard: true },
  },
  {
    id: 'u-aiko', username: 'aiko', displayName: 'Aiko Tanaka', status: 'QA on iOS 📱',
    look: { skin: SKIN.porcelain, hair: 'bob', hairColor: HAIR.black, bg: ['#D8E6FF', '#8FB2FF'], shirt: '#FF8A3D', glasses: true },
  },
  {
    id: 'u-samira', username: 'samira', displayName: 'Samira Haddad', status: 'Release captain this week',
    look: { skin: SKIN.olive, hair: 'bun', hairColor: HAIR.darkBrown, bg: ['#E4DAFF', '#B49CFF'], shirt: '#12B886', earrings: true },
  },
  {
    id: 'u-diego', username: 'diego', displayName: 'Diego Alvarez', status: 'Blog post graphics 🎨',
    look: { skin: SKIN.tan, hair: 'wavy', hairColor: HAIR.darkBrown, bg: ['#FFE7C2', '#FFC06B'], shirt: '#2D2446', beard: true },
  },
  {
    id: 'u-grace', username: 'grace', displayName: 'Grace Mensah', status: 'On call 🟢',
    look: { skin: SKIN.brown, hair: 'curly', hairColor: HAIR.black, bg: ['#FFE0D1', '#FF9F7A'], shirt: '#7C5CFF', earrings: true },
  },
  {
    id: 'u-tomas', username: 'tomas', displayName: 'Tomás Silva', status: '☕ back in 10',
    look: { skin: SKIN.light, hair: 'short', hairColor: HAIR.brown, bg: ['#D3F4FF', '#7DD3FC'], shirt: '#E0306F' },
  },
  {
    id: 'u-zara', username: 'zara', displayName: 'Zara Khan', status: 'Heads down until 4',
    look: { skin: SKIN.brown, hair: 'ponytail', hairColor: HAIR.darkBrown, bg: ['#FFF1C2', '#FFD35C'], shirt: '#0B7285' },
  },
  {
    id: 'u-kwame', username: 'kwame', displayName: 'Kwame Asante', status: 'Mixing the podcast 🎧',
    look: { skin: SKIN.deep, hair: 'bald', hairColor: HAIR.black, bg: ['#E8E2FF', '#A89BFF'], shirt: '#FFB86B', beard: true, glasses: true },
  },
  {
    id: 'u-chloe', username: 'chloe', displayName: 'Chloé Dubois', status: 'Writing docs',
    look: { skin: SKIN.porcelain, hair: 'bob', hairColor: HAIR.auburn, bg: ['#DDF3F0', '#7ED9C9'], shirt: '#FF6FB5' },
  },
  {
    id: 'u-noah', username: 'noah', displayName: 'Noah Bergström', status: null,
    look: { skin: SKIN.porcelain, hair: 'short', hairColor: HAIR.blonde, bg: ['#E2F7D5', '#9BE07A'], shirt: '#3B4252', glasses: true },
  },
  {
    id: 'u-mateo', username: 'mateo', displayName: 'Mateo Rossi', status: null,
    look: { skin: SKIN.olive, hair: 'short', hairColor: HAIR.black, bg: ['#FFD9D9', '#FF8F8F'], shirt: '#1E1B33', beard: true },
  },
];

const ME: Persona = {
  id: 'me', username: 'alex', displayName: 'Alex Kim', status: 'Shipping v2.4 🚀',
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
      lastSeen: p.status ? SHOWCASE_NOW : at('11:20'),
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
const U = Object.fromEntries([me, ...users].map((u) => [u.username, u])) as Record<string, ScenarioUser>;

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

const LUMEN = 'c-lumen';
const TRAIL = 'c-trail';
const SYNTH = 'c-synth';

export const showcaseChannels = {
  announcements: channel(LUMEN, 'ch-announcements', 'announcements', 'TEXT', 0),
  general: channel(LUMEN, 'ch-general', 'general', 'TEXT', 1),
  dev: channel(LUMEN, 'ch-dev', 'dev', 'TEXT', 2),
  design: channel(LUMEN, 'ch-design', 'design', 'TEXT', 3),
  random: channel(LUMEN, 'ch-random', 'random', 'TEXT', 4),
  lounge: channel(LUMEN, 'vc-lounge', 'Lounge', 'VOICE', 5),
  standup: channel(LUMEN, 'vc-standup', 'Standup', 'VOICE', 6),
};
const C = showcaseChannels;

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
  glyph: 'lumen' | 'trail' | 'synth',
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
// #dev — the hero conversation
// ─────────────────────────────────────────────────────────────────────────

const dev = { channelId: C.dev.id };

const prPreview: LinkPreview = {
  url: 'https://github.com/lumen-studio/lumen/pull/482',
  title: 'Retry socket reconnects with jittered backoff · Pull Request #482',
  description: 'Reconnects now back off exponentially with jitter, so a flaky network no longer stampedes the gateway.',
  siteName: 'GitHub',
  imageUrl: svgDataUri(prPreviewSvg()),
};

const devPriyaImage = msg(dev, U.priya, at('13:40'), 'New empty states are ready for review ✨ here\'s the channel one', {
  id: 'sc-dev-empty-states',
  attachments: [imageAttachment('sc-img-empty-state', 'empty-state-v3.png', emptyStateMockSvg, 184_320)],
  reactions: [react('😍', U.aiko, U.samira, U.tomas, U.grace), react('🎉', U.marcus, me)],
});

/** The thread parent in #dev (5 replies) — the `tour` thread story opens it. */
export const SHOWCASE_THREAD_PARENT_ID = 'sc-dev-release-thread';

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
    id: SHOWCASE_THREAD_PARENT_ID,
    replyCount: 5,
    lastReplyAt: at('14:41'),
  }),
  msg(dev, me, at('14:43'), [mention(U.marcus), text(' approved ✅ merging as soon as CI is green')]),
  msg(dev, U.grace, at('14:47'), 'CI is green on all three runners 🟢', {
    id: 'sc-dev-ci-green',
    reactions: [react('💚', U.marcus, U.samira, U.priya)],
  }),
];

const threadReplies: Message[] = [
  msg(dev, U.marcus, at('14:24'), 'Thursday. The mobile pass can land in 2.4.1', { parentMessageId: SHOWCASE_THREAD_PARENT_ID }),
  msg(dev, U.priya, at('14:26'), "+1, the empty states don't depend on it either", {
    parentMessageId: SHOWCASE_THREAD_PARENT_ID,
    reactions: [react('👍', U.samira, U.marcus)],
  }),
  msg(dev, U.aiko, at('14:29'), "I'll do a final QA pass on iOS and Android tonight 📱", { parentMessageId: SHOWCASE_THREAD_PARENT_ID }),
  msg(dev, U.samira, at('14:33'), "Perfect. I'll draft the changelog and tag the release Thursday morning", {
    id: 'sc-thread-changelog',
    parentMessageId: SHOWCASE_THREAD_PARENT_ID,
  }),
  msg(dev, me, at('14:41'), 'Ship it 🚀', {
    parentMessageId: SHOWCASE_THREAD_PARENT_ID,
    reactions: [react('🚀', U.samira, U.marcus, U.priya, U.aiko)],
  }),
];

// ─────────────────────────────────────────────────────────────────────────
// Other channels
// ─────────────────────────────────────────────────────────────────────────

const general = { channelId: C.general.id };
const generalMessages: Message[] = [
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
  [C.announcements.id]: announcementMessages,
  [C.general.id]: generalMessages,
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

export const SHOWCASE_DM_PRIYA = 'dm-priya';
export const SHOWCASE_DM_LAUNCH = 'dm-launch';

const dmPriya = { dmId: SHOWCASE_DM_PRIYA };
const dmLaunch = { dmId: SHOWCASE_DM_LAUNCH };
const dmMarcus = { dmId: 'dm-marcus' };
const dmGrace = { dmId: 'dm-grace' };
const dmKwame = { dmId: 'dm-kwame' };

const messagesByDmGroup: Record<string, Message[]> = {
  [SHOWCASE_DM_LAUNCH]: [
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
  [SHOWCASE_DM_PRIYA]: [
    // Yesterday: the empty states she shares in #dev today (13:40). Enough
    // history that the conversation scrolls, like a real 1:1 would.
    msg(dmPriya, U.priya, at('10:12', 1), 'morning! are we keeping the old onboarding illustrations for 2.4?'),
    msg(dmPriya, me, at('10:20', 1), 'only the welcome one, the rest can go'),
    msg(dmPriya, U.priya, at('10:21', 1), 'yesss 🎨'),
    msg(dmPriya, U.priya, at('16:05', 1), 'first pass at the empty states, still rough but you get the idea'),
    msg(dmPriya, me, at('16:30', 1), 'love the direction, the channel one especially'),
    msg(dmPriya, U.priya, at('16:31', 1), 'that one took the longest 😅'),
    msg(dmPriya, me, at('16:32', 1), 'can you share them in #dev tomorrow so the team can weigh in?'),
    msg(dmPriya, U.priya, at('16:33', 1), 'will do 👍'),
    msg(dmPriya, U.priya, at('13:30'), 'hey! do you have 5 minutes later to look at the onboarding copy?'),
    msg(dmPriya, me, at('13:32'), 'sure, after standup this afternoon?'),
    msg(dmPriya, U.priya, at('13:33'), 'perfect 🙏'),
    msg(dmPriya, U.priya, at('15:20'), 'sent you the Figma link, no rush', { id: 'sc-dm-priya-figma' }),
    msg(dmPriya, U.priya, at('15:21'), 'also… I may have made three more illustrations 😅', { id: 'sc-dm-priya-illustrations' }),
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
  dmGroup(SHOWCASE_DM_PRIYA, [me, U.priya], null, messagesByDmGroup[SHOWCASE_DM_PRIYA]),
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
 * the watched release thread. Unread ones match the unread DMs/mention below
 * (bell = 2 + 3 + 1); older read ones were cleared from the inbox. Newest
 * first, like the API.
 */
const notifications: NotificationDto[] = [
  notification('DIRECT_MESSAGE', 'sc-dm-priya-illustrations'),
  notification('DIRECT_MESSAGE', 'sc-dm-priya-figma'),
  notification('DIRECT_MESSAGE', 'sc-dm-launch-signoff'),
  notification('DIRECT_MESSAGE', 'sc-dm-launch-screens'),
  notification('DIRECT_MESSAGE', 'sc-dm-launch-copy'),
  notification('THREAD_REPLY', 'sc-thread-changelog', true),
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
 * `createDefaultCommunityRoles`), and the creator is its Community Admin.
 * Lumen Studio added two custom roles later.
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
  const isLumen = c.id === LUMEN;
  const release = role(c.id, 'Release Manager', [...MEMBER_ACTIONS, 'PIN_MESSAGE', 'UNPIN_MESSAGE', 'CREATE_INVITE'], 30, { createdDaysAgo: 142 });
  const designer = role(c.id, 'Designer', [...MEMBER_ACTIONS, 'MANAGE_EMOJIS', 'CREATE_SOUNDBOARD_SOUND'], 40, { createdDaysAgo: 96 });
  rolesByCommunity[c.id] = isLumen ? [admin, moderator, release, designer, member] : [admin, moderator, member];
  membershipsByCommunity[c.id] = c.memberIds.map((id, i) => {
    const user = id === me.id ? me : users.find((u) => u.id === id)!;
    const roles =
      id === c.ownerId
        ? [admin]
        : !isLumen
          ? [member]
          : id === U.grace.id || id === U.marcus.id
            ? [moderator]
            : id === U.samira.id
              ? [release]
              : id === U.priya.id || id === U.diego.id
                ? [designer]
                : [member];
    return {
      id: `sc-membership-${c.id}-${i}`,
      userId: id,
      communityId: c.id,
      // The creator joined the day the community was made; everyone else after.
      joinedAt: i === 0 ? c.createdAt : at('10:00', COMMUNITY_AGE_DAYS - 20 - i * 23),
      roles,
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
 * Who's in which voice channel, before Alex joins anything. Each person is in
 * at most one channel, and everyone in voice is online. The Lounge is the
 * design/writing crew co-working; the release crew is in Standup (Alex heads
 * there at 3:42 in the phone clip). The Voice story adds Alex to the Lounge
 * (`showcaseWithMeInVoice`) and keeps everyone else where they are.
 */
export const showcaseLoungeCrew: ScenarioUser[] = [U.priya, U.diego, U.chloe];
const voicePresenceByChannel: Record<string, VoicePresenceUserDto[]> = {
  [C.lounge.id]: presence([
    [U.priya, at('15:05')],
    [U.diego, at('15:08')],
    [U.chloe, at('15:21')],
  ]),
  [C.standup.id]: presence([
    [U.samira, at('15:36')],
    [U.marcus, at('15:38')],
    [U.aiko, at('15:39')],
  ]),
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
  threadRepliesByParent: { [SHOWCASE_THREAD_PARENT_ID]: threadReplies },
  pinnedByChannel,
  voicePresenceByChannel,
  dmGroups,
  messagesByDmGroup,
  unreadByContextId: {},
  notifications,
  friendships,
  membershipsByCommunity,
  rolesByCommunity,
  instanceName: 'Lumen Studio',
};
// Unread = the newest N messages of each context (the DM ones match the
// unread DIRECT_MESSAGE notifications above; #design's mention is 11:20).
assembled = withUnread(assembled, C.general.id, 4);
assembled = withUnread(assembled, C.design.id, 3, 1);
assembled = withUnread(assembled, C.announcements.id, 1);
assembled = withUnread(assembled, 'tr-general', 1);
assembled = withUnread(assembled, SHOWCASE_DM_PRIYA, 2);
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

/** The showcase with Alex connected to a voice channel: joins the people already there (last, just now). */
export function showcaseWithMeInVoice(channelId: string, scenario: Scenario = showcaseScenario): Scenario {
  const already = scenario.voicePresenceByChannel[channelId] ?? [];
  return {
    ...scenario,
    voicePresenceByChannel: {
      ...scenario.voicePresenceByChannel,
      [channelId]: [...already, ...presence([[me, at('15:41')]])],
    },
  };
}
export const showcaseMe = me;
/** Showcase users by username (`priya`, `marcus`, `aiko`, ...). */
export const showcaseUsers = U;
export const SHOWCASE_COMMUNITY_ID = LUMEN;

export const showcasePaths = {
  dev: `/community/${LUMEN}/channel/${C.dev.id}`,
  general: `/community/${LUMEN}/channel/${C.general.id}`,
  lounge: `/community/${LUMEN}/channel/${C.lounge.id}`,
  community: `/community/${LUMEN}`,
  communitySettings: `/community/${LUMEN}/edit`,
  dms: '/direct-messages',
  dmPriya: `/direct-messages/${SHOWCASE_DM_PRIYA}`,
  dmLaunch: `/direct-messages/${SHOWCASE_DM_LAUNCH}`,
  notifications: '/notifications',
  settings: '/settings',
  profile: `/profile/${U.priya.id}`,
  home: '/',
};
