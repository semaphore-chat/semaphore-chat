import React, { useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Card,
  CardContent,
  FormControlLabel,
  Switch,
  Alert,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import {
  Groups as GroupsIcon,
  Tag as TagIcon,
  VolumeUp as VoiceIcon,
  Announcement as AnnouncementIcon,
} from '@mui/icons-material';
import { OnboardingData } from './OnboardingWizard';

interface CommunitySetupStepProps {
  data: OnboardingData;
  updateData: (data: Partial<OnboardingData>) => void;
  onNext: () => void;
  onBack: () => void;
}

const CommunitySetupStep: React.FC<CommunitySetupStepProps> = ({
  data,
  updateData,
  onNext,
  onBack,
}) => {
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleChange = (field: keyof OnboardingData) => (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    updateData({ [field]: value });
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: '' }));
    }
  };

  const validateAndProceed = () => {
    const newErrors: Record<string, string> = {};

    if (data.createDefaultCommunity && !data.defaultCommunityName.trim()) {
      newErrors.defaultCommunityName = 'Community name is required when creating a default community';
    }

    setErrors(newErrors);

    if (Object.keys(newErrors).length === 0) {
      onNext();
    }
  };

  return (
    <Box>
      <Box sx={{ textAlign: 'center', mb: 4 }}>
        <GroupsIcon sx={{ fontSize: 'icon.5xl', color: 'primary.main', mb: 2 }} />
        <Typography variant="h4" gutterBottom>
          Create Your First Community
        </Typography>
        <Typography variant="body1" color="textSecondary">
          Communities are like servers - they contain channels where your team can chat.
        </Typography>
      </Box>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <FormControlLabel
            control={
              <Switch
                checked={data.createDefaultCommunity}
                onChange={handleChange('createDefaultCommunity')}
                color="primary"
              />
            }
            label="Create a default community"
            sx={{ mb: 2 }}
          />

          {data.createDefaultCommunity && (
            <Box sx={{ ml: 4 }}>
              <TextField
                label="Community Name"
                value={data.defaultCommunityName}
                onChange={handleChange('defaultCommunityName')}
                error={Boolean(errors.defaultCommunityName)}
                helperText={errors.defaultCommunityName || 'This will be your main community where team members gather'}
                fullWidth
                sx={{ mb: 2 }}
                placeholder="General"
              />

              <Alert severity="info" sx={{ mb: 2 }}>
                <strong>Default channels will be created:</strong>
              </Alert>

              <List dense>
                <ListItem>
                  <ListItemIcon>
                    <TagIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText 
                    primary="#general" 
                    secondary="Main text channel for general discussion"
                  />
                </ListItem>
                <ListItem>
                  <ListItemIcon>
                    <AnnouncementIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText 
                    primary="#announcements" 
                    secondary="Important updates and notifications"
                  />
                </ListItem>
                <ListItem>
                  <ListItemIcon>
                    <VoiceIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText 
                    primary="🎙️ voice-chat" 
                    secondary="Voice and video calls"
                  />
                </ListItem>
              </List>
            </Box>
          )}

          {!data.createDefaultCommunity && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              You can create communities and channels later from the main interface.
            </Alert>
          )}
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

export default CommunitySetupStep;