import { Box, Typography, Button, CircularProgress } from '@mui/material';
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

/**
 * The centred spinner shown while a lazy part of the app loads: App's top-level
 * Suspense, and AppShell's while the new design's chunk loads (no old-shell
 * chrome around it, so the two designs never mix on screen).
 */
export const AppLoadingFallback: React.FC = () => (
  <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 'var(--full-dvh)' }}>
    <CircularProgress />
  </Box>
);

interface NewDesignErrorFallbackProps {
  onBack: () => void;
  onRetry: () => void;
}

/**
 * Shown in place of the new design's shell when it crashed or its chunk failed to load (a deploy
 * replaced it, or the network dropped). Built without the kit, because the kit may be what failed.
 * Neither action reloads the page: a reload would end a call that is still connected underneath.
 */
export const NewDesignErrorFallback: React.FC<NewDesignErrorFallbackProps> = ({ onBack, onRetry }) => (
  <Box
    role="alert"
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
      The new design could not be shown
    </Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 3, maxWidth: 480 }}>
      If you are in a call, it is still connected.
    </Typography>
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
      <Button variant="contained" color="primary" onClick={onBack}>
        Back to the current design
      </Button>
      <Button variant="outlined" onClick={onRetry}>
        Try again
      </Button>
    </Box>
  </Box>
);

export default AppErrorFallback;
