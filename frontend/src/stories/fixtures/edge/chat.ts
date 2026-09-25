/**
 * Edge-case fixture helpers for the "chat content" area (stories in
 * `src/stories/edge/chat/`, ids `edge-chat-*`).
 *
 * Deterministic (explicit ids + seeded RNG via `buildScenario`) and shaped
 * like the real backend:
 *  - `/api/messages/channel|group/:id` are cursor-paginated newest-first
 *    (`limit`, `continuationToken` = last id of the previous page,
 *    `direction=older|newer`), and `/around/:messageId` returns
 *    `{messages, olderContinuationToken, newerContinuationToken}` with
 *    `floor((limit-1)/2)` on each side (messages.service.ts
 *    findAllByField / findAroundMessage) — `chatHandlers()` implements both so
 *    long histories page and anchor like prod;
 *  - `/api/threads/:id/replies` is oldest-first, 50 per page, with a
 *    continuationToken (threads.service.ts getThreadReplies);
 *  - message deletion is a HARD delete and `replyToId` is `onDelete: SetNull`
 *    (schema.prisma), so a reply whose target was deleted comes back with
 *    `replyTo: null` — NOT a `replyTo.deletedAt` tombstone;
 *  - special mentions are `here`/`channel` (useMentionAutocomplete) — there
 *    is no `@everyone`;
 *  - `pendingAttachments` is the server's count of files still uploading;
 *  - optimistic `sendStatus: 'pending'|'failed'` rows are cache-local only,
 *    so `useInjectOptimisticMessages` writes them into the TanStack cache via
 *    the product's own `prependMessageToInfinite`/`markOptimisticFailed`
 *    updaters — the same transitions `useOptimisticSendMessage` performs.
 */
import { useEffect, useRef } from 'react';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { delay, http, HttpResponse, type HttpHandler } from 'msw';
import { createMessage, createSpan, createChannel, createReaction, createDmGroupMember } from '../../../__tests__/test-utils/factories';
import type { Message, Span, FileMetadata, LinkPreview } from '../../../types/message.type';
import { SpanType } from '../../../types/message.type';
import type { Channel } from '../../../types/channel.type';
import type { DirectMessageGroup } from '../../../types/direct-message.type';
import type { MembershipResponseDto, PaginatedMessagesResponseDto, EnrichedThreadReplyDto } from '../../../api-client/types.gen';
import { parseMessageWithMentions } from '../../../utils/mentionParser';
import { prependMessageToInfinite, markOptimisticFailed } from '../../../utils/messageCacheUpdaters';
import { channelMessagesQueryKey, dmMessagesQueryKey } from '../../../utils/messageQueryKeys';
import { buildScenario } from '../builder';
import { placeholderPhoto } from '../avatars';
import { timeAgo } from '../rng';
import type { Scenario, ScenarioUser } from '../types';

// ── Base scenario ──────────────────────────────────────────────────────

const base = buildScenario({
  seed: 'edge-chat',
  userCount: 60,
  communityCount: 1,
  textChannelsPerCommunity: 3,
  voiceChannelsPerCommunity: 1,
  messagesInGeneral: 12,
  messagesPerOtherChannel: 4,
  dmGroupCount: 4,
  notificationCount: 2,
  meOverrides: { role: 'OWNER' },
});

const me = base.me;
const users = base.users;
const community = base.communities[0];
/** Stable cast of characters (first few seeded users). */
const [ava, bo, cy, di, ed] = users;

const U = (u: ScenarioUser) => ({ id: u.id, username: u.username, displayName: u.displayName ?? undefined });
const everyoneMentionable = [me, ...users].map(U);

// ── Message builders ───────────────────────────────────────────────────

let seq = 0;
/** Deterministic message id per channel key. */
function mid(key: string): string {
  seq += 1;
  return `edge-chat-${key}-${seq}`;
}

function text(t: string): Span[] {
  return [createSpan({ text: t })];
}

/** Spans exactly as the composer would send them (markdown + @mentions parsed client-side). */
export function composed(raw: string): Span[] {
  return parseMessageWithMentions(raw, everyoneMentionable) as Span[];
}

interface MsgOpts extends Partial<Message> {
  spans?: Span[];
}

function makeMsg(ctx: { channelId?: string; dmId?: string; key: string }, authorId: string, minutesAgo: number, spans: Span[], extra: MsgOpts = {}): Message {
  return createMessage({
    id: mid(ctx.key),
    channelId: ctx.channelId ?? null,
    directMessageGroupId: ctx.dmId ?? null,
    authorId,
    spans,
    sentAt: timeAgo(minutesAgo),
    reactions: [],
    attachments: [],
    pinned: false,
    replyCount: 0,
    lastReplyAt: null,
    pendingAttachments: 0,
    linkPreviews: [],
    ...extra,
  });
}

const FILLER = [
  'morning all ☀️',
  'anyone around? want a second pair of eyes on something',
  'sure, what’s up',
  'ok here goes, bear with me',
];

function filler(ctx: { channelId?: string; dmId?: string; key: string }, startMinutesAgo: number, authors: ScenarioUser[] = [ava, bo, me, ava]): Message[] {
  return FILLER.map((t, i) => makeMsg(ctx, authors[i % authors.length].id, startMinutesAgo - i * 2, text(t)));
}

function file(id: string, filename: string, mimeType: string, fileType: string, size: number, hasThumbnail = false): FileMetadata {
  return { id, filename, mimeType, fileType, size, hasThumbnail };
}

/** Image attachment whose file id encodes its pixel size — `chatHandlers()` serves an SVG of exactly that size. */
export function sizedImageId(key: string, width: number, height: number): string {
  return `edge-chat-img-${width}x${height}-${key}`;
}

const LOREM =
  'So here is the full write-up of what happened during the migration last night, because I know half of you were asleep and the other half were fighting the staging cluster. ' +
  'We started the cutover at 22:00 as planned, drained the old workers, and flipped the feature flag for the new queue consumer. Everything looked healthy for about forty minutes, then the retry queue started growing faster than we were draining it. ' +
  'It turned out the new consumer was acknowledging messages before the downstream write committed, so any transient database error meant the message was silently dropped instead of retried. ' +
  'We rolled the flag back at 23:10, replayed the dead-letter queue by hand (about 1,400 messages, all idempotent thankfully), and verified counts against the audit table. ' +
  'Action items: (1) move the ack after the commit, (2) add an alert on retry-queue growth rate rather than absolute size, (3) write a proper runbook for the replay because I did it from shell history and that is not ok, ' +
  '(4) get a second reviewer on anything that touches delivery semantics. I will open tickets for all four this morning. Thanks to everyone who stuck around, genuinely. ' +
  'Also, for the record, the coffee machine on floor three is broken again and I think that contributed to at least one of my decisions around 23:40.';

