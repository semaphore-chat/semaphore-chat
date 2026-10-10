import React from "react";
import {
  Avatar,
  Box,
  Chip,
  List,
  ListItem,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Paper,
  Typography,
} from "@mui/material";
import {
  AlternateEmail as MentionIcon,
  Group as GroupIcon,
  VolumeUp as VoiceIcon,
} from "@mui/icons-material";
import { Link } from "react-router-dom";
import UserAvatar from "../Common/UserAvatar";
import { ErrorState, ListSkeleton } from "../Common/ListState";
import { getDmDisplayName, getDmOtherUser } from "../../utils/dmHelpers";
import type { HomeMention, HomeUnreadDm, HomeVoiceChannel } from "../../hooks/useHomeSummary";

const channelPath = (communityId: string, channelId: string) => `/community/${communityId}/channel/${channelId}`;

interface SectionProps {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  testId?: string;
}

export const HomeSection: React.FC<SectionProps> = ({ title, action, children, testId }) => (
  <Box component="section" aria-label={title} data-testid={testId}>
    <Box sx={{ display: "flex", alignItems: "baseline", mb: 1, gap: 2 }}>
      <Typography variant="subtitle2" component="h2" color="text.secondary" sx={{ flex: 1, fontWeight: 700 }}>
        {title}
      </Typography>
      {action}
    </Box>
    <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
      {children}
    </Paper>
  </Box>
);

export const SectionSkeleton: React.FC<{ label: string }> = ({ label }) => (
  <ListSkeleton rows={2} avatarSize={32} label={label} />
);

export const SectionError: React.FC<{ title: string; onRetry: () => void }> = ({ title, onRetry }) => (
  <ErrorState title={title} description="Check your connection and try again." onRetry={onRetry} size="compact" />
);

const CountChip: React.FC<{ label: string; ariaLabel: string; color?: "primary" | "error" }> = ({
  label,
  ariaLabel,
  color = "primary",
}) => <Chip size="small" color={color} label={label} aria-label={ariaLabel} sx={{ fontWeight: 700 }} />;

export const MentionList: React.FC<{ mentions: HomeMention[] }> = ({ mentions }) => (
  <List disablePadding>
    {mentions.map((m) => (
      <ListItem key={m.channelId} disablePadding>
        <ListItemButton component={Link} to={channelPath(m.communityId, m.channelId)}>
          <ListItemAvatar sx={{ minWidth: 48 }}>
            <Avatar sx={{ width: 32, height: 32, bgcolor: "action.selected", color: "text.primary" }}>
              <MentionIcon fontSize="small" />
            </Avatar>
          </ListItemAvatar>
          <ListItemText
            primary={`# ${m.channelName}`}
            secondary={m.communityName}
            primaryTypographyProps={{ noWrap: true, fontWeight: 600 }}
            secondaryTypographyProps={{ noWrap: true }}
          />
          <CountChip
            color="error"
            label={`@${m.mentionCount}`}
            ariaLabel={`${m.mentionCount} unread ${m.mentionCount === 1 ? "mention" : "mentions"}`}
          />
        </ListItemButton>
      </ListItem>
    ))}
  </List>
);

export const UnreadDmList: React.FC<{ dms: HomeUnreadDm[]; currentUserId?: string }> = ({ dms, currentUserId }) => (
  <List disablePadding>
    {dms.map(({ group, unreadCount }) => {
      const other = getDmOtherUser(group, currentUserId);
      const name = getDmDisplayName(group, currentUserId);
      const preview = group.lastMessage?.spans.find((s) => s.type === "PLAINTEXT")?.text || "New message";
      return (
        <ListItem key={group.id} disablePadding>
          <ListItemButton component={Link} to={`/direct-messages/${group.id}`}>
            <ListItemAvatar sx={{ minWidth: 48 }}>
              {other ? (
                <UserAvatar userId={other.id} displayName={other.displayName || other.username} size="small" />
              ) : (
                <Avatar sx={{ width: 32, height: 32 }}>
                  <GroupIcon fontSize="small" />
                </Avatar>
              )}
            </ListItemAvatar>
            <ListItemText
              primary={name}
              secondary={preview}
              primaryTypographyProps={{ noWrap: true, fontWeight: 600 }}
              secondaryTypographyProps={{ noWrap: true }}
            />
            <CountChip label={String(unreadCount)} ariaLabel={`${unreadCount} unread`} />
          </ListItemButton>
        </ListItem>
      );
    })}
  </List>
);

const MAX_VOICE_AVATARS = 4;

export const VoiceNowList: React.FC<{ channels: HomeVoiceChannel[] }> = ({ channels }) => (
  <List disablePadding>
    {channels.map((v) => {
      const extra = v.users.length - MAX_VOICE_AVATARS;
      const names = v.users.map((u) => u.displayName || u.username).join(", ");
      return (
        <ListItem key={v.channelId} disablePadding>
          <ListItemButton component={Link} to={channelPath(v.communityId, v.channelId)}>
            <ListItemAvatar sx={{ minWidth: 48 }}>
              <Avatar sx={{ width: 32, height: 32, bgcolor: "success.main" }}>
                <VoiceIcon fontSize="small" />
              </Avatar>
            </ListItemAvatar>
            <ListItemText
              primary={v.channelName}
              secondary={`${v.communityName} · ${names}`}
              primaryTypographyProps={{ noWrap: true, fontWeight: 600 }}
              secondaryTypographyProps={{ noWrap: true }}
              sx={{ minWidth: 0 }}
            />
            <Box
              aria-label={`${v.users.length} in voice`}
              sx={{ display: { xs: "none", sm: "flex" }, alignItems: "center", ml: 1, flexShrink: 0 }}
            >
              {v.users.slice(0, MAX_VOICE_AVATARS).map((u, i) => (
                <Box key={u.id} sx={{ ml: i === 0 ? 0 : -1, borderRadius: "50%", border: 2, borderColor: "background.paper" }}>
                  <UserAvatar userId={u.id} displayName={u.displayName || u.username} size="small" />
                </Box>
              ))}
              {extra > 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                  +{extra}
                </Typography>
              )}
            </Box>
          </ListItemButton>
        </ListItem>
      );
    })}
  </List>
);
