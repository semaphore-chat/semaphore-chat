import React from "react";
import { Box, Typography, Avatar, IconButton, styled } from "@mui/material";
import { PhotoCamera } from "@mui/icons-material";
import { useAuthenticatedImage } from "../../hooks/useAuthenticatedImage";

const AvatarSection = styled(Box)(({ theme }) => ({
  display: "flex",
  alignItems: "center",
  gap: theme.spacing(2),
  marginBottom: theme.spacing(3),
}));

const AvatarUpload = styled(Box)(() => ({
  position: "relative",
  display: "inline-block",
}));

const AvatarInput = styled("input")({
  display: "none",
});

interface UserAvatarUploadProps {
  previewUrl: string | null;
  displayName: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

const UserAvatarUpload: React.FC<UserAvatarUploadProps> = React.memo(({
  previewUrl,
  displayName,
  onChange,
}) => {
  // Check if previewUrl is a local blob URL or a file ID
  const isLocalBlob = previewUrl?.startsWith("blob:");

  // Only fetch authenticated image if it's NOT a local blob AND previewUrl exists
  const { blobUrl: authenticatedUrl } = useAuthenticatedImage(
    !isLocalBlob && previewUrl ? previewUrl : null
  );

  // Use local blob for previews, authenticated URL for existing images
  const displayUrl = isLocalBlob ? previewUrl : authenticatedUrl;

  return (
    <AvatarSection>
      <AvatarUpload>
        <Avatar
          src={displayUrl || undefined}
          sx={{
            width: 120,
            height: 120,
            bgcolor: "primary.main",
            fontSize: 'scale.6xl',
            fontWeight: 600,
          }}
        >
          {displayName.slice(0, 2).toUpperCase() || "U"}
        </Avatar>
        <AvatarInput
          accept="image/*"
          id="avatar-upload"
          type="file"
          onChange={onChange}
        />
        <label htmlFor="avatar-upload">
          <IconButton
            component="span"
            sx={{
              position: "absolute",
              bottom: 0,
              right: 0,
              backgroundColor: "background.paper",
              border: "2px solid",
              borderColor: "divider",
              "&:hover": {
                backgroundColor: "grey.100",
              },
            }}
          >
            <PhotoCamera />
          </IconButton>
        </label>
      </AvatarUpload>
      <Typography variant="body2" color="text.secondary">
        Upload a profile picture
      </Typography>
    </AvatarSection>
  );
});

UserAvatarUpload.displayName = "UserAvatarUpload";

export default UserAvatarUpload;