// ── Channels ───────────────────────────────────────────────────────────

interface ChannelBuild {
  channel: Channel;
  messages: Message[];
}

const channelBuilds: ChannelBuild[] = [];
const threadReplies: Record<string, Message[]> = {};
/** parentMessageId → isSubscribed (watched). */
const threadWatched: Record<string, boolean> = {};

function addChannel(slug: string, name: string, build: (ctx: { channelId: string; key: string }) => Message[], opts: { slowmodeSeconds?: number } = {}): Channel {
  const channel = createChannel({
    id: `edge-chat-ch-${slug}`,
    communityId: community.id,
    name,
    type: 'TEXT',
    position: 100 + channelBuilds.length,
    slowmodeSeconds: opts.slowmodeSeconds ?? 0,
    createdAt: timeAgo(60 * 24 * 90),
  });
  const messages = build({ channelId: channel.id, key: slug });
  channelBuilds.push({ channel, messages });
  return channel;
}


// Wall of text
export const wallOfTextChannel = addChannel('wall', 'wall-of-text', (ctx) => [
  ...filler(ctx, 60),
  makeMsg(ctx, ava.id, 40, text(LOREM)),
  makeMsg(ctx, ava.id, 39, text(`${LOREM}\n\n${LOREM}`)),
  makeMsg(ctx, bo.id, 30, text('tl;dr?')),
]);

// Emoji-only + link-only + long URLs
export const emojiLinksChannel = addChannel('emoji', 'emoji-and-links', (ctx) => [
  ...filler(ctx, 80),
  makeMsg(ctx, bo.id, 50, text('🎉')),
  makeMsg(ctx, cy.id, 49, text('😂😂😂')),
  makeMsg(ctx, di.id, 48, text('🔥'.repeat(64))),
  makeMsg(ctx, ed.id, 47, text('👨‍👩‍👧‍👦🏳️‍🌈🧑🏽‍💻👩🏿‍🚀🇯🇵🇧🇷🇳🇬')),
  makeMsg(ctx, ava.id, 46, text('https://example.com/docs')),
  makeMsg(ctx, bo.id, 45, text(
    'https://analytics.example.com/dashboards/shared/7f3c9a1e-44b2-4c7e-9d1a-2b6f0e8c5a93/panels?from=2026-09-01T00%3A00%3A00Z&to=2026-09-22T23%3A59%3A59Z&filter%5Bservice%5D=delivery-queue-consumer&filter%5Benv%5D=production&groupBy=region%2Cinstance_type&token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0',
  )),
  makeMsg(ctx, cy.id, 44, text(
    'the build hash is 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a089f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 if anyone needs it',
  )),
  makeMsg(ctx, me.id, 43, text('Supercalifragilisticexpialidocious_Pneumonoultramicroscopicsilicovolcanoconiosis_Antidisestablishmentarianism')),
]);

// Code blocks
export const codeChannel = addChannel('code', 'code-blocks', (ctx) => [
  ...filler(ctx, 80),
  makeMsg(ctx, di.id, 40, composed(
    'this is the line that blows up:\n```\nconst result = await deliveryQueueConsumer.processBatch(messages.filter((m) => m.attempts < MAX_ATTEMPTS && !m.deadLettered && m.tenantId === currentTenant.id), { ackMode: "after-commit", timeoutMs: 30_000, retryPolicy: exponentialBackoff({ base: 250, max: 60_000 }) });\n```',
  )),
  makeMsg(ctx, ed.id, 38, composed(
    '```\n' + Array.from({ length: 30 }, (_, i) => `${String(i + 1).padStart(2, '0')}  [2026-09-22T23:${String(10 + i).padStart(2, '0')}:04Z] WARN consumer-7 retry queue depth=${1000 + i * 47} lag_ms=${i * 1200}`).join('\n') + '\n```',
  )),
  makeMsg(ctx, di.id, 36, composed('use `deliveryQueueConsumer.processBatchWithExplicitAcknowledgementAfterCommit()` instead')),
]);

// Markdown edge cases (exactly what the composer's parser emits)
export const markdownChannel = addChannel('markdown', 'markdown', (ctx) => [
  ...filler(ctx, 80),
  makeMsg(ctx, ava.id, 40, composed('**bold** *italic* ~~strike~~ `code` ***bold italic*** **~~bold strike~~**')),
  makeMsg(ctx, bo.id, 39, composed('unclosed **bold and *italic and `code with no end')),
  makeMsg(ctx, cy.id, 38, composed('# Not a heading\n> not a quote\n- not a list\n1. not ordered\n[link text](https://example.com)')),
  makeMsg(ctx, di.id, 37, composed('snake_case_names and 2*3*4 = 24 and a lone * star and ~tilde~')),
  makeMsg(ctx, ed.id, 36, composed('```\n**not bold inside a fence**\n```\n**bold after fence**')),
  makeMsg(ctx, me.id, 35, composed('    \n\n\nlots of\n\n\n\nblank lines\n\n\n')),
]);

// Mentions
const twentyMentioned = users.slice(0, 20);
export const mentionsChannel = addChannel('mentions', 'mentions', (ctx) => [
  ...filler(ctx, 80),
  makeMsg(ctx, ava.id, 40, composed(`standup roll call: ${twentyMentioned.map((u) => `@${u.username}`).join(' ')}`)),
  makeMsg(ctx, bo.id, 38, composed('@here deploy freeze starts in 10 minutes')),
  makeMsg(ctx, cy.id, 37, composed('@channel please read the incident doc before tomorrow')),
  makeMsg(ctx, di.id, 36, composed(`@${me.username} can you approve the rollback PR?`)),
]);

