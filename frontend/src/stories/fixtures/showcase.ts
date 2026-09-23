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
    id: 'u-diego', username: 'diego', displayName: 'Diego Alvarez', status: 'Writing landing page copy',
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
const trailMembers = [me, U.tomas, U.grace, U.noah, U.zara, U.mateo, U.chloe];
const synthMembers = [me, U.kwame, U.diego, U.aiko, U.mateo];

function community(
  id: string,
  name: string,
  description: string,
  glyph: 'lumen' | 'trail' | 'synth',
  banner: [string, string],
  channels: Channel[],
  members: ScenarioUser[],
): ScenarioCommunity {
  return {
    id,
    name,
    description,
    avatar: registerShowcaseFile(`sc-community-${glyph}`, () => communityIconSvg(glyph)),
    banner: registerShowcaseFile(`sc-community-banner-${glyph}`, () => bannerSvg(banner[0], banner[1])),
    createdAt: at('09:00', 400),
    channels,
    memberIds: members.map((u) => u.id),
    ownerId: me.id,
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
  msg(dev, U.grace, at('14:47'), 'CI is green on all three runners 🟢', { reactions: [react('💚', U.marcus, U.samira, U.priya)] }),
];

const threadReplies: Message[] = [
  msg(dev, U.marcus, at('14:24'), 'Thursday. The mobile pass can land in 2.4.1', { parentMessageId: SHOWCASE_THREAD_PARENT_ID }),
  msg(dev, U.priya, at('14:26'), "+1, the empty states don't depend on it either", {
    parentMessageId: SHOWCASE_THREAD_PARENT_ID,
    reactions: [react('👍', U.samira, U.marcus)],
  }),
  msg(dev, U.aiko, at('14:29'), "I'll do a final QA pass on iOS and Android tonight 📱", { parentMessageId: SHOWCASE_THREAD_PARENT_ID }),
  msg(dev, U.samira, at('14:33'), "Perfect. I'll draft the changelog and tag the release Thursday morning", {
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
  msg(design, U.priya, at('11:20'), [mention(me), text(' can we use the violet as the default accent in the app too?')]),
];

const announcements = { channelId: C.announcements.id };
const announcementMessages: Message[] = [
  msg(announcements, U.samira, at('09:30', 1), [
    text('Lumen 2.3.2 is out 🎉', { bold: true }),
    text(' Faster uploads, fixed notification sounds on Android, and a much nicer settings page. Full notes in #dev.'),
  ], { reactions: [react('🎉', U.marcus, U.priya, U.aiko, U.grace, U.tomas, me)], pinned: true }),
];

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
  'tr-general': [msg({ channelId: 'tr-general' }, U.grace, at('10:10'), 'Who is in for the ridge loop on Saturday? 🥾')],
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
    msg(dmLaunch, U.samira, at('17:10', 1), 'Launch checklist is pinned in #announcements, shout if I missed anything'),
    msg(dmLaunch, U.aiko, at('17:24', 1), 'Looks complete to me 👌'),
    msg(dmLaunch, U.diego, at('17:31', 1), "Blog post draft is ready too, I'll share it in the morning ✍️"),
    msg(dmLaunch, U.samira, at('14:55'), 'Status check for Thursday: ✅ QA plan ✅ release notes ⏳ changelog sign-off'),
    msg(dmLaunch, U.diego, at('15:02'), 'Landing page copy is final, preview link is in the doc', { reactions: [react('🎉', U.samira, U.aiko)] }),
    msg(dmLaunch, U.aiko, at('15:05'), 'Store screenshots updated for 2.4 📸', { reactions: [react('🙌', U.samira, U.diego)] }),
    msg(dmLaunch, U.samira, at('15:12'), [mention(me), text(' can you sign off on the changelog before Thursday?')]),
  ],
  [SHOWCASE_DM_PRIYA]: [
    msg(dmPriya, U.priya, at('13:30'), 'hey! do you have 5 minutes later to look at the onboarding copy?'),
    msg(dmPriya, me, at('13:32'), 'sure, right after standup?'),
    msg(dmPriya, U.priya, at('13:33'), 'perfect 🙏'),
    msg(dmPriya, U.priya, at('15:20'), 'sent you the Figma link, no rush'),
    msg(dmPriya, U.priya, at('15:21'), 'also… I may have made three more illustrations 😅'),
  ],
  'dm-marcus': [
    msg(dmMarcus, U.marcus, at('11:02'), 'pairing tomorrow at 10 still good?'),
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

function notification(
  i: number,
  type: NotificationDto['type'],
  author: ScenarioUser,
  time: string,
  spans: Span[],
  where: { channelId?: string; dmId?: string; communityId?: string },
  read = false,
): NotificationDto {
  return {
    id: `sc-notif-${i}`,
    type,
    userId: me.id,
    messageId: `sc-notif-msg-${i}`,
    channelId: where.channelId ?? null,
    directMessageGroupId: where.dmId ?? null,
    communityId: where.communityId ?? null,
    authorId: author.id,
    parentMessageId: null,
    read,
    dismissed: false,
    createdAt: time,
    author: { id: author.id, username: author.username, displayName: author.displayName, avatarUrl: author.avatarUrl },
    message: {
      id: `sc-notif-msg-${i}`,
      spans: spans as never,
      channelId: where.channelId ?? null,
      directMessageGroupId: where.dmId ?? null,
    },
  };
}

const notifications: NotificationDto[] = [
  notification(1, 'DIRECT_MESSAGE', U.priya, at('15:21'), [text('also… I may have made three more illustrations 😅')], { dmId: SHOWCASE_DM_PRIYA }),
  notification(2, 'USER_MENTION', U.samira, at('15:12'), [mention(me), text(' can you sign off on the changelog before Thursday?')], { dmId: SHOWCASE_DM_LAUNCH }),
  notification(3, 'USER_MENTION', U.priya, at('11:20'), [mention(me), text(' can we use the violet as the default accent in the app too?')], { channelId: C.design.id, communityId: LUMEN }),
  notification(4, 'THREAD_REPLY', U.samira, at('14:33'), [text("Perfect. I'll draft the changelog and tag the release Thursday morning")], { channelId: C.dev.id, communityId: LUMEN }, true),
  notification(5, 'CHANNEL_MESSAGE', U.grace, at('10:10'), [text('Who is in for the ridge loop on Saturday? 🥾')], { channelId: 'tr-general', communityId: TRAIL }, true),
];

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

function role(communityId: string, name: string, actions: RoleDto['actions'], position: number): RoleDto {
  return { id: `role-${name.toLowerCase().replace(/\W+/g, '-')}-${communityId}`, name, actions, createdAt: at('09:00', 400), isDefault: name === 'Member', position };
}

const rolesByCommunity: Record<string, RoleDto[]> = {};
const membershipsByCommunity: Record<string, MembershipResponseDto[]> = {};
for (const c of communities) {
  const owner = role(c.id, 'Owner', ADMIN_ACTIONS, 0);
  const moderator = role(c.id, 'Moderator', ADMIN_ACTIONS.filter((a) => !/COMMUNITY|ROLE/.test(a)), 1);
  const release = role(c.id, 'Release Manager', [...MEMBER_ACTIONS, 'PIN_MESSAGE', 'UNPIN_MESSAGE', 'CREATE_INVITE'], 2);
  const designer = role(c.id, 'Designer', [...MEMBER_ACTIONS, 'MANAGE_EMOJIS', 'CREATE_SOUNDBOARD_SOUND'], 3);
  const member = role(c.id, 'Member', MEMBER_ACTIONS, 4);
  rolesByCommunity[c.id] = [owner, moderator, release, designer, member];
  membershipsByCommunity[c.id] = c.memberIds.map((id, i) => {
    const user = id === me.id ? me : users.find((u) => u.id === id)!;
    const roles =
      id === me.id
        ? [owner]
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
      joinedAt: at('10:00', 300 - i * 9),
      roles,
      user: user as never,
    };
  });
}

function presence(list: ScenarioUser[], since: string): VoicePresenceUserDto[] {
  return list.map((u) => ({
    id: u.id,
    username: u.username,
    displayName: u.displayName ?? undefined,
    avatarUrl: u.avatarUrl ?? undefined,
    joinedAt: since,
    isDeafened: false,
    isServerMuted: false,
  }));
}

/** Who's in which voice channel when the viewer is NOT connected. */
const voicePresenceByChannel: Record<string, VoicePresenceUserDto[]> = {
  [C.lounge.id]: presence([U.kwame, U.zara], at('15:05')),
  [C.standup.id]: presence([U.marcus, U.samira, U.aiko], at('15:38')),
  'tr-campfire': presence([U.noah], at('14:00')),
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
  pinnedByChannel: {},
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
assembled = withUnread(assembled, C.general.id, 4);
assembled = withUnread(assembled, C.design.id, 3, 1);
assembled = withUnread(assembled, C.announcements.id, 1);
assembled = withUnread(assembled, 'tr-general', 6);
assembled = withUnread(assembled, SHOWCASE_DM_PRIYA, 2);
assembled = withUnread(assembled, SHOWCASE_DM_LAUNCH, 3, 1);

export const showcaseScenario: Scenario = assembled;
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
