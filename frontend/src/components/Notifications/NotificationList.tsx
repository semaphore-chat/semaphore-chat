/**
 * NotificationList Component
 *
 * Shared notification list body (mark-all button, loading/empty states, list).
 * Used by both the mobile NotificationsScreen and the desktop NotificationsPage.
 * Navigation is handled via react-router, so it works on mobile (URL-derived
 * screen state) and desktop alike.
 */

import React, { useCallback, useState } from 'react';
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Avatar,
  Badge,
  IconButton,
  CircularProgress,
  Button,
  Divider,
} from '@mui/material';
import {
  CheckCircle as CheckIcon,
  Close as DismissIcon,
  AlternateEmail as MentionIcon,
  Chat as DmIcon,
  Tag as ChannelIcon,
  Forum as ThreadIcon,
} from '@mui/icons-material';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { notificationsControllerDismissNotificationMutation } from '../../api-client/@tanstack/react-query.gen';

import { AuthenticatedImage } from '../Common/AuthenticatedImage';
import ListState, { ListSkeleton } from '../Common/ListState';
import { MobileSheet } from '../Mobile/common/MobileSheet';
import { useAuthenticatedImage } from '../../hooks/useAuthenticatedImage';
import { useResponsive } from '../../hooks/useResponsive';
import { useLongPress } from '../../hooks/useSwipeGesture';
import { TOUCH_TARGETS } from '../../utils/breakpoints';
import { NotificationType, Notification } from '../../types/notification.type';
import { logger } from '../../utils/logger';
import { useNotifications } from '../../hooks/useNotifications';
import { formatLastMessageTime } from '../../utils/dmHelpers';
import {
  getMessagePreview,
  getNotificationAuthorName,
  getNotificationTypeLabel,
  getTimeAgo,
} from '../../utils/notificationHelpers';

const getNotificationIcon = (type: Notification['type']) => {
  switch (type) {
    case NotificationType.USER_MENTION:
    case NotificationType.SPECIAL_MENTION:
      return <MentionIcon />;
    case NotificationType.DIRECT_MESSAGE:
      return <DmIcon />;
    case NotificationType.CHANNEL_MESSAGE:
      return <ChannelIcon />;
    case NotificationType.THREAD_REPLY:
      return <ThreadIcon />;
    default:
      return <MentionIcon />;
  }
};

const NOTIFICATION_AVATAR_SIZE = 40;
const TYPE_BADGE_SIZE = 18;
/** Compact row height; still above TOUCH_TARGETS.MINIMUM (44px). */
const ROW_MIN_HEIGHT = 56;

/**
 * Author avatar with a small notification-type badge. `author.avatarUrl` is a
 * file id, so it goes through the authenticated file cache
 * (AuthenticatedImage). With no avatar, the type icon itself is the avatar.
 */
const NotificationAvatar: React.FC<{ notification: Notification }> = ({ notification }) => {
  const iconAvatar = (
    <Avatar
      sx={{
        bgcolor: notification.read ? 'grey.500' : 'primary.main',
        width: NOTIFICATION_AVATAR_SIZE,
        height: NOTIFICATION_AVATAR_SIZE,
        '& .MuiSvgIcon-root': { fontSize: 20 },
      }}
    >
      {getNotificationIcon(notification.type)}
    </Avatar>
  );

  const avatarFileId = notification.author?.avatarUrl;
  // Shares AuthenticatedImage's cache entry; only used to hide the type badge
  // when the avatar can't be shown and the type icon is already the avatar.
  const { blobUrl } = useAuthenticatedImage(avatarFileId);
  if (!avatarFileId) {
    return iconAvatar;
  }

  return (
    <Badge
      invisible={!blobUrl}
      overlap="circular"
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      badgeContent={
        <Avatar
          sx={{
            width: TYPE_BADGE_SIZE,
            height: TYPE_BADGE_SIZE,
            bgcolor: notification.read ? 'grey.500' : 'primary.main',
            border: 2,
            borderColor: 'background.paper',
            '& .MuiSvgIcon-root': { fontSize: 11 },
          }}
        >
          {getNotificationIcon(notification.type)}
        </Avatar>
      }
    >
      <AuthenticatedImage
        fileId={avatarFileId}
        alt={getNotificationAuthorName(notification)}
        component="avatar"
        fallback={iconAvatar}
        sx={{ width: NOTIFICATION_AVATAR_SIZE, height: NOTIFICATION_AVATAR_SIZE }}
      />
    </Badge>
  );
};