// Reactions
/** 150 reactors: me + the 30 default members + deterministic ids of members not in this scenario's user list. */
const PIZZA_REACTORS = [me.id, ...users.slice(0, 30).map((u) => u.id), ...Array.from({ length: 119 }, (_, i) => `edge-chat-reactor-${i + 1}`)];
const reactionEmojis = ['👍', '👎', '😂', '❤️', '🎉', '🔥', '👀', '🙏', '💯', '🚀', '😮', '😢', '😡', '🤔', '👏', '🙌', '✅', '❌', '⭐', '🍕', '☕', '🐛', '🧠', '💀', '🤯', '🥳', '😴', '🫡', '🦄', '🌈'];
export const reactionsChannel = addChannel('reactions', 'reactions', (ctx) => [
  ...filler(ctx, 80),
  makeMsg(ctx, ava.id, 40, text('we hit 1.0 🎉'), {
    reactions: reactionEmojis.map((emoji, i) =>
      createReaction({ emoji, userIds: [...users.slice(i % 20, (i % 20) + 1 + (i % 4)).map((u) => u.id), ...(i === 4 ? [me.id] : [])] }),
    ),
  }),
  makeMsg(ctx, bo.id, 38, text('free pizza in the kitchen'), {
    reactions: [
            createReaction({ emoji: '🍕', userIds: PIZZA_REACTORS }),
      createReaction({ emoji: '🏃', userIds: users.slice(0, 12).map((u) => u.id) }),
    ],
  }),
]);

// Edited / reply to deleted / quotes
const quoteTarget = { id: 'edge-chat-edited-quote-target', authorId: bo.id };
export const editedChannel = addChannel('edited', 'edited-and-replies', (ctx) => {
  const target = makeMsg(ctx, bo.id, 50, text(LOREM), { id: quoteTarget.id });
  return [
    ...filler(ctx, 80),
    target,
    makeMsg(ctx, cy.id, 45, text('fixed the typo, sorry'), { editedAt: timeAgo(44) }),
    makeMsg(ctx, cy.id, 44, text(`${LOREM.slice(0, 400)} (edited several times)`), { editedAt: timeAgo(10) }),
    makeMsg(ctx, di.id, 42, text('replying to a long message'), {
      replyToId: target.id,
      replyTo: { id: target.id, authorId: target.authorId, spans: target.spans, sentAt: target.sentAt, deletedAt: null },
    }),
    // Target was hard-deleted → replyToId SET NULL, replyTo null (see module doc).
    makeMsg(ctx, ed.id, 40, text('^ agree with what you said there (the message I replied to has since been deleted)'), { replyToId: null, replyTo: null }),
    makeMsg(ctx, me.id, 39, text('replying to a mention-only message'), {
      replyToId: 'edge-chat-edited-mention-src',
      replyTo: {
        id: 'edge-chat-edited-mention-src',
        authorId: ava.id,
        spans: composed(`@${users[5].username} @${users[6].username}`),
        sentAt: timeAgo(70),
        deletedAt: null,
      },
    }),
  ];
});

// Consecutive-author runs vs alternating
export const runsChannel = addChannel('runs', 'author-runs', (ctx) => [
  ...['ok so', 'I have', 'a few', 'thoughts', 'coming in', 'one line at a time'].map((t, i) => makeMsg(ctx, ava.id, 60 - i, text(t))),
  ...['ping', 'pong', 'ping', 'pong', 'ping', 'pong'].map((t, i) => makeMsg(ctx, i % 2 ? bo.id : cy.id, 40 - i, text(t))),
]);

// Optimistic send states — list is normal; the pending/failed rows are injected into the cache by the story.
export const sendStatesChannel = addChannel('send', 'send-states', (ctx) => filler(ctx, 30, [ava, me, bo, me]));

// Slow mode (backend enforces slowmodeSeconds; frontend has no UI for it)
export const slowModeChannel = addChannel('slow', 'slow-mode', (ctx) => filler(ctx, 20), { slowmodeSeconds: 60 });

// Attachments
export const mediaChannel = addChannel('media', 'media', (ctx) => [
  ...filler(ctx, 90),
  makeMsg(ctx, ava.id, 50, text('very tall screenshot of the log'), { attachments: [file(sizedImageId('tall', 400, 2400), 'tall-log.png', 'image/png', 'IMAGE', 1_840_000)] }),
  makeMsg(ctx, bo.id, 45, text('panorama from the offsite'), { attachments: [file(sizedImageId('wide', 3200, 300), 'panorama.jpg', 'image/jpeg', 'IMAGE', 4_200_000)] }),
  makeMsg(ctx, cy.id, 40, text(''), { attachments: [file(sizedImageId('tiny', 16, 16), 'favicon.png', 'image/png', 'IMAGE', 900)] }),
]);

export const multiImageChannel = addChannel('multi', 'multi-image', (ctx) => [
  ...filler(ctx, 90),
  makeMsg(ctx, di.id, 50, text('photo dump from the weekend'), {
    attachments: [
      file(sizedImageId('m1', 1200, 800), 'IMG_0001.jpg', 'image/jpeg', 'IMAGE', 2_100_000),
      file(sizedImageId('m2', 800, 1200), 'IMG_0002.jpg', 'image/jpeg', 'IMAGE', 2_300_000),
      file(sizedImageId('m3', 1000, 1000), 'IMG_0003.jpg', 'image/jpeg', 'IMAGE', 1_900_000),
      file(sizedImageId('m4', 1600, 600), 'IMG_0004.jpg', 'image/jpeg', 'IMAGE', 2_600_000),
      file(sizedImageId('m5', 600, 1600), 'IMG_0005.jpg', 'image/jpeg', 'IMAGE', 2_200_000),
    ],
  }),
  makeMsg(ctx, ed.id, 45, text('mixed bag'), {
    attachments: [
      file(sizedImageId('mix', 1200, 800), 'diagram.png', 'image/png', 'IMAGE', 340_000),
      file('edge-chat-file-mixed-pdf', 'Q3 Delivery Reliability Review — FINAL (v7, really final).pdf', 'application/pdf', 'DOCUMENT', 3_400_000),
      file('edge-chat-file-mixed-video', 'screen-recording.mp4', 'video/mp4', 'VIDEO', 18_000_000, true),
    ],
  }),
]);

