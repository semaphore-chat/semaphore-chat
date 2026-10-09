import React, { useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { Check, Link as LinkIcon, VolumeUp } from '@mui/icons-material';
import { copyToClipboard } from '../../utils/clipboard';
import { voiceChannelLink } from '../../utils/voiceChannelLink';
import { logger } from '../../utils/logger';

interface SoloCallPanelProps {
  /** Channel name, or the DM call's name. */
  title: string;
  /** Community channel to link to; omitted for DM calls (no link to share). */
  channelLink?: { communityId: string; channelId: string };
  /** Your own tile, shown as a corner thumbnail. */
  thumbnail?: React.ReactNode;
  /** Phone: smaller type and thumbnail; the thumbnail hides when short on height. */
  compact?: boolean;
}

/**
 * The stage when you're the only one in the call: says so, offers the
 * channel link to share, and shrinks your own tile to a corner thumbnail
 * instead of one full-screen tile of your own initial.
 */
export const SoloCallPanel: React.FC<SoloCallPanelProps> = ({ title, channelLink, thumbnail, compact = false }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!channelLink) return;
    try {
      await copyToClipboard(voiceChannelLink(channelLink.communityId, channelLink.channelId));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      logger.error('Failed to copy channel link:', error);
    }
  };

  return (
    <Box
      data-testid="solo-call-panel"
      sx={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}
    >
      <Box
        sx={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: compact ? 1 : 1.5,
          px: 2,
          textAlign: 'center',
        }}
      >
        <Typography variant={compact ? 'h6' : 'h5'} component="p" sx={{ color: 'grey.100', fontWeight: 600 }}>
          {channelLink ? "You're the only one here" : 'Waiting for others to join…'}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: 'grey.400', minWidth: 0, maxWidth: '100%' }}>
          <VolumeUp fontSize="small" sx={{ flexShrink: 0 }} />
          <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
            {title}
          </Typography>
        </Box>
        {channelLink && (
          <Button
            variant="outlined"
            startIcon={copied ? <Check /> : <LinkIcon />}
            onClick={handleCopy}
            sx={{ mt: 1, minHeight: 44 }}
          >
            {copied ? 'Link copied' : 'Copy channel link'}
          </Button>
        )}
      </Box>
      {thumbnail && (
        <Box
          data-testid="solo-call-thumbnail"
          sx={{
            position: 'absolute',
            right: compact ? 8 : 16,
            bottom: compact ? 8 : 16,
            width: compact ? 128 : 240,
            height: compact ? 96 : 150,
            borderRadius: 1,
            overflow: 'hidden',
            boxShadow: 6,
            // Phone in landscape (or a short window): no room for it.
            ...(compact && { '@media (max-height: 480px)': { display: 'none' } }),
          }}
        >
          {thumbnail}
        </Box>
      )}
    </Box>
  );
};

export default SoloCallPanel;
