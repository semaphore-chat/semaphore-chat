/**
 * DaySeparator — a thin rule with a centred date label ("Today",
 * "Yesterday", "Friday, September 18") between messages from different days.
 */
import React from 'react';
import { Box, Typography } from '@mui/material';
import { formatDaySeparator } from '../../utils/messageTime';

interface DaySeparatorProps {
  date: string;
}

export const DaySeparator: React.FC<DaySeparatorProps> = ({ date }) => {
  const label = formatDaySeparator(date);
  return (
    <Box
      role="separator"
      aria-label={label}
      title={new Date(date).toLocaleDateString(undefined, { dateStyle: 'full' })}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        px: 2,
        pt: 2,
        pb: 0.5,
        '&::before, &::after': {
          content: '""',
          flex: 1,
          borderTop: 1,
          borderColor: 'divider',
        },
      }}
    >
      <Typography
        variant="caption"
        noWrap
        sx={{ color: 'text.secondary', fontWeight: 600, flexShrink: 0 }}
      >
        {label}
      </Typography>
    </Box>
  );
};

export default DaySeparator;
