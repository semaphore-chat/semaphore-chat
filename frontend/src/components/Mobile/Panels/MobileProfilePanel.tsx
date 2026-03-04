/**
 * MobileProfilePanel Component
 *
 * Shows user profile and settings.
 * Uses the new MobileAppBar component.
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
} from '@mui/material';
import {
  Edit as EditIcon,
  Logout as LogoutIcon,
  AdminPanelSettings as AdminIcon,
  Settings as SettingsIcon,
} from '@mui/icons-material';
import { useQuery, useMutation } from '@tanstack/react-query';
import { userControllerGetProfileOptions, authControllerLogoutMutation } from '../../../api-client/@tanstack/react-query.gen';
import { useAuthenticatedImage } from '../../../hooks/useAuthenticatedImage';
import { TOUCH_TARGETS } from '../../../utils/breakpoints';
import { useNavigate } from 'react-router-dom';
import MobileAppBar from '../MobileAppBar';
import { logger } from '../../../utils/logger';
import { isElectron } from '../../../utils/platform';
import { getElectronRefreshToken } from '../../../utils/tokenService';

/**
 * Profile panel - Shows user profile and settings
 * Default screen for the Profile tab
 */
export const MobileProfilePanel: React.FC = () => {
  const navigate = useNavigate();
  const { data: userData } = useQuery(userControllerGetProfileOptions());
  const { mutateAsync: logout } = useMutation(authControllerLogoutMutation());

  // Load authenticated images
  const { blobUrl: avatarUrl } = useAuthenticatedImage(userData?.avatarUrl);
  const { blobUrl: bannerUrl } = useAuthenticatedImage(userData?.bannerUrl);

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

  const isAdmin = userData?.instanceRole === 'ADMIN';

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
        {/* Profile card with banner */}
        {userData && (
          <Card sx={{ mt: 2, mb: 2, overflow: 'hidden' }}>
            {/* Banner */}
            <Box
              sx={{
                height: 120,
                background: bannerUrl
                  ? `url(${bannerUrl}) center/cover`
                  : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                position: 'relative',
              }}
            />

            {/* Profile info */}
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
                {/* Avatar with border */}
                <Avatar
                  src={avatarUrl || undefined}
                  sx={{
                    width: 96,
                    height: 96,
                    fontSize: '2.5rem',
                    border: '4px solid',
                    borderColor: 'background.paper',
                    bgcolor: 'primary.main',
                  }}
                >
                  {userData.displayName?.charAt(0).toUpperCase()}
                </Avatar>

                <Box sx={{ mt: 2 }}>
                  <Typography variant="h5" sx={{ fontWeight: 600 }}>
                    {userData.displayName}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    @{userData.username}
                  </Typography>
                  {userData.instanceRole && (
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
                      {userData.instanceRole}
                    </Typography>
                  )}
                </Box>
              </Box>
            </CardContent>
          </Card>
        )}

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
