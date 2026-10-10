import React, { useState } from 'react';
import { Box, Button, CircularProgress, Typography } from '@mui/material';
import { Headphones, Mic, MicOff, Block } from '@mui/icons-material';
import { useVoiceConnection } from '../../hooks/useVoiceConnection';
import { useChannelPermissions } from '../../hooks/useChannelPermissions';
import { playSound, Sounds } from '../../hooks/useSound';
import { ChannelType, type Channel } from '../../types/channel.type';
import { TOUCH_TARGETS } from '../../utils/breakpoints';
import { formatClockTime } from '../../utils/messageTime';
import { logger } from '../../utils/logger';
import { voiceJoinMode } from './voiceJoinMode';

interface VoiceChannelJoinButtonProps {
  channel: Channel;
  disabled?: boolean;
}

/**
 * The pre-join screen's join controls (desktop `VoiceChannelPreJoin` and the
 * phone voice panel). Permission-aware via `useChannelPermissions`, which
 * fails open while loading (the server still enforces).
 */
export const VoiceChannelJoinButton: React.FC<VoiceChannelJoinButtonProps> = ({
  channel,
  disabled = false,
}) => {
  const { state, actions } = useVoiceConnection();
  const { can, timedOutUntil } = useChannelPermissions(channel.communityId, channel.id);
  const [pending, setPending] = useState<'voice' | 'muted' | null>(null);

  if (channel.type !== ChannelType.VOICE) {
    return null;
  }

  const mode = voiceJoinMode({ connect: can('connect'), speak: can('speak') });
  const isConnecting = (state.isConnecting && state.currentChannelId === channel.id) || pending !== null;

  if (mode === 'none') {
    return (
      <Box
        data-testid="voice-join-blocked"
        sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary', justifyContent: 'center' }}
      >
        <Block fontSize="small" />
        <Typography variant="body2">You don't have permission to join this voice channel.</Typography>
      </Box>
    );
  }

  const join = async (startMuted: boolean) => {
    setPending(startMuted && mode === 'full' ? 'muted' : 'voice');
    try {
      await actions.joinVoiceChannel(
        channel.id,
        channel.name,
        channel.communityId,
        channel.isPrivate,
        channel.createdAt,
        { startMuted },
      );
    } catch (error) {
      logger.error('Failed to join voice channel:', error);
      playSound(Sounds.error);
      // The voice notice (VoiceNotice) explains the failure and offers Retry.
    } finally {
      setPending(null);
    }
  };

  const spinner = <CircularProgress size={18} color="inherit" />;
  const buttonSx = { minHeight: TOUCH_TARGETS.MINIMUM, px: 3 };

  if (mode === 'listen-only') {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
        <Button
          variant="contained"
          size="large"
          startIcon={pending ? spinner : <Headphones />}
          onClick={() => join(true)}
          disabled={disabled || isConnecting}
          sx={buttonSx}
        >
          {pending ? 'Connecting…' : 'Join to listen'}
        </Button>
        <Typography variant="body2" color="text.secondary" textAlign="center">
          {timedOutUntil
            ? `Timed out — you can listen until ${formatClockTime(timedOutUntil)}`
            : "You can listen but not speak here"}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', justifyContent: 'center' }}>
      <Button
        variant="contained"
        size="large"
        startIcon={pending === 'voice' ? spinner : <Mic />}
        onClick={() => join(false)}
        disabled={disabled || isConnecting}
        sx={buttonSx}
      >
        {pending === 'voice' ? 'Connecting…' : 'Join voice'}
      </Button>
      <Button
        variant="outlined"
        size="large"
        startIcon={pending === 'muted' ? spinner : <MicOff />}
        onClick={() => join(true)}
        disabled={disabled || isConnecting}
        sx={buttonSx}
      >
        {pending === 'muted' ? 'Connecting…' : 'Join muted'}
      </Button>
    </Box>
  );
};
