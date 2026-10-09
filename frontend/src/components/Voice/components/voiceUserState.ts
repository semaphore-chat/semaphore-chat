import type { ParticipantMediaState } from "../../../hooks/useParticipantTracks";

export interface VoiceUserState {
  isMuted: boolean;
  isDeafened: boolean;
  isVideoEnabled: boolean;
  isScreenSharing: boolean;
  isServerMuted: boolean;
}

/**
 * Derives a user's voice state by preferring LiveKit direct state
 * when a participant is connected, falling back to server-reported state.
 */
export function deriveUserState(
  livekitState: ParticipantMediaState,
  serverState: {
    isMuted?: boolean;
    isDeafened?: boolean;
    isVideoEnabled?: boolean;
    isScreenSharing?: boolean;
    isServerMuted?: boolean;
  },
): VoiceUserState {
  return {
    isMuted: livekitState.participant
      ? !livekitState.isMicrophoneEnabled
      : Boolean(serverState.isMuted),
    isDeafened: livekitState.participant
      ? livekitState.isDeafened
      : Boolean(serverState.isDeafened),
    isVideoEnabled: livekitState.participant
      ? livekitState.isCameraEnabled
      : Boolean(serverState.isVideoEnabled),
    isScreenSharing: livekitState.participant
      ? livekitState.isScreenShareEnabled
      : Boolean(serverState.isScreenSharing),
    isServerMuted: Boolean(serverState.isServerMuted),
  };
}

export type VoiceStatusBadgeKind = 'muted' | 'server-muted' | 'deafened';

export interface VoiceStatusBadge {
  kind: VoiceStatusBadgeKind;
  /** neutral = the user's own choice (grey); danger = imposed by a moderator (red). */
  tone: 'neutral' | 'danger';
  label: string;
}

/**
 * The out-of-the-ordinary states worth showing on a tile or avatar — and
 * nothing else (no "mic on" / "camera off" dots). Server-mute wins over a
 * self-mute, since it's the one the user can't undo.
 */
export function voiceStatusBadges(
  state: Pick<VoiceUserState, 'isMuted' | 'isDeafened' | 'isServerMuted'>,
): VoiceStatusBadge[] {
  const badges: VoiceStatusBadge[] = [];
  if (state.isServerMuted) {
    badges.push({ kind: 'server-muted', tone: 'danger', label: 'Muted by a moderator' });
  } else if (state.isMuted) {
    badges.push({ kind: 'muted', tone: 'neutral', label: 'Muted' });
  }
  if (state.isDeafened) {
    badges.push({ kind: 'deafened', tone: 'neutral', label: 'Deafened' });
  }
  return badges;
}

const BADGE_RANK: Record<VoiceStatusBadgeKind, number> = { 'server-muted': 0, deafened: 1, muted: 2 };

/** The single badge a small tile has room for: server-muted > deafened > muted. */
export function pickCompactBadge(badges: VoiceStatusBadge[]): VoiceStatusBadge | undefined {
  return [...badges].sort((a, b) => BADGE_RANK[a.kind] - BADGE_RANK[b.kind])[0];
}
