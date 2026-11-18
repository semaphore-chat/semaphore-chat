import React from 'react';
import { Box, Typography, Tooltip } from '@mui/material';
import { useReactionPeople } from '../../data/chat/useReactionPeople';

interface ReactionTooltipProps {
  /** Users who reacted; a missing list renders an empty tooltip. */
  userIds?: string[] | null;
  children: React.ReactElement;
}

// The tooltip's content: MUI mounts it only while the tooltip shows, so the names load on hover, not per chip.
const ReactionPeopleList: React.FC<{ userIds?: string[] | null }> = ({ userIds }) => {
  const { people, more: remainingCount } = useReactionPeople(userIds);
  return (
    <Box sx={{ maxWidth: 200 }}>
      {people.map(({ id, name }) => (
        <Typography key={id} variant="body2" sx={{ fontSize: 'scale.sm' }}>
          {name ?? 'Loading...'}
        </Typography>
      ))}
      {remainingCount > 0 && (
        <Typography variant="body2" sx={{ fontSize: 'scale.sm', fontStyle: 'italic', mt: 0.5 }}>
          +{remainingCount} more
        </Typography>
      )}
    </Box>
  );
};

export const ReactionTooltip: React.FC<ReactionTooltipProps> = ({ userIds, children }) => {
  const tooltipContent = <ReactionPeopleList userIds={userIds} />;

  return (
    <Tooltip 
      title={tooltipContent} 
      placement="top"
      componentsProps={{
        tooltip: {
          sx: {
            backgroundColor: 'rgba(0, 0, 0, 0.9)',
            maxWidth: 'none'
          }
        }
      }}
    >
      {children}
    </Tooltip>
  );
};