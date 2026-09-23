/**
 * ChannelRow
 *
 * The one channel row used by every channel list: the desktop sidebar
 * (`Channel`), the phone channel screen and the tablet sidebar
 * (`ChannelCategoryList`). It renders the unread pill and bold name, the
 * mention badge (from `useReadReceipts`), a lock for private channels and the
 * participants nested under voice channels.
 *
 * `variant="touch"` gives a 44px minimum row height and slightly larger type
 * for touch layouts; `variant="desktop"` keeps the compact sidebar sizing.
 *
 * Clicking a row runs the desktop behaviour by default (navigate to text
 * channels; join, or maximise, voice channels). Mobile and tablet lists pass
 * `onSelect` to route through their own navigation instead.
 */
import { useCallback } from "react";
import { Badge, Box, alpha } from "@mui/material";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import TagIcon from "@mui/icons-material/Tag";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import LockIcon from "@mui/icons-material/Lock";
import { styled } from "@mui/material/styles";
import type { ListItemButtonProps } from "@mui/material/ListItemButton";
import { useNavigate } from "react-router-dom";
import {
  Channel as ChannelType,
  ChannelType as ChannelKind,
} from "../../types/channel.type";
// Direct path, not the ../Voice barrel: the barrel also re-exports VideoTiles
// (runtime livekit-client), and this row is statically reachable from the
// always-mounted mobile layout — the barrel would drag livekit into the entry.
import { VoiceChannelUserList } from "../Voice/VoiceChannelUserList";
import { useVoiceConnection } from "../../hooks/useVoiceConnection";
import { useNotification } from "../../contexts/NotificationContext";
import { useReadReceipts } from "../../hooks/useReadReceipts";
import { logger } from "../../utils/logger";
import { playSound, Sounds } from "../../hooks/useSound";
import { TOUCH_TARGETS } from "../../utils/breakpoints";

export type ChannelRowVariant = "desktop" | "touch";

export interface ChannelRowProps {
  channel: ChannelType;
  communityId: string;
  selected: boolean;
  variant: ChannelRowVariant;
  /** Overrides the default desktop click behaviour (navigate / join voice). */
  onSelect?: (channel: ChannelType) => void;
}

interface RowContainerProps extends ListItemButtonProps {
  rowVariant: ChannelRowVariant;
}

const RowContainer = styled(ListItemButton, {
  shouldForwardProp: (prop) => prop !== "rowVariant",
})<RowContainerProps>(({ theme, rowVariant }) => {
  const isDark = theme.palette.mode === "dark";
  const selectedBg = alpha(theme.palette.primary.main, isDark ? 0.2 : 0.12);
  const selectedHoverBg = alpha(theme.palette.primary.main, isDark ? 0.25 : 0.15);
  const touch = rowVariant === "touch";

  return {
    padding: touch ? theme.spacing(1, 1.5, 1, 2) : theme.spacing(0.75, 1.5, 0.75, 2),
    marginLeft: theme.spacing(1),
    marginRight: theme.spacing(1),
    marginBottom: theme.spacing(0.25),
    borderRadius: theme.spacing(1),
    position: "relative",
    display: "flex",
    alignItems: "center",
    width: "auto",
    ...(touch ? { minHeight: TOUCH_TARGETS.MINIMUM } : {}),
    transition: "all 0.15s ease-in-out",
    backgroundColor: "transparent",
    color: theme.palette.text.secondary,
    "&:hover": {
      backgroundColor: isDark
        ? alpha(theme.palette.common.white, 0.08)
        : alpha(theme.palette.common.black, 0.04),
      color: theme.palette.text.primary,
    },
    "&.Mui-selected": {
      backgroundColor: selectedBg,
      color: theme.palette.primary.main,
      // The desktop sidebar has never had the theme's selected accent border.
      ...(touch ? {} : { borderLeft: "none", boxShadow: "none" }),
    },
    "&.Mui-selected:hover, &.Mui-selected.Mui-focusVisible": {
      backgroundColor: selectedHoverBg,
      color: theme.palette.primary.main,
    },
  };
});

