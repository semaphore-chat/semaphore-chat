import React, { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  Alert,
  CircularProgress,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  TextField,
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  Person as PersonIcon,
  Business as BusinessIcon,
  Groups as GroupsIcon,
} from '@mui/icons-material';
import { OnboardingData } from './OnboardingWizard';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { onboardingControllerSetupInstanceMutation, authControllerLoginMutation, onboardingControllerGetStatusQueryKey } from '../../api-client/@tanstack/react-query.gen';
import { logger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/format';
import { setAccessToken, storeElectronRefreshToken } from '../../utils/tokenService';

/** What the backend answers when the pasted setup token is wrong. */
const INVALID_SETUP_TOKEN_MESSAGE = 'Invalid setup token';

/**
 * The grep commands are copied whole, so each stays on one line and scrolls
 * sideways inside its own box on a phone instead of wrapping mid-word.
 */
const commandSx = {
  display: 'block',
  fontFamily: 'monospace',
  fontSize: '0.85em',
  whiteSpace: 'pre',
  overflowX: 'auto',
  maxWidth: '100%',
  mt: 0.5,
  px: 1,
  py: 0.75,
  borderRadius: 1,
  bgcolor: 'action.hover',
} as const;

/** Where the operator finds the token the backend printed at startup. */
const SetupTokenHint: React.FC = () => (
  <Alert severity="info" sx={{ mb: 2 }}>
    <strong>Where is my setup token?</strong> The backend prints it in its log,
    on a line containing{' '}
    <Box component="code" sx={{ whiteSpace: 'nowrap' }}>Setup token:</Box>
    <Box component="code" sx={commandSx}>
      docker compose logs backend | grep "Setup token:"
    </Box>
    <Box component="code" sx={commandSx}>
      kubectl logs -l app.kubernetes.io/component=backend --tail=-1 | grep "Setup token:"
    </Box>
    <Box sx={{ mt: 1 }}>
      If you set <code>SETUP_TOKEN</code> in the backend's environment, enter
      that value.
    </Box>
  </Alert>
);

interface CompletionStepProps {
  data: OnboardingData;
  updateData: (data: Partial<OnboardingData>) => void;
  onNext: () => void;
  onBack: () => void;
  onComplete: () => void;
}

const CompletionStep: React.FC<CompletionStepProps> = ({
  data,
  updateData,
  onBack,
  onComplete,
}) => {
  const queryClient = useQueryClient();
  const { mutateAsync: setupInstance, isPending: isLoading, error } = useMutation({
    ...onboardingControllerSetupInstanceMutation(),
  });
  const { mutateAsync: login } = useMutation(authControllerLoginMutation());
  const [isCompleted, setIsCompleted] = useState(false);

  const handleSetup = async () => {
    try {
      const result = await setupInstance({
        body: {
          adminUsername: data.adminUsername,
          adminPassword: data.adminPassword,
          adminEmail: data.adminEmail || undefined,
          instanceName: data.instanceName,
          instanceDescription: data.instanceDescription || undefined,
          defaultCommunityName: data.defaultCommunityName || undefined,
          createDefaultCommunity: data.createDefaultCommunity,
          setupToken: data.setupToken.trim(),
        },
      });

      if (result.success) {
        setIsCompleted(true);
        
        // Automatically login with the admin credentials
        try {
          const response = await login({
            body: { username: data.adminUsername, password: data.adminPassword },
          });

          // Store the tokens
          setAccessToken(response.accessToken);
          if (response.refreshToken) {
            await storeElectronRefreshToken(response.refreshToken);
          }
          
          // Give user a moment to see the success message, then redirect
          setTimeout(async () => {
            await queryClient.invalidateQueries({ queryKey: onboardingControllerGetStatusQueryKey() });
            onComplete();
          }, 2000);
        } catch (loginError) {
          logger.error('Auto-login failed:', loginError);
          // Still complete but redirect to login page
          setTimeout(async () => {
            await queryClient.invalidateQueries({ queryKey: onboardingControllerGetStatusQueryKey() });
            onComplete();
          }, 2000);
        }
      }
    } catch (err) {
      logger.error('Setup failed:', err);
    }
  };

  const errorMessage = error
    ? getErrorMessage(error, 'An unexpected error occurred. Please try again.')
    : null;
  const tokenMissing = data.setupTokenRequired && !data.setupToken.trim();

  if (isCompleted) {
    return (
      <Box sx={{ textAlign: 'center' }}>
        <CheckCircleIcon sx={{ fontSize: 'icon.6xl', color: 'success.main', mb: 2 }} />
        <Typography variant="h4" gutterBottom>
          🎉 Setup Complete!
        </Typography>
        <Typography variant="body1" sx={{ mb: 3 }}>
          Your Semaphore Chat instance is ready to use. Logging you in automatically...
        </Typography>
        <CircularProgress size={24} />
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ textAlign: 'center', mb: 4 }}>
        <Typography variant="h4" gutterBottom>
          Ready to Launch! 🚀
        </Typography>
        <Typography variant="body1" color="textSecondary">
          Review your configuration and complete the setup.
        </Typography>
      </Box>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Configuration Summary:
          </Typography>
          
          <List>
            <ListItem>
              <ListItemIcon>
                <PersonIcon color="primary" />
              </ListItemIcon>
              <ListItemText 
                primary="Admin Account" 
                secondary={`Username: ${data.adminUsername}${data.adminEmail ? ` • Email: ${data.adminEmail}` : ''}`}
              />
            </ListItem>
            
            <ListItem>
              <ListItemIcon>
                <BusinessIcon color="primary" />
              </ListItemIcon>
              <ListItemText 
                primary="Instance Configuration" 
                secondary={`Name: ${data.instanceName}${data.instanceDescription ? ` • ${data.instanceDescription}` : ''}`}
              />
            </ListItem>
            
            {data.createDefaultCommunity && (
              <ListItem>
                <ListItemIcon>
                  <GroupsIcon color="primary" />
                </ListItemIcon>
                <ListItemText 
                  primary="Default Community" 
                  secondary={`"${data.defaultCommunityName}" with #general, #announcements, and voice-chat channels`}
                />
              </ListItem>
            )}
          </List>
        </CardContent>
      </Card>

      {data.setupTokenRequired && (
        <Box sx={{ mb: 3 }}>
          <SetupTokenHint />
          <TextField
            label="Setup token"
            value={data.setupToken}
            onChange={(e) => updateData({ setupToken: e.target.value })}
            required
            fullWidth
            autoComplete="off"
            spellCheck={false}
            helperText="Proves you can see this server, so nobody else can set it up first"
            disabled={isLoading}
          />
        </Box>
      )}

      {errorMessage && (
        <Alert severity="error" sx={{ mb: 3 }}>
          <strong>Setup failed:</strong>{' '}
          {errorMessage === INVALID_SETUP_TOKEN_MESSAGE
            ? 'This setup token doesn\'t match the token in the backend log. Copy the value after "Setup token:" from the most recent line and try again.'
            : errorMessage}
        </Alert>
      )}

      <Alert severity="info" sx={{ mb: 3 }}>
        <strong>What happens next:</strong>
        <br />
        • Your admin account will be created with full permissions
        <br />
        • An invite code will be generated for adding more users
        <br />
        • You'll be redirected to login with your new credentials
      </Alert>

      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 4 }}>
        <Button onClick={onBack} variant="outlined" disabled={isLoading} sx={{ minHeight: 44 }}>
          Back
        </Button>
        <Button 
          onClick={handleSetup} 
          variant="contained" 
          size="large"
          sx={{ minHeight: 44 }}
          disabled={isLoading || tokenMissing}
          startIcon={isLoading ? <CircularProgress size={20} /> : <CheckCircleIcon />}
        >
          {isLoading ? 'Setting up...' : 'Complete Setup'}
        </Button>
      </Box>
    </Box>
  );
};

export default CompletionStep;