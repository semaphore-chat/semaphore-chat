/**
 * NotificationCenter Component
 *
 * Drawer component that displays a list of notifications with actions.
 * Supports marking as read, dismissing, and navigating to related content.
 */

import React, { useEffect } from 'react';
import {
  Drawer,
  Box,
  Typography,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListItemAvatar,
  Button,
  Divider,
  CircularProgress,
  Alert,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import CheckIcon from '@mui/icons-material/Check';
import DeleteIcon from '@mui/icons-material/Delete';
import { useMutation } from '@tanstack/react-query';
import {
  notificationsControllerDeleteNotificationMutation,
} from '../../api-client/@tanstack/react-query.gen';

import { AuthenticatedImage } from '../Common/AuthenticatedImage';
import { Notification } from '../../types/notification.type';
import { useNavigate } from 'react-router-dom';
import { logger } from '../../utils/logger';
import { useNotifications } from '../../hooks/useNotifications';
import { getNotificationText, getTimeAgo } from '../../utils/notificationHelpers';

interface NotificationCenterProps {
  open: boolean;
  onClose: () => void;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({
  open,
  onClose,
}) => {
  const navigate = useNavigate();

  const {
    notifications,
    hasUnread,
    isLoading,
    error,
    refetch,
    handleMarkAsRead,
    handleMarkAllAsRead,
    invalidateNotifications,
  } = useNotifications();

  const { mutateAsync: deleteNotification } = useMutation({
    ...notificationsControllerDeleteNotificationMutation(),
    onSuccess: () => invalidateNotifications(),
  });

  // Refetch notifications when drawer opens
  useEffect(() => {
    if (open) {
      refetch();
    }
  }, [open, refetch]);

  const handleDelete = async (notificationId: string) => {
    try {
      await deleteNotification({ path: { id: notificationId } });
    } catch (err) {
      logger.error('Failed to delete notification:', err);
    }
  };

  const handleNotificationClick = async (notification: Notification) => {
    // Mark as read if unread
    if (!notification.read) {
      handleMarkAsRead(notification.id);
    }

    // Navigate to the message with highlight
    const communityId = notification.communityId;
    if (communityId && notification.channelId && notification.messageId) {
      navigate(
        `/community/${communityId}/channel/${notification.channelId}?highlight=${notification.messageId}`
      );
    } else if (notification.directMessageGroupId) {
      navigate(
        `/direct-messages?group=${notification.directMessageGroupId}${notification.messageId ? `&highlight=${notification.messageId}` : ''}`
      );
    }

    onClose();
  };

  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <Box sx={{ width: 400, height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <Box
          sx={{
            p: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Typography variant="h6">Notifications</Typography>
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>

        {/* Mark All as Read Button */}
        {hasUnread && (
          <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
            <Button
              fullWidth
              variant="outlined"
              size="small"
              onClick={handleMarkAllAsRead}
              startIcon={<CheckIcon />}
            >
              Mark All as Read
            </Button>
          </Box>
        )}

        {/* Notifications List */}
        <Box sx={{ flex: 1, overflow: 'auto' }}>
          {isLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
              <CircularProgress />
            </Box>
          )}

          {error && (
            <Box sx={{ p: 2 }}>
              <Alert severity="error">Failed to load notifications</Alert>
            </Box>
          )}

          {!isLoading && !error && notifications.length === 0 && (
            <Box sx={{ p: 4, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                No notifications yet
              </Typography>
            </Box>
          )}

          {!isLoading && !error && notifications.length > 0 && (
            <List sx={{ p: 0 }}>
              {notifications.map((notification) => (
                <React.Fragment key={notification.id}>
                  {/* secondaryAction is a ListItem prop (not ListItemButton),
                      so the action buttons must live on a wrapping ListItem */}
                  <ListItem
                    disablePadding
                    secondaryAction={
                      <Box>
                        {!notification.read && (
                          <IconButton
                            edge="end"
                            size="small"
                            onClick={() => handleMarkAsRead(notification.id)}
                            title="Mark as read"
                          >
                            <CheckIcon fontSize="small" />
                          </IconButton>
                        )}
                        <IconButton
                          edge="end"
                          size="small"
                          onClick={() => handleDelete(notification.id)}
                          title="Delete"
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    }
                  >
                  <ListItemButton
                    sx={{
                      backgroundColor: notification.read
                        ? 'transparent'
                        : 'action.hover',
                      '&:hover': {
                        backgroundColor: notification.read
                          ? 'action.hover'
                          : 'action.selected',
                      },
                    }}
                    onClick={() => handleNotificationClick(notification)}
                  >
                    <ListItemAvatar>
                      <AuthenticatedImage
                        fileId={notification.author?.avatarUrl}
                        alt={notification.author?.displayName || notification.author?.username || '?'}
                        component="avatar"
                        sx={{ width: 40, height: 40 }}
                      />
                    </ListItemAvatar>
                    <ListItemText
                      primary={getNotificationText(notification)}
                      secondary={getTimeAgo(notification.createdAt)}
                      primaryTypographyProps={{
                        variant: 'body2',
                        sx: {
                          fontWeight: notification.read ? 'normal' : 'bold',
                          pr: 8, // Make room for action buttons
                        },
                      }}
                      secondaryTypographyProps={{
                        variant: 'caption',
                      }}
                    />
                  </ListItemButton>
                  </ListItem>
                  <Divider component="li" />
                </React.Fragment>
              ))}
            </List>
          )}
        </Box>
      </Box>
    </Drawer>
  );
};

export default NotificationCenter;
