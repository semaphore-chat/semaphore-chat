import React from "react";
import { Box, Typography, styled } from "@mui/material";
import { Upload } from "@mui/icons-material";
import { useAuthenticatedImage } from "../../hooks/useAuthenticatedImage";

const BannerSection = styled(Box)(({ theme }) => ({
  position: "relative",
  height: 200,
  borderRadius: theme.spacing(1),
  marginBottom: theme.spacing(3),
  border: `2px dashed ${theme.palette.divider}`,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  overflow: "hidden",
  backgroundColor: theme.palette.background.default,
  cursor: "pointer",
  "&:hover": {
    backgroundColor: theme.palette.action.hover,
  },
}));

const BannerPreview = styled("img")({
  width: "100%",
  height: "100%",
  objectFit: "cover",
});

const BannerInput = styled("input")({
  display: "none",
});

interface UserBannerUploadProps {
  previewUrl: string | null;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

const UserBannerUpload: React.FC<UserBannerUploadProps> = React.memo(({
  previewUrl,
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
    <BannerSection>
      <BannerInput
        accept="image/*"
        id="banner-upload"
        type="file"
        onChange={onChange}
      />
      <label
        htmlFor="banner-upload"
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {displayUrl ? (
          <BannerPreview src={displayUrl} alt="Banner preview" />
        ) : (
          <Box
            display="flex"
            flexDirection="column"
            alignItems="center"
            gap={1}
          >
            <Upload sx={{ fontSize: 'icon.5xl', color: "text.secondary" }} />
            <Typography variant="body2" color="text.secondary">
              Click to upload banner image
            </Typography>
            <Typography variant="caption" color="text.disabled">
              Recommended: 600x200px
            </Typography>
          </Box>
        )}
      </label>
    </BannerSection>
  );
});

UserBannerUpload.displayName = "UserBannerUpload";

export default UserBannerUpload;
