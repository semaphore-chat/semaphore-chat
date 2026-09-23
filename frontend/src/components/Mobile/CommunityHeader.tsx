/**
 * CommunityHeader
 *
 * The header above a community's channel list on phone (MobileChannelsPanel)
 * and tablet (TabletSidebar): community switcher, avatar, name and an options
 * menu (settings for users who can edit the community, leave).
 */
import React from 'react';
import {
  AppBar,
  Avatar,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Toolbar,
  Typography,
} from '@mui/material';
import {
  Menu as MenuIcon,
  MoreVert as MoreIcon,
  Settings as SettingsIcon,
  ExitToApp as LeaveIcon,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { communityControllerFindOneOptions } from '../../api-client/@tanstack/react-query.gen';
import { useAuthenticatedImage } from '../../hooks/useAuthenticatedImage';
import { useCanPerformAction } from '../../features/roles/useUserPermissions';
import { LAYOUT_CONSTANTS, TOUCH_TARGETS } from '../../utils/breakpoints';
import { useMobileNavigation } from './Navigation/MobileNavigationContext';

interface CommunityHeaderProps {
  communityId: string;
}

export const CommunityHeader: React.FC<CommunityHeaderProps> = ({ communityId }) => {
  const navigate = useNavigate();
  const { openDrawer } = useMobileNavigation();
  const { data: community } = useQuery(communityControllerFindOneOptions({ path: { id: communityId } }));
  const { blobUrl: avatarUrl } = useAuthenticatedImage(community?.avatar);
  const canEditCommunity = useCanPerformAction('COMMUNITY', communityId, 'UPDATE_COMMUNITY');
  const [menuAnchor, setMenuAnchor] = React.useState<null | HTMLElement>(null);

  const name = community?.name || 'Community';
  const closeMenu = () => setMenuAnchor(null);

  const handleEditCommunity = () => {
    closeMenu();
    navigate(`/community/${communityId}/edit`);
  };

  const handleLeaveCommunity = () => {
    // TODO: Implement leave community
    closeMenu();
    navigate('/');
  };

  const buttonSx = { width: TOUCH_TARGETS.MINIMUM, height: TOUCH_TARGETS.MINIMUM, flexShrink: 0 };

  return (
    <AppBar
      position="sticky"
      elevation={0}
      data-testid="community-header"
      sx={{
        backgroundColor: 'background.paper',
        borderBottom: 1,
        borderColor: 'divider',
        color: 'text.primary',
      }}
    >
      <Toolbar
        disableGutters
        sx={{ minHeight: LAYOUT_CONSTANTS.APPBAR_HEIGHT_MOBILE, px: 0.5, gap: 1 }}
      >
        <IconButton onClick={openDrawer} aria-label="Switch community" sx={buttonSx}>
          <MenuIcon />
        </IconButton>

        <Avatar
          src={avatarUrl || undefined}
          alt=""
          sx={{ width: 32, height: 32, fontSize: '0.875rem', flexShrink: 0 }}
        >
          {name.charAt(0).toUpperCase()}
        </Avatar>

        <Typography
          variant="h6"
          noWrap
          sx={{ flex: 1, minWidth: 0, fontSize: '1.0625rem', fontWeight: 600, lineHeight: 1.2 }}
        >
          {name}
        </Typography>

        <IconButton
          onClick={(e) => setMenuAnchor(e.currentTarget)}
          aria-label="Community options"
          aria-haspopup="menu"
          sx={buttonSx}
        >
          <MoreIcon />
        </IconButton>
      </Toolbar>

      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={closeMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {canEditCommunity && (
          <MenuItem onClick={handleEditCommunity} sx={{ minHeight: TOUCH_TARGETS.MINIMUM }}>
            <ListItemIcon>
              <SettingsIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Community Settings</ListItemText>
          </MenuItem>
        )}
        <MenuItem onClick={handleLeaveCommunity} sx={{ minHeight: TOUCH_TARGETS.MINIMUM }}>
          <ListItemIcon>
            <LeaveIcon fontSize="small" sx={{ color: 'error.main' }} />
          </ListItemIcon>
          <ListItemText sx={{ color: 'error.main' }}>Leave Community</ListItemText>
        </MenuItem>
      </Menu>
    </AppBar>
  );
};

export default CommunityHeader;
