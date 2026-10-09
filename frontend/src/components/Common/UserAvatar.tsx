import React from "react";
import { Avatar, Skeleton, Box } from "@mui/material";
import { useAuthenticatedImage } from "../../hooks/useAuthenticatedImage";
import UserStatusIndicator from "../Message/UserStatusIndicator";
import { useUserProfile } from "../../contexts/UserProfileContext";
import { useUser } from "../../hooks/useUser";

type AvatarSize = "small" | "medium" | "large" | "xlarge" | "fluid";

const sizeMap: Record<Exclude<AvatarSize, "fluid">, number> = {
  small: 32,
  medium: 40,
  large: 48,
  xlarge: 120,
};

interface UserAvatarProps {
  userId?: string;
  /** Fallback display name for initials while user data loads */
  displayName?: string | null;
  size?: AvatarSize;
  showStatus?: boolean;
  isOnline?: boolean;
  clickable?: boolean;
  /**
   * Background for the initial when there's no image. Voice tiles only
   * (see utils/voiceTileColor.ts); everywhere else keeps MUI's default.
   */
  fallbackColor?: string;
}

const UserAvatar: React.FC<UserAvatarProps> = ({
  userId,
  displayName,
  size = "medium",
  showStatus = false,
  isOnline = false,
  clickable = false,
  fallbackColor,
}) => {
  // "fluid" fills the parent container instead of using a fixed pixel size
  const avatarSize = size === "fluid" ? "100%" : sizeMap[size];
  const { data: user } = useUser(userId);
  const { blobUrl, isLoading } = useAuthenticatedImage(user?.avatarUrl);
  const { openProfile } = useUserProfile();

  const getInitials = () => {
    const name = user?.displayName || user?.username || displayName;
    if (!name) return "?";
    return name.charAt(0).toUpperCase();
  };

  const handleClick = () => {
    if (clickable && userId) {
      openProfile(userId);
    }
  };

  if (isLoading) {
    return (
      <Skeleton
        variant="circular"
        width={avatarSize}
        height={avatarSize}
      />
    );
  }

  const avatar = (
    <Avatar
      src={blobUrl || undefined}
      sx={{
        width: avatarSize,
        height: avatarSize,
        ...(fallbackColor && !blobUrl && { bgcolor: fallbackColor, color: "common.white" }),
        cursor: clickable && userId ? "pointer" : "default",
        transition: "opacity 0.2s",
        "&:hover": clickable && userId ? { opacity: 0.8 } : {},
      }}
      onClick={handleClick}
    >
      {getInitials()}
    </Avatar>
  );

  if (showStatus) {
    return (
      <Box sx={{ position: "relative", display: "inline-block" }}>
        {avatar}
        <UserStatusIndicator isOnline={isOnline} />
      </Box>
    );
  }

  return avatar;
};

export default React.memo(UserAvatar);
