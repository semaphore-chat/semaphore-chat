import React, { useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Card,
  CardContent,
  Alert,
  InputAdornment,
  IconButton,
} from '@mui/material';
import {
  Visibility,
  VisibilityOff,
  AdminPanelSettings as AdminIcon,
} from '@mui/icons-material';
import { OnboardingData } from './OnboardingWizard';

interface AdminSetupStepProps {
  data: OnboardingData;
  updateData: (data: Partial<OnboardingData>) => void;
  onNext: () => void;
  onBack: () => void;
}

const AdminSetupStep: React.FC<AdminSetupStepProps> = ({
  data,
  updateData,
  onNext,
  onBack,
}) => {
  const [showPassword, setShowPassword] = useState(false);
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

    if (!data.adminUsername.trim()) {
      newErrors.adminUsername = 'Username is required';
    } else if (data.adminUsername.length < 3) {
      newErrors.adminUsername = 'Username must be at least 3 characters';
    } else if (!/^[a-zA-Z0-9_-]+$/.test(data.adminUsername)) {
      newErrors.adminUsername = 'Username can only contain letters, numbers, underscores, and hyphens';
    }

    if (!data.adminPassword.trim()) {
      newErrors.adminPassword = 'Password is required';
    } else if (data.adminPassword.length < 6) {
      newErrors.adminPassword = 'Password must be at least 6 characters';
    }

    if (data.adminEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.adminEmail)) {
      newErrors.adminEmail = 'Please enter a valid email address';
    }

    setErrors(newErrors);

    if (Object.keys(newErrors).length === 0) {
      onNext();
    }
  };

  return (
    <Box>
      <Box sx={{ textAlign: 'center', mb: 4 }}>
        <AdminIcon sx={{ fontSize: 'icon.5xl', color: 'primary.main', mb: 2 }} />
        <Typography variant="h4" gutterBottom>
          Create Your Admin Account
        </Typography>
        <Typography variant="body1" color="textSecondary">
          This account will have full administrative privileges on your Semaphore Chat instance.
        </Typography>
      </Box>

      <Card>
        <CardContent>
          <Alert severity="info" sx={{ mb: 3 }}>
            <strong>Administrator privileges:</strong> This account will be able to manage 
            all communities, users, and instance settings. Choose your credentials carefully.
          </Alert>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <TextField
              label="Admin Username"
              value={data.adminUsername}
              onChange={handleChange('adminUsername')}
              error={Boolean(errors.adminUsername)}
              helperText={errors.adminUsername || 'This will be your login username'}
              required
              fullWidth
              autoComplete="username"
            />

            <TextField
              label="Password"
              type={showPassword ? 'text' : 'password'}
              value={data.adminPassword}
              onChange={handleChange('adminPassword')}
              error={Boolean(errors.adminPassword)}
              helperText={errors.adminPassword || 'Use a strong password to secure your account'}
              required
              fullWidth
              autoComplete="new-password"
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      onClick={() => setShowPassword(!showPassword)}
                      edge="end"
                    >
                      {showPassword ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />

            <TextField
              label="Email Address (Optional)"
              type="email"
              value={data.adminEmail}
              onChange={handleChange('adminEmail')}
              error={Boolean(errors.adminEmail)}
              helperText={errors.adminEmail || 'For password recovery and notifications'}
              fullWidth
              autoComplete="email"
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

export default AdminSetupStep;