import { Box, Typography, Button } from '@mui/material';
import { Error as ErrorIcon } from '@mui/icons-material';

interface AppErrorFallbackProps {
  error?: Error;
}

/**
 * Full-page fallback for the app-level ErrorBoundary in App.tsx.
 *
 * This is the outermost safety net — it only renders when a render error
 * escaped every closer boundary (e.g. RouteErrorBoundary), which means we
 * can't be confident about the state of anything below it (auth, sockets,
 * voice connection, etc). Recovery is a full reload rather than an in-place
 * reset.
 */
export const AppErrorFallback: React.FC<AppErrorFallbackProps> = ({ error }) => (
  <Box
    sx={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 'var(--full-dvh, 100vh)',
      width: '100%',
      p: 3,
      textAlign: 'center',
      bgcolor: 'background.canvas',
    }}
  >
    <ErrorIcon sx={{ fontSize: 'icon.6xl', color: 'error.main', mb: 2 }} />
    <Typography variant="h5" gutterBottom color="text.primary">
      Something went wrong
    </Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 3, maxWidth: 480 }}>
      {error?.message || 'An unexpected error occurred and the app needs to reload.'}
    </Typography>
    <Button
      variant="contained"
      color="primary"
      onClick={() => window.location.reload()}
    >
      Reload
    </Button>
  </Box>
);

export default AppErrorFallback;
