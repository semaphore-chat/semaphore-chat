/**
 * Story assembly for the marketing `tour/` stories (README / docs media —
 * see `showcase.ts` and `frontend/scripts/media/`).
 *
 * `defineShowcase(path, options)` is `defineEdgeScreen()` plus the things
 * that make a *recording* look alive rather than static:
 *
 * - a "showcase socket" that acks `sendMessage`/`sendDirectMessage` (so the
 *   composer's optimistic row settles like it does against a real server)
 *   and lets the recorder push real-shaped server events: a teammate's new
 *   message, typing indicator, or reaction;
 * - a fake LiveKit room whose remote participants can start/stop speaking
 *   (`isSpeakingChanged` + `activeSpeakersChanged`, exactly the events the
 *   app listens for), optionally on an automatic "conversation" loop;
 * - stateful reaction endpoints (`POST/DELETE /api/messages/reactions`
 *   return the updated message, like the real controller);
 * - live unread counts, notifications and DM-list previews (`LiveState`):
 *   `markAsRead` is answered with the server's self-sync read receipt,
 *   marking a notification read sticks, and a new DM moves the list preview,
 *   so badges stay consistent while a recording runs;
 * - the showcase's own appearance settings (applied through the app's real
 *   `useThemeSync()` path, as `fixtures/edge/states.ts` does) and artwork.
 *
 * The recorder drives all of this through `window.__showcase` (see
 * `ShowcaseControls` below) — no sandbox-only UI is ever rendered.
 *
 * Kept in a plain `.ts` file (createElement, no JSX) so it never trips
 * `react-refresh/only-export-components`.
 */
import { createElement as h, useEffect, useState, type ReactNode } from 'react';
import CssBaseline from '@mui/material/CssBaseline';
import GlobalStyles from '@mui/material/GlobalStyles';
import { http, HttpResponse, type HttpHandler } from 'msw';
import type { LocalParticipant, Participant, RemoteParticipant, Room } from 'livekit-client';
import { ClientEvents, ServerEvents } from '@semaphore-chat/shared';
import type { AppearanceSettingsResponseDto } from '../../api-client/types.gen';
import { ThemeProvider } from '../../contexts/ThemeContext';
import type { ThemeSettings } from '../../theme/constants';
import type { VoiceState } from '../../contexts/VoiceContext';
import { RoomContext } from '../../contexts/RoomContextDef';
import { SpeakingProvider } from '../../contexts/SpeakingContext';
import { SocketContext } from '../../utils/SocketContext';
import type { Message, Span } from '../../types/message.type';
import { SpanType } from '../../types/message.type';
import { SandboxShell } from './SandboxShell';
import { StoryRoutes } from './StoryRoutes';
import { makeHandlers } from './handlers';
import type { LadleStoryComponent } from './screenStory';
import { showcaseFileHandlers } from './showcaseArt';
import { showcaseScenario } from './showcase';
import type { Scenario, ScenarioUser } from './types';

/** The showcase's default look: dark, violet accent (matches the docs site), balanced intensity. */
export const SHOWCASE_THEME: ThemeSettings = { mode: 'dark', accentColor: 'purple', intensity: 'balanced' };

// ─────────────────────────────────────────────────────────────────────────
// Socket
// ─────────────────────────────────────────────────────────────────────────

type Handler = (...args: unknown[]) => void;

export interface ShowcaseSocket {
  on: (event: string, handler: Handler) => void;
  off: (event: string, handler: Handler) => void;
  once: (event: string, handler: Handler) => void;
  emit: (event: string, ...args: unknown[]) => void;
  connected: boolean;
  id: string;
  fire: (event: string, payload: unknown) => void;
}

