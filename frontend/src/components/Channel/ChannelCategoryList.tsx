import React, { useMemo, useState } from "react";
import {
  Box,
  Button,
  Typography,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Collapse,
  IconButton,
  Skeleton,
} from "@mui/material";
import {
  ExpandLess,
  ExpandMore,
  ErrorOutline as ErrorIcon,
  Refresh as RefreshIcon,
} from "@mui/icons-material";
import { ChannelType } from "../../types/channel.type";
import type { Channel } from "../../types/channel.type";
import { useCanPerformAction } from "../../features/roles/useUserPermissions";
import { TOUCH_TARGETS } from "../../utils/breakpoints";
import EmptyState from "../Common/EmptyState";
import CreateChannelDialog from "../Community/CreateChannelDialog";
import { ChannelRow } from "./ChannelRow";

interface ChannelCategoryListProps {
  channels: Channel[];
  communityId: string;
  onChannelSelect: (channelId: string) => void;
  selectedChannelId?: string;
  /** Denser category headers for the tablet sidebar */
  compact?: boolean;
  /** Channel query is loading (shows a skeleton instead of the empty state) */
  isLoading?: boolean;
  /** Channel query error (shows an error with retry when there's nothing to show) */
  error?: unknown;
  onRetry?: () => void;
}

const CATEGORY_TEXT = "Text Channels";
const CATEGORY_VOICE = "Voice Channels";

const ChannelListSkeleton: React.FC = () => (
  <Box data-testid="channel-list-skeleton" aria-busy="true" sx={{ px: 2, py: 1.5 }}>
    {[0, 1].map((section) => (
      <Box key={section} sx={{ mb: 2 }}>
        <Skeleton variant="text" width="40%" height={16} sx={{ mb: 1 }} />
        {Array.from({ length: section === 0 ? 6 : 2 }, (_, i) => (
          <Skeleton
            key={i}
            variant="rounded"
            height={TOUCH_TARGETS.MINIMUM - 8}
            sx={{ mb: 1 }}
          />
        ))}
      </Box>
    ))}
  </Box>
);

const ChannelListError: React.FC<{ onRetry?: () => void }> = ({ onRetry }) => (
  <Box
    role="alert"
    sx={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 1.5,
      px: 3,
      py: 6,
      textAlign: "center",
    }}
  >
    <ErrorIcon sx={{ fontSize: 40, color: "error.main" }} />
    <Typography variant="subtitle1" fontWeight={600}>
      Couldn't load channels
    </Typography>
    <Typography variant="body2" color="text.secondary">
      Check your connection and try again.
    </Typography>
    {onRetry && (
      <Button
        variant="outlined"
        startIcon={<RefreshIcon />}
        onClick={onRetry}
        sx={{ minHeight: TOUCH_TARGETS.MINIMUM, mt: 0.5 }}
      >
        Retry
      </Button>
    )}
  </Box>
);

/**
 * Shared channel list grouped into collapsible Text/Voice categories, built
 * from the same `ChannelRow` as the desktop sidebar (unread, mentions, lock,
 * voice participants). Sorts channels by position and renders the list states
 * (loading, error with retry, empty with "Create channel" for users who may
 * create channels). Used by MobileChannelsPanel and TabletSidebar.
 */
const ChannelCategoryList: React.FC<ChannelCategoryListProps> = ({
  channels,
  communityId,
  onChannelSelect,
  selectedChannelId,
  compact = false,
  isLoading = false,
  error,
  onRetry,
}) => {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set([CATEGORY_TEXT, CATEGORY_VOICE])
  );
  const [createOpen, setCreateOpen] = useState(false);
  const canCreateChannel = useCanPerformAction("COMMUNITY", communityId, "CREATE_CHANNEL");

  const { textChannels, voiceChannels } = useMemo(() => {
    const text = channels
      .filter((c) => c.type === ChannelType.TEXT)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

    const voice = channels
      .filter((c) => c.type === ChannelType.VOICE)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

    return { textChannels: text, voiceChannels: voice };
  }, [channels]);

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  if (channels.length === 0) {
    if (isLoading) return <ChannelListSkeleton />;
    if (error) return <ChannelListError onRetry={onRetry} />;

    return (
      <>
        <EmptyState
          variant="channels"
          title="No channels yet"
          description={
            canCreateChannel
              ? "Create a channel to start conversations."
              : "Channels will show up here once they're created."
          }
          action={
            canCreateChannel
              ? { label: "Create channel", onClick: () => setCreateOpen(true) }
              : undefined
          }
        />
        {canCreateChannel && (
          <CreateChannelDialog
            open={createOpen}
            onClose={() => setCreateOpen(false)}
            communityId={communityId}
          />
        )}
      </>
    );
  }

  const headerFontSize = compact ? "0.6875rem" : undefined;

  const renderCategory = (label: string, items: Channel[]) => {
    if (items.length === 0) return null;
    const expanded = expandedCategories.has(label);

    return (
      <React.Fragment key={label}>
        <ListItem
          disablePadding
          secondaryAction={
            <IconButton
              edge="end"
              size="small"
              onClick={() => toggleCategory(label)}
              aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
            >
              {expanded ? (
                <ExpandLess fontSize={compact ? "small" : "medium"} />
              ) : (
                <ExpandMore fontSize={compact ? "small" : "medium"} />
              )}
            </IconButton>
          }
        >
          <ListItemButton
            onClick={() => toggleCategory(label)}
            aria-expanded={expanded}
            sx={compact ? { py: 0.5 } : undefined}
          >
            <ListItemText
              primary={label.toUpperCase()}
              primaryTypographyProps={{
                variant: "caption",
                fontWeight: 700,
                color: "text.secondary",
                ...(headerFontSize ? { fontSize: headerFontSize } : {}),
              }}
            />
          </ListItemButton>
        </ListItem>

        <Collapse in={expanded} timeout="auto">
          <List component="div" disablePadding>
            {items.map((channel) => (
              <ChannelRow
                key={channel.id}
                channel={channel}
                communityId={communityId}
                selected={selectedChannelId === channel.id}
                variant="touch"
                onSelect={(c) => onChannelSelect(c.id)}
              />
            ))}
          </List>
        </Collapse>
      </React.Fragment>
    );
  };

  return (
    <List disablePadding={compact}>
      {renderCategory(CATEGORY_TEXT, textChannels)}
      {renderCategory(CATEGORY_VOICE, voiceChannels)}
    </List>
  );
};

export default ChannelCategoryList;