export const filesChannel = addChannel('files', 'files', (ctx) => [
  ...filler(ctx, 90),
  makeMsg(ctx, ava.id, 50, text('recording of the incident call'), { attachments: [file('edge-chat-file-video', 'incident-call-2026-09-22.mp4', 'video/mp4', 'VIDEO', 24_600_000, true)] }),
  makeMsg(ctx, bo.id, 45, text(''), { attachments: [file('edge-chat-file-zip', 'delivery-queue-consumer-heap-dump-production-eu-west-1-2026-09-22T23-41-07Z.hprof.zip', 'application/zip', 'OTHER', 24_900_000)] }),
  makeMsg(ctx, cy.id, 40, text('voice note'), { attachments: [file('edge-chat-file-audio', 'voice-note.mp3', 'audio/mpeg', 'AUDIO', 1_200_000)] }),
  makeMsg(ctx, di.id, 35, text('uploading the full set now…'), { pendingAttachments: 3, attachments: [] }),
]);

export const GIF_URL = 'https://media.giphy.com/media/edgeChatDemo/giphy.gif';
export const gifsChannel = addChannel('gifs', 'gifs-and-previews', (ctx) => [
  ...filler(ctx, 90),
  makeMsg(ctx, ava.id, 50, text(GIF_URL)),
  makeMsg(ctx, bo.id, 48, text(''), { attachments: [file(sizedImageId('gif', 480, 270), 'reaction.gif', 'image/gif', 'IMAGE', 2_800_000)] }),
  makeMsg(ctx, cy.id, 46, text('great write-up on queue semantics https://blog.example.com/posts/at-least-once-delivery'), {
    linkPreviews: [{
      url: 'https://blog.example.com/posts/at-least-once-delivery',
      title: 'At-least-once delivery, idempotency keys, and the lies we tell ourselves about exactly-once semantics in distributed queues',
      description: 'A long, opinionated tour through acknowledgement ordering, visibility timeouts, dead-letter queues and why "exactly once" is usually "at least once plus deduplication". '.repeat(2),
      imageUrl: 'https://images.example.com/og/at-least-once.png',
      siteName: 'The Example Engineering Blog',
      faviconUrl: 'https://images.example.com/favicon.png',
    } satisfies LinkPreview],
  }),
  makeMsg(ctx, di.id, 44, text('https://docs.example.com/runbooks/replay'), {
    linkPreviews: [{ url: 'https://docs.example.com/runbooks/replay', title: 'Runbook: replaying the dead-letter queue', siteName: 'docs.example.com' }],
  }),
]);

// Threads: 0 / 1 / 200 replies, watched vs not
function reply(parent: Message, authorId: string, minutesAgo: number, spans: Span[], i: number): Message {
  return createMessage({
    id: `edge-chat-reply-${parent.id}-${i}`,
    channelId: parent.channelId,
    authorId,
    spans,
    sentAt: timeAgo(minutesAgo),
    parentMessageId: parent.id,
    reactions: [],
    attachments: [],
  });
}

function withReplies(parent: Message, replies: Message[], watched: boolean): Message {
  threadReplies[parent.id] = replies;
  threadWatched[parent.id] = watched;
  return { ...parent, replyCount: replies.length, lastReplyAt: replies.length ? replies[replies.length - 1].sentAt : null };
}

export const THREAD_IDS = {
  none: 'edge-chat-thread-none',
  one: 'edge-chat-thread-one',
  many: 'edge-chat-thread-200',
  long: 'edge-chat-thread-long',
};

export const threadsChannel = addChannel('threads', 'threads', (ctx) => {
  const none = makeMsg(ctx, ava.id, 300, text('no replies on this one'), { id: THREAD_IDS.none });
  const one = makeMsg(ctx, bo.id, 290, text('one reply here'), { id: THREAD_IDS.one });
  const many = makeMsg(ctx, cy.id, 280, text('incident thread — keep all updates in here please'), { id: THREAD_IDS.many });
  const long = makeMsg(ctx, di.id, 270, text('design review: queue consumer v2 (long replies)'), { id: THREAD_IDS.long });
  const pool = [me, ...users];
  return [
    none,
    withReplies(one, [reply(one, me.id, 285, text('👍 on it'), 1)], false),
    withReplies(
      many,
      Array.from({ length: 200 }, (_, i) =>
        reply(many, pool[i % 25].id, 279 - i, text(i % 7 === 0 ? `update ${i + 1}: still investigating, retry depth ${1000 + i * 13}` : `update ${i + 1}`), i + 1),
      ),
      true,
    ),
    withReplies(
      long,
      Array.from({ length: 8 }, (_, i) =>
        reply(long, pool[(i * 3) % 20].id, 260 - i * 3, i % 2 ? text(LOREM) : composed(`@${users[i].username} ${LOREM.slice(0, 300)}\n\`\`\`\nconst consumer = createConsumer({ ackMode: 'after-commit', maxInFlight: ${i * 8 + 16}, visibilityTimeoutMs: 120000, deadLetterAfter: 5 });\n\`\`\``), i + 1),
      ),
      false,
    ),
    makeMsg(ctx, ed.id, 100, text('(thread badges above: 0 / 1 / 200 / 8 long replies)')),
  ];
});

// Long history for jump-far-back
export const HISTORY_COUNT = 400;
export const historyChannel = addChannel('history', 'history', (ctx) => {
  const pool = [ava, bo, cy, di, ed, me];
  return Array.from({ length: HISTORY_COUNT }, (_, i) =>
    makeMsg(ctx, pool[(i * 7) % pool.length].id, (HISTORY_COUNT - i) * 9, text(`history message #${i + 1} — ${FILLER[i % FILLER.length]}`), { id: `edge-chat-history-${i + 1}` }),
  );
});
/** Message ~340 back from the present: the "last read" point for the far-back jump. */
export const historyLastReadId = 'edge-chat-history-60';
export const historyUnreadCount = HISTORY_COUNT - 60;

