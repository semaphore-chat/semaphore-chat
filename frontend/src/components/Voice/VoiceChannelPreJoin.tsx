import React from 'react';
import { Box, Typography } from '@mui/material';
import { VolumeUp } from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { voicePresenceControllerGetChannelPresenceOptions } from '../../api-client/@tanstack/react-query.gen';
import type { Channel } from '../../types/channel.type';
import { useVoice } from '../../contexts/VoiceContext';
import { VoiceChannelJoinButton } from './VoiceChannelJoinButton';
import { VoiceParticipantGrid } from './VoiceParticipantGrid';

interface VoiceChannelPreJoinProps {
  channel: Channel;
}

/**
 * Desktop: what a voice channel you're NOT in shows — the channel, who's in
 * it (everyone, as an avatar grid) and how to join, according to your
 * channel permissions (see VoiceChannelJoinButton).
 */
export const VoiceChannelPreJoin: React.FC<VoiceChannelPreJoinProps> = ({ channel }) => {
  const voice = useVoice();
  const { data, isLoading, isError } = useQuery({
    ...voicePresenceControllerGetChannelPresenceOptions({ path: { channelId: channel.id } }),
    refetchInterval: 120_000,
  });
  const users = data?.users ?? [];
  const connectedElsewhere = voice.isConnected && voice.currentChannelId !== channel.id && !!voice.channelName;

  let countLabel = '';
  if (isError) countLabel = "Couldn't load who's here";
  else if (!isLoading) countLabel = users.length === 0 ? "Nobody's here yet" : `${users.length} ${users.length === 1 ? 'person' : 'people'} here`;

  return (
    <Box
      data-testid="voice-prejoin"
      sx={{
        width: '100%',
        height: '100%',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        px: 3,
        py: 6,
        boxSizing: 'border-box',
      }}
    >
      <Box sx={{ width: '100%', maxWidth: 720, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2.5, my: 'auto' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0, maxWidth: '100%' }}>
          <VolumeUp color="primary" sx={{ fontSize: 'icon.4xl', flexShrink: 0 }} />
          <Typography variant="h4" component="h1" noWrap sx={{ minWidth: 0 }}>
            {channel.name}
          </Typography>
        </Box>
        <Typography variant="body1" color="text.secondary" sx={{ minHeight: 24 }}>
          {countLabel}
        </Typography>

        <VoiceChannelJoinButton channel={channel} />

        {connectedElsewhere && (
          <Typography variant="body2" color="warning.main" textAlign="center">
            You're in "{voice.channelName}". Joining moves you here.
          </Typography>
        )}

        {users.length > 0 && (
          <Box sx={{ width: '100%', mt: 2 }}>
            <VoiceParticipantGrid users={users} />
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default VoiceChannelPreJoin;
