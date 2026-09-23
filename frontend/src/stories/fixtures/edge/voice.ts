/**
 * Edge-case fixture helpers for the VOICE & PERMISSIONS story area
 * (`stories/edge/voice/EdgeVoice*.stories.tsx`).
 *
 * Kept in a plain `.ts` file (components built with `createElement`, no JSX)
 * so this module never trips `react-refresh/only-export-components`.
 *
 * Three pieces:
 *
 * 1. `createMediaRoom()` — a richer variant of `fixtures/fakeRoom.tsx`'s
 *    fake LiveKit `Room`. That stub returns `undefined` from every
 *    `getTrackPublication()`, which the app reads as "mic off" for every
 *    participant (so the base `VoiceConnected` story shows everyone muted).
 *    This one publishes *trackless* publications (`{ source, isMuted,
 *    track: undefined }`) per participant, exactly the fields
 *    `useParticipantTracks` / `useLocalMediaState` / `VideoTiles` read, plus
 *    `isSpeaking` (read once by `useSpeakingDetection` for remote
 *    participants) and a `metadata` JSON carrying `isDeafened` (same shape
 *    LiveKit participant metadata has in production). Every other consumer
 *    (`AudioRenderer`, `useDeafenEffect`, `useTrackSubscription`, ...)
 *    guards on `publication.track` / `instanceof RemoteTrackPublication` and
 *    skips these, so nothing tries to play audio.
 *
 *    With #443's Stage/Float/Dock redesign this room also drives the NEW
 *    voice UI: the embedded stage (`VideoTiles` in `CommunityPage` /
 *    `MobileChatPanel` whenever connected to the viewed voice channel, and
 *    the DM `StageSplit` on desktop) renders one tile per participant — an
 *    avatar tile for anyone with no camera/screen — and the desktop/tablet
 *    `FloatCard` (via `useFloatTileSelection`) picks a single active-speaker
 *    tile. Remote personas marked `speaking` are reported as LiveKit active
 *    speakers for that selection (see `createMediaRoom`).
 *
 *    Camera / screen-share publications that are actually *watched* get a
 *    stand-in `track` whose `attach(videoEl)` plays a canvas-generated
 *    MediaStream visibly labelled "SIMULATED" — there is no real remote
 *    media in the sandbox, so this is the most honest thing a static
 *    screenshot can show. Unwatched remote video renders the app's real
 *    "Click to watch" placeholder tile (no media needed at all).
 *
 *    NOT fakeable: the LOCAL speaking indicator (driven by real AudioContext
 *    analysis of a mic MediaStreamTrack).
 *
 * 2. `createControllableSocket()` + `FireServerEvent` — a fake socket.io
 *    client that remembers listeners so a story can deliver a real-shaped
 *    server event (e.g. `dmVoiceCallStarted`) through the app's own
 *    `useSocketHub` → event bus → `IncomingCallListener` path.
 *
 * 3. Permission helpers — community role presets copied verbatim from
 *    `backend/src/roles/default-roles.config.ts`, and handlers for the
 *    `/api/roles/my/{community,channel}` endpoints (channel roles are the
 *    community roles on the real backend — `getUserRolesForChannel`).
 */
import { createElement, useEffect, type ReactNode } from 'react';
import { http, HttpResponse, type HttpHandler } from 'msw';
import type { LocalParticipant, Participant, RemoteParticipant, Room } from 'livekit-client';
import type {
  ChannelMembershipResponseDto,
  CommunityBanDto,
  CommunityTimeoutDto,
  RoleDto,
  UserRolesResponseDto,
  VoicePresenceUserDto,
} from '../../../api-client/types.gen';
import { SocketContext } from '../../../utils/SocketContext';
import { RoomContext } from '../../../contexts/RoomContextDef';
import { SpeakingProvider } from '../../../contexts/SpeakingContext';
import { SandboxShell } from '../SandboxShell';
import { StoryRoutes } from '../StoryRoutes';
import { makeHandlers } from '../handlers';
import { timeAgo } from '../rng';
import { buildScenario } from '../builder';
import { colorFor } from '../avatars';
import type { LadleStoryComponent } from '../screenStory';
import { VoiceSessionType, type VoiceState } from '../../../contexts/VoiceContext';
import type { Scenario, ScenarioCommunity, ScenarioUser } from '../types';
import { createMessage, createSpan } from '../../../__tests__/test-utils/factories';

