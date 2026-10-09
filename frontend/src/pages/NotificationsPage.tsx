import React from 'react';
import { Box, Container, Typography } from '@mui/material';
import { NotificationList } from '../components/Notifications/NotificationList';
import { ListPageShell } from '../components/Common/PageShell';
import { useResponsive } from '../hooks/useResponsive';

/**
 * NotificationsPage
 *
 * Standalone notifications route (`/notifications`). Reuses the shared
 * NotificationList body. Works on desktop (in the list page shell) and, via
 * the mobile 'route' screen, as a deep-linkable notifications view.
 */
const NotificationsPage: React.FC = () => {
  const { isDesktop } = useResponsive();

  if (isDesktop) {
    return (
      <ListPageShell title="Notifications" fillHeight>
        <NotificationList />
      </ListPageShell>
    );
  }

  return (
    <Container maxWidth="sm" sx={{ py: 2, height: '100%' }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <Typography variant="h5" sx={{ fontWeight: 700, px: 1, pb: 1 }}>
          Notifications
        </Typography>
        <NotificationList />
      </Box>
    </Container>
  );
};

export default NotificationsPage;
