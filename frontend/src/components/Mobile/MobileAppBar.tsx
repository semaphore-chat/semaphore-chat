/**
 * MobileAppBar Component
 *
 * Contextual app bar for mobile screens.
 * Shows back button, title, and action buttons based on current screen.
 */

import React from 'react';
import {
  AppBar,
  Toolbar,
  IconButton,
  Typography,
  Box,
  Avatar,
} from '@mui/material';
import {
  ArrowBack as BackIcon,
  Menu as MenuIcon,
  Search as SearchIcon,
  People as MembersIcon,
  MoreVert as MoreIcon,
} from '@mui/icons-material';
import { useMobileNavigation } from './Navigation/MobileNavigationContext';
import { LAYOUT_CONSTANTS } from '../../utils/breakpoints';

interface MobileAppBarProps {
  // Title to display
  title: string;
  // Optional subtitle (e.g., community name when in channel)
  subtitle?: string;
  // Optional avatar (e.g., community avatar)
  avatarUrl?: string;
  // Show back button instead of menu
  showBack?: boolean;
  // Custom back handler (defaults to goBack)
  onBack?: () => void;
  // Show community picker trigger (menu icon)
  showDrawerTrigger?: boolean;
  // Right-side action buttons
  actions?: React.ReactNode;
  // Show search button
  showSearch?: boolean;
  onSearchClick?: () => void;
  // Show members button
  showMembers?: boolean;
  onMembersClick?: () => void;
  // Show more options button
  showMore?: boolean;
  onMoreClick?: (event: React.MouseEvent<HTMLElement>) => void;
}

const MobileAppBar: React.FC<MobileAppBarProps> = ({
  title,
  subtitle,
  avatarUrl,
  showBack = false,
  onBack,
  showDrawerTrigger = false,
  actions,
  showSearch = false,
  onSearchClick,
  showMembers = false,
  onMembersClick,
  showMore = false,
  onMoreClick,
}) => {
  const { goBack, openDrawer } = useMobileNavigation();

  const handleBackClick = () => {
    if (onBack) {
      onBack();
    } else {
      goBack();
    }
  };

  const handleDrawerClick = () => {
    openDrawer();
  };

  return (
    <AppBar
      position="sticky"
      elevation={0}
      sx={{
        backgroundColor: 'background.paper',
        borderBottom: 1,
        borderColor: 'divider',
        color: 'text.primary',
      }}
    >
      <Toolbar
        sx={{
          minHeight: LAYOUT_CONSTANTS.APPBAR_HEIGHT_MOBILE,
          // With a leading icon button its own padding sets the inset; a bare
          // title sits on the 16px gutter like the list content below it.
          pl: showBack || showDrawerTrigger ? 1 : 2,
          pr: 1,
          gap: 0.5,
        }}
      >
        {/* Left action: Back or Menu */}
        {showBack ? (
          <IconButton
            edge="start"
            onClick={handleBackClick}
            sx={{ mr: 0.5 }}
            aria-label="Go back"
          >
            <BackIcon />
          </IconButton>
        ) : showDrawerTrigger ? (
          <IconButton
            edge="start"
            onClick={handleDrawerClick}
            sx={{ mr: 0.5 }}
            aria-label="Open community menu"
          >
            <MenuIcon />
          </IconButton>
        ) : null}

        {/* Avatar (optional) */}
        {avatarUrl && (
          <Avatar
            src={avatarUrl}
            sx={{
              width: 32,
              height: 32,
              mr: 1,
            }}
          />
        )}

        {/* Title area */}
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <Typography
            variant="h6"
            noWrap
            sx={{
              fontSize: 'scale.xl',
              fontWeight: 600,
              lineHeight: 1.2,
            }}
          >
            {title}
          </Typography>
          {subtitle && (
            <Typography
              variant="caption"
              noWrap
              sx={{
                color: 'text.secondary',
                fontSize: 'scale.sm',
                lineHeight: 1.2,
              }}
            >
              {subtitle}
            </Typography>
          )}
        </Box>

        {/* Right actions */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {showSearch && (
            <IconButton onClick={onSearchClick} aria-label="Search">
              <SearchIcon />
            </IconButton>
          )}
          {showMembers && (
            <IconButton onClick={onMembersClick} aria-label="Show members">
              <MembersIcon />
            </IconButton>
          )}
          {showMore && (
            <IconButton onClick={onMoreClick} aria-label="More options">
              <MoreIcon />
            </IconButton>
          )}
          {actions}
        </Box>
      </Toolbar>
    </AppBar>
  );
};

export default MobileAppBar;