interface NotificationItemProps {
  notification: Notification;
  touch: boolean;
  onMarkRead: (id: string) => void;
  onDismiss: (id: string) => void;
  onClick: (notification: Notification) => void;
  onOpenActions: (notification: Notification) => void;
}

/**
 * One compact row:  [avatar] [Name · label ........ time]
 *                            [preview ............ •unread]
 *
 * Pointer layouts get inline mark-read / dismiss icons; touch layouts open an
 * action sheet on long-press instead. Every text node is a <span>/<div> — no
 * <p> nesting (the old ListItemText secondary put <p>s inside a <p>).
 */
const NotificationItem: React.FC<NotificationItemProps> = ({
  notification,
  touch,
  onMarkRead,
  onDismiss,
  onClick,
  onOpenActions,
}) => {
  const preview = getMessagePreview(notification);
  const unread = !notification.read;

  const longPress = useLongPress(() => onOpenActions(notification), { enabled: touch });
  const touchHandlers = touch
    ? {
        onTouchStart: longPress.onTouchStart,
        onTouchMove: longPress.onTouchMove,
        onTouchEnd: longPress.onTouchEnd,
        onTouchCancel: longPress.onTouchCancel,
        onContextMenu: longPress.onContextMenu,
      }
    : {};

  // Sibling of the row button (not nested inside it, not an absolutely
  // positioned secondaryAction that would overlap the time column).
  const actions = touch ? null : (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, pr: 1, flexShrink: 0 }}>
      {unread && (
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            onMarkRead(notification.id);
          }}
          aria-label="Mark as read"
          title="Mark as read"
          sx={{ color: 'text.secondary' }}
        >
          <CheckIcon fontSize="small" />
        </IconButton>
      )}
      <IconButton
        size="small"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(notification.id);
        }}
        aria-label="Dismiss"
        title="Dismiss"
        sx={{ color: 'text.secondary' }}
      >
        <DismissIcon fontSize="small" />
      </IconButton>
    </Box>
  );

  return (
    <ListItem disablePadding sx={{ alignItems: 'stretch' }}>
      <ListItemButton
        data-testid={`notification-row-${notification.id}`}
        onClick={() => {
          // Ignore the ghost click that follows a long-press (iOS).
          if (touch && longPress.isLongPressTriggered()) return;
          onClick(notification);
        }}
        {...touchHandlers}
        sx={{
          minHeight: ROW_MIN_HEIGHT,
          borderRadius: 0,
          mb: 0,
          py: 1,
          px: 2,
          gap: 1.5,
          alignItems: 'center',
          flex: 1,
          minWidth: 0,
          ...(touch && { WebkitTouchCallout: 'none', userSelect: 'none' }),
        }}
      >
        <Box sx={{ flexShrink: 0, display: 'flex' }}>
          <NotificationAvatar notification={notification} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, minWidth: 0 }}>
            <Typography
              component="span"
              noWrap
              sx={{ flex: '0 1 auto', minWidth: 0, fontWeight: unread ? 600 : 500, fontSize: '0.9375rem' }}
            >
              {getNotificationAuthorName(notification)}
            </Typography>
            <Typography
              component="span"
              variant="body2"
              color="text.secondary"
              noWrap
              // Shrinks before the name does.
              sx={{ flex: '0 1000 auto', minWidth: 0 }}
            >
              {getNotificationTypeLabel(notification.type as NotificationType)}
            </Typography>
            <Typography
              component="span"
              variant="caption"
              noWrap
              title={getTimeAgo(notification.createdAt)}
              sx={{
                ml: 'auto',
                pl: 1,
                flexShrink: 0,
                color: unread ? 'primary.main' : 'text.secondary',
                fontWeight: unread ? 600 : undefined,
              }}
            >
              {formatLastMessageTime(notification.createdAt)}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            <Typography
              component="span"
              variant="body2"
              noWrap
              sx={{ flex: 1, minWidth: 0, color: unread ? 'text.primary' : 'text.secondary' }}
            >
              {preview || '\u00A0'}
            </Typography>
            {unread && (
              <Box
                component="span"
                data-testid="notification-unread-dot"
                aria-label="Unread"
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor: 'primary.main',
                  flexShrink: 0,
                }}
              />
            )}
          </Box>
        </Box>
      </ListItemButton>
      {actions}
    </ListItem>
  );
};

interface NotificationActionsSheetProps {
  notification: Notification | null;
  onClose: () => void;
  onMarkRead: (id: string) => void;
  onDismiss: (id: string) => void;
}

