import React from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import {
  Box,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  Divider,
  IconButton,
  useTheme,
} from "@mui/material";
import { APPBAR_HEIGHT } from "../../constants/layout";
import { useMobileBreakpoint } from "../../hooks/useResponsive";
import {
  Menu as MenuIcon,
  Dashboard as DashboardIcon,
  People as PeopleIcon,
  Groups as CommunitiesIcon,
  Link as InvitesIcon,
  Security as RolesIcon,
  Storage as StorageIcon,
  Settings as SettingsIcon,
  BugReport as BugReportIcon,
} from "@mui/icons-material";

const DRAWER_WIDTH = 240;

interface NavItem {
  label: string;
  path: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  { label: "Dashboard", path: "/admin", icon: <DashboardIcon /> },
  { label: "Users", path: "/admin/users", icon: <PeopleIcon /> },
  { label: "Communities", path: "/admin/communities", icon: <CommunitiesIcon /> },
  { label: "Invites", path: "/admin/invites", icon: <InvitesIcon /> },
  { label: "Roles", path: "/admin/roles", icon: <RolesIcon /> },
  { label: "Storage", path: "/admin/storage", icon: <StorageIcon /> },
  { label: "Settings", path: "/admin/settings", icon: <SettingsIcon /> },
  { label: "Debug", path: "/admin/debug", icon: <BugReportIcon /> },
];

const AdminLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const isMobile = useMobileBreakpoint();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  const isActive = (path: string) => {
    if (path === "/admin") {
      return location.pathname === "/admin";
    }
    return location.pathname.startsWith(path);
  };

  const handleNavigate = (path: string) => {
    navigate(path);
    setMobileOpen(false);
  };

  const drawerContent = (
    <>
      {/* Header */}
      <Box sx={{ p: 2 }}>
        <Typography variant="h6" fontWeight="bold">
          Instance Admin
        </Typography>
      </Box>
      <Divider />

      {/* Navigation */}
      <List sx={{ flex: 1 }}>
        {navItems.map((item) => (
          <ListItem key={item.path} disablePadding>
            <ListItemButton
              selected={isActive(item.path)}
              onClick={() => handleNavigate(item.path)}
              sx={{
                "&.Mui-selected": {
                  backgroundColor: theme.palette.action.selected,
                  borderRight: `3px solid ${theme.palette.primary.main}`,
                },
              }}
            >
              <ListItemIcon
                sx={{
                  color: isActive(item.path)
                    ? theme.palette.primary.main
                    : "inherit",
                }}
              >
                {item.icon}
              </ListItemIcon>
              <ListItemText primary={item.label} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </>
  );

  return (
    <Box sx={{ display: "flex", minHeight: `calc(var(--full-dvh) - ${APPBAR_HEIGHT}px)` }}>
      {/* Sidebar */}
      {isMobile ? (
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            "& .MuiDrawer-paper": {
              width: DRAWER_WIDTH,
              boxSizing: "border-box",
              backgroundColor: theme.palette.background.paper,
            },
          }}
        >
          {drawerContent}
        </Drawer>
      ) : (
        <Drawer
          variant="permanent"
          sx={{
            width: DRAWER_WIDTH,
            flexShrink: 0,
            "& .MuiDrawer-paper": {
              width: DRAWER_WIDTH,
              boxSizing: "border-box",
              position: "relative",
              minHeight: `calc(var(--full-dvh) - ${APPBAR_HEIGHT}px)`,
              backgroundColor: theme.palette.background.paper,
            },
          }}
        >
          {drawerContent}
        </Drawer>
      )}

      {/* Main content */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          minWidth: 0,
          p: 3,
          overflow: "auto",
          backgroundColor: theme.palette.background.canvas,
        }}
      >
        {isMobile && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
            <IconButton
              edge="start"
              onClick={() => setMobileOpen(true)}
              aria-label="open admin navigation"
            >
              <MenuIcon />
            </IconButton>
            <Typography variant="h6" fontWeight="bold">
              Instance Admin
            </Typography>
          </Box>
        )}
        <Outlet />
      </Box>
    </Box>
  );
};

export default AdminLayout;
