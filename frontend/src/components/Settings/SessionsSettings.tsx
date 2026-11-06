import React, { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Divider,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  IconButton,
  Button,
  Chip,
  CircularProgress,
  Alert,
  Skeleton,
} from '@mui/material';
import {
  Devices as DevicesIcon,
  Computer as DesktopIcon,
  Smartphone as MobileIcon,
  Laptop as LaptopIcon,
  Delete as DeleteIcon,
  Logout as LogoutIcon,
} from '@mui/icons-material';
import { formatDistanceToNow } from 'date-fns';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  authControllerGetSessionsOptions,
  authControllerRevokeSessionMutation,
  authControllerRevokeAllOtherSessionsMutation,
  pushNotificationsControllerSubscribeMutation,
} from '../../api-client/@tanstack/react-query.gen';
import {
  extractSubscriptionData,
  getCurrentPushSubscription,
  hasNotificationPermission,
  isPushSupported,
} from '../../utils/pushSubscription';

import type { SessionInfoDto as SessionInfo } from '../../api-client/types.gen';
import ConfirmDialog from '../Common/ConfirmDialog';
import { useNotification } from '../../contexts/NotificationContext';
import { logger } from '../../utils/logger';

// Helper to determine device icon based on device name
const getDeviceIcon = (deviceName: string) => {
  const name = deviceName.toLowerCase();
  if (name.includes('android') || name.includes('iphone') || name.includes('ipad')) {
    return <MobileIcon />;
  }
  if (name.includes('desktop') || name.includes('electron')) {
    return <DesktopIcon />;
  }
  return <LaptopIcon />;
};

// Session item component
const SessionItem: React.FC<{
  session: SessionInfo;
  onRevoke: (id: string) => void;
  isRevoking: boolean;
}> = ({ session, onRevoke, isRevoking }) => {
  return (
    <ListItem
      sx={{
        bgcolor: session.isCurrent ? 'action.selected' : 'transparent',
        borderRadius: 1,
        mb: 1,
        border: session.isCurrent ? '1px solid' : '1px solid transparent',
        borderColor: 'primary.main',
      }}
      secondaryAction={
        !session.isCurrent && (
          <IconButton
            edge="end"
            onClick={() => onRevoke(session.id)}
            disabled={isRevoking}
            color="error"
            title="Revoke session"
          >
            {isRevoking ? <CircularProgress size={20} /> : <DeleteIcon />}
          </IconButton>
        )
      }
    >
      <ListItemIcon>{getDeviceIcon(session.deviceName)}</ListItemIcon>
      <ListItemText
        primary={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body1">{session.deviceName}</Typography>
            {session.isCurrent && (
              <Chip
                label="Current"
                size="small"
                color="primary"
                variant="outlined"
              />
            )}
          </Box>
        }
        secondary={
          <Box>
            <Typography variant="body2" color="text.secondary">
              Last active: {formatDistanceToNow(new Date(session.lastUsedAt), { addSuffix: true })}
            </Typography>
            {session.ipAddress && (
              <Typography variant="caption" color="text.disabled">
                IP: {session.ipAddress}
              </Typography>
            )}
          </Box>
        }
      />
    </ListItem>
  );
};

// Loading skeleton
const SessionSkeleton: React.FC = () => (
  <ListItem sx={{ mb: 1 }}>
    <ListItemIcon>
      <Skeleton variant="circular" width={24} height={24} />
    </ListItemIcon>
    <ListItemText
      primary={<Skeleton width="60%" />}
      secondary={<Skeleton width="40%" />}
    />
  </ListItem>
);

const SessionsSettings: React.FC = () => {
  const { showNotification } = useNotification();
  const queryClient = useQueryClient();
  const { data: sessions, isLoading, error, refetch } = useQuery(authControllerGetSessionsOptions());
  const { mutateAsync: revokeSession } = useMutation({
    ...authControllerRevokeSessionMutation(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [{ _id: 'authControllerGetSessions' }] });
    },
  });
  const { mutateAsync: revokeAllOther, isPending: isRevokingAll } = useMutation({
    ...authControllerRevokeAllOtherSessionsMutation(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [{ _id: 'authControllerGetSessions' }] });
    },
  });

  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const { mutateAsync: subscribePush } = useMutation(pushNotificationsControllerSubscribeMutation());

  const handleRevokeSession = async (sessionId: string) => {
    setRevokingId(sessionId);
    try {
      await revokeSession({ path: { sessionId } });
      showNotification('Session revoked', 'success');
    } catch (err) {
      logger.error('Failed to revoke session:', err);
      showNotification('Failed to revoke session', 'error');
    } finally {
      setRevokingId(null);
    }
  };

  const keepThisDevicePush = async () => {
    try {
      if (!isPushSupported() || !hasNotificationPermission()) return;
      const subscription = await getCurrentPushSubscription();
      if (subscription) {
        await subscribePush({ body: extractSubscriptionData(subscription) });
      }
    } catch (err) {
      logger.warn('Could not keep push on this device:', err);
    }
  };

  const handleRevokeAllOther = async () => {
    try {
      const result = await revokeAllOther({});
      showNotification(result.message, 'success');
      setConfirmDialogOpen(false);
      // The server ended every push subscription with them; this device stays
      await keepThisDevicePush();
    } catch (err) {
      logger.error('Failed to revoke sessions:', err);
      showNotification('Failed to revoke sessions', 'error');
    }
  };

  const otherSessionsCount = sessions?.filter(s => !s.isCurrent).length ?? 0;

  return (
    <>
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography
            variant="h6"
            gutterBottom
            sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
          >
            <DevicesIcon /> Active Sessions
          </Typography>
          <Divider sx={{ mb: 2 }} />

          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Manage your active sessions across devices. You can sign out of any session
            to protect your account.
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              Failed to load sessions.{' '}
              <Button size="small" onClick={() => refetch()}>
                Retry
              </Button>
            </Alert>
          )}

          {isLoading ? (
            <List>
              {[1, 2, 3].map((i) => (
                <SessionSkeleton key={i} />
              ))}
            </List>
          ) : sessions && sessions.length > 0 ? (
            <List disablePadding>
              {sessions.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  onRevoke={handleRevokeSession}
                  isRevoking={revokingId === session.id}
                />
              ))}
            </List>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No active sessions found.
            </Typography>
          )}

          {otherSessionsCount > 0 && (
            <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                variant="outlined"
                color="error"
                startIcon={isRevokingAll ? <CircularProgress size={16} /> : <LogoutIcon />}
                onClick={() => setConfirmDialogOpen(true)}
                disabled={isRevokingAll}
              >
                Sign Out All Other Sessions ({otherSessionsCount})
              </Button>
            </Box>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmDialogOpen}
        title="Sign Out Other Sessions?"
        description={`This will sign you out of ${otherSessionsCount} other ${otherSessionsCount === 1 ? 'session' : 'sessions'}. You'll remain signed in on this device.`}
        confirmLabel={isRevokingAll ? 'Signing out...' : 'Sign Out All'}
        confirmColor="error"
        isLoading={isRevokingAll}
        onConfirm={handleRevokeAllOther}
        onCancel={() => setConfirmDialogOpen(false)}
      />
    </>
  );
};

export default SessionsSettings;
