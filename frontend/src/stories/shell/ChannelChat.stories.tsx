/**
 * The new shell's text channel chat, read side (PR 10c-1, shell/lounge/screens/chat): the chat fixture's real
 * descriptor in the real frame, on the mock-ups' community (`fixtures/loungeCommunityHandlers.ts`) with a
 * conversation in #general. Only the hidden fixture reaches it in the app; it is built for phone width.
 *
 * States: a conversation (day and unread separators, a reply quote, an image and a file, reactions, a replies count,
 * a mention of the reader, a long unbroken word, a code block), light, a private channel, empty, loading, no
 * access (403), gone (404) and a load error with Try again.
 *
 * Write side (PR 10c-2a): the composer typing, with the mention list open, replying, and its three notices (no
 * permission, timed out, read-only); a message's actions Sheet on your own message, on someone else's (a plain
 * member), as a moderator (Pin and Delete), and without the right to react; editing in place; a failed send with
 * Retry; light variants of the main ones. The signed-in user is alexk (id `me`). Stories that need a press (the Sheet, Reply, Edit) make it themselves once the chat has loaded.
 */
import { useEffect, useRef, useState, type JSX } from 'react';
import { http, HttpResponse, delay, type HttpHandler } from 'msw';
import { IncomingCallProvider } from '../../contexts/IncomingCallContext';
import { LOUNGE_CHAT_FIXTURE_PATH, LOUNGE_ROUTES } from '../../shell/loungeRoutes';
import { LoungeFrame } from '../../shell/lounge/frame/LoungeFrame';
import type { ModeName } from '../../theme/derive/derivePalette';
import { defineComponent } from '../fixtures/componentStory';
import { KitFrameStage } from '../fixtures/kitStory';
import { bigCommunityScenario } from '../fixtures/scenarios';
import { LOUNGE_COMMUNITY_ID, loungeCommunityHandlers } from '../fixtures/loungeCommunityHandlers';
import { ALL_CAPS, timedOutCaps, type Caps } from '../fixtures/channelPermissions';
import { composerDraftStorageKey } from '../../hooks/useComposerDraft';

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
  message('me', at(0, 20), [text('on my way, bringing the headset')]),
];

/** A send of the reader's that did not go through (as the cache holds it after a refused send). */
const FAILED = message('me', at(0, 21), [text('did this one go through?')], { id: 'pending-story-1', clientId: 'pending-story-1', sendStatus: 'failed', sendError: 'Failed to send' });

const channelsPath = `/api/channels/community/${LOUNGE_COMMUNITY_ID}`;
const messagesPath = `/api/messages/channel/${CHANNEL}`;

/** The channel itself (its name for the composer's label and notices). */
const channelHandler = (channel: { preset?: string; name?: string } = {}) =>
  http.get(`/api/channels/${CHANNEL}`, () =>
    HttpResponse.json({
      id: CHANNEL,
      name: channel.name ?? 'general',
      communityId: LOUNGE_COMMUNITY_ID,
      type: 'TEXT',
      isPrivate: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      position: 0,
      slowmodeSeconds: 0,
      preset: channel.preset ?? 'NORMAL',
    }),
  );

