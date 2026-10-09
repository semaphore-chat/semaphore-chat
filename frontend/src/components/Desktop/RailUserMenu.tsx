import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Button,
  Divider,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from "@mui/material";
import PersonOutlineIcon from "@mui/icons-material/PersonOutline";
import AdminPanelSettingsOutlinedIcon from "@mui/icons-material/AdminPanelSettingsOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import LogoutIcon from "@mui/icons-material/Logout";
import UserAvatar from "../Common/UserAvatar";
import ConfirmDialog from "../Common/ConfirmDialog";
import { useLogout } from "../../hooks/useLogout";
import { useSocketConnected } from "../../hooks/useSocket";
import { useUserPermissions } from "../../features/roles/useUserPermissions";
import { useTheme as useThemeSettings } from "../../contexts/ThemeContext";
import type { User } from "../../types/auth.type";

interface RailUserMenuProps {
  user: User | undefined;
  isExpanded: boolean;
}

/**
 * The account button at the foot of the desktop community rail: your avatar
 * with a presence dot, opening a menu with your name and status, Profile,
 * Admin (when allowed), Settings, the theme switch and "Log out…" (confirmed).
 * Mute and deafen stay in the voice bar.
 */
export const RailUserMenu: React.FC<RailUserMenuProps> = ({ user, isExpanded }) => {
  const navigate = useNavigate();
  const isOnline = useSocketConnected();
  const { handleLogout, logoutLoading } = useLogout();
  const { settings: themeSettings, toggleMode } = useThemeSettings();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Same rule the old app bar used: the owner, or anyone who can read instance invites.
  const { hasPermissions: canViewInvites } = useUserPermissions({
    resourceType: "INSTANCE",
    actions: ["READ_INSTANCE_INVITE"],
  });
  const showAdmin = user?.role === "OWNER" || canViewInvites;

  const name = user?.displayName || user?.username || "Account";
  const statusText = user?.status || (isOnline ? "Online" : "Offline");
  const isDark = themeSettings.mode === "dark";
  const open = Boolean(anchorEl);

  const close = () => setAnchorEl(null);
  const go = (path: string) => {
    close();
    navigate(path);
  };

  const avatar = (
    <UserAvatar userId={user?.id} size={isExpanded ? "small" : "medium"} showStatus isOnline={isOnline} />
  );

  const trigger = (
    <Button
      onClick={(e) => setAnchorEl(e.currentTarget)}
      variant="text"
      aria-label="Account menu"
      aria-haspopup="menu"
      aria-controls={open ? "rail-user-menu" : undefined}
      aria-expanded={open}
      sx={{
        width: "100%",
        minWidth: 0,
        p: isExpanded ? 0.5 : 0.75,
        justifyContent: isExpanded ? "flex-start" : "center",
        textTransform: "none",
        borderRadius: 2,
        "&:hover": { backgroundColor: "action.hover" },
      }}
    >
      {avatar}
      {isExpanded && (
        <Box sx={{ ml: 1, minWidth: 0, flex: 1, textAlign: "start" }}>
          <Typography variant="listItem" component="div" noWrap dir="auto" sx={{ color: "text.primary" }}>
            {name}
          </Typography>
          <Typography variant="meta" component="div" noWrap dir="auto" sx={{ color: "text.secondary" }}>
            {statusText}
          </Typography>
        </Box>
      )}
    </Button>
  );

  return (
    <>
      {isExpanded ? trigger : (
        <Tooltip title={name} placement="right" arrow>
          {trigger}
        </Tooltip>
      )}
      <Menu
        id="rail-user-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={close}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        transformOrigin={{ vertical: "bottom", horizontal: "left" }}
        slotProps={{ paper: { sx: { minWidth: 240, maxWidth: 320 } } }}
      >
        {/* Header: not a menu item, so arrow keys skip it. */}
        <Box
          data-testid="rail-user-menu-header"
          sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 2, pt: 1, pb: 1.5 }}
        >
          <UserAvatar userId={user?.id} size="medium" showStatus isOnline={isOnline} />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="listItem" component="div" noWrap dir="auto" sx={{ fontWeight: 700 }}>
              {name}
            </Typography>
            <Typography variant="meta" component="div" noWrap dir="auto" sx={{ color: "text.secondary" }}>
              {statusText}
            </Typography>
          </Box>
        </Box>
        <Divider sx={{ my: 0.5 }} />
        <MenuItem onClick={() => go(user?.id ? `/profile/${user.id}` : "/profile")}>
          <ListItemIcon><PersonOutlineIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Profile</ListItemText>
        </MenuItem>
        {showAdmin && (
          <MenuItem onClick={() => go("/admin")}>
            <ListItemIcon><AdminPanelSettingsOutlinedIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Admin</ListItemText>
          </MenuItem>
        )}
        <MenuItem onClick={() => go("/settings")}>
          <ListItemIcon><SettingsOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Settings</ListItemText>
        </MenuItem>
        <MenuItem onClick={toggleMode}>
          <ListItemIcon>
            {isDark ? <LightModeOutlinedIcon fontSize="small" /> : <DarkModeOutlinedIcon fontSize="small" />}
          </ListItemIcon>
          <ListItemText>{isDark ? "Light theme" : "Dark theme"}</ListItemText>
        </MenuItem>
        <Divider sx={{ my: 0.5 }} />
        <MenuItem
          onClick={() => {
            close();
            setConfirmOpen(true);
          }}
          sx={{ color: "error.main" }}
        >
          <ListItemIcon><LogoutIcon fontSize="small" color="error" /></ListItemIcon>
          <ListItemText>Log out…</ListItemText>
        </MenuItem>
      </Menu>
      <ConfirmDialog
        open={confirmOpen}
        title="Log out?"
        description="You'll leave any voice call and need to sign in again on this device."
        confirmLabel="Log out"
        isLoading={logoutLoading}
        onConfirm={() => void handleLogout()}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
};

export default RailUserMenu;
