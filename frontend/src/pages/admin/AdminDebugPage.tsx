import React, { useState, useCallback } from "react";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Divider,
  Alert,
  CircularProgress,
  Stack,
  Paper,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  ListSubheader,
} from "@mui/material";
import BugReportIcon from "@mui/icons-material/BugReport";
import SendIcon from "@mui/icons-material/Send";
import { useQuery } from "@tanstack/react-query";
import {
  userControllerGetProfileOptions,
  communityControllerFindAllMineOptions,
  channelsControllerFindAllForCommunityOptions,
  directMessagesControllerFindUserDmGroupsOptions,
} from "../../api-client/@tanstack/react-query.gen";
import { useDebugStatus, useDebugEmit } from "../../hooks/useDebugPanel";
import TypingEventForm from "../../components/admin/debug/TypingEventForm";
import GenericEventForm from "../../components/admin/debug/GenericEventForm";
import UserSearchAutocomplete, {
  type UserOption,
} from "../../components/Common/UserSearchAutocomplete";

// ---------------------------------------------------------------------------
// Event catalog — derived from shared/src/events/server-events.enum.ts
// Each entry knows which room type it targets, so the UI can auto-select.
// ---------------------------------------------------------------------------

type RoomTarget = "channel" | "dmGroup" | "user" | "community";

interface EventDef {
  value: string;
  label: string;
  category: string;
  roomTarget: RoomTarget;
  /** JSON template shown as placeholder so the admin knows what fields to fill */
  template: Record<string, unknown>;
}

