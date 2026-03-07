import React from 'react';
import { Box, Typography } from '@mui/material';
import { useTypingUsers } from '../../hooks/useTypingUsers';
import { useUsers } from '../../hooks/useUser';

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

  if (typingUserIds.length === 0)
    return <Box sx={{ px: 2, minHeight: 24 }} />;

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
    <Box sx={{ px: 2, minHeight: 24 }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
        {text}
      </Typography>
    </Box>
  );
};

export default TypingIndicator;