// ─────────────────────────────────────────────────────────────────────────
// Scenario
// ─────────────────────────────────────────────────────────────────────────

/**
 * 30 users, and EVERY user a member of community-1 (the builder picks a
 * random 6..N subset, too few for a 25-person voice channel that should
 * only contain community members).
 */
function withAllUsersInFirstCommunity(scenario: Scenario): Scenario {
  const community = scenario.communities[0];
  const memberRole = scenario.rolesByCommunity[community.id].find((r) => r.name === 'Member')!;
  const existing = scenario.membershipsByCommunity[community.id];
  const missing = scenario.users.filter((u) => !community.memberIds.includes(u.id));
  const added = missing.map((u, i) => ({
    id: `membership-${community.id}-x${i}`,
    userId: u.id,
    communityId: community.id,
    joinedAt: timeAgo(60 * 24 * (10 + i)),
    roles: [memberRole],
    user: u as never,
  }));
  return {
    ...scenario,
    communities: scenario.communities.map((c, i) =>
      i === 0 ? { ...c, memberIds: [...c.memberIds, ...missing.map((u) => u.id)] } : c,
    ),
    membershipsByCommunity: { ...scenario.membershipsByCommunity, [community.id]: [...existing, ...added] },
  };
}

export const edgeVoiceScenario: Scenario = withAllUsersInFirstCommunity(
  buildScenario({ seed: 'edge-voice', userCount: 30, meOverrides: { role: 'OWNER' } }),
);
export const edgeCommunity: ScenarioCommunity = edgeVoiceScenario.communities[0];
export const edgeGeneral = edgeCommunity.channels.find((c) => c.name === 'general')!;
export const edgeVoiceChannel = edgeCommunity.channels.find((c) => c.type === 'VOICE')!;
export const edgeSecondText = edgeCommunity.channels.filter((c) => c.type === 'TEXT')[1];
export const edgeDmGroup = edgeVoiceScenario.dmGroups[0];

/** The DM partner of `edgeDmGroup` (1:1 DM). */
export const edgeDmPartner: ScenarioUser = edgeVoiceScenario.users.find(
  (u) => u.id === edgeDmGroup.members.find((m) => m.userId !== edgeVoiceScenario.me.id)?.userId,
)!;

/** Other users (never `me`), in a stable order, first `n`. */
export function others(scenario: Scenario, n: number): ScenarioUser[] {
  return scenario.users.slice(0, n);
}

