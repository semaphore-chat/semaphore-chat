import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  Stepper,
  Step,
  StepLabel,
  Button,
  TextField,
  Box,
  Typography,
  Alert,
  CircularProgress,
} from '@mui/material';
import { OpenInBrowser } from '@mui/icons-material';
import { addOrActivateServer } from '../../utils/serverStorage';
import { clearTokens } from '../../utils/tokenService';
import { logger } from '../../utils/logger';
import { useElectronAPI } from '../../contexts/ElectronContext';
import { requestBrowserLoginOnLoad } from '../../hooks/useBrowserLogin';

interface ConnectionWizardProps {
  open: boolean;
  /** Called once the server is saved and active; the app reloads to use it. */
  onComplete: () => void;
  /**
   * Changing the server from the login screen: the wizard can be closed
   * without picking one. First-run setup can't.
   */
  onCancel?: () => void;
}

export const ConnectionWizard: React.FC<ConnectionWizardProps> = ({ open, onComplete, onCancel }) => {
  const electronAPI = useElectronAPI();
  // Changing server skips the welcome step
  const [activeStep, setActiveStep] = useState(onCancel ? 1 : 0);
  // Whether the server can sign the app in through the browser
  const [browserLoginSupported, setBrowserLoginSupported] = useState(false);
  // The server that passed the connection test, saved on confirm (commitServer)
  const [pendingServer, setPendingServer] = useState<{ name: string; url: string } | null>(null);
  const [serverUrl, setServerUrl] = useState('');
  const [serverName, setServerName] = useState('');
  const [error, setError] = useState('');
  const [testing, setTesting] = useState(false);

  const steps = ['Welcome', 'Server Details', 'Complete'];

  const validateUrl = (url: string): boolean => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
      return false;
    }
  };

  const testConnection = async (url: string): Promise<boolean> => {
    try {
      // Test connection to /api/onboarding/status endpoint
      const response = await fetch(`${url}/api/onboarding/status`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) return false;
      setBrowserLoginSupported(await supportsBrowserLogin(url));
      return true;
    } catch (error) {
      logger.error('Connection test failed:', error);
      return false;
    }
  };

  const supportsBrowserLogin = async (url: string): Promise<boolean> => {
    if (!electronAPI?.startBrowserLogin) return false;
    try {
      const response = await fetch(`${url}/api/instance/settings/public`);
      if (!response.ok) return false;
      const settings = (await response.json()) as { desktopBrowserLogin?: boolean };
      return settings.desktopBrowserLogin === true;
    } catch {
      return false;
    }
  };

  const normalizeUrl = (url: string): string => {
    let normalized = url.trim();
    try {
      const parsed = new URL(normalized);
      // Strip hash fragment and search params — keep only origin + pathname
      normalized = parsed.origin + parsed.pathname;
    } catch {
      return normalized;
    }
    // Remove trailing slash
    return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  };

  const handleNext = async () => {
    setError('');

    if (activeStep === 1) {
      // Validate URL
      if (!serverUrl.trim()) {
        setError('Please enter a server URL');
        return;
      }

      if (!validateUrl(serverUrl)) {
        setError('Please enter a valid URL (http:// or https://)');
        return;
      }

      // Normalize: strip hash/search params (users may paste full app URLs like https://server.com/#/invite/code)
      const cleanUrl = normalizeUrl(serverUrl);
      setServerUrl(cleanUrl);

      // Test connection
      setTesting(true);
      const connectionOk = await testConnection(cleanUrl);
      setTesting(false);

      if (!connectionOk) {
        setError('Could not connect to server. Please check the URL and try again.');
        return;
      }

      // Auto-generate server name if not provided
      if (!serverName.trim()) {
        try {
          const url = new URL(cleanUrl);
          setServerName(url.hostname);
        } catch {
          setServerName('My Server');
        }
      }

      // Saved only when the user confirms on the last step (commitServer):
      // leaving the wizard before that (Escape when changing server) keeps
      // the current server, its session and the app pointing at it
      setPendingServer({ name: serverName || new URL(cleanUrl).hostname || 'My Server', url: cleanUrl });
    }

    setActiveStep((prevStep) => prevStep + 1);
  };

  const handleBack = () => {
    setError('');
    setActiveStep((prevStep) => prevStep - 1);
  };

  /**
   * Make the tested server the active one, all at once with the reload that
   * onComplete does: storage never names a server the running app isn't
   * about to use.
   */
  const commitServer = (): boolean => {
    if (!pendingServer) return false;
    try {
      addOrActivateServer(pendingServer.name, pendingServer.url);
      // A session (refresh token) belongs to the server it came from
      clearTokens();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save server');
      return false;
    }
  };

  const handleFinish = () => {
    if (commitServer()) onComplete();
  };

  const handleSignInWithBrowser = () => {
    if (!commitServer()) return;
    // The login screen starts it once the app has reloaded onto this server
    requestBrowserLoginOnLoad();
    onComplete();
  };

  const renderStepContent = () => {
    switch (activeStep) {
      case 0:
        return (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography variant="h5" gutterBottom>
              Welcome to Semaphore Chat!
            </Typography>
            <Typography variant="body1" color="text.secondary" paragraph>
              Let's get you connected to a Semaphore Chat server.
            </Typography>
            <Typography variant="body2" color="text.secondary">
              You'll need the URL of your Semaphore Chat server to continue.
            </Typography>
          </Box>
        );

      case 1:
        return (
          <Box sx={{ py: 2 }}>
            <Typography variant="h6" gutterBottom>
              Enter Server Details
            </Typography>
            <TextField
              fullWidth
              label="Server URL"
              placeholder="https://chat.example.com"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              error={Boolean(error) && !testing}
              helperText={error && !testing ? error : 'Enter the full URL including https://'}
              sx={{ mb: 2 }}
              // eslint-disable-next-line jsx-a11y/no-autofocus -- first field of the wizard step the user just advanced to
              autoFocus
            />
            <TextField
              fullWidth
              label="Server Name (Optional)"
              placeholder="My Semaphore Chat Server"
              value={serverName}
              onChange={(e) => setServerName(e.target.value)}
              helperText="A friendly name to identify this server"
            />
            {testing && (
              <Box sx={{ display: 'flex', alignItems: 'center', mt: 2 }}>
                <CircularProgress size={20} sx={{ mr: 1 }} />
                <Typography variant="body2" color="text.secondary">
                  Testing connection...
                </Typography>
              </Box>
            )}
          </Box>
        );

      case 2:
        return (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography variant="h5" gutterBottom color="success.main">
              ✓ Connected Successfully!
            </Typography>
            {error && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {error}
              </Alert>
            )}
            <Alert severity="success" sx={{ mt: 2, mb: 2 }}>
              <Typography variant="body2">
                <strong>{serverName || 'Server'}</strong>
                <br />
                {serverUrl}
              </Typography>
            </Alert>
            <Typography variant="body2" color="text.secondary">
              {browserLoginSupported
                ? "You're all set! Sign in with your browser to use its password manager, or continue to sign in here."
                : "You're all set! Click finish to start using Semaphore Chat."}
            </Typography>
          </Box>
        );

      default:
        return null;
    }
  };

  return (
    <Dialog
      open={open}
      maxWidth="sm"
      fullWidth
      disableEscapeKeyDown={!onCancel}
      onClose={(_, reason) => {
        // First-run setup closes with the finish button only; changing
        // server can be abandoned with Escape
        if (onCancel && reason === 'escapeKeyDown') onCancel();
      }}
    >
      <DialogTitle>{onCancel ? 'Change Server' : 'Connect to Server'}</DialogTitle>
      <DialogContent>
        <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
          {steps.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {renderStepContent()}

        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 4 }}>
          {onCancel && activeStep < steps.length - 1 ? (
            <Button onClick={onCancel}>Cancel</Button>
          ) : (
            <Button
              disabled={activeStep === 0 || activeStep === steps.length - 1}
              onClick={handleBack}
            >
              Back
            </Button>
          )}
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {activeStep === steps.length - 1 ? (
              browserLoginSupported ? (
                <>
                  <Button variant="outlined" onClick={handleFinish}>
                    Sign in with password
                  </Button>
                  <Button
                    variant="contained"
                    startIcon={<OpenInBrowser />}
                    onClick={handleSignInWithBrowser}
                  >
                    Sign in with browser
                  </Button>
                </>
              ) : (
                <Button variant="contained" onClick={handleFinish}>
                  Finish
                </Button>
              )
            ) : (
              <Button
                variant="contained"
                onClick={handleNext}
                disabled={testing}
              >
                {activeStep === steps.length - 2 ? 'Connect' : 'Next'}
              </Button>
            )}
          </Box>
        </Box>
      </DialogContent>
    </Dialog>
  );
};