const EVENT_CATALOG: EventDef[] = [
  // Presence & Typing
  {
    value: "userTyping",
    label: "User Typing",
    category: "Presence & Typing",
    roomTarget: "channel",
    template: { userId: "", channelId: "", isTyping: true },
  },
  {
    value: "userOnline",
    label: "User Online",
    category: "Presence & Typing",
    roomTarget: "user",
    template: { userId: "", username: "", displayName: null, avatarUrl: null },
  },
  {
    value: "userOffline",
    label: "User Offline",
    category: "Presence & Typing",
    roomTarget: "user",
    template: { userId: "", username: "", displayName: null, avatarUrl: null },
  },

  // Message Reactions
  {
    value: "reactionAdded",
    label: "Reaction Added",
    category: "Reactions",
    roomTarget: "channel",
    template: {
      messageId: "",
      reaction: { emoji: "", userId: "", username: "" },
      channelId: "",
    },
  },
  {
    value: "reactionRemoved",
    label: "Reaction Removed",
    category: "Reactions",
    roomTarget: "channel",
    template: {
      messageId: "",
      emoji: "",
      reactions: [],
      channelId: "",
    },
  },

  // Read Receipts
  {
    value: "readReceiptUpdated",
    label: "Read Receipt Updated",
    category: "Read Receipts",
    roomTarget: "channel",
    template: {
      channelId: "",
      lastReadMessageId: "",
      lastReadAt: new Date().toISOString(),
      userId: "",
      username: "",
    },
  },

  // Voice Channels
  {
    value: "voiceChannelUserJoined",
    label: "Voice User Joined",
    category: "Voice Channels",
    roomTarget: "channel",
    template: {
      channelId: "",
      user: { id: "", username: "", joinedAt: new Date().toISOString() },
    },
  },
  {
    value: "voiceChannelUserLeft",
    label: "Voice User Left",
    category: "Voice Channels",
    roomTarget: "channel",
    template: {
      channelId: "",
      userId: "",
      user: { id: "", username: "", joinedAt: new Date().toISOString() },
    },
  },

  // DM Voice Calls
  {
    value: "dmVoiceCallStarted",
    label: "DM Voice Call Started",
    category: "DM Voice",
    roomTarget: "dmGroup",
    template: {
      dmGroupId: "",
      startedBy: "",
      starter: { id: "", username: "" },
    },
  },
  {
    value: "dmVoiceUserJoined",
    label: "DM Voice User Joined",
    category: "DM Voice",
    roomTarget: "dmGroup",
    template: {
      dmGroupId: "",
      user: { id: "", username: "", joinedAt: new Date().toISOString() },
    },
  },
  {
    value: "dmVoiceUserLeft",
    label: "DM Voice User Left",
    category: "DM Voice",
    roomTarget: "dmGroup",
    template: {
      dmGroupId: "",
      userId: "",
      user: { id: "", username: "", joinedAt: new Date().toISOString() },
    },
  },

  // Moderation
  {
    value: "userBanned",
    label: "User Banned",
    category: "Moderation",
    roomTarget: "community",
    template: { communityId: "", userId: "", moderatorId: "", reason: "" },
  },
  {
    value: "userKicked",
    label: "User Kicked",
    category: "Moderation",
    roomTarget: "community",
    template: { communityId: "", userId: "", moderatorId: "", reason: "" },
  },
  {
    value: "userTimedOut",
    label: "User Timed Out",
    category: "Moderation",
    roomTarget: "community",
    template: {
      communityId: "",
      userId: "",
      moderatorId: "",
      durationSeconds: 300,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    },
  },
  {
    value: "timeoutRemoved",
    label: "Timeout Removed",
    category: "Moderation",
    roomTarget: "community",
    template: { communityId: "", userId: "", moderatorId: "" },
  },
  {
    value: "messagePinned",
    label: "Message Pinned",
    category: "Moderation",
    roomTarget: "channel",
    template: {
      messageId: "",
      channelId: "",
      pinnedBy: "",
      pinnedAt: new Date().toISOString(),
    },
  },
  {
    value: "messageUnpinned",
    label: "Message Unpinned",
    category: "Moderation",
    roomTarget: "channel",
    template: { messageId: "", channelId: "", unpinnedBy: "" },
  },

  // Channel Lifecycle
  {
    value: "channelCreated",
    label: "Channel Created",
    category: "Channel Lifecycle",
    roomTarget: "community",
    template: {
      communityId: "",
      channel: { id: "", name: "", type: "TEXT", communityId: "" },
    },
  },
  {
    value: "channelUpdated",
    label: "Channel Updated",
    category: "Channel Lifecycle",
    roomTarget: "community",
    template: {
      communityId: "",
      channel: { id: "", name: "", type: "TEXT", communityId: "" },
    },
  },
  {
    value: "channelDeleted",
    label: "Channel Deleted",
    category: "Channel Lifecycle",
    roomTarget: "community",
    template: { communityId: "", channelId: "" },
  },

  // Community Lifecycle
  {
    value: "communityUpdated",
    label: "Community Updated",
    category: "Community Lifecycle",
    roomTarget: "community",
    template: { communityId: "", name: "" },
  },
  {
    value: "communityDeleted",
    label: "Community Deleted",
    category: "Community Lifecycle",
    roomTarget: "community",
    template: { communityId: "" },
  },

  // Role Management
  {
    value: "roleCreated",
    label: "Role Created",
    category: "Role Management",
    roomTarget: "community",
    template: { communityId: "", roleId: "", roleName: "" },
  },
  {
    value: "roleUpdated",
    label: "Role Updated",
    category: "Role Management",
    roomTarget: "community",
    template: { communityId: "", roleId: "", roleName: "" },
  },
  {
    value: "roleDeleted",
    label: "Role Deleted",
    category: "Role Management",
    roomTarget: "community",
    template: { communityId: "", roleId: "" },
  },
  {
    value: "roleAssigned",
    label: "Role Assigned",
    category: "Role Management",
    roomTarget: "community",
    template: { communityId: "", userId: "", roleId: "", roleName: "" },
  },
  {
    value: "roleUnassigned",
    label: "Role Unassigned",
    category: "Role Management",
    roomTarget: "community",
    template: { communityId: "", userId: "", roleId: "" },
  },

  // Threads
  {
    value: "threadReplyCountUpdated",
    label: "Thread Reply Count Updated",
    category: "Threads",
    roomTarget: "channel",
    template: {
      parentMessageId: "",
      replyCount: 1,
      lastReplyAt: new Date().toISOString(),
      channelId: "",
    },
  },

  // User Profile
  {
    value: "userProfileUpdated",
    label: "User Profile Updated",
    category: "User Profile",
    roomTarget: "user",
    template: { userId: "", displayName: "", avatarUrl: null },
  },

  // Notifications
  {
    value: "newNotification",
    label: "New Notification",
    category: "Notifications",
    roomTarget: "user",
    template: {
      id: "",
      type: "MENTION",
      read: false,
      communityId: "",
      channelId: "",
      messageId: "",
      actorId: "",
      actorUsername: "",
      createdAt: new Date().toISOString(),
    },
  },

  // Membership
  {
    value: "memberAddedToCommunity",
    label: "Member Added to Community",
    category: "Community Membership",
    roomTarget: "user",
    template: { communityId: "", userId: "" },
  },
];

// Build grouped menu items for the Select dropdown
function buildGroupedMenuItems(): React.ReactNode[] {
  const items: React.ReactNode[] = [];
  let lastCategory = "";
  for (const evt of EVENT_CATALOG) {
    if (evt.category !== lastCategory) {
      items.push(
        <ListSubheader key={`header-${evt.category}`}>
          {evt.category}
        </ListSubheader>
      );
      lastCategory = evt.category;
    }
    items.push(
      <MenuItem key={evt.value} value={evt.value}>
        {evt.label}
      </MenuItem>
    );
  }
  return items;
}

const GROUPED_ITEMS = buildGroupedMenuItems();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOM_TARGET_LABELS: Record<RoomTarget, string> = {
  channel: "Channel",
  dmGroup: "DM Group",
  user: "User",
  community: "Community",
};

