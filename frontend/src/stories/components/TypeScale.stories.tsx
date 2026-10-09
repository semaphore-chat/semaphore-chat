import { Box, Divider, Typography } from '@mui/material';
import { defineComponent } from '../fixtures/componentStory';
import { bigCommunityScenario } from '../fixtures/scenarios';
import { TYPE_SCALE } from '../../theme/tokens';

const ROLES = [
  ['messageBody', 'Message text: 16px. The quick brown fox jumps over the lazy dog.'],
  ['listItem', 'Channel, member and DM names: 14px / 500'],
  ['meta', 'Timestamps, status lines, captions: 12px'],
  ['sectionLabel', 'Section labels: 12px / 700'],
] as const;

/**
 * The desktop type scale: the four chat type roles (Typography variants), then
 * every TYPE_SCALE step. Nothing renders text below 11px (`xs`); `2xs` is for
 * badge counters only.
 */
export const TypeScale = defineComponent(bigCommunityScenario, () => (
  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
    {ROLES.map(([variant, text]) => (
      <Box key={variant}>
        <Typography variant="meta" component="div" color="text.secondary">
          {variant}
        </Typography>
        <Typography variant={variant}>{text}</Typography>
      </Box>
    ))}
    <Divider />
    {Object.entries(TYPE_SCALE).map(([step, size]) => (
      <Box key={step} sx={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
        <Typography variant="meta" color="text.secondary" noWrap sx={{ width: 160, flexShrink: 0 }}>
          {`scale.${step} · ${size}`}
        </Typography>
        <Box sx={{ fontSize: `scale.${step}`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          Semaphore Chat
        </Box>
      </Box>
    ))}
  </Box>
));