// ── Worst-case channel (everything at once, bottom of the list) ────────
export const worstChannel = addChannel('worst', 'worst-case', (ctx) => {
  const target = makeMsg(ctx, bo.id, 90, text(LOREM));
  const parent = makeMsg(ctx, cy.id, 80, composed(`@here ${twentyMentioned.slice(0, 8).map((u) => `@${u.username}`).join(' ')} **heads up** — https://analytics.example.com/dashboards/shared/7f3c9a1e-44b2-4c7e-9d1a-2b6f0e8c5a93/panels?from=2026-09-01T00%3A00%3A00Z&to=2026-09-22T23%3A59%3A59Z`), {
    editedAt: timeAgo(70),
    reactions: reactionEmojis.slice(0, 18).map((emoji, i) => createReaction({ emoji, userIds: users.slice(i, i + 1 + (i % 3)).map((u) => u.id) })),
  });
  const pool = [me, ...users];
  return [
    target,
    withReplies(parent, Array.from({ length: 200 }, (_, i) => reply(parent, pool[i % 25].id, 79 - i * 0.3, text(`reply ${i + 1}`), i + 1)), true),
    makeMsg(ctx, di.id, 60, composed('```\nconst result = await deliveryQueueConsumer.processBatch(messages.filter((m) => m.attempts < MAX_ATTEMPTS && !m.deadLettered), { ackMode: "after-commit", timeoutMs: 30_000 });\n```'), {
      replyToId: target.id,
      replyTo: { id: target.id, authorId: target.authorId, spans: target.spans, sentAt: target.sentAt, deletedAt: null },
      reactions: [createReaction({ emoji: '🍕', userIds: PIZZA_REACTORS })],
    }),
    makeMsg(ctx, ed.id, 50, text(''), {
      attachments: [
        file(sizedImageId('w1', 400, 2400), 'tall.png', 'image/png', 'IMAGE', 1_800_000),
        file(sizedImageId('w2', 3200, 300), 'wide.png', 'image/png', 'IMAGE', 1_800_000),
        file('edge-chat-file-worst-zip', 'delivery-queue-consumer-heap-dump-production-eu-west-1.hprof.zip', 'application/zip', 'OTHER', 24_900_000),
      ],
    }),
    makeMsg(ctx, ava.id, 40, text('🔥'.repeat(40))),
  ];
});

// ── DM ─────────────────────────────────────────────────────────────────

export const EDGE_DM_ID = 'edge-chat-dm-1';
export const EDGE_GROUP_DM_ID = 'edge-chat-dm-group';

const dmCtx = { dmId: EDGE_DM_ID, key: 'dm' };
const dmTarget = makeMsg(dmCtx, ava.id, 200, text('can you send me the heap dump and the full write-up when you get a chance?'));
const dmMessages: Message[] = [
  ...filler(dmCtx, 240, [ava, me, ava, me]),
  dmTarget,
  makeMsg(dmCtx, me.id, 180, text(LOREM), { editedAt: timeAgo(170) }),
  makeMsg(dmCtx, ava.id, 160, text('😂😂😂')),
  makeMsg(dmCtx, me.id, 150, text('https://analytics.example.com/dashboards/shared/7f3c9a1e-44b2-4c7e-9d1a-2b6f0e8c5a93/panels?from=2026-09-01T00%3A00%3A00Z&to=2026-09-22T23%3A59%3A59Z&filter%5Bservice%5D=delivery-queue-consumer')),
  makeMsg(dmCtx, me.id, 140, text(''), {
    replyToId: dmTarget.id,
    replyTo: { id: dmTarget.id, authorId: dmTarget.authorId, spans: dmTarget.spans, sentAt: dmTarget.sentAt, deletedAt: null },
    attachments: [
      file('edge-chat-file-dm-zip', 'delivery-queue-consumer-heap-dump-production-eu-west-1-2026-09-22T23-41-07Z.hprof.zip', 'application/zip', 'OTHER', 24_900_000),
      file(sizedImageId('dmtall', 400, 2400), 'tall-log.png', 'image/png', 'IMAGE', 1_840_000),
    ],
  }),
  makeMsg(dmCtx, ava.id, 120, text('thank you!! 🙏'), {
    reactions: reactionEmojis.slice(0, 12).map((emoji, i) => createReaction({ emoji, userIds: i % 2 ? [me.id] : [ava.id] })),
  }),
  makeMsg(dmCtx, ava.id, 110, text(GIF_URL)),
];

const groupCtx = { dmId: EDGE_GROUP_DM_ID, key: 'gdm' };
const groupMembers = [me, ...users.slice(0, 9)];
const groupMessages: Message[] = groupMembers.slice(1).map((u, i) =>
  makeMsg(groupCtx, u.id, 100 - i * 3, i % 3 === 0 ? composed(`@${me.username} ${FILLER[i % 4]}`) : text(FILLER[i % 4])),
);

function dmGroup(id: string, members: ScenarioUser[], lastMessage: Message, name: string | null, isGroup: boolean): DirectMessageGroup {
  return {
    id,
    name,
    isGroup,
    createdAt: timeAgo(60 * 24 * 30),
    members: members.map((u, i) =>
      createDmGroupMember({
        id: `edge-chat-dm-member-${id}-${i}`,
        userId: u.id,
        joinedAt: timeAgo(60 * 24 * 30),
        user: { id: u.id, username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl },
      }),
    ),
    lastMessage: { id: lastMessage.id, authorId: lastMessage.authorId, spans: lastMessage.spans as never, sentAt: lastMessage.sentAt },
  } as never;
}

// ── Assemble the scenario ──────────────────────────────────────────────

/**
 * Community memberships for `me` + the first `count` users. Kept at 30 for
 * the default scenario: with ~55+ members every channel screen hits a React
 * "Maximum update depth exceeded" page error (see `edgeChatManyMembersScenario`).
 */
function buildMemberships(count: number): MembershipResponseDto[] {
  const roles = base.rolesByCommunity[community.id];
  return [me, ...users.slice(0, count)].map((u, i) => ({
    id: `edge-chat-membership-${String(i).padStart(3, '0')}`,
    userId: u.id,
    communityId: community.id,
    joinedAt: timeAgo(60 * 24 * 120 - i * 60),
    roles: [u.id === me.id ? roles[0] : roles[1]],
    user: u as never,
  }));
}

const DEFAULT_MEMBER_COUNT = 30;

const channelMessages: Record<string, Message[]> = { ...base.messagesByChannel };
for (const b of channelBuilds) channelMessages[b.channel.id] = b.messages;

