import React, { useState } from "react";
import {
  Box,
  Tabs,
  Tab,
  Badge,
  Button,
  Typography,
} from "@mui/material";
import { PersonAdd as AddIcon } from "@mui/icons-material";
import { useQuery } from "@tanstack/react-query";
import {
  friendsControllerGetFriendsOptions,
  friendsControllerGetPendingRequestsOptions,
} from "../../api-client/@tanstack/react-query.gen";
import FriendList from "./FriendList";
import FriendRequestList from "./FriendRequestList";
import AddFriendDialog from "./AddFriendDialog";

interface FriendsPanelProps {
  onSelectDmGroup?: (dmGroupId: string) => void;
  compact?: boolean;
  /** Hide the "Friends" heading (the mobile app bar already shows it). */
  hideTitle?: boolean;
}

const FriendsPanel: React.FC<FriendsPanelProps> = ({
  onSelectDmGroup,
  compact = false,
  hideTitle = false,
}) => {
  const [tabValue, setTabValue] = useState<"all" | "pending">("all");
  const [showAddDialog, setShowAddDialog] = useState(false);

  const { data: friends } = useQuery(friendsControllerGetFriendsOptions());
  const { data: requests } = useQuery(friendsControllerGetPendingRequestsOptions());

  const friendsCount = friends?.length || 0;
  const pendingCount = (requests?.received.length || 0) + (requests?.sent.length || 0);
  const incomingCount = requests?.received.length || 0;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header with Add Friend button */}
      <Box
        sx={{
          p: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: hideTitle ? "flex-end" : "space-between",
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        {!hideTitle && <Typography variant="h6">Friends</Typography>}
        <Button
          variant="contained"
          size="small"
          startIcon={<AddIcon />}
          onClick={() => setShowAddDialog(true)}
        >
          Add Friend
        </Button>
      </Box>

      {/* Tabs */}
      <Tabs
        value={tabValue}
        onChange={(_, newValue) => setTabValue(newValue)}
        variant="fullWidth"
        sx={{ borderBottom: 1, borderColor: "divider" }}
      >
        <Tab label={`All (${friendsCount})`} value="all" />
        <Tab
          label={
            <Badge badgeContent={incomingCount} color="error">
              <Box sx={{ pr: incomingCount > 0 ? 2 : 0 }}>
                Pending ({pendingCount})
              </Box>
            </Badge>
          }
          value="pending"
        />
      </Tabs>

      {/* Content */}
      <Box sx={{ flex: 1, overflow: "auto" }}>
        {tabValue === "all" ? (
          <FriendList onSelectDmGroup={onSelectDmGroup} />
        ) : (
          <FriendRequestList compact={compact} />
        )}
      </Box>

      {/* Add Friend Dialog */}
      <AddFriendDialog
        open={showAddDialog}
        onClose={() => setShowAddDialog(false)}
      />
    </Box>
  );
};

export default FriendsPanel;
