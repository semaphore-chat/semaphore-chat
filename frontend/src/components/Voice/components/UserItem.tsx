import React from "react";
import {
  Box,
  Typography,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Divider,
} from "@mui/material";
import {
  Mic,
  MicOff,
  Videocam,
  ScreenShare,
  VolumeOff,
} from "@mui/icons-material";
import type { VoicePresenceUserDto } from "../../../api-client/types.gen";
import { useParticipantTracks } from "../../../hooks/useParticipantTracks";
import UserAvatar from "../../Common/UserAvatar";
import { formatDistanceToNow } from "date-fns";
import { deriveUserState } from "./voiceUserState";
import { useResponsive } from "../../../hooks/useResponsive";
import { useLongPress } from "../../../hooks/useSwipeGesture";

interface UserItemProps {
  user: VoicePresenceUserDto;
  index: number;
  totalCount: number;
  showInline: boolean;
  onContextMenu: (event: React.MouseEvent<HTMLElement>, user: VoicePresenceUserDto) => void;
  onClickUser: (userId: string) => void;
}

const UserItem: React.FC<UserItemProps> = React.memo(({
  user,
  index,
  totalCount,
  showInline,
  onContextMenu,
  onClickUser,
}) => {
  const livekitState = useParticipantTracks(user.id);
  const userState = deriveUserState(livekitState, user);
  const { shouldUseTouchUI } = useResponsive();

  const longPress = useLongPress(
    (point) => {
      if (point) {
        onContextMenu(
          { preventDefault: () => {}, clientX: point.x, clientY: point.y } as React.MouseEvent<HTMLElement>,
          user,
        );
      }
    },
    { enabled: shouldUseTouchUI },
  );

  const interactionProps = shouldUseTouchUI
    ? {
        onTouchStart: longPress.onTouchStart,
        onTouchMove: longPress.onTouchMove,
        onTouchEnd: longPress.onTouchEnd,
        onTouchCancel: longPress.onTouchCancel,
        onContextMenu: longPress.onContextMenu,
      }
    : { onContextMenu: (e: React.MouseEvent<HTMLElement>) => onContextMenu(e, user) };

  const statusIcons = [];

  if (userState.isMuted) statusIcons.push(<MicOff key="muted" fontSize="small" />);
  else statusIcons.push(<Mic key="mic" fontSize="small" />);

  if (userState.isDeafened)
    statusIcons.push(<VolumeOff key="deafened" fontSize="small" />);
  if (userState.isVideoEnabled)
    statusIcons.push(<Videocam key="video" fontSize="small" />);
  if (userState.isScreenSharing)
    statusIcons.push(<ScreenShare key="screen" fontSize="small" />);

  const joinedAgo = formatDistanceToNow(new Date(user.joinedAt), {
    addSuffix: true,
  });

  return (
    <React.Fragment key={user.id}>
      <ListItem
        // Not in tab order (-1) — only focused programmatically, to restore
        // focus here after the right-click/long-press context menu closes.
        tabIndex={-1}
        sx={{
          px: showInline ? 1 : 2,
          py: 1,
          cursor: "pointer",
         ...(shouldUseTouchUI && {
           WebkitTouchCallout: "none",
           userSelect: "none",
         }),
          "&:hover": {
            backgroundColor: "action.hover",
          },
        }}
        onClick={() => {
          // Ignore the post-long-press ghost click (iOS) so the profile
          // doesn't open on top of the moderation menu.
          if (longPress.isLongPressTriggered()) return;
          onClickUser(user.id);
        }}
        {...interactionProps}
      >
        <ListItemAvatar>
          <UserAvatar userId={user.id} size="small" />
        </ListItemAvatar>

        <ListItemText
          primary={
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
              <Typography variant="body2" fontWeight="medium" noWrap sx={{ minWidth: 0 }}>
                {user.displayName || user.username}
              </Typography>
              <Box
                sx={{ display: "flex", gap: 0.5, color: "text.secondary" }}
              >
                {statusIcons.map((icon, i) => (
                  <Box key={i} sx={{ display: "flex", alignItems: "center" }}>
                    {icon}
                  </Box>
                ))}
              </Box>
            </Box>
          }
          secondary={
            !showInline && (
              <Typography variant="caption" color="text.secondary">
                Joined {joinedAgo}
              </Typography>
            )
          }
        />
      </ListItem>
      {index < totalCount - 1 && <Divider />}
    </React.Fragment>
  );
});

export default UserItem;