export const edgeChatScenario: Scenario = {
  ...base,
  communities: [
    {
      ...community,
      channels: [...community.channels, ...channelBuilds.map((b) => b.channel)],
      memberIds: [me, ...users.slice(0, DEFAULT_MEMBER_COUNT)].map((u) => u.id),
    },
  ],
  messagesByChannel: channelMessages,
  threadRepliesByParent: { ...base.threadRepliesByParent, ...threadReplies },
  dmGroups: [
    dmGroup(EDGE_DM_ID, [me, ava], dmMessages[dmMessages.length - 1], null, false),
    dmGroup(EDGE_GROUP_DM_ID, groupMembers, groupMessages[groupMessages.length - 1], null, true),
    ...base.dmGroups,
  ],
  messagesByDmGroup: { ...base.messagesByDmGroup, [EDGE_DM_ID]: dmMessages, [EDGE_GROUP_DM_ID]: groupMessages },
  membershipsByCommunity: { ...base.membershipsByCommunity, [community.id]: buildMemberships(DEFAULT_MEMBER_COUNT) },
};

/** Same data, but all 60 users are community members (61 incl. me) — enough for "50+ mention matches". */
export const edgeChatManyMembersScenario: Scenario = {
  ...edgeChatScenario,
  communities: [{ ...edgeChatScenario.communities[0], memberIds: [me, ...users].map((u) => u.id) }],
  membershipsByCommunity: { ...edgeChatScenario.membershipsByCommunity, [community.id]: buildMemberships(users.length) },
};

export const edgeCommunityId = community.id;
export const edgeMe = me;
export const edgeUsers = users;
export const channelPath = (c: Channel) => `/community/${community.id}/channel/${c.id}`;
export const dmPath = (id: string) => `/direct-messages/${id}`;

// ── Handlers ───────────────────────────────────────────────────────────

type Page = { messages: Message[]; continuationToken?: string };

/** Mirrors messages.service.ts findAllByField (newest-first, cursor = last id). */
function paginate(all: Message[], url: URL): Page {
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50) || 50, 100);
  const token = url.searchParams.get('continuationToken') || undefined;
  const direction = url.searchParams.get('direction') === 'newer' ? 'newer' : 'older';
  const desc = [...all].reverse();
  const ordered = direction === 'newer' ? [...all] : desc;
  let start = 0;
  if (token) {
    const idx = ordered.findIndex((m) => m.id === token);
    start = idx === -1 ? ordered.length : idx + 1;
  }
  const slice = ordered.slice(start, start + limit);
  const continuationToken = slice.length === limit ? slice[slice.length - 1].id : undefined;
  return { messages: direction === 'newer' ? [...slice].reverse() : slice, continuationToken };
}

/** Mirrors messages.service.ts findAroundMessage. */
function around(all: Message[], messageId: string, url: URL) {
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50) || 50, 100);
  const half = Math.floor((limit - 1) / 2);
  const idx = all.findIndex((m) => m.id === messageId);
  if (idx === -1) return null;
  const older = all.slice(Math.max(0, idx - half), idx).reverse();
  const newer = all.slice(idx + 1, idx + 1 + half);
  return {
    messages: [...[...newer].reverse(), all[idx], ...older],
    olderContinuationToken: older.length === half ? older[older.length - 1].id : undefined,
    newerContinuationToken: newer.length === half ? newer[newer.length - 1].id : undefined,
  };
}

function svgResponse(svgDataUri: string): HttpResponse<string> {
  const [, encoded] = svgDataUri.split(',');
  return new HttpResponse(decodeURIComponent(encoded), { headers: { 'Content-Type': 'image/svg+xml' } });
}

function toThreadReply(m: Message): EnrichedThreadReplyDto {
  return {
    ...m,
    directMessageGroupId: m.directMessageGroupId ?? null,
    pendingAttachments: 0,
    editedAt: m.editedAt ?? null,
    deletedAt: null,
    pinned: false,
    pinnedAt: null,
    pinnedBy: null,
    replyCount: 0,
    lastReplyAt: null,
    searchText: null,
    deletedBy: null,
    deletedByReason: null,
  } as unknown as EnrichedThreadReplyDto;
}

export interface ChatHandlerOptions {
  /** Extra unread-count rows (with lastReadMessageId) for `/api/read-receipts/unread-counts`. */
  unread?: { channelId?: string; directMessageGroupId?: string; unreadCount: number; mentionCount?: number; lastReadMessageId?: string }[];
}

