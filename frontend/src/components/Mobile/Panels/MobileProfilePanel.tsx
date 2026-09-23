/**
 * MobileProfilePanel Component
 *
 * Without a `userId` (or with the current user's id) it is the Profile tab:
 * the user's own profile card plus settings, admin and logout.
 *
 * With another user's `userId` (`/profile/:userId`) it shows that user's
 * profile read-only: the same card (banner, avatar, name, status, bio) plus
 * their public clips — the mobile counterpart of the desktop `ProfilePage`.
 */

import React from 'react';
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Avatar,
  Divider,
  Card,
  CardContent,
  Chip,
  CircularProgress,
} from '@mui/material';
import {
  Edit as EditIcon,
  Logout as LogoutIcon,
  AdminPanelSettings as AdminIcon,
  Settings as SettingsIcon,
  PersonOff as PersonOffIcon,
  ErrorOutline as ErrorIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  userControllerGetProfileOptions,
  userControllerGetUserByIdOptions,
  authControllerLogoutMutation,
} from '../../../api-client/@tanstack/react-query.gen';
import type { UserEntity } from '../../../api-client/types.gen';
import { useAuthenticatedImage } from '../../../hooks/useAuthenticatedImage';
import { TOUCH_TARGETS } from '../../../utils/breakpoints';
import { useNavigate } from 'react-router-dom';
import MobileAppBar from '../MobileAppBar';
import EmptyState from '../../Common/EmptyState';
import { ClipLibrary } from '../../Profile/ClipLibrary';
import { logger } from '../../../utils/logger';
import { isElectron } from '../../../utils/platform';
import { getElectronRefreshToken } from '../../../utils/tokenService';

interface MobileProfilePanelProps {
  /** Whose profile to show. Omitted (or the current user's id) = own profile. */
  userId?: string;
}

/** The API client throws the parsed error body, e.g. `{ statusCode: 404, message }`. */
const isNotFoundError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { statusCode?: unknown }).statusCode === 404;

/** Banner + avatar + name/username (+ role, status, bio) card, shared by own and other profiles. */
const ProfileCard: React.FC<{ user: UserEntity }> = ({ user }) => {
  const { blobUrl: avatarUrl } = useAuthenticatedImage(user.avatarUrl);
  const { blobUrl: bannerUrl } = useAuthenticatedImage(user.bannerUrl);
  const name = user.displayName || user.username;

  return (
    <Card sx={{ mt: 2, mb: 2, overflow: 'hidden' }}>
      <Box
        sx={{
          height: 120,
          background: bannerUrl
            ? `url(${bannerUrl}) center/cover`
            : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          position: 'relative',
        }}
      />

      <CardContent sx={{ pt: 0 }}>
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            mt: -6,
          }}
        >
          <Avatar
            src={avatarUrl || undefined}
            alt={name}
            sx={{
              width: 96,
              height: 96,
              fontSize: 'scale.5xl',
              border: '4px solid',
              borderColor: 'background.paper',
              bgcolor: 'primary.main',
            }}
          >
            {name.charAt(0).toUpperCase()}
          </Avatar>

          <Box sx={{ mt: 2, width: '100%', minWidth: 0 }}>
            <Typography variant="h5" component="h2" noWrap dir="auto" title={name} sx={{ fontWeight: 600 }}>
              {name}
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap title={`@${user.username}`}>
              @{user.username}
            </Typography>
            {user.role === 'OWNER' && (
              <Typography
                variant="caption"
                sx={{
                  mt: 1,
                  px: 1.5,
                  py: 0.5,
                  borderRadius: 1,
                  bgcolor: 'primary.main',
                  color: 'primary.contrastText',
                  display: 'inline-block',
                }}
              >
                {user.role}
              </Typography>
            )}
            {user.status && (
              <Box sx={{ mt: 1 }}>
                <Chip label={user.status} size="small" dir="auto" sx={{ maxWidth: '100%' }} />
              </Box>
            )}
          </Box>

          {user.bio && (
            <Box sx={{ mt: 2, width: '100%', textAlign: 'start' }}>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                About Me
              </Typography>
              <Typography
                variant="body2"
                dir="auto"
                sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
              >
                {user.bio}
              </Typography>
            </Box>
          )}
        </Box>
      </CardContent>
    </Card>
  );
};

const CenteredSpinner: React.FC = () => (
  <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
    <CircularProgress />
  </Box>
);

