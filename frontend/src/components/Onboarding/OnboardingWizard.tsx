import React, { useState } from 'react';
import {
  Box,
  Stepper,
  Step,
  StepLabel,
  Paper,
  Container,
  Typography,
} from '@mui/material';
import WelcomeStep from './WelcomeStep';
import AdminSetupStep from './AdminSetupStep';
import InstanceSetupStep from './InstanceSetupStep';
import CommunitySetupStep from './CommunitySetupStep';
import CompletionStep from './CompletionStep';

export interface OnboardingData {
  adminUsername: string;
  adminPassword: string;
  adminEmail: string;
  instanceName: string;
  instanceDescription: string;
  defaultCommunityName: string;
  createDefaultCommunity: boolean;
  setupToken: string;
  /**
   * The operator must paste the setup token from the backend log (the
   * default, REQUIRE_SETUP_TOKEN); the server never sends it.
   */
  setupTokenRequired: boolean;
}

const steps = [
  'Welcome',
  'Admin Account',
  'Instance Setup',
  'Community Setup',
  'Complete',
];

interface OnboardingWizardProps {
  /** Only sent by servers with REQUIRE_SETUP_TOKEN=false */
  setupToken?: string;
  setupTokenRequired: boolean;
  onComplete: () => void;
}

const OnboardingWizard: React.FC<OnboardingWizardProps> = ({
  setupToken,
  setupTokenRequired,
  onComplete,
}) => {
  const [activeStep, setActiveStep] = useState(0);
  const [onboardingData, setOnboardingData] = useState<OnboardingData>({
    adminUsername: '',
    adminPassword: '',
    adminEmail: '',
    instanceName: '',
    instanceDescription: '',
    defaultCommunityName: 'General',
    createDefaultCommunity: true,
    setupToken: setupToken ?? '',
    setupTokenRequired,
  });

  const handleNext = () => {
    setActiveStep((prevStep) => prevStep + 1);
  };

  const handleBack = () => {
    setActiveStep((prevStep) => prevStep - 1);
  };

  const updateOnboardingData = (data: Partial<OnboardingData>) => {
    setOnboardingData((prev) => ({ ...prev, ...data }));
  };

  const renderStepContent = (step: number) => {
    const commonProps = {
      data: onboardingData,
      updateData: updateOnboardingData,
      onNext: handleNext,
      onBack: handleBack,
    };

    switch (step) {
      case 0:
        return <WelcomeStep {...commonProps} />;
      case 1:
        return <AdminSetupStep {...commonProps} />;
      case 2:
        return <InstanceSetupStep {...commonProps} />;
      case 3:
        return <CommunitySetupStep {...commonProps} />;
      case 4:
        return <CompletionStep {...commonProps} onComplete={onComplete} />;
      default:
        return <div>Unknown step</div>;
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Paper elevation={3} sx={{ p: 4, minHeight: '600px' }}>
        <Typography variant="h3" component="h1" gutterBottom align="center">
          Welcome to Semaphore Chat
        </Typography>
        <Typography variant="h6" color="textSecondary" align="center" sx={{ mb: 4 }}>
          Let's set up your new chat instance
        </Typography>

        <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
          {steps.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        <Box sx={{ minHeight: '400px' }}>
          {renderStepContent(activeStep)}
        </Box>
      </Paper>
    </Container>
  );
};

export default OnboardingWizard;