/** Handlers prepended in front of `makeHandlers(edgeChatScenario)` — real pagination, sized images, external media. */
export function chatHandlers(scenario: Scenario = edgeChatScenario, opts: ChatHandlerOptions = {}): HttpHandler[] {
  const handlers: HttpHandler[] = [
    http.get('/api/messages/channel/:channelId/around/:messageId', ({ params, request }) => {
      const res = around(scenario.messagesByChannel[String(params.channelId)] ?? [], String(params.messageId), new URL(request.url));
      return res ? HttpResponse.json(res) : HttpResponse.json({ message: 'Message not found', statusCode: 404 }, { status: 404 });
    }),
    http.get('/api/messages/channel/:channelId', ({ params, request }) =>
      HttpResponse.json(paginate(scenario.messagesByChannel[String(params.channelId)] ?? [], new URL(request.url)))),
    http.get('/api/messages/group/:groupId/around/:messageId', ({ params, request }) => {
      const res = around(scenario.messagesByDmGroup[String(params.groupId)] ?? [], String(params.messageId), new URL(request.url));
      return res ? HttpResponse.json(res) : HttpResponse.json({ message: 'Message not found', statusCode: 404 }, { status: 404 });
    }),
    http.get('/api/messages/group/:groupId', ({ params, request }) =>
      HttpResponse.json(paginate(scenario.messagesByDmGroup[String(params.groupId)] ?? [], new URL(request.url)))),

    http.get('/api/threads/:parentMessageId/metadata', ({ params }) => {
      const id = String(params.parentMessageId);
      const replies = scenario.threadRepliesByParent[id] ?? [];
      return HttpResponse.json({
        parentMessageId: id,
        replyCount: replies.length,
        lastReplyAt: replies.length ? replies[replies.length - 1].sentAt : null,
        isSubscribed: threadWatched[id] ?? replies.length > 0,
      });
    }),
    http.get('/api/threads/:parentMessageId/replies', ({ params, request }) => {
      const url = new URL(request.url);
      const limit = Number(url.searchParams.get('limit') ?? 50) || 50;
      const token = url.searchParams.get('continuationToken') || undefined;
      const all = scenario.threadRepliesByParent[String(params.parentMessageId)] ?? [];
      const start = token ? all.findIndex((m) => m.id === token) + 1 : 0;
      const slice = all.slice(start, start + limit);
      return HttpResponse.json({
        replies: slice.map(toThreadReply),
        continuationToken: slice.length === limit ? slice[slice.length - 1].id : undefined,
      });
    }),

    http.get('/api/file/:id', ({ params }) => {
      const id = String(params.id);
      const m = /^edge-chat-img-(\d+)x(\d+)-/.exec(id);
      if (!m) return undefined;
      return svgResponse(placeholderPhoto(id, Number(m[1]), Number(m[2]), `${m[1]}×${m[2]}`));
    }),

    // External media the app loads straight from the web (GIF embeds, link-preview og:images/favicons).
    http.get('https://media.giphy.com/*', () => svgResponse(placeholderPhoto('giphy', 480, 270, 'GIF'))),
    http.get('https://images.example.com/og/*', () => svgResponse(placeholderPhoto('og', 1200, 630, 'og:image'))),
    http.get('https://images.example.com/favicon.png', () => svgResponse(placeholderPhoto('fav', 16, 16, ''))),
  ];

  if (opts.unread) {
    const extra = opts.unread;
    const overridden = new Set(extra.map((r) => r.channelId ?? r.directMessageGroupId));
    // Same shape as the base handler's rows (handlers.ts), plus the overrides.
    const baseRows = Object.entries(scenario.unreadByContextId)
      .filter(([id]) => !overridden.has(id))
      .map(([id, v]) => {
        const isDm = scenario.dmGroups.some((g) => g.id === id);
        return { directMessageGroupId: isDm ? id : undefined, channelId: isDm ? undefined : id, unreadCount: v.unreadCount, mentionCount: v.mentionCount };
      });
    handlers.push(
      http.get('/api/read-receipts/unread-counts', () =>
        HttpResponse.json([...baseRows, ...extra.map((r) => ({ mentionCount: 0, lastReadAt: timeAgo(60 * 24), ...r }))])),
    );
  }
  return handlers;
}

/**
 * Channel message pages in one direction (a request with a continuationToken)
 * never resolve, pinning the list in its "loading older/newer page" state.
 * The first page and `/around/` still answer, from the handlers after this.
 */
export function hangingPageLoads(direction: 'older' | 'newer'): HttpHandler {
  return http.get('/api/messages/channel/:channelId', async ({ request }) => {
    const url = new URL(request.url);
    const dir = url.searchParams.get('direction') === 'newer' ? 'newer' : 'older';
    if (!url.searchParams.get('continuationToken') || dir !== direction) return undefined;
    await delay(10 * 60_000);
    return HttpResponse.json({ messages: [] });
  });
}

// ── Story drivers (DOM + cache) ────────────────────────────────────────

/** Mirrors useResponsive's shouldUseTouchUI (coarse pointer, phone, or tablet < 1200px). */
export function isTouchUI(): boolean {
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches || window.innerWidth < 1200;
}

const messageList = () => document.querySelector<HTMLElement>('[role="list"][aria-label="Messages"]');

/**
 * A driver step that succeeds once the message list has made its initial
 * scroll and then held its scroll position and height for `polls` polls in a
 * row (initial positioning, row measuring and deep-link centering are done).
 */
export function messageListSteady(polls = 3): DriverStep {
  let last = '';
  let same = 0;
  return () => {
    const list = messageList();
    if (!list || list.scrollTop === 0) return false;
    const now = `${list.scrollTop}/${list.scrollHeight}`;
    same = now === last ? same + 1 : 0;
    last = now;
    return same >= polls;
  };
}

/**
 * A driver step that scrolls the message list to its top or bottom edge (as a
 * user would, firing its scroll handler) and succeeds once the list is at
 * that edge and busy loading the next page there.
 */
export function scrollMessageListToLoad(edge: 'top' | 'bottom'): DriverStep {
  return () => {
    const list = messageList();
    if (!list) return false;
    const atEdge = edge === 'top' ? list.scrollTop === 0 : list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
    if (atEdge && list.getAttribute('aria-busy') === 'true') return true;
    list.scrollTop = edge === 'top' ? 0 : list.scrollHeight;
    return false;
  };
}

/** The message row (`MessageComponent` Container) whose text contains `needle` (the last match with `last`). */
export function findMessageRow(needle: string, { last = false, root = document as ParentNode } = {}): HTMLElement | null {
  const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-row-focus-target="true"]')).filter((r) => (r.textContent ?? '').includes(needle));
  return (last ? rows[rows.length - 1] : rows[0]) ?? null;
}

/** Open a message's action surface the way a user would: long-press on touch UI, right-click otherwise. */
export function openMessageActions(row: HTMLElement): void {
  const target = (row.querySelector('p, .MuiTypography-body1') as HTMLElement | null) ?? row;
  const rect = target.getBoundingClientRect();
  const x = rect.left + Math.min(40, rect.width / 2);
  const y = rect.top + rect.height / 2;
  if (isTouchUI()) {
    const touch = new Touch({ identifier: 1, target, clientX: x, clientY: y });
    target.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [touch], targetTouches: [touch], changedTouches: [touch] }));
  } else {
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }));
  }
}

/** Click the first menu item / sheet row whose text matches. */
export function clickActionItem(pattern: RegExp): boolean {
  const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"], [role="presentation"] .MuiListItemButton-root, .MuiDrawer-root .MuiListItemButton-root'));
  const el = items.find((i) => pattern.test(i.textContent ?? ''));
  if (!el) return false;
  el.click();
  return true;
}

/** The composer textarea inside `scope` (the visible, non-aria-hidden one). */
export function composerTextarea(scope: ParentNode = document): HTMLTextAreaElement | null {
  const all = Array.from(scope.querySelectorAll<HTMLTextAreaElement>('textarea:not([aria-hidden="true"])'));
  return all[0] ?? null;
}