/** Replace a user's display name everywhere it's embedded (users list + memberships + DM members). */
export function withRenamedUsers(scenario: Scenario, names: Record<string, string>): Scenario {
  const rename = <T extends { id: string; displayName?: string | null }>(u: T): T =>
    names[u.id] ? { ...u, displayName: names[u.id] } : u;
  return {
    ...scenario,
    users: scenario.users.map(rename),
    membershipsByCommunity: Object.fromEntries(
      Object.entries(scenario.membershipsByCommunity).map(([cid, list]) => [
        cid,
        list.map((m) => ({ ...m, user: m.user ? rename(m.user as never) : m.user })),
      ]),
    ),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Voice presence (REST shape — `VoicePresenceUserDto`)
// ─────────────────────────────────────────────────────────────────────────

export interface VoicePersona {
  user: ScenarioUser;
  /** Mic publication present + unmuted. Default true. */
  micOn?: boolean;
  speaking?: boolean;
  deafened?: boolean;
  /** Server-muted by a moderator (REST presence / WS only — not in LiveKit metadata). */
  serverMuted?: boolean;
  camera?: boolean;
  screen?: boolean;
}

/** REST voice-presence rows for a channel, mirroring what the backend's Redis-backed presence returns. */
export function withChannelPresence(scenario: Scenario, channelId: string, personas: VoicePersona[]): Scenario {
  const list: VoicePresenceUserDto[] = personas.map((p, i) => ({
    id: p.user.id,
    username: p.user.username,
    displayName: p.user.displayName ?? undefined,
    avatarUrl: p.user.avatarUrl ?? undefined,
    joinedAt: timeAgo(90 - i * 3),
    isDeafened: !!p.deafened,
    isServerMuted: !!p.serverMuted,
  }));
  return { ...scenario, voicePresenceByChannel: { ...scenario.voicePresenceByChannel, [channelId]: list } };
}

/** `GET /api/dm-groups/:id/voice-presence` for a live DM call (base handler always returns nobody). */
export function dmPresenceHandler(dmGroupId: string, users: ScenarioUser[]): HttpHandler {
  return http.get(`/api/dm-groups/${dmGroupId}/voice-presence`, () =>
    HttpResponse.json({
      dmGroupId,
      users: users.map((u, i) => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName ?? undefined,
        avatarUrl: u.avatarUrl ?? undefined,
        joinedAt: timeAgo(12 - i),
        isDeafened: false,
        isServerMuted: false,
      })),
      count: users.length,
    }),
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Fake LiveKit room with media state
// ─────────────────────────────────────────────────────────────────────────

type Handler = (...args: unknown[]) => void;

class Emitter {
  private handlers = new Map<string, Set<Handler>>();
  /**
   * Events whose latest payload is replayed to every new listener (shortly
   * after it subscribes). Used for `activeSpeakersChanged`: the real Room
   * emits it whenever the speaker set changes, but in a static story nothing
   * ever changes, so a late subscriber (the float card mounts after the
   * layout) would otherwise never learn who's talking.
   */
  private sticky = new Map<string, unknown[]>();
  on = (event: string, handler: Handler): this => {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    const replay = this.sticky.get(event);
    if (replay) {
      setTimeout(() => {
        if (this.handlers.get(event)?.has(handler)) handler(...replay);
      }, 50);
    }
    return this;
  };
  setSticky = (event: string, ...args: unknown[]): void => {
    this.sticky.set(event, args);
  };
  off = (event: string, handler: Handler): this => {
    this.handlers.get(event)?.delete(handler);
    return this;
  };
  once = (event: string, handler: Handler): this => this.on(event, handler);
}

/**
 * A stand-in video "track": `attach(videoEl)` plays a canvas-drawn stream
 * clearly labelled as simulated (no real media exists in the sandbox).
 */
function simulatedVideoTrack(label: string, kind: 'camera' | 'screen', key: string) {
  let stream: MediaStream | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const draw = (ctx: CanvasRenderingContext2D, w: number, h: number, tick: number) => {
    const c1 = colorFor(key);
    const c2 = colorFor(`${key}:2`);
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, kind === 'screen' ? '#1e2230' : c1);
    g.addColorStop(1, kind === 'screen' ? '#2d3448' : c2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    if (kind === 'screen') {
      // A crude "desktop": window chrome + code-ish lines.
      ctx.fillStyle = '#3b4258';
      ctx.fillRect(40, 40, w - 80, 28);
      ctx.fillStyle = '#12151f';
      ctx.fillRect(40, 68, w - 80, h - 120);
      for (let i = 0; i < 9; i++) {
        ctx.fillStyle = ['#7aa2f7', '#9ece6a', '#e0af68', '#bb9af7'][i % 4];
        ctx.fillRect(64, 92 + i * 22, 80 + ((i * 97) % (w - 260)), 8);
      }
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath();
      ctx.arc(w / 2, h * 0.42, h * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(w / 2 - h * 0.3, h * 0.66, h * 0.6, h * 0.4);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, h - 34, w, 34);
    ctx.fillStyle = '#fff';
    ctx.font = '600 16px Roboto, Arial, sans-serif';
    ctx.fillText(`SIMULATED ${kind === 'screen' ? 'SCREEN SHARE' : 'CAMERA'} · ${label}`, 12, h - 12);
    // A moving dot so captureStream keeps emitting frames.
    ctx.fillStyle = '#ff5252';
    ctx.beginPath();
    ctx.arc(w - 18, 18, 6 + (tick % 2), 0, Math.PI * 2);
    ctx.fill();
  };
  return {
    kind: 'video',
    attach(el: HTMLMediaElement) {
      if (!stream) {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 360;
        const ctx = canvas.getContext('2d')!;
        let tick = 0;
        draw(ctx, canvas.width, canvas.height, tick);
        timer = setInterval(() => draw(ctx, canvas.width, canvas.height, ++tick), 250);
        stream = canvas.captureStream(4);
      }
      el.muted = true;
      el.srcObject = stream;
      return el;
    },
    detach(el?: HTMLMediaElement) {
      if (el) el.srcObject = null;
      if (timer) clearInterval(timer);
      timer = null;
      stream = null;
      return el ? [el] : [];
    },
  };
}

interface FakePublication {
  source: string;
  kind: 'audio' | 'video';
  trackSid: string;
  trackName: string;
  isMuted: boolean;
  isSubscribed: boolean;
  track: ReturnType<typeof simulatedVideoTrack> | undefined;
}

function mediaParticipant(persona: VoicePersona, watched: { camera: boolean; screen: boolean }): Participant {
  const emitter = new Emitter();
  const { user } = persona;
  const name = user.displayName || user.username;
  const pubs = new Map<string, FakePublication>();
  const mk = (source: string, kind: 'audio' | 'video', track?: FakePublication['track']): FakePublication => ({
    source,
    kind,
    trackSid: `TR_${user.id}_${source}`,
    trackName: source,
    isMuted: false,
    isSubscribed: !!track,
    track,
  });
  if (persona.micOn !== false) pubs.set('microphone', mk('microphone', 'audio'));
  if (persona.camera) {
    pubs.set('camera', mk('camera', 'video', watched.camera ? simulatedVideoTrack(name, 'camera', user.id) : undefined));
  }
  if (persona.screen) {
    pubs.set(
      'screen_share',
      mk('screen_share', 'video', watched.screen ? simulatedVideoTrack(name, 'screen', `${user.id}:screen`) : undefined),
    );
  }
  const bySid = (kind?: 'audio' | 'video') =>
    new Map(Array.from(pubs.values()).filter((p) => !kind || p.kind === kind).map((p) => [p.trackSid, p]));

  return {
    identity: user.id,
    name,
    metadata: persona.deafened ? JSON.stringify({ isDeafened: true }) : undefined,
    isSpeaking: !!persona.speaking,
    audioTrackPublications: bySid('audio'),
    videoTrackPublications: bySid('video'),
    // Left empty on purpose: `useTrackSubscription` iterates this to call
    // `setSubscribed()` on real RemoteTrackPublications — none exist here.
    trackPublications: new Map(),
    getTrackPublication: (source: string) => pubs.get(source),
    getTrackPublications: () => [],
    setMicrophoneEnabled: async () => undefined,
    setCameraEnabled: async () => undefined,
    on: emitter.on,
    off: emitter.off,
    once: emitter.once,
  } as unknown as Participant;
}

/**
 * A fake connected Room. `watched` lists remote user ids whose camera /
 * screen share the viewer is watching (must match `voiceState.watchingCameras`
 * / `watchingScreenShares`). The local participant's own video is always
 * "attached" (that's how the real app behaves: local tiles show by default).
 *
 * Active speakers: the remote personas marked `speaking` (in order) are
 * delivered as LiveKit's `activeSpeakersChanged` event to whoever subscribes
 * — only the float card's `useFloatTileSelection` does, to pick the
 * active-speaker tile. (The local user is excluded, matching the float
 * card's anti-flap rule, and because local speaking isn't fakeable anyway.)
 */
export function createMediaRoom(
  me: VoicePersona,
  remotes: VoicePersona[],
  watched: { cameras?: string[]; screens?: string[] } = {},
): Room {
  const emitter = new Emitter();
  const remoteParticipants = new Map<string, RemoteParticipant>();
  remotes
    .filter((p) => p.user.id !== me.user.id)
    .forEach((p) =>
      remoteParticipants.set(
        p.user.id,
        mediaParticipant(p, {
          camera: !!watched.cameras?.includes(p.user.id),
          screen: !!watched.screens?.includes(p.user.id),
        }) as unknown as RemoteParticipant,
      ),
    );
  const speakers = remotes
    .filter((p) => p.speaking && p.user.id !== me.user.id)
    .map((p) => remoteParticipants.get(p.user.id)!);
  if (speakers.length > 0) emitter.setSticky('activeSpeakersChanged', speakers);
  return {
    localParticipant: mediaParticipant(me, { camera: true, screen: true }) as unknown as LocalParticipant,
    remoteParticipants,
    on: emitter.on,
    off: emitter.off,
    once: emitter.once,
  } as unknown as Room;
}

// ─────────────────────────────────────────────────────────────────────────
// Controllable fake socket
// ─────────────────────────────────────────────────────────────────────────

export interface ControllableSocket {
  on: (event: string, handler: Handler) => void;
  off: (event: string, handler: Handler) => void;
  once: (event: string, handler: Handler) => void;
  emit: (event: string, ...args: unknown[]) => void;
  connected: boolean;
  id: string;
  /** Deliver a server → client event to every registered listener. Returns how many listeners got it. */
  fire: (event: string, payload: unknown) => number;
  listenerCount: (event: string) => number;
}

/**
 * Like `fixtures/fakeSocket.ts`, but `fire()` can push a server event in.
 * `emit()` (client → server) is a no-op — including `sendMessage`, whose ack
 * is never called, which is exactly what the real server does when it
 * throws a `WsException` (timed out / slowmode): the client never gets an ack.
 */
export function createControllableSocket(): ControllableSocket {
  const handlers = new Map<string, Set<Handler>>();
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
    emit() {},
    connected: true,
    id: 'ladle-edge-voice-socket',
    fire(event, payload) {
      const set = handlers.get(event);
      if (!set) return 0;
      for (const h of Array.from(set)) h(payload);
      return set.size;
    },
    listenerCount: (event) => handlers.get(event)?.size ?? 0,
  };
}

/** Waits until something listens for `event` on `socket` (the hub mounts inside Layout), then fires it once. */
export function FireServerEvent({
  socket,
  event,
  payload,
  delayMs = 300,
}: {
  socket: ControllableSocket;
  event: string;
  payload: unknown;
  delayMs?: number;
}) {
  useEffect(() => {
    let cancelled = false;
    const started = Date.now();
    const tryFire = () => {
      if (cancelled) return;
      if (socket.listenerCount(event) > 0) {
        setTimeout(() => !cancelled && socket.fire(event, payload), delayMs);
        return;
      }
      if (Date.now() - started < 6000) setTimeout(tryFire, 100);
    };
    tryFire();
    return () => {
      cancelled = true;
    };
  }, [socket, event, payload, delayMs]);
  return null;
}

/** `VoiceProvider` seed for "connected to this community voice channel". */
export function channelVoiceState(
  channel: { id: string; name: string; communityId: string; isPrivate?: boolean },
  extra: Partial<VoiceState> = {},
): Partial<VoiceState> {
  return {
    isConnected: true,
    // Pin the float card's collapsed state (otherwise lazily restored from
    // localStorage, i.e. whatever the last story/drag left behind).
    pipCollapsed: false,
    contextType: VoiceSessionType.Channel,
    currentChannelId: channel.id,
    channelName: channel.name,
    communityId: channel.communityId,
    isPrivate: !!channel.isPrivate,
    createdAt: timeAgo(25),
    ...extra,
  };
}

/** `VoiceProvider` seed for "connected to this DM's call". */
export function dmVoiceState(dmGroupId: string, dmGroupName: string, extra: Partial<VoiceState> = {}): Partial<VoiceState> {
  return {
    isConnected: true,
    pipCollapsed: false,
    contextType: VoiceSessionType.Dm,
    currentDmGroupId: dmGroupId,
    dmGroupName,
    ...extra,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Story assembly
// ─────────────────────────────────────────────────────────────────────────

export interface EdgeScreenOptions {
  path: string;
  voiceState?: Partial<VoiceState>;
  room?: Room;
  socket?: ControllableSocket;
  /** Rendered next to the routes, INSIDE the fake room/socket providers. */
  overlay?: ReactNode;
  extraHandlers?: HttpHandler[];
}

/**
 * Like `defineScreen`, but optionally shadows `AuthenticatedShell`'s
 * RoomContext (null in the sandbox) with a fake room and its SocketContext
 * with a controllable socket — both must sit in `SandboxShell`'s children
 * slot to be *inside* the real providers.
 */
/**
 * `useVoicePresenceHeartbeat` POSTs these every ~30s while connected (and
 * once on mount); the base handlers don't cover them. Shapes per
 * `voice-presence.controller.ts` / `dm-voice-presence.controller.ts`.
 */
const voiceHeartbeatHandlers: HttpHandler[] = [
  http.post('/api/channels/:channelId/voice-presence/refresh', ({ params }) =>
    HttpResponse.json(
      { success: true, message: 'Presence refreshed successfully', channelId: String(params.channelId) },
      { status: 201 },
    )),
  http.post('/api/dm-groups/:dmGroupId/voice-presence/refresh', ({ params }) =>
    HttpResponse.json(
      { success: true, message: 'DM presence refreshed successfully', dmGroupId: String(params.dmGroupId) },
      { status: 201 },
    )),
];

export function defineEdgeScreen(scenario: Scenario, options: EdgeScreenOptions): LadleStoryComponent {
  const { path, voiceState, room, socket, overlay, extraHandlers } = options;
  const Story: LadleStoryComponent = () => {
    let tree: ReactNode = createElement(
      'div',
      { style: { display: 'contents' } },
      createElement(StoryRoutes),
      overlay ?? null,
    );
    if (room) {
      // A second SpeakingProvider, INSIDE the fake room, so speaking state is
      // computed from it (AuthenticatedShell's one sits above and sees null).
      tree = createElement(
        RoomContext.Provider,
        { value: { room, setRoom: () => {}, getRoom: () => room } },
        createElement(SpeakingProvider, null, tree),
      );
    }
    if (socket) {
      tree = createElement(SocketContext.Provider, { value: { socket: socket as never, isConnected: true } }, tree);
    }
    return createElement(SandboxShell, { path, voiceState }, tree);
  };
  Story.msw = makeHandlers(scenario, { extraHandlers: [...(extraHandlers ?? []), ...voiceHeartbeatHandlers] });
  return Story;
}

// ─────────────────────────────────────────────────────────────────────────
// Permissions
// ─────────────────────────────────────────────────────────────────────────

type Action = RoleDto['actions'][number];

/** `DEFAULT_MEMBER_ROLE` (backend/src/roles/default-roles.config.ts). */
export const MEMBER_ACTIONS: Action[] = [
  'READ_COMMUNITY', 'READ_CHANNEL', 'READ_MEMBER', 'READ_MESSAGE', 'CREATE_MESSAGE', 'JOIN_CHANNEL',
  'CREATE_REACTION', 'DELETE_REACTION', 'READ_ALIAS_GROUP', 'READ_ALIAS_GROUP_MEMBER', 'CAPTURE_REPLAY',
  'READ_SOUNDBOARD_SOUND',
];

/** `DEFAULT_ADMIN_ROLE` ("Community Admin"). */
export const ADMIN_ACTIONS: Action[] = [
  'UPDATE_COMMUNITY', 'DELETE_COMMUNITY', 'READ_COMMUNITY', 'CREATE_CHANNEL', 'UPDATE_CHANNEL', 'DELETE_CHANNEL',
  'READ_CHANNEL', 'JOIN_CHANNEL', 'CREATE_MEMBER', 'UPDATE_MEMBER', 'DELETE_MEMBER', 'READ_MEMBER',
  'CREATE_MESSAGE', 'DELETE_MESSAGE', 'READ_MESSAGE', 'CREATE_ROLE', 'UPDATE_ROLE', 'DELETE_ROLE', 'READ_ROLE',
  'CREATE_INVITE', 'DELETE_INVITE', 'CREATE_ALIAS_GROUP', 'UPDATE_ALIAS_GROUP', 'DELETE_ALIAS_GROUP',
  'READ_ALIAS_GROUP', 'CREATE_ALIAS_GROUP_MEMBER', 'DELETE_ALIAS_GROUP_MEMBER', 'READ_ALIAS_GROUP_MEMBER',
  'UPDATE_ALIAS_GROUP_MEMBER', 'MANAGE_EMOJIS', 'CREATE_REACTION', 'DELETE_REACTION', 'CAPTURE_REPLAY',
  'KICK_USER', 'TIMEOUT_USER', 'UNBAN_USER', 'PIN_MESSAGE', 'UNPIN_MESSAGE', 'DELETE_ANY_MESSAGE',
  'VIEW_BAN_LIST', 'VIEW_MODERATION_LOGS', 'MUTE_PARTICIPANT', 'CREATE_SOUNDBOARD_SOUND',
  'DELETE_SOUNDBOARD_SOUND', 'READ_SOUNDBOARD_SOUND',
];

/** A custom "Read-only" role an admin could create: Member minus CREATE_MESSAGE. */
export const READ_ONLY_ACTIONS: Action[] = MEMBER_ACTIONS.filter((a) => a !== 'CREATE_MESSAGE');

export function makeRole(communityId: string, name: string, actions: Action[], position: number): RoleDto {
  return {
    id: `role-${name.toLowerCase().replace(/\W+/g, '-')}-${communityId}`,
    name,
    actions,
    createdAt: '2025-03-01T00:00:00Z',
    isDefault: name !== 'Read-only',
    position,
  };
}

/**
 * Make `me` an ordinary instance USER holding `role` in `communityId`
 * (member list + roles list updated to match), and return the handlers
 * the permission checks read.
 */
export function asCommunityRole(
  scenario: Scenario,
  communityId: string,
  role: RoleDto,
): { scenario: Scenario; handlers: HttpHandler[] } {
  const me: ScenarioUser = { ...scenario.me, role: 'USER' };
  const existingRoles = scenario.rolesByCommunity[communityId] ?? [];
  const next: Scenario = {
    ...scenario,
    me,
    rolesByCommunity: {
      ...scenario.rolesByCommunity,
      [communityId]: existingRoles.some((r) => r.id === role.id) ? existingRoles : [...existingRoles, role],
    },
    membershipsByCommunity: {
      ...scenario.membershipsByCommunity,
      [communityId]: (scenario.membershipsByCommunity[communityId] ?? []).map((m) =>
        m.userId === me.id ? { ...m, roles: [role], user: me as never } : m,
      ),
    },
  };
  const channelIds = new Set(scenario.communities.find((c) => c.id === communityId)?.channels.map((c) => c.id));
  const handlers: HttpHandler[] = [
    http.get(`/api/roles/my/community/${communityId}`, () =>
      HttpResponse.json({ resourceType: 'COMMUNITY', userId: me.id, resourceId: communityId, roles: [role] } satisfies UserRolesResponseDto)),
    http.get('/api/roles/my/channel/:channelId', ({ params }) => {
      const channelId = String(params.channelId);
      return HttpResponse.json({
        resourceType: 'CHANNEL',
        userId: me.id,
        resourceId: channelId,
        roles: channelIds.has(channelId) ? [role] : [],
      } satisfies UserRolesResponseDto);
    }),
  ];
  return { scenario: next, handlers };
}

/** Mark a channel private and serve its explicit member list (`ChannelMembershipResponseDto[]`). */
export function withPrivateChannel(
  scenario: Scenario,
  channelId: string,
  memberIds: string[],
): { scenario: Scenario; handlers: HttpHandler[] } {
  const next: Scenario = {
    ...scenario,
    communities: scenario.communities.map((c) => ({
      ...c,
      channels: c.channels.map((ch) => (ch.id === channelId ? { ...ch, isPrivate: true } : ch)),
    })),
  };
  const all = [scenario.me, ...scenario.users];
  const rows: ChannelMembershipResponseDto[] = memberIds.map((id, i) => ({
    id: `chm-${channelId}-${i}`,
    userId: id,
    user: all.find((u) => u.id === id) as never,
    channelId,
    joinedAt: timeAgo(60 * 24 * (3 + i)),
    addedBy: scenario.me.id,
  }));
  return {
    scenario: next,
    handlers: [http.get(`/api/channel-membership/channel/${channelId}`, () => HttpResponse.json(rows))],
  };
}

function moderationUser(u: ScenarioUser) {
  const { email: _email, ...rest } = u;
  return rest;
}

/** Populated `bans/:communityId` + `timeouts/:communityId` (bare arrays, like the real controller). */
export function moderationListHandlers(scenario: Scenario, communityId: string): HttpHandler[] {
  const [a, b, c] = scenario.users.slice(-3);
  const mod = scenario.me;
  const bans: CommunityBanDto[] = [
    {
      id: 'ban-1', communityId, userId: a.id, moderatorId: mod.id, user: moderationUser(a), moderator: moderationUser(mod),
      reason: 'Repeated spam in #general after two warnings', createdAt: timeAgo(60 * 30), expiresAt: null, active: true,
    },
    {
      id: 'ban-2', communityId, userId: b.id, moderatorId: mod.id, user: moderationUser(b), moderator: moderationUser(mod),
      reason: null, createdAt: timeAgo(60 * 5), expiresAt: new Date(Date.now() + 6 * 24 * 3600_000).toISOString(), active: true,
    },
  ];
  const timeouts: CommunityTimeoutDto[] = [
    {
      id: 'timeout-1', communityId, userId: c.id, moderatorId: mod.id, user: moderationUser(c), moderator: moderationUser(mod),
      reason: 'Cool off for a bit', createdAt: new Date(Date.now() - 12 * 60_000).toISOString(),
      // Relative to the viewer's real clock (the UI computes "time left" from Date.now()).
      expiresAt: new Date(Date.now() + 48 * 60_000).toISOString(),
    },
  ];
  return [
    http.get(`/api/moderation/bans/${communityId}`, () => HttpResponse.json(bans)),
    http.get(`/api/moderation/timeouts/${communityId}`, () => HttpResponse.json(timeouts)),
  ];
}

/** Nest's default RbacGuard rejection (guard returns false → ForbiddenException). */
export function forbidden(method: 'get' | 'post', path: string): HttpHandler {
  return http[method](path, () =>
    HttpResponse.json({ message: 'Forbidden resource', error: 'Forbidden', statusCode: 403 }, { status: 403 }));
}

// ─────────────────────────────────────────────────────────────────────────
// Messages + message-actions interaction
// ─────────────────────────────────────────────────────────────────────────

/** Append a newest message (unique text, so interactions can find its row). */
export function withAppendedMessage(scenario: Scenario, channelId: string, authorId: string, text: string): Scenario {
  const list = scenario.messagesByChannel[channelId] ?? [];
  const message = createMessage({
    channelId,
    authorId,
    spans: [createSpan({ text })],
    sentAt: timeAgo(0.5),
    reactions: [],
    attachments: [],
  });
  return { ...scenario, messagesByChannel: { ...scenario.messagesByChannel, [channelId]: [...list, message] } };
}

function findMessageRow(text: string): HTMLElement | null {
  const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-row-focus-target="true"]'));
  return rows.find((r) => (r.textContent ?? '').includes(text)) ?? null;
}

/**
 * Open the per-message actions UI for the message containing `text`, the
 * way a user would on this device: a long-press (touchstart held past the
 * long-press delay) under touch UI → `MessageActionsSheet`; a right-click
 * (`contextmenu`) otherwise → `MessageContextMenu`. Both are dispatched;
 * each layout only listens for its own.
 */
export function OpenMessageActions({ text, timeoutMs = 9000 }: { text: string; timeoutMs?: number }) {
  useEffect(() => {
    let cancelled = false;
    const started = Date.now();
    // Desktop: a visible context-menu item for this message; touch: the sheet's quick-react row.
    // (Other, keep-mounted `role="menu"` elements exist on the page, so match on content.)
    const isOpen = () =>
      !!document.querySelector('[aria-label="More reactions"]') ||
      Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).some(
        (el) => el.offsetParent !== null && /Copy Message|Reply in Thread|Add Reaction/i.test(el.textContent ?? ''),
      );
    const attempt = () => {
      if (cancelled || Date.now() - started > timeoutMs) return;
      const row = isOpen() ? null : findMessageRow(text);
      if (row) {
        // Like a user would: scroll the message list down to the (newest) target first.
        let scroller: HTMLElement | null = row.parentElement;
        while (scroller && !(scroller.scrollHeight > scroller.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY))) {
          scroller = scroller.parentElement;
        }
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
        const rect = row.getBoundingClientRect();
        const x = rect.left + Math.min(120, rect.width / 2);
        const y = rect.top + rect.height / 2;
        try {
          const touch = new Touch({ identifier: Date.now(), target: row, clientX: x, clientY: y });
          row.dispatchEvent(
            new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [touch], targetTouches: [touch] }),
          );
        } catch {
          // No Touch support in this browser — desktop path below still runs.
        }
        row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      }
      // The message list can re-mount its rows while it settles (dropping the
      // row's local menu state) — keep re-trying until a menu/sheet is up.
      setTimeout(attempt, 900);
    };
    const t = setTimeout(attempt, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [text, timeoutMs]);
  return null;
}