interface TestResult {
  timestamp: string;
  message: string;
  success: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const AdminDebugPage: React.FC = () => {
  const { data: profile, isLoading: isLoadingProfile } = useQuery(
    userControllerGetProfileOptions()
  );
  const { isEnabled, isLoading: isLoadingStatus, isUnavailable } =
    useDebugStatus();
  const { mutateAsync: emitEvent, isPending: isEmitting } = useDebugEmit();

  // Event selection
  const [selectedEvent, setSelectedEvent] = useState("userTyping");
  const eventDef = EVENT_CATALOG.find((e) => e.value === selectedEvent)!;

  // Target selectors (for channel / community / dmGroup resolution)
  const [communityId, setCommunityId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [dmGroupId, setDmGroupId] = useState("");
  const [targetUser, setTargetUser] = useState<UserOption | null>(null);

  // Typing-specific form
  const [typingState, setTypingState] = useState<{
    user: UserOption | null;
    isTyping: boolean;
  }>({ user: null, isTyping: true });

  // Payload editor (pre-populated from template)
  const [payloadJson, setPayloadJson] = useState(
    JSON.stringify(eventDef.template, null, 2)
  );
  const [jsonError, setJsonError] = useState<string | null>(null);

  // Results log
  const [testResults, setTestResults] = useState<TestResult[]>([]);

  // Data queries
  const { data: communities } = useQuery({
    ...communityControllerFindAllMineOptions(),
    enabled:
      eventDef.roomTarget === "channel" ||
      eventDef.roomTarget === "community",
  });

  const { data: channels } = useQuery({
    ...channelsControllerFindAllForCommunityOptions({
      path: { communityId },
    }),
    enabled: eventDef.roomTarget === "channel" && !!communityId,
  });

  const { data: dmGroups } = useQuery({
    ...directMessagesControllerFindUserDmGroupsOptions(),
    enabled: eventDef.roomTarget === "dmGroup",
  });

  const addResult = useCallback(
    (message: string, success: boolean = true) => {
      const timestamp = new Date().toLocaleTimeString();
      setTestResults((prev) => [
        { timestamp, message, success },
        ...prev.slice(0, 19),
      ]);
    },
    []
  );

  // When event changes, reset payload to template and clear target
  const handleEventChange = (value: string) => {
    const def = EVENT_CATALOG.find((e) => e.value === value);
    if (!def) return;
    setSelectedEvent(value);
    setPayloadJson(JSON.stringify(def.template, null, 2));
    setJsonError(null);
    // Reset targets when room type changes
    if (def.roomTarget !== eventDef.roomTarget) {
      setCommunityId("");
      setChannelId("");
      setDmGroupId("");
      setTargetUser(null);
    }
  };

  // Loading / access checks
  if (isLoadingProfile || isLoadingStatus) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (profile?.role !== "OWNER") {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="error">
          This debug panel is only accessible to instance owners.
        </Alert>
      </Box>
    );
  }

  if (isUnavailable || !isEnabled) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="warning">
          Debug panel is not enabled. Set <code>ADMIN_DEBUG_PANEL=true</code> in
          your backend environment and restart.
        </Alert>
      </Box>
    );
  }

  const getRoomId = (): string | null => {
    switch (eventDef.roomTarget) {
      case "channel":
        return channelId || null;
      case "dmGroup":
        return dmGroupId || null;
      case "community":
        return communityId || null;
      case "user":
        return targetUser?.id || null;
    }
  };

  const buildPayload = (): Record<string, unknown> | null => {
    // Special form for typing
    if (selectedEvent === "userTyping") {
      if (!typingState.user) return null;
      return {
        userId: typingState.user.id,
        username: typingState.user.username,
        ...(eventDef.roomTarget === "channel"
          ? { channelId }
          : { directMessageGroupId: dmGroupId }),
        isTyping: typingState.isTyping,
      };
    }

    // Parse JSON for all other events
    try {
      const parsed = JSON.parse(payloadJson);
      setJsonError(null);
      return parsed;
    } catch {
      setJsonError("Invalid JSON");
      return null;
    }
  };

  const handleEmit = async () => {
    const roomId = getRoomId();
    if (!roomId) {
      addResult(
        `Missing target: select a ${ROOM_TARGET_LABELS[eventDef.roomTarget]}`,
        false
      );
      return;
    }

    const payload = buildPayload();
    if (!payload) {
      addResult("Invalid or incomplete payload", false);
      return;
    }

    try {
      const result = await emitEvent({
        event: selectedEvent,
        roomType: eventDef.roomTarget,
        roomId,
        payload,
      });
      addResult(
        `Emitted "${selectedEvent}" to ${result.room} (success: ${result.success})`,
        result.success
      );
    } catch (error) {
      addResult(`Failed to emit: ${error}`, false);
    }
  };

  // ---------------------------------------------------------------------------
  // Target picker — adapts to the selected event's room target
  // ---------------------------------------------------------------------------
  const renderTargetPicker = () => {
    switch (eventDef.roomTarget) {
      case "channel":
        return (
          <Stack spacing={2}>
            <FormControl fullWidth size="small">
              <InputLabel>Community</InputLabel>
              <Select
                value={communityId}
                label="Community"
                onChange={(e) => {
                  setCommunityId(e.target.value);
                  setChannelId("");
                }}
              >
                {(communities ?? []).map((c: any) => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small" disabled={!communityId}>
              <InputLabel>Channel</InputLabel>
              <Select
                value={channelId}
                label="Channel"
                onChange={(e) => setChannelId(e.target.value)}
              >
                {(channels ?? []).map((ch: any) => (
                  <MenuItem key={ch.id} value={ch.id}>
                    #{ch.name} ({ch.type})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
        );

      case "dmGroup":
        return (
          <FormControl fullWidth size="small">
            <InputLabel>DM Group</InputLabel>
            <Select
              value={dmGroupId}
              label="DM Group"
              onChange={(e) => setDmGroupId(e.target.value)}
            >
              {(dmGroups ?? []).map((dm: any) => (
                <MenuItem key={dm.id} value={dm.id}>
                  {dm.members
                    ?.map((m: any) => m.user?.username ?? m.userId)
                    .join(", ") || dm.id}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        );

      case "community":
        return (
          <FormControl fullWidth size="small">
            <InputLabel>Community</InputLabel>
            <Select
              value={communityId}
              label="Community"
              onChange={(e) => setCommunityId(e.target.value)}
            >
              {(communities ?? []).map((c: any) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        );

      case "user":
        return (
          <UserSearchAutocomplete
            value={targetUser}
            onChange={(u) => setTargetUser(u as UserOption | null)}
            label="Target User"
            placeholder="Search for a user..."
            excludeCurrentUser={false}
          />
        );
    }
  };

  return (
    <Box sx={{ p: 4, maxWidth: 900, mx: "auto" }}>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 3 }}>
        <BugReportIcon sx={{ fontSize: 40 }} />
        <Typography variant="h4">WebSocket Debug Panel</Typography>
      </Stack>

      <Alert severity="info" sx={{ mb: 3 }}>
        Emit server-side WebSocket events to test how the frontend renders
        events from other users.
      </Alert>

      {/* Event selector */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Event
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <FormControl fullWidth size="small">
            <InputLabel>Server Event</InputLabel>
            <Select
              value={selectedEvent}
              label="Server Event"
              onChange={(e) => handleEventChange(e.target.value)}
            >
              {GROUPED_ITEMS}
            </Select>
          </FormControl>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
            Room target: <strong>{ROOM_TARGET_LABELS[eventDef.roomTarget]}</strong>
          </Typography>
        </CardContent>
      </Card>

      {/* Target picker */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Target ({ROOM_TARGET_LABELS[eventDef.roomTarget]})
          </Typography>
          <Divider sx={{ mb: 2 }} />
          {renderTargetPicker()}
        </CardContent>
      </Card>

      {/* Payload */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Payload
          </Typography>
          <Divider sx={{ mb: 2 }} />

          {selectedEvent === "userTyping" ? (
            <TypingEventForm value={typingState} onChange={setTypingState} />
          ) : (
            <GenericEventForm
              value={payloadJson}
              onChange={(v) => {
                setPayloadJson(v);
                setJsonError(null);
              }}
              error={jsonError}
            />
          )}
        </CardContent>
      </Card>

      {/* Emit */}
      <Button
        variant="contained"
        size="large"
        fullWidth
        onClick={handleEmit}
        disabled={isEmitting}
        startIcon={
          isEmitting ? <CircularProgress size={20} /> : <SendIcon />
        }
        sx={{ mb: 3 }}
      >
        Emit Event
      </Button>

      {/* Results log */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Results Log
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <Paper
            variant="outlined"
            sx={{
              maxHeight: 300,
              overflow: "auto",
              p: 2,
              bgcolor: "background.default",
            }}
          >
            {testResults.length ? (
              testResults.map((result, i) => (
                <Typography
                  key={i}
                  variant="body2"
                  sx={{
                    mb: 0.5,
                    fontFamily: "monospace",
                    fontSize: 12,
                    color: result.success ? "success.main" : "error.main",
                  }}
                >
                  [{result.timestamp}] {result.message}
                </Typography>
              ))
            ) : (
              <Typography color="text.secondary" variant="body2">
                No results yet. Select an event, pick a target, and click Emit.
              </Typography>
            )}
          </Paper>
        </CardContent>
      </Card>
    </Box>
  );
};

export default AdminDebugPage;
