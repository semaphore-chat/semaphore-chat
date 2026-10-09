import React, { useEffect, useState } from 'react';
import { Box, Tooltip } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import type { Participant, Room } from 'livekit-client';
import { CONNECTION_QUALITY, ROOM_EVENT } from '../../features/voice/livekitEvents';
import { describeConnectionQuality, type Quality } from '../../features/voice/connectionQuality';

const BAR_HEIGHTS = [6, 10, 14];

/**
 * Three-bar signal for YOUR connection to the voice server (LiveKit's local
 * ConnectionQuality), with the detail on hover. Replaces the old static
 * "Connected" pill, which repeated "Voice Connected".
 */
export const ConnectionQualityIndicator: React.FC<{ room: Room | null | undefined }> = ({ room }) => {
  const theme = useTheme();
  const [quality, setQuality] = useState<Quality | string>(
    room?.localParticipant?.connectionQuality ?? CONNECTION_QUALITY.Unknown,
  );
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    if (!room) return;
    setQuality(room.localParticipant?.connectionQuality ?? CONNECTION_QUALITY.Unknown);
    const onQuality = (q: Quality, participant?: Participant) => {
      if (!participant || participant === room.localParticipant) setQuality(q);
    };
    const onReconnecting = () => setReconnecting(true);
    const onReconnected = () => setReconnecting(false);
    room.on(ROOM_EVENT.ConnectionQualityChanged, onQuality);
    room.on(ROOM_EVENT.Reconnecting, onReconnecting);
    room.on(ROOM_EVENT.Reconnected, onReconnected);
    return () => {
      room.off(ROOM_EVENT.ConnectionQualityChanged, onQuality);
      room.off(ROOM_EVENT.Reconnecting, onReconnecting);
      room.off(ROOM_EVENT.Reconnected, onReconnected);
    };
  }, [room]);

  const info = describeConnectionQuality(quality, reconnecting);
  const color = {
    positive: theme.palette.semantic.status.positive,
    warning: theme.palette.warning.main,
    negative: theme.palette.error.main,
    unknown: theme.palette.text.disabled,
  }[info.tone];
  const label = `Connection: ${info.label}`;

  return (
    <Tooltip title={label} arrow>
      <Box
        role="img"
        aria-label={label}
        data-testid="connection-quality"
        data-bars={info.bars}
        tabIndex={0}
        sx={{
          display: 'inline-flex',
          alignItems: 'flex-end',
          gap: '2px',
          height: 16,
          px: 0.5,
          flexShrink: 0,
          borderRadius: 0.5,
          '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}` },
        }}
      >
        {BAR_HEIGHTS.map((h, i) => (
          <Box
            key={h}
            sx={{
              width: 4,
              height: h,
              borderRadius: '1px',
              backgroundColor: i < info.bars ? color : theme.palette.action.disabledBackground,
            }}
          />
        ))}
      </Box>
    </Tooltip>
  );
};

export default ConnectionQualityIndicator;