const chatHandlers: HttpHandler[] = [
  channelHandler(),
  http.get(messagesPath, () => HttpResponse.json({ messages: [...MESSAGES].reverse(), continuationToken: undefined })),
  http.get('/api/users/:id', ({ params }) => {
    // The signed-in user's own profile is the community fixture's (alexk, id `me`): not this route's.
    if (params.id === 'profile') return undefined;
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

/** Runs `steps` in order once each finds its element (polled, bounded): a story's own press after the chat loads. */
function useSteps(steps: readonly { find: () => HTMLElement | null; run: (el: HTMLElement) => void }[]): void {
  useEffect(() => {
    let step = 0;
    let tries = 0;
    const timer = setInterval(() => {
      const el = steps[step]?.find() ?? null;
      tries += 1;
      if (el !== null) {
        steps[step].run(el);
        step += 1;
        tries = 0;
      }
      if (step >= steps.length || tries > 100) clearInterval(timer);
    }, 100);
    return () => clearInterval(timer);
  }, [steps]);
}

const rowWith = (words: string) => () =>
  [...document.querySelectorAll<HTMLElement>('[role="article"]')].find((row) => row.textContent?.includes(words)) ?? null;
const buttonNamed = (name: string) => () =>
  [...document.querySelectorAll<HTMLElement>('[role="dialog"] button, [role="dialog"] [role="button"]')].find(
    (b) => (b.getAttribute('aria-label') ?? b.textContent) === name,
  ) ?? null;
const openActions = (words: string) => ({
  find: rowWith(words),
  run: (row: HTMLElement) => {
    row.focus();
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  },
});
const press = (name: string) => ({ find: buttonNamed(name), run: (el: HTMLElement) => el.click() });
const composerField = () => document.querySelector<HTMLTextAreaElement>('textarea[aria-label^="Message"]');
/** The caret to the end of the draft, so the mention list reads the word being typed. */
const caretToEnd = {
  find: composerField,
  run: (el: HTMLElement) => {
    const field = el as HTMLTextAreaElement;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
    // A key's release is when the field reads the caret (React's select event), as after typing the "@".
    field.dispatchEvent(new KeyboardEvent('keyup', { key: '@', bubbles: true }));
  },
};

function Frame({ mode, draft, steps = NO_STEPS }: { mode: ModeName; draft?: string; steps?: Parameters<typeof useSteps>[0] }): JSX.Element {
  // A draft in the composer's storage before it mounts (the sandbox clears drafts first).
  useState(() => {
    if (draft !== undefined) sessionStorage.setItem(composerDraftStorageKey(`channel:${CHANNEL}`), draft);
  });
  useSteps(steps);
  return <FrameOnly mode={mode} />;
}

const NO_STEPS: Parameters<typeof useSteps>[0] = [];

function FrameOnly({ mode }: { mode: ModeName }): JSX.Element {
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

const story = (options: { mode?: ModeName; handlers?: HttpHandler[]; draft?: string; steps?: Parameters<typeof useSteps>[0] } = {}) =>
  defineComponent(bigCommunityScenario, () => <Frame mode={options.mode ?? 'dark'} draft={options.draft} steps={options.steps} />, {
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

// --- Write side (PR 10c-2a) ---

/** The channel's capabilities for the reader (`useComposerAvailability`, reactions), and its name and preset. */
const capsHandlers = (caps: Partial<Caps>, channel: { preset?: string; name?: string } = {}): HttpHandler[] => [
  http.get(`/api/channels/community/${LOUNGE_COMMUNITY_ID}/permissions/me`, () =>
    HttpResponse.json({ communityId: LOUNGE_COMMUNITY_ID, channels: [{ channelId: CHANNEL, ...ALL_CAPS, ...caps }] }),
  ),
  channelHandler(channel),
];

/** Typing: a draft in the field (Send is available). */
export const ComposerTyping = story({ draft: 'same time tomorrow? I can host' });

/** Typing a mention: the suggestion list over the conversation (@here, @channel, the people), the first highlighted. */
export const ComposerMentionList = story({ draft: 'hey @', steps: [caretToEnd] });

/** The same, light. */
export const ComposerMentionListLight = story({ mode: 'light', draft: 'hey @', steps: [caretToEnd] });

/** Replying: the banner names who, with a line of the original; Escape cancels. */
export const ComposerReply = story({ steps: [openActions('you in?'), press('Reply')] });

/** No permission to post: the notice in the field's place. */
export const ComposerNoPermission = story({ handlers: capsHandlers({ post: false, attach: false }) });

/** Timed out: the time left. */
export const ComposerTimedOut = story({
  handlers: capsHandlers(timedOutCaps(new Date(Date.now() + 4 * 60_000).toISOString())),
});

/** A read-only channel: who may post. */
export const ComposerReadOnly = story({
  handlers: capsHandlers({ post: false, attach: false, postingRoleNames: ['Moderator', 'Community Admin'] }, { preset: 'ANNOUNCEMENT', name: 'announcements' }),
});

/** Your own message's actions: the quick reactions, Reply, Edit, Copy and Delete (no Pin: a plain member). */
export const ActionsOwnMessage = story({ steps: [openActions('bringing the headset')] });

/** Someone else's message, as a plain member: the quick reactions, Reply and Copy (no Pin, no Delete). */
export const ActionsSomeoneElses = story({ steps: [openActions('you in?')] });

/** The reader's roles in this channel may delete and pin others' messages (a moderator). */
const moderatorHandlers: HttpHandler[] = [
  http.get(`/api/roles/my/channel/${CHANNEL}`, () =>
    HttpResponse.json({
      resourceType: 'CHANNEL',
      userId: 'me',
      resourceId: CHANNEL,
      roles: [{ id: 'r-mod', name: 'Moderator', actions: ['DELETE_MESSAGE', 'PIN_MESSAGE', 'UNPIN_MESSAGE'] }],
    }),
  ),
];

/** Someone else's message, as a moderator: the quick reactions, Reply, Pin, Copy and Delete. */
export const ActionsModerator = story({ handlers: moderatorHandlers, steps: [openActions('you in?')] });

/** Without the right to react (and no posting): no quick reactions. */
export const ActionsNoPermissions = story({
  handlers: capsHandlers({ react: false, post: false, attach: false }),
  steps: [openActions('you in?')],
});

/** Delete asks first. */
export const ActionsDeleteConfirm = story({ steps: [openActions('bringing the headset'), press('Delete message')] });

/** Editing your message in place: the inline composer in save mode. */
export const EditingInPlace = story({ steps: [openActions('bringing the headset'), press('Edit message')] });

/** A send that failed: the reason, Retry and Delete (Retry turns busy while it runs: `kit-message-row--states`). */
export const FailedSend = story({
  handlers: [http.get(messagesPath, () => HttpResponse.json({ messages: [...MESSAGES, FAILED].reverse(), continuationToken: undefined }))],
});

/** Light: your own message's actions. */
export const ActionsOwnMessageLight = story({ mode: 'light', steps: [openActions('bringing the headset')] });

/** Light: editing in place. */
export const EditingInPlaceLight = story({ mode: 'light', steps: [openActions('bringing the headset'), press('Edit message')] });

/** Light: a failed send. */
export const FailedSendLight = story({
  mode: 'light',
  handlers: [http.get(messagesPath, () => HttpResponse.json({ messages: [...MESSAGES, FAILED].reverse(), continuationToken: undefined }))],
});

/** Light: no permission to post. */
export const ComposerNoPermissionLight = story({ mode: 'light', handlers: capsHandlers({ post: false, attach: false }) });
