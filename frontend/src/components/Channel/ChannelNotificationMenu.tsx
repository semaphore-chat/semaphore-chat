/**
 * ChannelNotificationMenu Component
 *
 * Dropdown menu for managing per-channel notification overrides.
 * Allows users to set notification level for a specific channel.
 */

import React, { useState } from 'react';
import {
  IconButton,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
  CircularProgress,
  Tooltip,
} from '@mui/material';
import {
  AlternateEmail,
  NotificationsActive,
  NotificationsOff,
  NotificationsPaused,
  Check,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  notificationsControllerGetChannelOverrideOptions,
  notificationsControllerSetChannelOverrideMutation,
  notificationsControllerDeleteChannelOverrideMutation,
  notificationsControllerGetSettingsOptions,
} from '../../api-client/@tanstack/react-query.gen';

import { logger } from '../../utils/logger';

interface ChannelNotificationMenuProps {
  channelId: string;
  channelName?: string;
}

enum NotificationLevel {
  All = 'all',
  Mentions = 'mentions',
  None = 'none',
  Default = 'default',
}

export const ChannelNotificationMenu: React.FC<ChannelNotificationMenuProps> = ({
  channelId,
  channelName,
}) => {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);
  const queryClient = useQueryClient();

  const { data: override, isLoading: overrideLoading } = useQuery(
    notificationsControllerGetChannelOverrideOptions({ path: { channelId } })
  );
  const { data: settings } = useQuery(notificationsControllerGetSettingsOptions());

  const { mutateAsync: setOverride, isPending: isSettingOverride } = useMutation({
    ...notificationsControllerSetChannelOverrideMutation(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [{ _id: 'notificationsControllerGetChannelOverride' }] });
    },
  });

  const { mutateAsync: deleteOverride, isPending: isDeletingOverride } = useMutation({
    ...notificationsControllerDeleteChannelOverrideMutation(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [{ _id: 'notificationsControllerGetChannelOverride' }] });
    },
  });

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleSetLevel = async (level: NotificationLevel) => {
    try {
      if (level === NotificationLevel.Default) {
        // Remove override to use default settings
        await deleteOverride({ path: { channelId } });
      } else {
        // Set specific override level
        await setOverride({ path: { channelId }, body: { level } });
      }
      handleClose();
    } catch (error) {
      logger.error('Failed to update notification level:', error);
    }
  };

  // Determine current notification level
  const currentLevel: NotificationLevel = override?.level as NotificationLevel || NotificationLevel.Default;
  const defaultLevel = settings?.defaultChannelLevel || 'mentions';

  // Get icon based on current level
  const getIcon = () => {
    const effectiveLevel = currentLevel === NotificationLevel.Default ? defaultLevel : currentLevel;
    switch (effectiveLevel) {
      case NotificationLevel.All:
        return <NotificationsActive />;
      case NotificationLevel.Mentions:
        return <AlternateEmail />;
      case NotificationLevel.None:
        return <NotificationsOff />;
      default:
        return <AlternateEmail />;
    }
  };

  // Get tooltip text
  const getTooltipText = () => {
    const effectiveLevel = currentLevel === NotificationLevel.Default ? defaultLevel : currentLevel;
    const levelText = {
      [NotificationLevel.All]: 'All messages',
      [NotificationLevel.Mentions]: 'Only @mentions',
      [NotificationLevel.None]: 'Nothing',
    }[effectiveLevel];

    return currentLevel === NotificationLevel.Default
      ? `Notifications: ${levelText} (default)`
      : `Notifications: ${levelText}`;
  };

  const isLoading = isSettingOverride || isDeletingOverride;

  return (
    <>
      <Tooltip title={getTooltipText()}>
        <IconButton
          onClick={handleClick}
          size="small"
          disabled={overrideLoading || isLoading}
          aria-label={getTooltipText()}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          {overrideLoading ? <CircularProgress size={20} /> : getIcon()}
        </IconButton>
      </Tooltip>

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem disabled sx={{ opacity: '1 !important' }}>
          <ListItemText
            primary={`Notifications for ${channelName || 'this channel'}`}
            primaryTypographyProps={{ variant: 'subtitle2', fontWeight: 'bold' }}
          />
        </MenuItem>
        <Divider />

        <MenuItem
          onClick={() => handleSetLevel(NotificationLevel.All)}
          selected={currentLevel === NotificationLevel.All}
          disabled={isLoading}
        >
          <ListItemIcon>
            {currentLevel === NotificationLevel.All ? <Check /> : <NotificationsActive />}
          </ListItemIcon>
          <ListItemText
            primary="All Messages"
            secondary="Every message in this channel"
          />
        </MenuItem>

        <MenuItem
          onClick={() => handleSetLevel(NotificationLevel.Mentions)}
          selected={currentLevel === NotificationLevel.Mentions}
          disabled={isLoading}
        >
          <ListItemIcon>
            {currentLevel === NotificationLevel.Mentions ? <Check /> : <AlternateEmail />}
          </ListItemIcon>
          <ListItemText
            primary="Only @mentions"
            secondary="When someone mentions you"
          />
        </MenuItem>

        <MenuItem
          onClick={() => handleSetLevel(NotificationLevel.None)}
          selected={currentLevel === NotificationLevel.None}
          disabled={isLoading}
        >
          <ListItemIcon>
            {currentLevel === NotificationLevel.None ? <Check /> : <NotificationsOff />}
          </ListItemIcon>
          <ListItemText
            primary="Nothing"
            secondary="No notifications from this channel"
          />
        </MenuItem>

        {currentLevel !== NotificationLevel.Default && (
          <>
            <Divider />
            <MenuItem
              onClick={() => handleSetLevel(NotificationLevel.Default)}
              disabled={isLoading}
            >
              <ListItemIcon>
                <NotificationsPaused />
              </ListItemIcon>
              <ListItemText
                primary="Use Default"
                secondary={`Currently: ${defaultLevel}`}
              />
            </MenuItem>
          </>
        )}
      </Menu>
    </>
  );
};

export default ChannelNotificationMenu;
