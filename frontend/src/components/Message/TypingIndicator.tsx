import React from 'react';
import { alpha, Box, Typography } from '@mui/material';
import { useTypingUsers } from '../../hooks/useTypingUsers';
import { useUsers } from '../../hooks/useUser';
import { TYPING_INDICATOR_HEIGHT } from '../../constants/layout';

interface TypingIndicatorProps {
  channelId?: string;
  directMessageGroupId?: string;
  currentUserId?: string;
}

const TypingIndicator: React.FC<TypingIndicatorProps> = ({
  channelId,
  directMessageGroupId,
  currentUserId,
}) => {
  const typingUserIds = useTypingUsers({ channelId, directMessageGroupId, currentUserId });
  const userQueries = useUsers(typingUserIds);

  if (typingUserIds.length === 0) return null;

  const getName = (index: number) => {
    const user = userQueries[index]?.data;
    return user?.displayName || user?.username || 'Someone';
  };

  let text: string;
  if (typingUserIds.length === 1) {
    text = `${getName(0)} is typing...`;
  } else if (typingUserIds.length === 2) {
    text = `${getName(0)} and ${getName(1)} are typing...`;
  } else {
    text = `${getName(0)} and ${typingUserIds.length - 1} others are typing...`;
  }

  return (
    <Box
      data-testid="typing-indicator"
      sx={(theme) => {
        // Use background.paper (a solid color) so alpha() can parse it;
        // the page ground (background.ground) can be a linear-gradient.
        const bg = theme.palette.background.paper;
        return {
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          // Fixed height: VirtualMessageList reserves exactly this much
          // space after the newest message so the indicator never covers it.
          height: TYPING_INDICATOR_HEIGHT,
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'flex-end',
          px: 2,
          pt: 1,
          pb: 0.5,
          background: `linear-gradient(to bottom, transparent 0%, ${alpha(bg, 0.85)} 40%, ${bg} 70%)`,
          maskImage: 'linear-gradient(to right, black 85%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to right, black 85%, transparent 100%)',
          pointerEvents: 'none',
        };
      }}
    >
      <Typography variant="caption" color="text.secondary" noWrap sx={{ fontStyle: 'italic', minWidth: 0 }}>
        {text}
      </Typography>
    </Box>
  );
};

export default TypingIndicator;
