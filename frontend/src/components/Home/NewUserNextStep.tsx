import React from "react";
import { Box, Button, Paper, Typography } from "@mui/material";
import { Add as AddIcon, ChatBubbleOutline as ChatIcon, Groups as GroupsIcon } from "@mui/icons-material";
import { Link } from "react-router-dom";
import { useCanPerformAction } from "../../features/roles/useUserPermissions";
import { RBAC_ACTIONS } from "../../constants/rbacActions";
import { TOUCH_TARGETS } from "../../utils/breakpoints";

/**
 * The one next step for a user in no communities. Existing users can't redeem
 * an invite link (invites are registration codes), so the step is "Create a
 * community" when they may, else "ask an admin to add you".
 */
const NewUserNextStep: React.FC<{ fullWidth?: boolean }> = ({ fullWidth = false }) => {
  const canCreateCommunity = useCanPerformAction("INSTANCE", undefined, RBAC_ACTIONS.CREATE_COMMUNITY);

  return (
    <Paper
      variant="outlined"
      data-testid="new-user-next-step"
      sx={{
        p: { xs: 3, sm: 4 },
        borderRadius: 2,
        textAlign: "center",
        width: "100%",
        ...(!fullWidth && { maxWidth: 520, mx: "auto" }),
      }}
    >
      <GroupsIcon color="primary" sx={{ fontSize: "icon.3xl", mb: 1 }} />
      <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>
        You're not in any communities yet
      </Typography>
      {canCreateCommunity ? (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 3 }}>
            Communities hold your channels and voice rooms. Create one and invite people to it.
          </Typography>
          <Button component={Link} to="/community/create" variant="contained" startIcon={<AddIcon />} sx={{ minHeight: TOUCH_TARGETS.MINIMUM }}>
            Create a community
          </Button>
        </>
      ) : (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 3 }}>
            Ask an admin of this server to add you to a community. You can still send direct messages in the
            meantime.
          </Typography>
          <Box sx={{ display: "flex", justifyContent: "center" }}>
            <Button component={Link} to="/direct-messages" variant="outlined" startIcon={<ChatIcon />} sx={{ minHeight: TOUCH_TARGETS.MINIMUM }}>
              Message someone
            </Button>
          </Box>
        </>
      )}
    </Paper>
  );
};

export default NewUserNextStep;
