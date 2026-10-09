import React from 'react';
import { Box, Tooltip } from '@mui/material';
import { HeadsetOff, MicOff } from '@mui/icons-material';
import type { VoiceStatusBadge } from './voiceUserState';

interface VoiceStatusBadgesProps {
  badges: VoiceStatusBadge[];
  /** Icon size in px. */
  size?: number;
  /** Draw each icon on a small dark disc (for use over avatars / video). */
  onDisc?: boolean;
}

/**
 * Small icons for the out-of-the-ordinary voice states from
 * `voiceStatusBadges()`: grey for the user's own mute/deafen, red for a
 * moderator's server-mute. Renders nothing when there's nothing unusual.
 */
export const VoiceStatusBadges: React.FC<VoiceStatusBadgesProps> = ({ badges, size = 16, onDisc = false }) => {
  if (badges.length === 0) return null;
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>
      {badges.map((badge) => {
        const Icon = badge.kind === 'deafened' ? HeadsetOff : MicOff;
        return (
          <Tooltip key={badge.kind} title={badge.label}>
            <Box
              component="span"
              role="img"
              aria-label={badge.label}
              data-testid={`voice-badge-${badge.kind}`}
              data-tone={badge.tone}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: badge.tone === 'danger' ? 'error.main' : 'grey.400',
                ...(onDisc && {
                  width: size + 8,
                  height: size + 8,
                  borderRadius: '50%',
                  backgroundColor: 'rgba(0,0,0,0.6)',
                }),
              }}
            >
              <Icon sx={{ fontSize: size }} />
            </Box>
          </Tooltip>
        );
      })}
    </Box>
  );
};

export default VoiceStatusBadges;
