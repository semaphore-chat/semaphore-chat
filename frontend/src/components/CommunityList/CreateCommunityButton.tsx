import React from "react";
import Box from "@mui/material/Box";
import Avatar from "@mui/material/Avatar";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { Button } from "@mui/material";
import { useTheme, alpha } from "@mui/material/styles";
import AddIcon from "@mui/icons-material/Add";

interface CreateCommunityButtonProps {
  isExpanded: boolean;
  onClick: () => void;
}

const CreateCommunityButton: React.FC<CreateCommunityButtonProps> = ({
  isExpanded,
  onClick,
}) => {
  const theme = useTheme();

  const content = (
    <Button onClick={onClick} variant="text" sx={{ width: "90%", padding: 0 }}>
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
          background: alpha(theme.palette.text.secondary, 0.12),
          border: `2px dashed ${alpha(theme.palette.text.secondary, 0.3)}`,
          "&:hover": {
            background: alpha(theme.palette.text.secondary, 0.2),
            border: `2px dashed ${alpha(theme.palette.text.secondary, 0.5)}`,
          },
        }}
      >
        <Avatar
          sx={{
            width: 48,
            height: 48,
            bgcolor: "action.hover",
            ml: isExpanded ? 0 : "auto",
            mr: isExpanded ? 2 : "auto",
            zIndex: 1,
            transition: "box-shadow 0.2s",
          }}
        >
          <AddIcon sx={{ color: "text.primary", fontSize: 'icon.2xl' }} />
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
                color: "text.secondary",
                alignItems: "left",
              }}
            >
              Create Community
            </Typography>
            <Typography
              variant="body2"
              noWrap
              sx={{
                opacity: 0.6,
                fontSize: 'scale.sm',
                color: "text.secondary",
                fontStyle: "italic",
              }}
            >
              Start your own community
            </Typography>
          </Box>
        )}
      </Box>
    </Button>
  );

  return isExpanded ? (
    content
  ) : (
    <Tooltip title="Create Community" placement="right" arrow>
      {content}
    </Tooltip>
  );
};

export default CreateCommunityButton;
