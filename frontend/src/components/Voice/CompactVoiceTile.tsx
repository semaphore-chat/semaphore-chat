import React from 'react';
import { Box, Card, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { MicOff } from '@mui/icons-material';
import type {
  TrackPublication,
  RemoteParticipant,
  LocalParticipant,
} from 'livekit-client';
import UserAvatar from '../Common/UserAvatar';
import { useSpeaking } from '../../hooks/useSpeaking';

/** Fixed height of a compact tile — the phone grid scrolls instead of shrinking tiles. */
export const COMPACT_TILE_HEIGHT = 104;
const COMPACT_AVATAR_SIZE = 52;

export interface CompactVoiceTileProps {
  participant: RemoteParticipant | LocalParticipant;
  audioTrack?: TrackPublication;
  isLocal?: boolean;
}

/**
 * Small avatar tile for a voice-only participant, used by `VideoTiles` on the
 * phone when the call is too big for the regular grid (see
 * `PHONE_COMPACT_TILE_THRESHOLD`): avatar with the speaking ring and a
 * muted badge, plus the name on one line with an ellipsis.
 */
const CompactVoiceTile: React.FC<CompactVoiceTileProps> = ({ participant, audioTrack, isLocal = false }) => {
  const theme = useTheme();
  const { isSpeaking } = useSpeaking();
  const speaking = isSpeaking(participant.identity);
  const hasAudio = !!audioTrack && !audioTrack.isMuted;
  const displayName = participant.name || participant.identity;

  return (
    <Card
      data-testid="compact-participant-tile"
      aria-label={`${displayName}${isLocal ? ' (You)' : ''}${hasAudio ? '' : ', muted'}${speaking ? ', speaking' : ''}`}
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
        backgroundColor: 'grey.800',
        border: speaking
          ? `2px solid ${theme.palette.semantic.status.positive}`
          : '2px solid transparent',
        transition: 'border-color 0.2s ease',
      }}
    >
      <Box sx={{ position: 'relative', width: COMPACT_AVATAR_SIZE, height: COMPACT_AVATAR_SIZE, flexShrink: 0 }}>
        <UserAvatar userId={participant.identity} displayName={participant.name} size="fluid" />
        {!hasAudio && (
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
              backgroundColor: theme.palette.semantic.status.negative,
              border: `2px solid ${theme.palette.grey[800]}`,
            }}
          >
            <MicOff sx={{ fontSize: 12, color: 'common.white' }} />
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
