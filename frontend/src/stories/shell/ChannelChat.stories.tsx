/**
 * The new shell's text channel chat, read side (PR 10c-1, shell/lounge/screens/chat): the chat fixture's real
 * descriptor in the real frame, on the mock-ups' community (`fixtures/loungeCommunityHandlers.ts`) with a
 * conversation in #general. Only the hidden fixture reaches it in the app; it is built for phone width.
 *
 * States: a conversation (day and unread separators, a reply quote, an image and a file, reactions, a replies count,
 * a mention of the reader, a long unbroken word, a code block), light, a private channel, empty, loading, no
 * access (403), gone (404) and a load error with Try again.
 */
import { useRef, type JSX } from 'react';
import { http, HttpResponse, delay, type HttpHandler } from 'msw';
import { IncomingCallProvider } from '../../contexts/IncomingCallContext';
import { LOUNGE_CHAT_FIXTURE_PATH, LOUNGE_ROUTES } from '../../shell/loungeRoutes';
import { LoungeFrame } from '../../shell/lounge/frame/LoungeFrame';
import type { ModeName } from '../../theme/derive/derivePalette';
import { defineComponent } from '../fixtures/componentStory';
import { KitFrameStage } from '../fixtures/kitStory';
import { bigCommunityScenario } from '../fixtures/scenarios';
import { LOUNGE_COMMUNITY_ID, loungeCommunityHandlers } from '../fixtures/loungeCommunityHandlers';

const chat = LOUNGE_ROUTES.find((route) => route.path === LOUNGE_CHAT_FIXTURE_PATH)!;
const CHANNEL = 'ch-general';

const PEOPLE: Record<string, { username: string; displayName: string | null }> = {
  me: { username: 'alexk', displayName: null },
  'u-aiko': { username: 'aiko', displayName: null },
  'u-dropbear': { username: 'dropbear', displayName: null },
  'u-gracie': { username: 'gracie', displayName: 'Gracie with a display name that is far too long for a phone' },
  'u-kwam3': { username: 'kwam3', displayName: null },
};

const DAY = 24 * 3_600_000;
const at = (daysAgo: number, minutes: number) => {
  const d = new Date(Date.now() - daysAgo * DAY);
  d.setHours(20, minutes, 0, 0);
  return d.toISOString();
};

const PICTURE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"><rect width="16" height="9" fill="#6FB1F5"/><circle cx="8" cy="4.5" r="2.5" fill="#121214"/></svg>';

let seq = 0;
const message = (authorId: string, sentAt: string, spans: unknown[], extra: Record<string, unknown> = {}) => ({
  id: `m-${++seq}`,
  channelId: CHANNEL,
  directMessageGroupId: null,
  authorId,
  spans,
  attachments: [],
  reactions: [],
  sentAt,
  editedAt: null,
  deletedAt: null,
  pendingAttachments: 0,
  linkPreviews: null,
  replyCount: 0,
  lastReplyAt: null,
  pinned: false,
  pinnedAt: null,
  pinnedBy: null,
  parentMessageId: null,
  replyToId: null,
  replyTo: null,
  webhook: null,
  ...extra,
});
const text = (value: string, style: Record<string, unknown> = {}) => ({ type: 'PLAINTEXT', text: value, ...style });

const MESSAGES = [
  message('u-kwam3', at(1, 2), [text('ok that run was cursed, same time tomorrow?')]),
  message('u-kwam3', at(1, 3), [text('I am bringing snacks')]),
  message('u-dropbear', at(1, 40), [text('night all')]),
  message('u-aiko', at(0, 5), [text('read this one: '), text('https://docs.example.org/guide/raids', {})]),
  message('u-gracie', at(0, 9), [text('a long word that will not fit: supercalifragilisticexpialidociouslyunbreakablewordthatgoesonandon')], {
    reactions: [
      { emoji: '😂', userIds: ['me', 'u-aiko', 'u-kwam3'] },
      { emoji: '🔥', userIds: ['u-dropbear'] },
    ],
  }),
  message('u-aiko', at(0, 12), [{ type: 'CODE_BLOCK', text: 'const party = ["aiko", "kwam3", "dropbear"];\nparty.forEach((who) => invite(who, { at: "9pm", voice: "Squad Up" }));' }], {
    replyCount: 3,
  }),
  message('u-dropbear', at(0, 15), [text('yes, 9 sharp')], {
    replyToId: 'm-1',
    replyTo: { id: 'm-1', authorId: 'u-kwam3', sentAt: at(1, 2), deletedAt: null, spans: [text('ok that run was cursed, same time tomorrow?')] },
  }),
  message('u-kwam3', at(0, 16), [text('screens from last night')], {
    attachments: [
      { id: 'f-shot', filename: 'boss-fight.png', fileType: 'IMAGE', size: 482_000, width: 1600, height: 900 },
      { id: 'f-log', filename: 'combat-log-with-a-long-file-name.txt', fileType: 'DOCUMENT', size: 12_400 },
    ],
  }),
  message('u-aiko', at(0, 18), [text('hey '), { type: 'USER_MENTION', userId: 'me', text: '@alexk' }, text(', you in?')], {
    editedAt: at(0, 19),
  }),
];

