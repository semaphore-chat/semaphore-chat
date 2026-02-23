import React from 'react';
import { Box, Chip } from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import type { Reaction } from '../../types/message.type';
import { useQuery } from '@tanstack/react-query';
import { userControllerGetProfileOptions } from '../../api-client/@tanstack/react-query.gen';
import { ReactionTooltip } from './ReactionTooltip';

interface MessageReactionsProps {
  messageId: string;
  reactions: Reaction[];
  onReactionClick: (emoji: string) => void;
}

// Component to display user info for a single reaction
const SingleReactionChip: React.FC<{
  reaction: Reaction;
  userHasReacted: boolean;
  onReactionClick: (emoji: string) => void
}> = ({ reaction, userHasReacted, onReactionClick }) => {
  const theme = useTheme();
  const userIds = reaction.userIds ?? [];
  const count = userIds.length;

  return (
    <ReactionTooltip userIds={userIds}>
      <Chip
        label={`${reaction.emoji} ${count}`}
        size="small"
        variant="filled"
        onClick={() => onReactionClick(reaction.emoji)}
        sx={{
          height: '26px',
          fontSize: '13px',
          fontWeight: 500,
          cursor: 'pointer',
          backgroundColor: userHasReacted
            ? alpha(theme.palette.primary.main, 0.15)
            : theme.palette.semantic.overlay.medium,
          color: userHasReacted
            ? theme.palette.primary.main
            : 'text.primary',
          border: userHasReacted
            ? `1px solid ${alpha(theme.palette.primary.main, 0.3)}`
            : `1px solid ${theme.palette.divider}`,
          borderRadius: '12px',
          transition: 'all 0.15s ease',
          '&:hover': {
            backgroundColor: userHasReacted
              ? alpha(theme.palette.primary.main, 0.25)
              : theme.palette.semantic.overlay.heavy,
            borderColor: userHasReacted
              ? alpha(theme.palette.primary.main, 0.5)
              : theme.palette.divider,
            transform: 'scale(1.05)',
          },
          '&:active': {
            transform: 'scale(0.95)',
          },
          '& .MuiChip-label': {
            padding: '0 8px',
            fontSize: '13px',
            fontWeight: userHasReacted ? 600 : 500,
          }
        }}
      />
    </ReactionTooltip>
  );
};

export const MessageReactions: React.FC<MessageReactionsProps> = ({ 
  reactions, 
  onReactionClick 
}) => {
  const { data: currentUser } = useQuery(userControllerGetProfileOptions());

  if (reactions.length === 0) return null;

  return (
    <Box display="flex" gap={0.5} mt={0.5} flexWrap="wrap">
      {reactions.map((reaction) => {
        const userHasReacted = currentUser ? (reaction.userIds ?? []).includes(currentUser.id) : false;

        return (
          <SingleReactionChip
            key={reaction.emoji}
            reaction={reaction}
            userHasReacted={userHasReacted}
            onReactionClick={onReactionClick}
          />
        );
      })}
    </Box>
  );
};