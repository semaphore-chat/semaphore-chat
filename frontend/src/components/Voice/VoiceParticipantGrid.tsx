import React from 'react';
import { Box, ButtonBase, Typography } from '@mui/material';
import { ScreenShare, Videocam } from '@mui/icons-material';
import type { VoicePresenceUserDto } from '../../api-client/types.gen';
import UserAvatar from '../Common/UserAvatar';
import { useUserProfile } from '../../contexts/UserProfileContext';
import { deriveUserState, voiceStatusBadges } from './components/voiceUserState';
import { VoiceStatusBadges } from './components/VoiceStatusBadges';
import type { ParticipantMediaState } from '../../hooks/useParticipantTracks';

/** WS presence payloads layer these on top of the REST DTO (which has neither). */
export type VoiceGridUser = VoicePresenceUserDto & {
  isMuted?: boolean;
  isVideoEnabled?: boolean;
  isScreenSharing?: boolean;
};

const NO_LIVEKIT: ParticipantMediaState = {
  isCameraEnabled: false,
  isMicrophoneEnabled: false,
  isScreenShareEnabled: false,
  isSpeaking: false,
  isDeafened: false,
  participant: null,
};

interface VoiceParticipantGridProps {
  users: VoiceGridUser[];
}

/**
 * Everyone in a voice channel you're not in, as an avatar grid (pre-join
 * screen). State comes from REST voice presence: deafened and server-muted
 * always; self-mute / camera / share only when a WS update carried them.
 * Only unusual states get an icon.
 */
export const VoiceParticipantGrid: React.FC<VoiceParticipantGridProps> = ({ users }) => {
  const { openProfile } = useUserProfile();

  return (
    <Box
      component="ul"
      aria-label="People in this voice channel"
      data-testid="voice-participant-grid"
      sx={{
        listStyle: 'none',
        m: 0,
        p: 0,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
        gap: 1,
        width: '100%',
      }}
    >
      {users.map((user) => {
        const state = deriveUserState(NO_LIVEKIT, user);
        const badges = voiceStatusBadges(state);
        const name = user.displayName || user.username;
        return (
          <Box component="li" key={user.id} sx={{ minWidth: 0 }}>
            <ButtonBase
              onClick={() => openProfile(user.id)}
              aria-label={name}
              sx={{
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 0.75,
                p: 1,
                borderRadius: 2,
                '&:hover': { backgroundColor: 'action.hover' },
                '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' },
              }}
            >
              <Box sx={{ position: 'relative', width: 64, height: 64 }}>
                <UserAvatar userId={user.id} displayName={name} size="fluid" />
                {(badges.length > 0 || state.isVideoEnabled || state.isScreenSharing) && (
                  <Box sx={{ position: 'absolute', right: -6, bottom: -6, display: 'flex', gap: 0.25 }}>
                    <VoiceStatusBadges badges={badges} size={14} onDisc />
                    {state.isVideoEnabled && (
                      <Box component="span" aria-label="Camera on" role="img" sx={discSx}>
                        <Videocam sx={{ fontSize: 14 }} />
                      </Box>
                    )}
                    {state.isScreenSharing && (
                      <Box component="span" aria-label="Sharing screen" role="img" sx={discSx}>
                        <ScreenShare sx={{ fontSize: 14 }} />
                      </Box>
                    )}
                  </Box>
                )}
              </Box>
              <Typography variant="body2" noWrap sx={{ maxWidth: '100%', minWidth: 0 }}>
                {name}
              </Typography>
            </ButtonBase>
          </Box>
        );
      })}
    </Box>
  );
};

const discSx = {
  width: 22,
  height: 22,
  borderRadius: '50%',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'rgba(0,0,0,0.6)',
  color: 'grey.100',
} as const;

export default VoiceParticipantGrid;