const channelsPath = `/api/channels/community/${LOUNGE_COMMUNITY_ID}`;
const messagesPath = `/api/messages/channel/${CHANNEL}`;

const chatHandlers: HttpHandler[] = [
  http.get(messagesPath, () => HttpResponse.json({ messages: [...MESSAGES].reverse(), continuationToken: undefined })),
  http.get('/api/users/:id', ({ params }) => {
    const person = PEOPLE[String(params.id)];
    return person ? HttpResponse.json({ id: params.id, avatarUrl: null, ...person }) : HttpResponse.json({}, { status: 404 });
  }),
  http.get('/api/file/:id/thumbnail', () => new HttpResponse(PICTURE_SVG, { headers: { 'Content-Type': 'image/svg+xml' } })),
  http.get('/api/read-receipts/unread-counts', () =>
    HttpResponse.json([
      {
        channelId: CHANNEL,
        communityId: LOUNGE_COMMUNITY_ID,
        channelType: 'TEXT',
        unreadCount: 3,
        mentionCount: 1,
        lastReadMessageId: MESSAGES[5].id,
      },
    ]),
  ),
];

function Frame({ mode }: { mode: ModeName }): JSX.Element {
  const root = useRef<HTMLDivElement>(null);
  return (
    <KitFrameStage mode={mode}>
      <IncomingCallProvider>
        <div ref={root} style={{ display: 'contents' }}>
          <LoungeFrame
            choice={{ kind: 'lounge', route: chat, params: { communityId: LOUNGE_COMMUNITY_ID, channelId: CHANNEL } }}
            rootRef={root}
          />
        </div>
      </IncomingCallProvider>
    </KitFrameStage>
  );
}

const story = (options: { mode?: ModeName; handlers?: HttpHandler[] } = {}) =>
  defineComponent(bigCommunityScenario, () => <Frame mode={options.mode ?? 'dark'} />, {
    maxWidth: false,
    // First match wins: the story's own, then the chat's, then the community's.
    extraHandlers: [...(options.handlers ?? []), ...chatHandlers, ...loungeCommunityHandlers],
  });

const failWith = (status: number) =>
  http.get(messagesPath, () => HttpResponse.json({ statusCode: status, message: 'nope' }, { status }));

/** A conversation in #general: day and unread separators, quote, image and file, reactions, replies, a mention of you. */
export const Phone = story();

/** The same, light. */
export const PhoneLight = story({ mode: 'light' });

/** A private channel: the lock in the header (its members are the channel's own, in the Members Sheet). */
export const PrivateChannel = story({
  handlers: [
    http.get(channelsPath, () =>
      HttpResponse.json([
        {
          id: CHANNEL,
          name: 'staff-only-with-a-name-long-enough-to-truncate',
          communityId: LOUNGE_COMMUNITY_ID,
          type: 'TEXT',
          isPrivate: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          position: 0,
          slowmodeSeconds: 0,
          preset: 'NORMAL',
        },
      ]),
    ),
    http.get(`/api/channel-membership/channel/${CHANNEL}`, () =>
      HttpResponse.json(
        ['me', 'u-aiko'].map((id) => ({
          id: `cm-${id}`,
          userId: id,
          channelId: CHANNEL,
          joinedAt: '2026-01-01T00:00:00.000Z',
          user: { id, avatarUrl: null, status: null, lastSeen: null, ...PEOPLE[id] },
        })),
      ),
    ),
  ],
});

/** No messages yet. */
export const Empty = story({ handlers: [http.get(messagesPath, () => HttpResponse.json({ messages: [], continuationToken: undefined }))] });

/** Still loading the messages: skeleton rows. */
export const Loading = story({
  handlers: [
    http.get(messagesPath, async () => {
      await delay('infinite');
      return HttpResponse.json({ messages: [] });
    }),
  ],
});

/** The server says the reader cannot see this channel (403). */
export const NoAccess = story({ handlers: [failWith(403)] });

/** The channel is gone (404). */
export const Gone = story({ handlers: [failWith(404)] });

/** Any other failure: Try again. */
export const LoadError = story({ handlers: [failWith(500)] });
