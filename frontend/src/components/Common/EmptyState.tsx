import React from 'react';
import { Box, Typography, Button, alpha, useTheme } from '@mui/material';
import {
  Chat as ChatIcon,
  VideoLibrary as VideoIcon,
  Forum as ForumIcon,
  Notifications as NotificationsIcon,
  Search as SearchIcon,
  Group as GroupIcon,
} from '@mui/icons-material';

export type EmptyStateVariant =
  | 'messages'
  | 'dm'
  | 'clips'
  | 'notifications'
  | 'search'
  | 'members'
  | 'channels'
  | 'generic';

interface EmptyStateProps {
  variant?: EmptyStateVariant;
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  action?: {
    label: string;
    onClick: () => void;
  };
}

const variantConfig: Record<EmptyStateVariant, { icon: React.ReactNode; title: string; description: string }> = {
  messages: {
    icon: <ForumIcon sx={{ fontSize: 'icon.6xl' }} />,
    title: 'No messages yet',
    description: 'Start the conversation by sending a message!',
  },
  dm: {
    icon: <ChatIcon sx={{ fontSize: 'icon.6xl' }} />,
    title: 'No conversations',
    description: 'Start a direct message to connect with others.',
  },
  clips: {
    icon: <VideoIcon sx={{ fontSize: 'icon.6xl' }} />,
    title: 'No clips yet',
    description: 'Capture a replay while screen sharing to save your best moments.',
  },
  notifications: {
    icon: <NotificationsIcon sx={{ fontSize: 'icon.6xl' }} />,
    title: 'All caught up!',
    description: "You don't have any notifications right now.",
  },
  search: {
    icon: <SearchIcon sx={{ fontSize: 'icon.6xl' }} />,
    title: 'No results found',
    description: 'Try adjusting your search terms or filters.',
  },
  members: {
    icon: <GroupIcon sx={{ fontSize: 'icon.6xl' }} />,
    title: 'No members',
    description: 'Invite people to join this community.',
  },
  channels: {
    icon: <ForumIcon sx={{ fontSize: 'icon.6xl' }} />,
    title: 'No channels',
    description: 'Create a channel to start conversations.',
  },
  generic: {
    icon: <ForumIcon sx={{ fontSize: 'icon.6xl' }} />,
    title: 'Nothing here yet',
    description: 'Content will appear here once available.',
  },
};

const EmptyState: React.FC<EmptyStateProps> = ({
  variant = 'generic',
  title,
  description,
  icon,
  action,
}) => {
  const theme = useTheme();
  const config = variantConfig[variant];

  const displayIcon = icon || config.icon;
  const displayTitle = title || config.title;
  const displayDescription = description || config.description;

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        py: 6,
        px: 3,
        textAlign: 'center',
      }}
    >
      {/* Icon with gradient background */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 120,
          height: 120,
          borderRadius: '50%',
          mb: 3,
          background: theme.palette.mode === 'dark'
            ? `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.2)} 0%, ${alpha(theme.palette.secondary.main, 0.2)} 100%)`
            : `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.1)} 0%, ${alpha(theme.palette.secondary.main, 0.1)} 100%)`,
          color: theme.palette.mode === 'dark'
            ? alpha(theme.palette.primary.light, 0.7)
            : theme.palette.primary.main,
        }}
      >
        {displayIcon}
      </Box>

      {/* Title */}
      <Typography
        variant="h6"
        sx={{
          fontWeight: 600,
          mb: 1,
          color: 'text.primary',
        }}
      >
        {displayTitle}
      </Typography>

      {/* Description */}
      <Typography
        variant="body2"
        sx={{
          color: 'text.secondary',
          maxWidth: 300,
          mb: action ? 3 : 0,
        }}
      >
        {displayDescription}
      </Typography>

      {/* Optional action button */}
      {action && (
        <Button
          variant="contained"
          onClick={action.onClick}
          sx={{
            borderRadius: 2,
            px: 3,
          }}
        >
          {action.label}
        </Button>
      )}
    </Box>
  );
};

export default EmptyState;