/** Read-only profile of another user. */
const OtherUserProfile: React.FC<{ userId: string }> = ({ userId }) => {
  // A missing user won't appear by retrying, so skip retries on 404; any
  // other failure keeps the client's default retry policy.
  const defaultRetry = useQueryClient().getDefaultOptions().queries?.retry ?? 3;
  const { data: user, isLoading, error, refetch } = useQuery({
    ...userControllerGetUserByIdOptions({ path: { id: userId } }),
    retry: (failureCount, err) => {
      if (isNotFoundError(err)) return false;
      if (typeof defaultRetry === 'function') return defaultRetry(failureCount, err);
      if (typeof defaultRetry === 'number') return failureCount < defaultRetry;
      return defaultRetry;
    },
  });

  let body: React.ReactNode;
  if (isLoading) {
    body = <CenteredSpinner />;
  } else if (isNotFoundError(error)) {
    body = (
      <EmptyState
        icon={<PersonOffIcon sx={{ fontSize: 'icon.6xl' }} />}
        title="User not found"
        description="This account may have been deleted, or the link is wrong."
      />
    );
  } else if (error || !user) {
    body = (
      <EmptyState
        icon={<ErrorIcon sx={{ fontSize: 'icon.6xl' }} />}
        title="Couldn't load this profile"
        description="Something went wrong. Check your connection and try again."
        action={{ label: 'Try again', onClick: () => void refetch() }}
      />
    );
  } else {
    body = (
      <>
        <ProfileCard user={user} />
        <Card sx={{ p: 2, mb: 2 }}>
          <ClipLibrary userId={userId} isOwnProfile={false} />
        </Card>
      </>
    );
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <MobileAppBar title="Profile" showBack />
      <Box sx={{ flex: 1, overflowY: 'auto', px: 2, pb: 2 }}>{body}</Box>
    </Box>
  );
};

/** The current user's own profile with settings, admin and logout. */
const OwnProfile: React.FC<{ userData: UserEntity | undefined }> = ({ userData }) => {
  const navigate = useNavigate();
  const { mutateAsync: logout } = useMutation(authControllerLogoutMutation());

  const handleEditProfile = () => {
    navigate('/profile/edit');
  };

  const handleSettings = () => {
    navigate('/settings');
  };

  const handleAdminPanel = () => {
    navigate('/admin/invites');
  };

  const handleLogout = async () => {
    try {
      // Electron clients must send refresh token in body since cookies don't work cross-origin
      const refreshToken = isElectron() ? (await getElectronRefreshToken()) ?? undefined : undefined;
      await logout({ body: { refreshToken } });
      navigate('/login');
    } catch (error) {
      logger.error('Failed to logout:', error);
    }
  };

  const isAdmin = userData?.role === 'OWNER';

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* App bar */}
      <MobileAppBar title="Profile" />

      {/* Content */}
      <Box
        sx={{
          flex: 1,
          overflowY: 'auto',
          px: 2,
          pb: 2,
        }}
      >
        {userData && <ProfileCard user={userData} />}

        {/* Settings list */}
        <Box sx={{ mt: 2 }}>
          <Typography
            variant="caption"
            sx={{
              textTransform: 'uppercase',
              fontWeight: 700,
              color: 'text.secondary',
              px: 2,
            }}
          >
            Settings
          </Typography>
          <List sx={{ pt: 1 }}>
            <ListItem disablePadding>
              <ListItemButton
                onClick={handleEditProfile}
                sx={{ minHeight: TOUCH_TARGETS.RECOMMENDED }}
              >
                <ListItemIcon>
                  <EditIcon />
                </ListItemIcon>
                <ListItemText
                  primary="Edit Profile"
                  secondary="Update your display name and settings"
                />
              </ListItemButton>
            </ListItem>

            <ListItem disablePadding>
              <ListItemButton
                onClick={handleSettings}
                sx={{ minHeight: TOUCH_TARGETS.RECOMMENDED }}
              >
                <ListItemIcon>
                  <SettingsIcon />
                </ListItemIcon>
                <ListItemText
                  primary="Settings"
                  secondary="Notifications, appearance, and audio"
                />
              </ListItemButton>
            </ListItem>

            {isAdmin && (
              <ListItem disablePadding>
                <ListItemButton
                  onClick={handleAdminPanel}
                  sx={{ minHeight: TOUCH_TARGETS.RECOMMENDED }}
                >
                  <ListItemIcon>
                    <AdminIcon />
                  </ListItemIcon>
                  <ListItemText
                    primary="Admin Panel"
                    secondary="Manage instance invitations"
                  />
                </ListItemButton>
              </ListItem>
            )}
          </List>

          <Divider sx={{ my: 2 }} />

          <List>
            <ListItem disablePadding>
              <ListItemButton
                onClick={handleLogout}
                sx={{
                  minHeight: TOUCH_TARGETS.RECOMMENDED,
                  color: 'error.main',
                }}
              >
                <ListItemIcon>
                  <LogoutIcon sx={{ color: 'error.main' }} />
                </ListItemIcon>
                <ListItemText primary="Logout" />
              </ListItemButton>
            </ListItem>
          </List>
        </Box>
      </Box>
    </Box>
  );
};

/**
 * Profile panel — own profile (Profile tab default) or, given another user's
 * id, that user's read-only profile.
 */
export const MobileProfilePanel: React.FC<MobileProfilePanelProps> = ({ userId }) => {
  const { data: me, isLoading: meLoading } = useQuery(userControllerGetProfileOptions());

  if (userId) {
    // Don't guess own-vs-other until we know who "me" is — avoids flashing
    // the read-only view (or firing a by-id fetch) for our own profile.
    if (meLoading) {
      return (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <MobileAppBar title="Profile" showBack />
          <CenteredSpinner />
        </Box>
      );
    }
    if (userId !== me?.id) {
      return <OtherUserProfile userId={userId} />;
    }
  }

  return <OwnProfile userData={me} />;
};