/** Type into a controlled textarea (native setter + input event), leaving the caret at the end and firing keyup so cursor tracking updates. */
export function typeInto(el: HTMLTextAreaElement, value: string): void {
  el.focus();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(el, value);
  el.setSelectionRange(value.length, value.length);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
}

/** Real PNG bytes (so the composer's image thumbnail actually renders), drawn on a canvas. */
function pngBytes(width: number, height: number, color: string): Uint8Array {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  if (g) {
    g.fillStyle = color;
    g.fillRect(0, 0, width, height);
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.beginPath();
    g.arc(width * 0.3, height * 0.35, Math.min(width, height) * 0.15, 0, Math.PI * 2);
    g.fill();
  }
  const b64 = canvas.toDataURL('image/png').split(',')[1];
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export interface FakeFile {
  name: string;
  type: string;
  /** For images: pixel size of the generated PNG. */
  size?: [number, number];
  color?: string;
}

/** Attach several files through the composer's hidden file input in one change event. */
export function attachFiles(files: FakeFile[], scope: ParentNode = document): boolean {
  const input = scope.querySelector('input[type="file"]') as HTMLInputElement | null;
  if (!input) return false;
  const dt = new DataTransfer();
  for (const f of files) {
    const bytes = f.type === 'image/png' ? pngBytes(f.size?.[0] ?? 320, f.size?.[1] ?? 240, f.color ?? '#5865F2') : new Uint8Array(4096);
    dt.items.add(new File([bytes as BlobPart], f.name, { type: f.type }));
  }
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

export function clickButtonByLabel(label: string, scope: ParentNode = document): boolean {
  const el = scope.querySelector<HTMLElement>(`button[aria-label="${label}"]`);
  if (!el) return false;
  el.click();
  return true;
}

export function clickButtonByText(pattern: RegExp, scope: ParentNode = document): boolean {
  const el = Array.from(scope.querySelectorAll<HTMLElement>('button')).find((b) => pattern.test(b.textContent ?? ''));
  if (!el) return false;
  el.click();
  return true;
}

export type DriverStep = () => boolean | void;

/**
 * Run DOM steps in order once mounted. A step returning `false` is retried
 * (every `pollMs`, up to `timeoutMs`) — so steps can wait for data to load.
 * `wait(ms)` steps pause between actions (e.g. the long-press delay).
 */
export function useDriver(steps: DriverStep[], { pollMs = 120, timeoutMs = 15000 } = {}): void {
  const stepsRef = useRef(steps);
  useEffect(() => {
    let cancelled = false;
    let i = 0;
    let stepStarted = Date.now();
    const tick = () => {
      if (cancelled || i >= stepsRef.current.length) return;
      const ok = stepsRef.current[i]();
      if (ok !== false) {
        i += 1;
        stepStarted = Date.now();
        setTimeout(tick, pollMs);
      } else if (Date.now() - stepStarted < timeoutMs) {
        setTimeout(tick, pollMs);
      } else {
        console.warn(`[edge-chat driver] step ${i} timed out`);
      }
    };
    setTimeout(tick, pollMs);
    return () => {
      cancelled = true;
    };
  }, [pollMs, timeoutMs]);
}

/** A step that succeeds only after `ms` have elapsed since it was first tried. */
export function wait(ms: number): DriverStep {
  let first: number | null = null;
  return () => {
    if (first === null) first = Date.now();
    if (Date.now() - first < ms) return false;
    first = null;
    return true;
  };
}

export interface OptimisticSpec {
  text: string;
  status: 'pending' | 'failed';
  replyTo?: Message;
}

/**
 * Inject optimistic (pending/failed) rows into a channel/DM message cache
 * once its first page has loaded — the same cache transitions
 * `useOptimisticSendMessage` performs (prepend as 'pending', then
 * `markOptimisticFailed` on ack timeout).
 */
export function useInjectOptimisticMessages(context: { channelId?: string; dmId?: string }, specs: OptimisticSpec[]): void {
  const queryClient = useQueryClient();
  const specsRef = useRef(specs);
  useEffect(() => {
    const key = context.channelId ? channelMessagesQueryKey(context.channelId) : dmMessagesQueryKey(context.dmId ?? '');
    let cancelled = false;
    const tryInject = () => {
      if (cancelled) return;
      const data = queryClient.getQueryData<InfiniteData<PaginatedMessagesResponseDto>>(key);
      if (!data) {
        setTimeout(tryInject, 100);
        return;
      }
      specsRef.current.forEach((spec, i) => {
        const clientId = `pending-edge-chat-${i + 1}`;
        const msg: Message = {
          id: clientId,
          clientId,
          channelId: context.channelId ?? null,
          directMessageGroupId: context.dmId ?? null,
          authorId: me.id,
          spans: composed(spec.text),
          attachments: [],
          pendingAttachments: 0,
          reactions: [],
          sentAt: new Date(Date.now() - (specsRef.current.length - i) * 1000).toISOString(),
          sendStatus: 'pending',
          ...(spec.replyTo ? { replyToId: spec.replyTo.id } : {}),
        };
        queryClient.setQueryData(key, (old: unknown) => {
          const next = prependMessageToInfinite(old as never, msg);
          return spec.status === 'failed' ? markOptimisticFailed(next, clientId) : next;
        });
      });
    };
    tryInject();
    return () => {
      cancelled = true;
    };
  }, [queryClient, context.channelId, context.dmId]);
}

export { SpanType };

/** Five mixed files for "composer with lots attached" stories. */
export const FIVE_FILES: FakeFile[] = [
  { name: 'screenshot-2026-09-22-at-23.41.07.png', type: 'image/png', size: [1200, 800], color: '#5865F2' },
  { name: 'tall.png', type: 'image/png', size: [300, 1400], color: '#EB459E' },
  { name: 'Q3 Delivery Reliability Review — FINAL (v7, really final).pdf', type: 'application/pdf' },
  { name: 'delivery-queue-consumer-heap-dump-production-eu-west-1.zip', type: 'application/zip' },
  { name: 'incident-call.mp4', type: 'video/mp4' },
];

export const FOUR_LINE_DRAFT =
  'ok so here is my take on the rollback:\n1) ack after commit, no exceptions\n2) alert on retry-queue growth rate, not size\n3) runbook for the replay before anyone touches this again';
