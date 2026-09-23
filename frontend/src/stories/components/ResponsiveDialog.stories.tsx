import { DialogContent, DialogActions, Button, Typography } from '@mui/material';
import { ResponsiveDialog } from '../../components/Common/ResponsiveDialog';
import { defineComponent } from '../fixtures/componentStory';
import { bigCommunityScenario } from '../fixtures/scenarios';

/** Centered dialog on desktop, fullscreen slide-up sheet below the phone breakpoint. */
export const Example = defineComponent(
  bigCommunityScenario,
  () => (
    <ResponsiveDialog open title="Leave community?" onClose={() => {}}>
      <DialogContent>
        <Typography>You can rejoin later with a new invite. Any unread messages here will be marked as read.</Typography>
      </DialogContent>
      <DialogActions>
        <Button>Cancel</Button>
        <Button color="error">Leave</Button>
      </DialogActions>
    </ResponsiveDialog>
  ),
  { maxWidth: false },
);