/** Touch-only bottom sheet opened by long-pressing a notification row. */
const NotificationActionsSheet: React.FC<NotificationActionsSheetProps> = ({
  notification,
  onClose,
  onMarkRead,
  onDismiss,
}) => (
  <MobileSheet
    open={notification !== null}
    onClose={onClose}
    showCloseButton={false}
    title={notification ? getNotificationAuthorName(notification) : undefined}
  >
    {notification && (
      <List disablePadding>
        {!notification.read && (
          <ListItemButton
            onClick={() => {
              onMarkRead(notification.id);
              onClose();
            }}
            sx={{ minHeight: TOUCH_TARGETS.RECOMMENDED, borderRadius: 1 }}
          >
            <ListItemIcon>
              <CheckIcon />
            </ListItemIcon>
            <ListItemText primary="Mark as read" />
          </ListItemButton>
        )}
        <ListItemButton
          onClick={() => {
            onDismiss(notification.id);
            onClose();
          }}
          sx={{ minHeight: TOUCH_TARGETS.RECOMMENDED, borderRadius: 1 }}
        >
          <ListItemIcon>
            <DismissIcon />
          </ListItemIcon>
          <ListItemText primary="Dismiss" />
        </ListItemButton>
      </List>
    )}
  </MobileSheet>
);

/**
 * Notification list body — mark-all button, loading/empty states, and the list.
 */
export const NotificationList: React.FC = () => {
  const navigate = useNavigate();
  const { shouldUseTouchUI } = useResponsive();
  const [actionTarget, setActionTarget] = useState<Notification | null>(null);
  const closeActions = useCallback(() => setActionTarget(null), []);

  const {
    notifications,
    unreadCount,
    isLoading,
    error,
    isMarkingAllRead,
    refetch,
    handleMarkAsRead,
    handleMarkAllAsRead,
    invalidateNotifications,
  } = useNotifications();

  const { mutateAsync: dismissNotification } = useMutation({
    ...notificationsControllerDismissNotificationMutation(),
    onSuccess: () => invalidateNotifications(),
  });

  const handleDismiss = async (notificationId: string) => {
    try {
      await dismissNotification({ path: { id: notificationId } });
    } catch (error) {
      logger.error('Failed to dismiss notification:', error);
    }
  };

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.read) {
      handleMarkAsRead(notification.id);
    }

    if (notification.communityId && notification.channelId) {
      navigate(`/community/${notification.communityId}/channel/${notification.channelId}`);
    } else if (notification.directMessageGroupId) {
      navigate(`/direct-messages/${notification.directMessageGroupId}`);
    }
  };

  return (
    <>
      {/* Mark all as read button */}
      {unreadCount > 0 && (
        <Box sx={{ px: 1, py: 0.5, display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            size="small"
            onClick={handleMarkAllAsRead}
            disabled={isMarkingAllRead}
            startIcon={isMarkingAllRead ? <CircularProgress size={16} /> : <CheckIcon />}
          >
            Mark all as read
          </Button>
        </Box>
      )}

      {unreadCount > 0 && <Divider />}

      <ListState
        isLoading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        isEmpty={notifications.length === 0}
        skeleton={<ListSkeleton rows={8} avatarSize={NOTIFICATION_AVATAR_SIZE} label="Loading notifications" />}
        errorTitle="Couldn't load notifications"
        empty={
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 1,
              gap: 2,
              p: 3,
            }}
          >
            <Box sx={{ fontSize: 64, opacity: 0.5 }}>🔔</Box>
            <Typography variant="h6" color="text.secondary">
              No notifications
            </Typography>
            <Typography variant="body2" color="text.secondary" textAlign="center">
              You'll see mentions, replies, and direct messages here.
            </Typography>
            <Button variant="outlined" onClick={() => refetch()}>
              Refresh
            </Button>
          </Box>
        }
      >
        <Box sx={{ flex: 1, overflowY: 'auto' }}>
          <List disablePadding>
            {notifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                touch={shouldUseTouchUI}
                onMarkRead={handleMarkAsRead}
                onDismiss={handleDismiss}
                onClick={handleNotificationClick}
                onOpenActions={setActionTarget}
              />
            ))}
          </List>
        </Box>
      </ListState>

      {shouldUseTouchUI && (
        <NotificationActionsSheet
          notification={actionTarget}
          onClose={closeActions}
          onMarkRead={handleMarkAsRead}
          onDismiss={handleDismiss}
        />
      )}
    </>
  );
};

export default NotificationList;
