import React, { Suspense, useState } from "react";
import { Routes, Route } from "react-router-dom";
import Layout from "./Layout";
import CssBaseline from "@mui/material/CssBaseline";
import { CircularProgress, Box } from "@mui/material";
import { ThemeProvider } from "./contexts/ThemeContext";
import AutoUpdater from "./components/Electron/AutoUpdater";
import { ConnectionWizard } from "./components/Electron/ConnectionWizard";
import { PWAInstallPrompt } from "./components/PWA/PWAInstallPrompt";
import { hasServers } from "./utils/serverStorage";
import { isElectron } from "./utils/platform";
import { AuthGate } from "./components/AuthGate";
import { PublicRoute } from "./components/PublicRoute";

// Eager imports - first-paint routes
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import OnboardingPage from "./pages/OnboardingPage";

// Lazy-loaded routes
const HomePage = React.lazy(() => import("./pages/HomePage"));
const CreateCommunityPage = React.lazy(() => import("./pages/CreateCommunityPage"));
const EditCommunityPage = React.lazy(() => import("./pages/EditCommunityPage"));
const JoinInvitePage = React.lazy(() => import("./pages/JoinInvitePage"));
const AdminInvitePage = React.lazy(() => import("./pages/AdminInvitePage"));
const AdminLayout = React.lazy(() => import("./components/admin/AdminLayout"));
const AdminDashboard = React.lazy(() => import("./pages/admin").then(m => ({ default: m.AdminDashboard })));
const AdminUsersPage = React.lazy(() => import("./pages/admin").then(m => ({ default: m.AdminUsersPage })));
const AdminCommunitiesPage = React.lazy(() => import("./pages/admin").then(m => ({ default: m.AdminCommunitiesPage })));
const AdminSettingsPage = React.lazy(() => import("./pages/admin").then(m => ({ default: m.AdminSettingsPage })));
const AdminRolesPage = React.lazy(() => import("./pages/admin").then(m => ({ default: m.AdminRolesPage })));
const AdminStoragePage = React.lazy(() => import("./pages/admin").then(m => ({ default: m.AdminStoragePage })));
const AdminDebugPage = React.lazy(() => import("./pages/admin").then(m => ({ default: m.AdminDebugPage })));
const NotificationDebugPage = React.lazy(() => import("./pages/debug/NotificationDebugPage"));
const DirectMessagesPage = React.lazy(() => import("./pages/DirectMessagesPage"));
const FriendsPage = React.lazy(() => import("./pages/FriendsPage"));
const ProfilePage = React.lazy(() => import("./pages/ProfilePage"));
const ProfileEditPage = React.lazy(() => import("./pages/ProfileEditPage"));
const SettingsPage = React.lazy(() => import("./pages/SettingsPage"));
const CommunityPage = React.lazy(() => import("./pages/CommunityPage"));
const NotFoundPage = React.lazy(() => import("./pages/NotFoundPage"));

function App() {
  // Check if running in Electron and needs server configuration
  const needsServerSetup = isElectron() && !hasServers();
  const [showWizard, setShowWizard] = useState(needsServerSetup);

  // Show connection wizard for Electron if no servers configured
  if (showWizard) {
    return (
      <ThemeProvider>
        <CssBaseline />
        <AutoUpdater />
        <ConnectionWizard
          open={true}
          onComplete={() => {
            setShowWizard(false);
            // Reload the page to pick up the new server configuration
            window.location.reload();
          }}
        />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <CssBaseline />
      <AutoUpdater />
      <PWAInstallPrompt />
      <Suspense fallback={
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
          <CircularProgress />
        </Box>
      }>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
          <Route path="/register" element={<PublicRoute><RegisterPage /></PublicRoute>} />
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/join/:inviteCode" element={<JoinInvitePage />} />

          {/* Authenticated routes — AuthGate validates token + mounts providers */}
          <Route element={<AuthGate />}>
            <Route path="/" element={<Layout />}>
              <Route index element={<HomePage />} />
              <Route path="direct-messages" element={<DirectMessagesPage />} />
              <Route path="friends" element={<FriendsPage />} />
              <Route path="settings" element={<SettingsPage />} />

              {/* Admin routes with dedicated layout */}
              <Route path="admin" element={<AdminLayout />}>
                <Route index element={<AdminDashboard />} />
                <Route path="users" element={<AdminUsersPage />} />
                <Route path="communities" element={<AdminCommunitiesPage />} />
                <Route path="invites" element={<AdminInvitePage />} />
                <Route path="roles" element={<AdminRolesPage />} />
                <Route path="storage" element={<AdminStoragePage />} />
                <Route path="settings" element={<AdminSettingsPage />} />
                <Route path="debug" element={<AdminDebugPage />} />
              </Route>

              {/* Debug routes (admin only - access check in component) */}
              <Route path="debug/notifications" element={<NotificationDebugPage />} />
              <Route path="profile/edit" element={<ProfileEditPage />} />
              <Route path="profile/:userId" element={<ProfilePage />} />
              <Route path="community/create" element={<CreateCommunityPage />} />
              <Route path="community/:communityId">
                <Route index element={<CommunityPage />} />
                <Route path="edit" element={<EditCommunityPage />} />
                <Route path="channel/:channelId" element={<CommunityPage />} />
              </Route>
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Route>
        </Routes>
      </Suspense>
    </ThemeProvider>
  );
}

export default App;