export function ChannelRow({
  channel,
  communityId,
  selected,
  variant,
  onSelect,
}: ChannelRowProps) {
  const navigate = useNavigate();
  const { state: voiceState, actions: voiceActions } = useVoiceConnection();
  const { showNotification } = useNotification();
  const { hasUnread, mentionCount } = useReadReceipts();

  const isText = channel.type === ChannelKind.TEXT;
  const isVoice = channel.type === ChannelKind.VOICE;
  const isUnread = isText && !selected && hasUnread(channel.id);
  const mentions = isText && !selected ? mentionCount(channel.id) : 0;
  const touch = variant === "touch";
  const iconSize = touch ? 20 : 18;

  const handleClick = useCallback(async () => {
    if (onSelect) {
      onSelect(channel);
      return;
    }
    const path = `/community/${communityId}/channel/${channel.id}`;
    if (isText) {
      navigate(path);
      return;
    }
    if (!isVoice) return;
    try {
      if (voiceState.currentChannelId === channel.id && voiceState.isConnected) {
        // Already connected: open the channel's stage and reveal the tiles
        navigate(path);
        voiceActions.revealVideoTiles();
      } else {
        await voiceActions.joinVoiceChannel(
          channel.id,
          channel.name,
          communityId,
          channel.isPrivate || false,
          channel.createdAt,
        );
        navigate(path);
      }
    } catch (error) {
      logger.error("Failed to join voice channel:", error);
      playSound(Sounds.error);
      showNotification("Failed to join voice channel. Please try again.", "error");
    }
  }, [
    onSelect,
    channel,
    communityId,
    isText,
    isVoice,
    navigate,
    voiceState.currentChannelId,
    voiceState.isConnected,
    voiceActions,
    showNotification,
  ]);

  return (
    <Box>
      <RowContainer
        rowVariant={variant}
        selected={selected}
        aria-current={selected ? "page" : undefined}
        data-variant={variant}
        onClick={handleClick}
      >
        {/* Unread pill on the left edge */}
        {isUnread && (
          <Box
            data-testid="unread-indicator"
            sx={{
              position: "absolute",
              left: 0,
              width: 4,
              height: 8,
              borderRadius: "0 4px 4px 0",
              bgcolor: "text.primary",
            }}
          />
        )}
        <ListItemIcon
          sx={{
            minWidth: touch ? 32 : 28,
            color: isUnread ? "text.primary" : "inherit",
          }}
        >
          {isText ? (
            <TagIcon sx={{ fontSize: iconSize }} />
          ) : (
            <VolumeUpIcon sx={{ fontSize: iconSize }} />
          )}
        </ListItemIcon>
        <ListItemText
          primary={channel.name}
          primaryTypographyProps={{ noWrap: true }}
          sx={{
            minWidth: 0,
            my: 0.5,
            "& .MuiListItemText-primary": {
              fontSize: touch ? "0.9375rem" : "0.875rem",
              fontWeight: isUnread ? 700 : selected ? 600 : 500,
              color: isUnread ? "text.primary" : undefined,
            },
          }}
        />
        {channel.isPrivate && (
          <LockIcon
            aria-label="Private channel"
            titleAccess="Private channel"
            sx={{ fontSize: 'icon.sm', ml: 0.5, flexShrink: 0, color: "text.secondary" }}
          />
        )}
        {mentions > 0 && (
          <Badge
            data-testid="mention-badge"
            badgeContent={mentions}
            color="error"
            max={99}
            sx={{
              ml: "auto",
              pl: 1,
              flexShrink: 0,
              "& .MuiBadge-badge": {
                fontSize: touch ? 11 : 10,
                height: touch ? 18 : 16,
                minWidth: touch ? 18 : 16,
                position: "static",
                transform: "none",
              },
            }}
          />
        )}
      </RowContainer>

      {/* Participants nested under voice channels */}
      {isVoice && <VoiceChannelUserList channel={channel} showCompact />}
    </Box>
  );
}

export default ChannelRow;
