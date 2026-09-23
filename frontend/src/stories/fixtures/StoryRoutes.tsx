/**
 * Mirrors the authenticated portion of `src/routes.tsx` (everything normally
 * nested under `<Route element={<AuthGate/>}>`), so screen stories render
 * the exact same page components at the exact same paths the real app uses
 * — just under `AuthenticatedShell` instead of `AuthGate` (see that file for
 * why). Keep this in sync if `routes.tsx` adds/removes authenticated routes.
 */
import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from '../../Layout';
import { ProfileRedirect } from '../../components/ProfileRedirect';

const HomePage = React.lazy(() => import('../../pages/HomePage'));
const CreateCommunityPage = React.lazy(() => import('../../pages/CreateCommunityPage'));
const EditCommunityPage = React.lazy(() => import('../../pages/EditCommunityPage'));
const AdminLayout = React.lazy(() => import('../../components/admin/AdminLayout'));
const AdminDashboard = React.lazy(() => import('../../pages/admin').then((m) => ({ default: m.AdminDashboard })));
const AdminUsersPage = React.lazy(() => import('../../pages/admin').then((m) => ({ default: m.AdminUsersPage })));
const AdminCommunitiesPage = React.lazy(() => import('../../pages/admin').then((m) => ({ default: m.AdminCommunitiesPage })));
const AdminSettingsPage = React.lazy(() => import('../../pages/admin').then((m) => ({ default: m.AdminSettingsPage })));
const AdminRolesPage = React.lazy(() => import('../../pages/admin').then((m) => ({ default: m.AdminRolesPage })));
const AdminStoragePage = React.lazy(() => import('../../pages/admin').then((m) => ({ default: m.AdminStoragePage })));
const DirectMessagesPage = React.lazy(() => import('../../pages/DirectMessagesPage'));
const FriendsPage = React.lazy(() => import('../../pages/FriendsPage'));
const ProfilePage = React.lazy(() => import('../../pages/ProfilePage'));
const ProfileEditPage = React.lazy(() => import('../../pages/ProfileEditPage'));
const SettingsPage = React.lazy(() => import('../../pages/SettingsPage'));
const CommunityPage = React.lazy(() => import('../../pages/CommunityPage'));
const NotificationsPage = React.lazy(() => import('../../pages/NotificationsPage'));
const NotFoundPage = React.lazy(() => import('../../pages/NotFoundPage'));

/** The authenticated route tree, for use inside a `<MemoryRouter>` in stories. */
export const StoryRoutes: React.FC = () => (
  <Routes>
    <Route path="/" element={<Layout />}>
      <Route index element={<HomePage />} />
      <Route path="direct-messages" element={<DirectMessagesPage />} />
      <Route path="direct-messages/:dmGroupId" element={<DirectMessagesPage />} />
      <Route path="notifications" element={<NotificationsPage />} />
      <Route path="friends" element={<FriendsPage />} />
      <Route path="settings" element={<SettingsPage />} />
      <Route path="admin" element={<AdminLayout />}>
        <Route index element={<AdminDashboard />} />
        <Route path="users" element={<AdminUsersPage />} />
        <Route path="communities" element={<AdminCommunitiesPage />} />
        <Route path="roles" element={<AdminRolesPage />} />
        <Route path="storage" element={<AdminStoragePage />} />
        <Route path="settings" element={<AdminSettingsPage />} />
      </Route>
      <Route path="profile" element={<ProfileRedirect />} />
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
  </Routes>
);