function createShowcaseSocket(me: ScenarioUser, live: LiveState): ShowcaseSocket {
  const handlers = new Map<string, Set<Handler>>();
  let n = 0;
  const fire = (event: string, payload: unknown) => {
    for (const fn of Array.from(handlers.get(event) ?? [])) fn(payload);
  };
  return {
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
    },
    off(event, handler) {
      handlers.get(event)?.delete(handler);
    },
    once(event, handler) {
      const wrapped: Handler = (...args) => {
        handlers.get(event)?.delete(wrapped);
        handler(...args);
      };
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(wrapped);
    },
    emit(event, ...args) {
      // Client → server, answered the way the gateway does.
      if (event === ClientEvents.MARK_AS_READ) {
        // Store the watermark, then the self-sync receipt (no userId) that
        // clears this user's badge on every open client.
        const payload = args[0] as { lastReadMessageId: string; channelId?: string; directMessageGroupId?: string };
        const contextId = payload.channelId ?? payload.directMessageGroupId;
        if (contextId) live.unread.delete(contextId);
        fire(ServerEvents.READ_RECEIPT_UPDATED, {
          channelId: payload.channelId ?? null,
          directMessageGroupId: payload.directMessageGroupId ?? null,
          lastReadMessageId: payload.lastReadMessageId,
          lastReadAt: new Date().toISOString(),
        });
        return;
      }
      // Message sends: ack with a new id, then echo the stored message back.
      if (event !== ClientEvents.SEND_MESSAGE && event !== ClientEvents.SEND_DM) return;
      const payload = args[0] as Omit<Message, 'id'>;
      const ack = args[1] as ((id: string) => void) | undefined;
      const id = `sc-sent-${++n}`;
      setTimeout(() => {
        ack?.(id);
        const message = { ...payload, id, authorId: me.id, sentAt: new Date().toISOString(), reactions: [] } as Message;
        live.sent.push(message);
        fire(event === ClientEvents.SEND_DM ? ServerEvents.NEW_DM : ServerEvents.NEW_MESSAGE, { message });
      }, 180);
    },
    connected: true,
    id: 'ladle-showcase-socket',
    fire,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Voice room
// ─────────────────────────────────────────────────────────────────────────

class Emitter {
  private handlers = new Map<string, Set<Handler>>();
  private sticky = new Map<string, unknown[]>();
  on = (event: string, handler: Handler): this => {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    const replay = this.sticky.get(event);
    if (replay) setTimeout(() => this.handlers.get(event)?.has(handler) && handler(...replay), 50);
    return this;
  };
  off = (event: string, handler: Handler): this => {
    this.handlers.get(event)?.delete(handler);
    return this;
  };
  once = (event: string, handler: Handler): this => this.on(event, handler);
  emit = (event: string, ...args: unknown[]): void => {
    for (const fn of Array.from(this.handlers.get(event) ?? [])) fn(...args);
  };
  setSticky = (event: string, ...args: unknown[]): void => {
    this.sticky.set(event, args);
  };
}

export interface ShowcaseVoicer {
  user: ScenarioUser;
  micOn?: boolean;
  speaking?: boolean;
}

interface LiveParticipant {
  participant: Participant;
  emitter: Emitter;
}

function liveParticipant(v: ShowcaseVoicer): LiveParticipant {
  const emitter = new Emitter();
  const mic = {
    source: 'microphone',
    kind: 'audio',
    trackSid: `TR_${v.user.id}_mic`,
    trackName: 'microphone',
    isMuted: false,
    isSubscribed: false,
    track: undefined,
  };
  const audio = v.micOn === false ? new Map() : new Map([[mic.trackSid, mic]]);
  const participant = {
    identity: v.user.id,
    name: v.user.displayName || v.user.username,
    metadata: undefined,
    isSpeaking: !!v.speaking,
    audioTrackPublications: audio,
    videoTrackPublications: new Map(),
    trackPublications: new Map(),
    getTrackPublication: (source: string) => (source === 'microphone' && v.micOn !== false ? mic : undefined),
    getTrackPublications: () => [],
    setMicrophoneEnabled: async () => undefined,
    setCameraEnabled: async () => undefined,
    on: emitter.on,
    off: emitter.off,
    once: emitter.once,
  } as unknown as Participant;
  return { participant, emitter };
}

export interface ShowcaseRoom {
  room: Room;
  setSpeaking: (userId: string, speaking: boolean) => void;
  /** Start an endless, deterministic back-and-forth between the given speakers. */
  startConversation: (userIds: string[], stepMs?: number) => () => void;
}

export function createShowcaseRoom(me: ShowcaseVoicer, remotes: ShowcaseVoicer[]): ShowcaseRoom {
  const roomEmitter = new Emitter();
  const live = new Map<string, LiveParticipant>();
  const remoteParticipants = new Map<string, RemoteParticipant>();
  for (const v of remotes) {
    const lp = liveParticipant(v);
    live.set(v.user.id, lp);
    remoteParticipants.set(v.user.id, lp.participant as unknown as RemoteParticipant);
  }
  const speakers = () =>
    Array.from(live.values())
      .map((lp) => lp.participant)
      .filter((p) => p.isSpeaking);
  roomEmitter.setSticky('activeSpeakersChanged', speakers());

  const setSpeaking = (userId: string, speaking: boolean) => {
    const lp = live.get(userId);
    if (!lp || lp.participant.isSpeaking === speaking) return;
    (lp.participant as { isSpeaking: boolean }).isSpeaking = speaking;
    lp.emitter.emit('isSpeakingChanged', speaking);
    const now = speakers();
    roomEmitter.setSticky('activeSpeakersChanged', now);
    roomEmitter.emit('activeSpeakersChanged', now);
  };

  const room = {
    localParticipant: liveParticipant(me).participant as unknown as LocalParticipant,
    remoteParticipants,
    on: roomEmitter.on,
    off: roomEmitter.off,
    once: roomEmitter.once,
  } as unknown as Room;

  const startConversation = (userIds: string[], stepMs = 1400) => {
    // A fixed "script": who talks in each step (sometimes two overlap).
    const pattern: number[][] = [[0], [0], [1], [1, 0], [2], [2], [0], [1], [1], [2, 1]];
    let step = 0;
    const tick = () => {
      const active = new Set((pattern[step % pattern.length] ?? []).map((i) => userIds[i % userIds.length]));
      for (const id of userIds) setSpeaking(id, active.has(id));
      step += 1;
    };
    tick();
    const timer = setInterval(tick, stepMs);
    return () => clearInterval(timer);
  };

  return { room, setSpeaking, startConversation };
}

// ─────────────────────────────────────────────────────────────────────────
// Live server state
// ─────────────────────────────────────────────────────────────────────────

/**
 * The bits of "server" state a recording changes, so refetches agree with
 * what the viewer just did (the base handlers answer from the static
 * scenario): messages sent during the story, read watermarks, and read or
 * dismissed notifications.
 */
interface LiveState {
  /** Messages posted while the story runs (Alex's sends and teammates' `say`). */
  sent: Message[];
  unread: Map<string, { unreadCount: number; mentionCount: number }>;
  readNotifications: Set<string>;
  dismissedNotifications: Set<string>;
}

function createLiveState(scenario: Scenario): LiveState {
  return {
    sent: [],
    unread: new Map(Object.entries(scenario.unreadByContextId)),
    readNotifications: new Set(),
    dismissedNotifications: new Set(),
  };
}

/** Unread counts, notifications and the DM list, answered from `LiveState`. */
function liveHandlers(scenario: Scenario, live: LiveState): HttpHandler[] {
  const isDm = (id: string) => scenario.dmGroups.some((g) => g.id === id);
  const notifications = () =>
    scenario.notifications
      .filter((n) => !live.dismissedNotifications.has(n.id))
      .map((n) => (live.readNotifications.has(n.id) ? { ...n, read: true } : n));
  const unreadNotifications = () => notifications().filter((n) => !n.read).length;
  return [
    http.get('/api/read-receipts/unread-counts', () =>
      HttpResponse.json(
        Array.from(live.unread.entries()).map(([id, v]) => ({
          directMessageGroupId: isDm(id) ? id : undefined,
          channelId: isDm(id) ? undefined : id,
          unreadCount: v.unreadCount,
          mentionCount: v.mentionCount,
        })),
      )),
    http.get('/api/notifications', () => {
      const list = notifications();
      return HttpResponse.json({ notifications: list, total: list.length, unreadCount: unreadNotifications() });
    }),
    http.get('/api/notifications/unread-count', () => HttpResponse.json({ count: unreadNotifications() })),
    http.post('/api/notifications/read-all', () => {
      for (const n of scenario.notifications) live.readNotifications.add(n.id);
      return HttpResponse.json({ success: true });
    }),
    http.post('/api/notifications/:id/read', ({ params }) => {
      live.readNotifications.add(String(params.id));
      return HttpResponse.json({ success: true });
    }),
    http.post('/api/notifications/:id/dismiss', ({ params }) => {
      live.dismissedNotifications.add(String(params.id));
      return HttpResponse.json({ success: true });
    }),
    // The app refetches the DM list on every new DM for its preview line.
    http.get('/api/direct-messages', () =>
      HttpResponse.json(
        scenario.dmGroups.map((g) => {
          const last = [...(scenario.messagesByDmGroup[g.id] ?? []), ...live.sent.filter((m) => m.directMessageGroupId === g.id)]
            .sort((a, b) => a.sentAt.localeCompare(b.sentAt))
            .pop();
          return last
            ? { ...g, lastMessage: { id: last.id, authorId: last.authorId, spans: last.spans as never, sentAt: last.sentAt } }
            : g;
        }),
      )),
  ];
}

// ─────────────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────────────

function appearanceHandler(scenario: Scenario, theme: ThemeSettings): HttpHandler {
  return http.get('/api/appearance-settings', () =>
    HttpResponse.json({
      id: 'appearance-1',
      userId: scenario.me.id,
      themeMode: theme.mode,
      accentColor: theme.accentColor,
      intensity: theme.intensity,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    } satisfies AppearanceSettingsResponseDto),
  );
}

function allMessages(scenario: Scenario): Message[] {
  return [
    ...Object.values(scenario.messagesByChannel).flat(),
    ...Object.values(scenario.threadRepliesByParent).flat(),
    ...Object.values(scenario.messagesByDmGroup).flat(),
  ];
}

/** Toggle-able reactions: the real controller returns the updated message. */
function reactionHandlers(scenario: Scenario, extraMessages: () => Message[]): HttpHandler[] {
  const overrides = new Map<string, Message>();
  const find = (id: string) =>
    overrides.get(id) ?? allMessages(scenario).find((m) => m.id === id) ?? extraMessages().find((m) => m.id === id);
  const apply = async (request: Request, add: boolean) => {
    const body = (await request.json()) as { messageId: string; emoji: string };
    const message = find(body.messageId);
    if (!message) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    const reactions = (message.reactions ?? []).map((r) => ({ ...r, userIds: [...r.userIds] }));
    const existing = reactions.find((r) => r.emoji === body.emoji);
    const meId = scenario.me.id;
    if (add) {
      if (existing) {
        if (!existing.userIds.includes(meId)) existing.userIds.push(meId);
      } else reactions.push({ emoji: body.emoji, userIds: [meId] });
    } else if (existing) {
      existing.userIds = existing.userIds.filter((id) => id !== meId);
    }
    const updated = { ...message, reactions: reactions.filter((r) => r.userIds.length > 0) };
    overrides.set(message.id, updated);
    return HttpResponse.json(updated);
  };
  return [
    http.post('/api/messages/reactions', ({ request }) => apply(request, true)),
    http.delete('/api/messages/reactions', ({ request }) => apply(request, false)),
  ];
}

/** Each member's real roles (the base handlers answer "no roles" for others, the first role for Alex). */
function memberRoleHandlers(scenario: Scenario): HttpHandler[] {
  return [
    http.get('/api/roles/my/community/:communityId', ({ params }) =>
      HttpResponse.json({
        resourceType: 'COMMUNITY',
        userId: scenario.me.id,
        resourceId: String(params.communityId),
        roles:
          (scenario.membershipsByCommunity[String(params.communityId)] ?? []).find((m) => m.userId === scenario.me.id)
            ?.roles ?? [],
      })),
    http.get('/api/roles/user/:userId/community/:communityId', ({ params }) => {
      const membership = (scenario.membershipsByCommunity[String(params.communityId)] ?? []).find(
        (m) => m.userId === String(params.userId),
      );
      return HttpResponse.json({
        resourceType: 'COMMUNITY',
        userId: String(params.userId),
        resourceId: String(params.communityId),
        roles: membership?.roles ?? [],
      });
    }),
  ];
}

const voiceHeartbeatHandlers: HttpHandler[] = [
  http.post('/api/channels/:channelId/voice-presence/refresh', ({ params }) =>
    HttpResponse.json({ success: true, message: 'Presence refreshed successfully', channelId: String(params.channelId) }, { status: 201 })),
  http.post('/api/read-receipts/mark-as-read', () => HttpResponse.json({ success: true })),
  http.post('/api/read-receipts/mark-read', () => HttpResponse.json({ success: true })),
];

// ─────────────────────────────────────────────────────────────────────────
// Recorder API (window.__showcase)
// ─────────────────────────────────────────────────────────────────────────

export interface ShowcaseApi {
  /** A teammate (or `alex`, e.g. replaying an earlier scene) posts a message (channel id or DM group id). */
  say: (username: string, where: { channelId?: string; dmId?: string }, text: string, extra?: Partial<Message>) => string;
  /** A teammate starts/stops typing in a channel or DM. */
  typing: (username: string, where: { channelId?: string; dmId?: string }, isTyping: boolean) => void;
  /** A teammate (or `alex`) reacts to a message; existing reactors are kept. */
  react: (username: string, messageId: string, emoji: string, where: { channelId?: string; dmId?: string }) => void;
  /**
   * Alex read a channel/DM elsewhere (another device, or an earlier scene of
   * the same recording): the server's self-sync read receipt plus
   * `notificationRead` for its notifications, so every badge drops.
   */
  read: (where: { channelId?: string; dmId?: string }) => void;
  speak: (username: string, speaking: boolean) => void;
  conversation: (usernames: string[], stepMs?: number) => void;
}

declare global {
  interface Window {
    __showcase?: ShowcaseApi;
  }
}

function ShowcaseControls({
  scenario,
  socket,
  room,
  live,
}: {
  scenario: Scenario;
  socket: ShowcaseSocket;
  room?: ShowcaseRoom;
  live: LiveState;
}) {
  useEffect(() => {
    const { sent } = live;
    const byName = (username: string) => [scenario.me, ...scenario.users].find((u) => u.username === username)!;
    const messagesIn = (where: { channelId?: string; dmId?: string }) =>
      [...allMessages(scenario), ...sent].filter((m) =>
        where.dmId ? m.directMessageGroupId === where.dmId : m.channelId === where.channelId && !m.parentMessageId,
      );
    let n = 0;
    const reactors = new Map<string, string[]>();
    let stopConversation: (() => void) | undefined;
    const api: ShowcaseApi = {
      say(username, where, text, extra = {}) {
        const author = byName(username);
        const id = `sc-live-${++n}`;
        const spans: Span[] = [{ type: SpanType.PLAINTEXT, text }];
        const message: Message = {
          id,
          channelId: where.channelId ?? null,
          directMessageGroupId: where.dmId ?? null,
          authorId: author.id,
          spans,
          attachments: [],
          reactions: [],
          sentAt: new Date().toISOString(),
          ...extra,
        };
        sent.push(message);
        socket.fire(where.dmId ? ServerEvents.NEW_DM : ServerEvents.NEW_MESSAGE, { message });
        return id;
      },
      typing(username, where, isTyping) {
        socket.fire(ServerEvents.USER_TYPING, {
          userId: byName(username).id,
          channelId: where.channelId,
          directMessageGroupId: where.dmId,
          isTyping,
        });
      },
      react(username, messageId, emoji, where) {
        // The server sends the reaction's full user list, so accumulate
        // (starting from whoever had already reacted).
        const key = `${messageId}|${emoji}`;
        const before =
          reactors.get(key) ??
          [...allMessages(scenario), ...sent].find((m) => m.id === messageId)?.reactions?.find((r) => r.emoji === emoji)
            ?.userIds ??
          [];
        const userIds = [...before.filter((id) => id !== byName(username).id), byName(username).id];
        reactors.set(key, userIds);
        socket.fire(ServerEvents.REACTION_ADDED, {
          messageId,
          reaction: { emoji, userIds },
          channelId: where.channelId ?? null,
          directMessageGroupId: where.dmId ?? null,
        });
      },
      read(where) {
        const contextId = where.channelId ?? where.dmId;
        if (!contextId) return;
        const last = messagesIn(where)
          .sort((a, b) => a.sentAt.localeCompare(b.sentAt))
          .pop();
        live.unread.delete(contextId);
        if (last) {
          socket.fire(ServerEvents.READ_RECEIPT_UPDATED, {
            channelId: where.channelId ?? null,
            directMessageGroupId: where.dmId ?? null,
            lastReadMessageId: last.id,
            lastReadAt: new Date().toISOString(),
          });
        }
        for (const note of scenario.notifications) {
          const inContext = note.channelId === contextId || note.directMessageGroupId === contextId;
          if (!inContext || note.read || live.readNotifications.has(note.id)) continue;
          live.readNotifications.add(note.id);
          socket.fire(ServerEvents.NOTIFICATION_READ, { notificationId: note.id });
        }
      },
      speak(username, speaking) {
        room?.setSpeaking(byName(username).id, speaking);
      },
      conversation(usernames, stepMs) {
        stopConversation?.();
        stopConversation = room?.startConversation(usernames.map((u) => byName(u).id), stepMs);
      },
    };
    window.__showcase = api;
    return () => {
      stopConversation?.();
      if (window.__showcase === api) delete window.__showcase;
    };
  }, [scenario, socket, room, live]);
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// defineShowcase
// ─────────────────────────────────────────────────────────────────────────

export interface ShowcaseOptions {
  scenario?: Scenario;
  theme?: ThemeSettings;
  voiceState?: Partial<VoiceState>;
  /** Voice participants (me first). Requires `voiceState` to be "connected". */
  voice?: { me: ShowcaseVoicer; remotes: ShowcaseVoicer[]; autoConversation?: string[] };
  overlay?: ReactNode;
  extraHandlers?: HttpHandler[];
}

export function defineShowcase(path: string, options: ShowcaseOptions = {}): LadleStoryComponent {
  const scenario = options.scenario ?? showcaseScenario;
  const theme = options.theme ?? SHOWCASE_THEME;
  // One per story (MSW handlers are per story); every capture is a fresh page load.
  const live = createLiveState(scenario);

  const Story: LadleStoryComponent = () => {
    // Fresh socket + room per mount, so re-visiting a story starts clean.
    const [socket] = useStateOnce(() => createShowcaseSocket(scenario.me, live));
    const [room] = useStateOnce(() =>
      options.voice ? createShowcaseRoom(options.voice.me, options.voice.remotes) : undefined,
    );
    useEffect(() => {
      if (!room || !options.voice?.autoConversation) return undefined;
      const ids = options.voice.autoConversation.map(
        (u) => [scenario.me, ...scenario.users].find((x) => x.username === u)!.id,
      );
      return room.startConversation(ids);
    }, [room]);

    let tree: ReactNode = h(
      'div',
      { style: { display: 'contents' } },
      h(StoryRoutes),
      h(ShowcaseControls, { scenario, socket, room, live }),
      options.overlay ?? null,
    );
    if (room) {
      tree = h(
        RoomContext.Provider,
        { value: { room: room.room, setRoom: () => {}, getRoom: () => room.room } },
        h(SpeakingProvider, null, tree),
      );
    }
    tree = h(SocketContext.Provider, { value: { socket: socket as never, isConnected: true } }, tree);
    return h(
      ThemeProvider,
      null,
      h(CssBaseline),
      // Ladle's own light/dark backdrop would show through transparent panes.
      h(GlobalStyles, { styles: { '.ladle-background': { display: 'none' } } }),
      h(SandboxShell, { path, voiceState: options.voiceState }, tree),
    );
  };
  Story.msw = makeHandlers(scenario, {
    extraHandlers: [
      ...(options.extraHandlers ?? []),
      ...showcaseFileHandlers(),
      appearanceHandler(scenario, theme),
      ...reactionHandlers(scenario, () => live.sent),
      ...memberRoleHandlers(scenario),
      ...liveHandlers(scenario, live),
      ...voiceHeartbeatHandlers,
    ],
  });
  return Story;
}

/** `useState(init)` without the setter — a stable per-mount value. */
function useStateOnce<T>(init: () => T): [T] {
  const [value] = useState(init);
  return [value];
}
