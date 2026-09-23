/**
 * A structurally-honest fake LiveKit `Room` for the `VoiceConnected` story.
 *
 * Why: `VoiceChannelUserList.tsx` derives the participant list from
 * `voiceState.room` (not the REST voice-presence query) whenever the viewer
 * is connected to that channel — see its `isConnectedToThisChannel` branch.
 * With no real LiveKit connection, `RoomProvider`'s `room` stays `null`
 * forever, so that component (used both in the sidebar, compact, and in the
 * main channel-view panel) always renders nothing while "connected", which
 * is the empty black area this fixes.
 *
 * This is NOT a generic "fake LiveKit" — it implements exactly the surface
 * actually read by the hooks that mount unconditionally in the app's global
 * layout plus the ones `VoiceChannelUserList`'s rendered rows use, traced by
 * hand against `DesktopLayout.tsx`'s always-mounted
 * `TrackSubscriptionProvider` / `VoiceBottomBar` (which calls
 * `useDeafenEffect`, `useRemoteVolumeEffect`, `useSpeaking`) and
 * `AudioRenderer`, plus `SpeakingProvider`'s `useSpeakingDetection` (mounted
 * once for the whole app), plus `useParticipantTracks` (used by
 * `UserItem`/`CompactUserItem`/`InlineUserAvatar` for each rendered
 * participant row):
 *
 *   - `room.localParticipant` / `room.remoteParticipants` (a real `Map`)
 *   - `participant.identity`, `.name`, `.metadata`, `.isSpeaking`
 *   - `participant.getTrackPublication()` → `undefined` (no real tracks —
 *     honestly reflects "no LiveKit connection", not a fabricated success)
 *   - `participant.audioTrackPublications` / `.trackPublications` (empty
 *     `Map`s — every consumer iterates them and tolerates zero entries)
 *   - `room.on/off` and `participant.on/off` for arbitrary event names —
 *     never actually emitted, since nothing in the sandbox drives a live
 *     connection; they only need to exist and not throw so mount/cleanup
 *     effects succeed.
 *
 * Since #443 (Stage, Float, Dock) this stub ALSO drives the embedded voice
 * stage: `CommunityPage` (desktop) and `MobileChatPanel` (phone/tablet)
 * render `VideoTiles` whenever the viewer is connected to the viewed voice
 * channel, and every connected participant with no camera/screen tile gets
 * an avatar tile — which needs only `videoTrackPublications` /
 * `audioTrackPublications` (empty here), `identity` and `name`. So the
 * `VoiceConnected` story shows a stage of avatar tiles. Real `<video>`
 * rendering (camera / screen-share tiles, the float card's active-speaker
 * camera) is NOT faked here — use `fixtures/edge/voice.ts`'s
 * `createMediaRoom()`, which publishes simulated feeds.
 */
import type { LocalParticipant, Participant, RemoteParticipant, Room } from 'livekit-client';
import { RoomContext } from '../../contexts/RoomContextDef';
import React from 'react';

type Handler = (...args: unknown[]) => void;

/** `on`/`off`/`once` only — nothing here ever calls `emit`, since no fake
 *  event ever needs to actually fire for a static screenshot. */
class FakeEmitter {
  private handlers = new Map<string, Set<Handler>>();
  on(event: string, handler: Handler): this {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    return this;
  }
  off(event: string, handler: Handler): this {
    this.handlers.get(event)?.delete(handler);
    return this;
  }
  once(event: string, handler: Handler): this {
    return this.on(event, handler);
  }
}

export interface FakeVoiceParticipant {
  id: string;
  username: string;
  displayName?: string | null;
}

function fakeParticipant(user: FakeVoiceParticipant): Participant {
  const emitter = new FakeEmitter();
  return {
    identity: user.id,
    name: user.displayName || user.username,
    metadata: undefined,
    isSpeaking: false,
    audioTrackPublications: new Map(),
    videoTrackPublications: new Map(),
    trackPublications: new Map(),
    getTrackPublication: () => undefined,
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    once: emitter.once.bind(emitter),
  } as unknown as Participant;
}

/** A fake connected `Room` with `me` as local participant and `others` as remote participants. */
export function createFakeVoiceRoom(me: FakeVoiceParticipant, others: FakeVoiceParticipant[]): Room {
  const emitter = new FakeEmitter();
  const remoteParticipants = new Map<string, RemoteParticipant>();
  others
    .filter((u) => u.id !== me.id)
    .forEach((u) => remoteParticipants.set(u.id, fakeParticipant(u) as unknown as RemoteParticipant));

  return {
    localParticipant: fakeParticipant(me) as unknown as LocalParticipant,
    remoteParticipants,
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    once: emitter.once.bind(emitter),
  } as unknown as Room;
}

/**
 * Shadows `AuthenticatedShell`'s real `RoomProvider` for descendants — must
 * be rendered as (a descendant of) `SandboxShell`'s `children` slot, which is
 * INSIDE that real provider, not wrapped around `SandboxShell` itself.
 */
export const FakeRoomProvider: React.FC<{ room: Room; children: React.ReactNode }> = ({ room, children }) => (
  <RoomContext.Provider value={{ room, setRoom: () => {}, getRoom: () => room }}>
    {children}
  </RoomContext.Provider>
);
