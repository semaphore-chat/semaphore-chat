import React from "react";
import { Routes, Route } from "react-router-dom";
import Layout from "./Layout";
import { AuthGate } from "./components/AuthGate";
import { PublicRoute } from "./components/PublicRoute";
import { ProfileRedirect } from "./components/ProfileRedirect";

// Eager imports - first-paint routes
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
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
const PWADebugPage = React.lazy(() => import("./pages/debug/PWADebugPage"));
const DirectMessagesPage = React.lazy(() => import("./pages/DirectMessagesPage"));
const FriendsPage = React.lazy(() => import("./pages/FriendsPage"));
const ProfilePage = React.lazy(() => import("./pages/ProfilePage"));
const ProfileEditPage = React.lazy(() => import("./pages/ProfileEditPage"));
const SettingsPage = React.lazy(() => import("./pages/SettingsPage"));
const CommunityPage = React.lazy(() => import("./pages/CommunityPage"));
const NotificationsPage = React.lazy(() => import("./pages/NotificationsPage"));
const NotFoundPage = React.lazy(() => import("./pages/NotFoundPage"));

export const AppRoutes: React.FC = () => (
  <Routes>
    {/* Public routes */}
    <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
    <Route path="/register" element={<PublicRoute><RegisterPage /></PublicRoute>} />
    <Route path="/forgot-password" element={<PublicRoute><ForgotPasswordPage /></PublicRoute>} />
    <Route path="/reset-password" element={<PublicRoute><ResetPasswordPage /></PublicRoute>} />
    <Route path="/onboarding" element={<OnboardingPage />} />
    <Route path="/join/:inviteCode" element={<JoinInvitePage />} />

    {/* Authenticated routes — AuthGate validates token + mounts providers */}
    <Route element={<AuthGate />}>
      {/* Debug routes — outside Layout so they render on mobile too */}
      <Route path="debug/pwa" element={<PWADebugPage />} />

      <Route path="/" element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="direct-messages" element={<DirectMessagesPage />} />
        <Route path="direct-messages/:dmGroupId" element={<DirectMessagesPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
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
        <Route path="profile" element={<ProfileRedirect />} />
        <Route path="profile/edit" element={<ProfileEditPage />} />
        <Route path="profile/:userId" element={<ProfilePage />} />
        <Route path="community/create" element={<CreateCommunityPage />} />
        <Route path="community/:communityId">
          <Route index element={<CommunityPage />} />
          <Route path="edit" element={<EditCommunityPage />} />
          <Route path="channel/:channelId" element={<CommunityPage />} />
          {/* Phone full-screen message search; wider layouts just show the channel. */}
          <Route path="channel/:channelId/search" element={<CommunityPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Route>
  </Routes>
);

export default AppRoutes;
