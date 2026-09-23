import React, { useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Card,
  CardContent,
} from '@mui/material';
import {
  Settings as SettingsIcon,
} from '@mui/icons-material';
import { OnboardingData } from './OnboardingWizard';

interface InstanceSetupStepProps {
  data: OnboardingData;
  updateData: (data: Partial<OnboardingData>) => void;
  onNext: () => void;
  onBack: () => void;
}

const InstanceSetupStep: React.FC<InstanceSetupStepProps> = ({
  data,
  updateData,
  onNext,
  onBack,
}) => {
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleChange = (field: keyof OnboardingData) => (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    updateData({ [field]: event.target.value });
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: '' }));
    }
  };

  const validateAndProceed = () => {
    const newErrors: Record<string, string> = {};

    if (!data.instanceName.trim()) {
      newErrors.instanceName = 'Instance name is required';
    } else if (data.instanceName.length < 1) {
      newErrors.instanceName = 'Instance name cannot be empty';
    }

    setErrors(newErrors);

    if (Object.keys(newErrors).length === 0) {
      onNext();
    }
  };

  return (
    <Box>
      <Box sx={{ textAlign: 'center', mb: 4 }}>
        <SettingsIcon sx={{ fontSize: 'icon.5xl', color: 'primary.main', mb: 2 }} />
        <Typography variant="h4" gutterBottom>
          Configure Your Instance
        </Typography>
        <Typography variant="body1" color="textSecondary">
          Set up the basic details for your Semaphore Chat instance.
        </Typography>
      </Box>

      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <TextField
              label="Instance Name"
              value={data.instanceName}
              onChange={handleChange('instanceName')}
              error={Boolean(errors.instanceName)}
              helperText={errors.instanceName || 'This will be the name of your chat platform (e.g., "Acme Corp Chat", "My Team Hub")'}
              required
              fullWidth
              placeholder="My Awesome Chat Platform"
            />

            <TextField
              label="Instance Description (Optional)"
              value={data.instanceDescription}
              onChange={handleChange('instanceDescription')}
              helperText="A brief description of your instance's purpose"
              fullWidth
              multiline
              rows={3}
              placeholder="Welcome to our team communication platform! Here we collaborate, share ideas, and stay connected."
            />
          </Box>
        </CardContent>
      </Card>

      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 4 }}>
        <Button onClick={onBack} variant="outlined">
          Back
        </Button>
        <Button onClick={validateAndProceed} variant="contained">
          Continue
        </Button>
      </Box>
    </Box>
  );
};

export default InstanceSetupStep;