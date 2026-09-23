import React, { useState } from "react";
import { Box, Card, Typography, styled } from "@mui/material";
import LinkIcon from "@mui/icons-material/Link";
import type { LinkPreview } from "../../types/message.type";

const PreviewCard = styled(Card)(({ theme }) => ({
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  borderRadius: theme.spacing(1),
  backgroundColor:
    theme.palette.mode === "dark"
      ? "rgba(0, 0, 0, 0.2)"
      : theme.palette.grey[50],
  borderLeft: `3px solid ${theme.palette.primary.main}`,
  border: `1px solid ${theme.palette.divider}`,
  borderLeftWidth: 3,
  borderLeftColor: theme.palette.primary.main,
  maxWidth: 420,
  cursor: "pointer",
  transition: "background-color 0.2s",
  "&:hover": {
    backgroundColor:
      theme.palette.mode === "dark"
        ? "rgba(0, 0, 0, 0.35)"
        : theme.palette.grey[100],
  },
}));

const BannerImage = styled("img")({
  width: "100%",
  maxHeight: 250,
  objectFit: "cover",
  display: "block",
});

const Favicon = styled("img")({
  width: 16,
  height: 16,
  marginRight: 6,
  flexShrink: 0,
  borderRadius: 2,
});

const FallbackDot = styled(Box)(({ theme }) => ({
  width: 16,
  height: 16,
  marginRight: 6,
  flexShrink: 0,
  borderRadius: 2,
  backgroundColor: theme.palette.action.disabled,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
}));

interface LinkPreviewCardProps {
  preview: LinkPreview;
}

export const LinkPreviewCard: React.FC<LinkPreviewCardProps> = React.memo(
  ({ preview }) => {
    const [imageError, setImageError] = useState(false);

    const handleClick = () => {
      window.open(preview.url, "_blank", "noopener,noreferrer");
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleClick();
      }
    };

    let hostname = "";
    try {
      hostname = new URL(preview.url).hostname;
    } catch {
      hostname = preview.url;
    }

    const showBannerImage = preview.imageUrl && !imageError;

    return (
      <PreviewCard
        elevation={0}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        role="link"
        tabIndex={0}
        aria-label={preview.title || preview.url}
      >
        <Box sx={{ p: 1.25, pb: showBannerImage ? 0.75 : 1.25 }}>
          {/* Site name + favicon */}
          <Box sx={{ display: "flex", alignItems: "center", mb: 0.5 }}>
            {preview.faviconUrl ? (
              <Favicon
                src={preview.faviconUrl}
                alt=""
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <FallbackDot>
                <LinkIcon sx={{ fontSize: 'icon.2xs' }} />
              </FallbackDot>
            )}
            <Typography variant="caption" color="text.secondary" noWrap>
              {preview.siteName || hostname}
              {preview.authorName && ` · ${preview.authorName}`}
            </Typography>
          </Box>

          {/* Title */}
          {preview.title && (
            <Typography
              variant="body2"
              fontWeight={600}
              color="primary"
              sx={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                lineHeight: 1.3,
                mb: preview.description ? 0.25 : 0,
              }}
            >
              {preview.title}
            </Typography>
          )}

          {/* Description */}
          {preview.description && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                lineHeight: 1.4,
              }}
            >
              {preview.description}
            </Typography>
          )}
        </Box>

        {/* Banner image below text — like Discord */}
        {showBannerImage && (
          <Box sx={{ px: 1.25, pb: 1.25 }}>
            <BannerImage
              src={preview.imageUrl}
              alt={preview.title || ""}
              onError={() => setImageError(true)}
              sx={{ borderRadius: 0.75 }}
            />
          </Box>
        )}
      </PreviewCard>
    );
  }
);

LinkPreviewCard.displayName = "LinkPreviewCard";
