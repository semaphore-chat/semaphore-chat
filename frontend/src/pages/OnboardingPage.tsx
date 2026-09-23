import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, CircularProgress, Alert } from '@mui/material';
import OnboardingWizard from '../components/Onboarding/OnboardingWizard';
import { useQuery } from '@tanstack/react-query';
import { onboardingControllerGetStatusOptions } from '../api-client/@tanstack/react-query.gen';

const OnboardingPage: React.FC = () => {
  const navigate = useNavigate();
  const { data: status, error, isLoading } = useQuery(onboardingControllerGetStatusOptions());

  const handleComplete = () => {
    // Redirect to home page (user should be logged in automatically)
    navigate('/', { replace: true });
  };

  if (isLoading) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: 'var(--full-dvh)',
        }}
      >
        <CircularProgress size={40} />
      </Box>
    );
  }

  if (error) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: 'var(--full-dvh)',
          p: 2,
        }}
      >
        <Alert severity="error" sx={{ maxWidth: 400 }}>
          Failed to load onboarding status. Please refresh the page or contact support.
        </Alert>
      </Box>
    );
  }

  if (!status?.needsSetup) {
    // Redirect to login if setup is not needed
    navigate('/login', { replace: true });
    return null;
  }

  if (!status.setupToken) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: 'var(--full-dvh)',
          p: 2,
        }}
      >
        <Alert severity="error" sx={{ maxWidth: 400 }}>
          Setup token is missing. Please refresh the page.
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: 'var(--full-dvh)', bgcolor: 'background.canvas' }}>
      <OnboardingWizard
        setupToken={status.setupToken}
        onComplete={handleComplete}
      />
    </Box>
  );
};

export default OnboardingPage;