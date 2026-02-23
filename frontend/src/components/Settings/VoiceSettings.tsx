import React from 'react';
import { Card, CardContent } from '@mui/material';
import AudioVideoSettingsPanel from './AudioVideoSettingsPanel';

const VoiceSettings: React.FC = () => (
  <Card sx={{ mb: 3 }}>
    <CardContent>
      <AudioVideoSettingsPanel />
    </CardContent>
  </Card>
);

export default VoiceSettings;
