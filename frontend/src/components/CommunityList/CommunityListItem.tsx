import React from "react";
import Box from "@mui/material/Box";
import Avatar from "@mui/material/Avatar";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { Community } from "../../types/community.type";
import { Button } from "@mui/material";
import { useTheme, alpha } from "@mui/material/styles";
import { useNavigate } from "react-router-dom";
import { useAuthenticatedImage } from "../../hooks/useAuthenticatedImage";
import { stringToColor, getCommunityInitials } from "../../utils/communityHelpers";

interface CommunityListItemProps {
  community: Community;
  isExpanded: boolean;
  selected?: boolean;
}

const CommunityListItem: React.FC<CommunityListItemProps> = ({
  community,
  isExpanded,
  selected = false,
}) => {
  const theme = useTheme();
  const navigate = useNavigate();
  const { blobUrl: avatarUrl } = useAuthenticatedImage(community.avatar);
  const { blobUrl: bannerUrl } = useAuthenticatedImage(community.banner);

  const navigateToCommunity = (communityId: string) => {
    // use react router to go to community/:communityId
    navigate(`/community/${communityId}`);
  };

  const content = (
    <Button
      onClick={() => navigateToCommunity(community.id)}
      variant="text"
      sx={{ width: "90%", padding: 0 }}
    >
      <Box
        sx={{
          position: "relative",
          width: "100%",
          display: "flex",
          alignItems: "center",
          borderRadius: 2,
          overflow: "hidden",
          padding: "8px",
          transition: "background 0.2s, box-shadow 0.2s",
          background: selected ? alpha(theme.palette.primary.main, 0.12) : undefined,
          boxShadow: selected ? `0 0 0 2px ${theme.palette.primary.main}` : undefined,
        }}
      >
        <Avatar
          sx={{
            width: 48,
            height: 48,
            ...(!community.avatar && {
              bgcolor: stringToColor(community.id).bg,
              color: stringToColor(community.id).text,
            }),
            fontWeight: 700,
            fontSize: 'scale.3xl',
            ml: isExpanded ? 0 : "auto",
            mr: isExpanded ? 2 : "auto",
            zIndex: 1,
            transition: "box-shadow 0.2s",
          }}
          src={avatarUrl || undefined}
          alt={community.name}
        >
          {getCommunityInitials(community.name)}
        </Avatar>
        {isExpanded && (
          <Box
            sx={{
              flex: 1,
              minWidth: 0,
              zIndex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "start",
              textTransform: "none",
            }}
          >
            <Typography
              variant="subtitle1"
              noWrap
              sx={{
                fontSize: 'scale.base',
                fontWeight: 600,
                color: "text.primary",
                alignItems: "left",
              }}
            >
              {community.name}
            </Typography>
            {community.description && (
              <Typography
                variant="body2"
                noWrap
                sx={{ opacity: 0.8, fontSize: 'scale.sm', color: "text.secondary" }}
              >
                {community.description}
              </Typography>
            )}
          </Box>
        )}
        {bannerUrl && isExpanded && (
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              zIndex: 0,
              background: `url(${bannerUrl})`,
              backgroundSize: "cover",
              backgroundRepeat: "no-repeat",
              filter: "blur(2px)",
            }}
          />
        )}
      </Box>
    </Button>
  );
  return isExpanded ? (
    content
  ) : (
    <Tooltip title={community.name} placement="right" arrow>
      {content}
    </Tooltip>
  );
};

export default CommunityListItem;
