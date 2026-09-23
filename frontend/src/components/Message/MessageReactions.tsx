import React from 'react';
import { Box, Chip } from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import type { Reaction } from '../../types/message.type';
import { useQuery } from '@tanstack/react-query';
import { userControllerGetProfileOptions } from '../../api-client/@tanstack/react-query.gen';
import type { CustomEmojiDto } from '../../api-client/types.gen';
import { getFileUrl } from '../../utils/fileHelpers';
import { ReactionTooltip } from './ReactionTooltip';

interface MessageReactionsProps {
  messageId: string;
  reactions: Reaction[];
  onReactionClick: (emoji: string) => void;
  /** Community custom emojis, keyed by id — resolves `custom:{id}` reactions. */
  emojiById?: Map<string, CustomEmojiDto>;
}

/** Sentinel prefix for custom (community) emoji reactions: `custom:{emojiId}`. */
const CUSTOM_REACTION_PREFIX = 'custom:';

/** Inline image label for a custom-emoji reaction chip, with count. */
const CustomReactionLabel: React.FC<{
  emoji: string;
  count: number;
  emojiById?: Map<string, CustomEmojiDto>;
}> = ({ emoji, count, emojiById }) => {
  const id = emoji.slice(CUSTOM_REACTION_PREFIX.length);
  const custom = emojiById?.get(id);
  const src = custom ? getFileUrl(custom.fileId) : null;
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
      {custom && src ? (
        <img
          src={src}
          alt={`:${custom.name}:`}
          title={`:${custom.name}:`}
          style={{ height: '1.15em', width: 'auto', verticalAlign: '-0.2em' }}
        />
      ) : (
        // Unknown/deleted custom emoji — neutral placeholder.
        <span>{custom ? `:${custom.name}:` : '❓'}</span>
      )}
      {count}
    </Box>
  );
};

// Component to display user info for a single reaction
const SingleReactionChip: React.FC<{
  reaction: Reaction;
  userHasReacted: boolean;
  onReactionClick: (emoji: string) => void;
  emojiById?: Map<string, CustomEmojiDto>;
}> = ({ reaction, userHasReacted, onReactionClick, emojiById }) => {
  const theme = useTheme();
  const userIds = reaction.userIds ?? [];
  const count = userIds.length;
  const isCustom = reaction.emoji.startsWith(CUSTOM_REACTION_PREFIX);

  return (
    <ReactionTooltip userIds={userIds}>
      <Chip
        label={
          isCustom ? (
            <CustomReactionLabel
              emoji={reaction.emoji}
              count={count}
              emojiById={emojiById}
            />
          ) : (
            `${reaction.emoji} ${count}`
          )
        }
        size="small"
        variant="filled"
        onClick={() => onReactionClick(reaction.emoji)}
        sx={{
          height: '26px',
          fontSize: 'scale.md',
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
            fontSize: 'scale.md',
            fontWeight: userHasReacted ? 600 : 500,
          }
        }}
      />
    </ReactionTooltip>
  );
};

export const MessageReactions: React.FC<MessageReactionsProps> = ({
  reactions,
  onReactionClick,
  emojiById,
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
            emojiById={emojiById}
          />
        );
      })}
    </Box>
  );
};