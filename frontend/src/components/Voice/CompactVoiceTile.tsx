import React from 'react';
import { Box, Card, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { HeadsetOff, MicOff } from '@mui/icons-material';
import type {
  TrackPublication,
  RemoteParticipant,
  LocalParticipant,
} from 'livekit-client';
import UserAvatar from '../Common/UserAvatar';
import { useSpeaking } from '../../hooks/useSpeaking';
import { voiceTileColor } from '../../utils/voiceTileColor';
import { pickCompactBadge, voiceStatusBadges } from './components/voiceUserState';

function isDeafenedMeta(metadata: string | undefined): boolean {
  if (!metadata) return false;
  try {
    return Boolean(JSON.parse(metadata)?.isDeafened);
  } catch {
    return false;
  }
}

/** Fixed height of a compact tile — the phone grid scrolls instead of shrinking tiles. */
export const COMPACT_TILE_HEIGHT = 104;
const COMPACT_AVATAR_SIZE = 52;

export interface CompactVoiceTileProps {
  participant: RemoteParticipant | LocalParticipant;
  audioTrack?: TrackPublication;
  isLocal?: boolean;
  /** Server-muted by a moderator (from voice presence). */
  isServerMuted?: boolean;
}

/**
 * Small avatar tile for a voice-only participant, used by `VideoTiles` on the
 * phone when the call is too big for the regular grid (see
 * `PHONE_COMPACT_TILE_THRESHOLD`): avatar with the speaking ring and a
 * muted badge, plus the name on one line with an ellipsis.
 */
const CompactVoiceTile: React.FC<CompactVoiceTileProps> = ({ participant, audioTrack, isLocal = false, isServerMuted = false }) => {
  const theme = useTheme();
  const { isSpeaking } = useSpeaking();
  const speaking = isSpeaking(participant.identity);
  const hasAudio = !!audioTrack && !audioTrack.isMuted;
  const displayName = participant.name || participant.identity;
  const tint = voiceTileColor(participant.identity);
  // One corner badge, for the most notable unusual state:
  // server-muted (red) > deafened > self-muted (grey).
  const badge = pickCompactBadge(
    voiceStatusBadges({
      isMuted: !hasAudio,
      isDeafened: isDeafenedMeta(participant.metadata),
      isServerMuted,
    }),
  );
  const positive = theme.palette.semantic.status.positive;

  return (
    <Card
      data-testid="compact-participant-tile"
      aria-label={`${displayName}${isLocal ? ' (You)' : ''}${badge ? `, ${badge.label.toLowerCase()}` : ''}${speaking ? ', speaking' : ''}`}
      sx={{
        height: COMPACT_TILE_HEIGHT,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0.75,
        px: 0.75,
        boxSizing: 'border-box',
        backgroundColor: 'grey.900',
        backgroundImage: `linear-gradient(${alpha(tint, 0.28)}, ${alpha(tint, 0.12)})`,
        border: speaking ? `2px solid ${positive}` : '2px solid transparent',
        boxShadow: speaking ? `0 0 12px ${alpha(positive, 0.45)}` : 'none',
        transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
      }}
    >
      <Box
        sx={{
          position: 'relative',
          width: COMPACT_AVATAR_SIZE,
          height: COMPACT_AVATAR_SIZE,
          flexShrink: 0,
          borderRadius: '50%',
          boxShadow: speaking ? `0 0 0 3px ${positive}` : 'none',
        }}
      >
        <UserAvatar userId={participant.identity} displayName={participant.name} size="fluid" fallbackColor={tint} />
        {badge && (
          <Box
            sx={{
              position: 'absolute',
              right: -4,
              bottom: -4,
              width: 20,
              height: 20,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: badge.tone === 'danger' ? theme.palette.semantic.status.negative : theme.palette.grey[700],
              border: `2px solid ${theme.palette.grey[900]}`,
            }}
            data-testid={`voice-badge-${badge.kind}`}
          >
            {badge.kind === 'deafened'
              ? <HeadsetOff sx={{ fontSize: 12, color: 'common.white' }} />
              : <MicOff sx={{ fontSize: 12, color: 'common.white' }} />}
          </Box>
        )}
      </Box>
      <Typography
        variant="caption"
        noWrap
        component="div"
        sx={{ color: 'grey.100', fontWeight: 'bold', maxWidth: '100%', minWidth: 0, textAlign: 'center' }}
      >
        {displayName}
        {isLocal && ' (You)'}
      </Typography>
    </Card>
  );
};

export default CompactVoiceTile;
