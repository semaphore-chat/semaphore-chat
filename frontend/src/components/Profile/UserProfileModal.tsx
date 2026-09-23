/**
 * UserProfileModal Component
 *
 * Modal dialog for viewing user profiles.
 * Shows avatar, banner, display name, username, status, and bio.
 */

import React from "react";
import {
  Dialog,
  DialogContent,
  Box,
  Avatar,
  Typography,
  Chip,
  IconButton,
  Button,
  Skeleton,
  styled,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ChatIcon from "@mui/icons-material/Chat";
import PersonIcon from "@mui/icons-material/Person";
import { useNavigate } from "react-router-dom";
import { navigateAfterOverlays } from "../../hooks/useOverlayHistory";
import { useQuery, useMutation } from "@tanstack/react-query";
import { userControllerGetUserByIdOptions, directMessagesControllerCreateDmGroupMutation } from "../../api-client/@tanstack/react-query.gen";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { useAuthenticatedImage } from "../../hooks/useAuthenticatedImage";
import { logger } from "../../utils/logger";

const BannerContainer = styled(Box)(({ theme }) => ({
  position: "relative",
  height: 120,
  width: "100%",
  backgroundColor: theme.palette.primary.dark,
  overflow: "hidden",
}));

const BannerImage = styled("img")({
  width: "100%",
  height: "100%",
  objectFit: "cover",
});

const ProfileContent = styled(Box)(({ theme }) => ({
  padding: theme.spacing(2),
  paddingTop: theme.spacing(6),
  position: "relative",
}));

const AvatarContainer = styled(Box)(() => ({
  position: "absolute",
  top: -40,
  left: 16,
  zIndex: 1,
}));

const CloseButton = styled(IconButton)(({ theme }) => ({
  position: "absolute",
  top: theme.spacing(1),
  right: theme.spacing(1),
  backgroundColor: "rgba(0, 0, 0, 0.5)",
  color: "white",
  "&:hover": {
    backgroundColor: "rgba(0, 0, 0, 0.7)",
  },
}));

interface UserProfileModalProps {
  userId: string | null;
  open: boolean;
  onClose: () => void;
}

export const UserProfileModal: React.FC<UserProfileModalProps> = ({
  userId,
  open,
  onClose,
}) => {
  const navigate = useNavigate();
  const { user: currentUser } = useCurrentUser();
  const { data: user, isLoading } = useQuery({
    ...userControllerGetUserByIdOptions({ path: { id: userId! } }),
    enabled: !!userId && open,
  });

  const { blobUrl: bannerUrl } = useAuthenticatedImage(user?.bannerUrl || null);
  const { blobUrl: avatarUrl } = useAuthenticatedImage(user?.avatarUrl || null);

  const { mutateAsync: createDmGroup } = useMutation(directMessagesControllerCreateDmGroupMutation());

  const isOwnProfile = currentUser?.id === userId;

  const handleViewFullProfile = () => {
    onClose();
    // Opened from a drawer/sheet (e.g. the phone member list): drop those
    // overlays' history entries before pushing the new route.
    navigateAfterOverlays(() => navigate(`/profile/${userId}`));
  };

  const handleSendMessage = async () => {
    if (!userId) return;
    try {
      const result = await createDmGroup({
        body: { userIds: [userId], isGroup: false },
      });
      onClose();
      navigateAfterOverlays(() => navigate(`/direct-messages/${result.id}`));
    } catch (err) {
      logger.error("Failed to create DM:", err);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      PaperProps={{
        sx: { borderRadius: 2, overflow: "visible" },
      }}
    >
      <BannerContainer sx={{ borderRadius: "8px 8px 0 0", overflow: "hidden" }}>
        {bannerUrl && <BannerImage src={bannerUrl} alt="Profile banner" />}
        <CloseButton size="small" onClick={onClose}>
          <CloseIcon fontSize="small" />
        </CloseButton>
      </BannerContainer>

      <DialogContent sx={{ p: 0, overflow: "visible" }}>
        <ProfileContent>
          <AvatarContainer>
            {isLoading ? (
              <Skeleton variant="circular" width={80} height={80} />
            ) : (
              <Avatar
                src={avatarUrl || undefined}
                sx={{
                  width: 80,
                  height: 80,
                  border: "4px solid",
                  borderColor: "background.paper",
                  bgcolor: "primary.main",
                  fontSize: 'scale.4xl',
                  fontWeight: 600,
                }}
              >
                {(user?.displayName || user?.username || "?")
                  .slice(0, 2)
                  .toUpperCase()}
              </Avatar>
            )}
          </AvatarContainer>

          {isLoading ? (
            <Box>
              <Skeleton width="60%" height={32} />
              <Skeleton width="40%" height={24} />
            </Box>
          ) : user ? (
            <Box>
              <Typography variant="h6" fontWeight={600}>
                {user.displayName || user.username}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                @{user.username}
              </Typography>

              {user.status && (
                <Chip
                  label={user.status}
                  size="small"
                  sx={{ mt: 1 }}
                />
              )}

              {user.bio && (
                <Box mt={2}>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    fontWeight={600}
                    sx={{ textTransform: "uppercase" }}
                  >
                    About Me
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{
                      mt: 0.5,
                      whiteSpace: "pre-wrap",
                      maxHeight: 100,
                      overflow: "auto",
                    }}
                  >
                    {user.bio}
                  </Typography>
                </Box>
              )}

              <Box mt={2} display="flex" gap={1}>
                {!isOwnProfile && (
                  <Button
                    variant="contained"
                    size="small"
                    startIcon={<ChatIcon />}
                    onClick={handleSendMessage}
                    fullWidth
                  >
                    Message
                  </Button>
                )}
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<PersonIcon />}
                  onClick={handleViewFullProfile}
                  fullWidth
                >
                  View Profile
                </Button>
              </Box>
            </Box>
          ) : (
            <Typography color="error">User not found</Typography>
          )}
        </ProfileContent>
      </DialogContent>
    </Dialog>
  );
};

export default UserProfileModal;
