import React from "react";
import { Avatar, Badge, Box, Button, Tooltip, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";

interface RailNavButtonProps {
  /** Visible label in the expanded rail; tooltip and accessible name when collapsed. */
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  isExpanded: boolean;
  /** Count shown on the avatar (0 hides it). */
  badgeContent?: number;
  /** Overrides the accessible name (e.g. to include the unread count). */
  ariaLabel?: string;
  /** Styles for the round icon avatar (background, icon colour). */
  avatarSx?: SxProps<Theme>;
}

/**
 * A round icon button in the desktop community rail (Direct Messages, the
 * notification inbox): a 48px avatar with a tooltip when the rail is
 * collapsed, a 32px avatar plus a label when it's expanded.
 */
export const RailNavButton: React.FC<RailNavButtonProps> = ({
  label,
  icon,
  onClick,
  isExpanded,
  badgeContent = 0,
  ariaLabel,
  avatarSx,
}) => {
  const size = isExpanded ? 32 : 48;
  const button = (
    <Button
      onClick={onClick}
      variant="text"
      aria-label={ariaLabel ?? label}
      sx={{
        width: "100%",
        minWidth: 0,
        p: isExpanded ? 0.5 : 0,
        justifyContent: isExpanded ? "flex-start" : "center",
        textTransform: "none",
        borderRadius: 2,
        "&:hover": { backgroundColor: "action.hover" },
      }}
    >
      <Badge badgeContent={badgeContent} color="error" max={99} overlap="circular">
        <Avatar
          sx={[
            { width: size, height: size, bgcolor: "primary.main", transition: "width 0.2s, height 0.2s" },
            ...(Array.isArray(avatarSx) ? avatarSx : [avatarSx]),
          ]}
        >
          {icon}
        </Avatar>
      </Badge>
      {isExpanded && (
        <Box sx={{ ml: 1, minWidth: 0, flex: 1, textAlign: "start" }}>
          <Typography variant="listItem" component="div" noWrap sx={{ color: "text.primary" }}>
            {label}
          </Typography>
        </Box>
      )}
    </Button>
  );

  return isExpanded ? (
    button
  ) : (
    <Tooltip title={label} placement="right" arrow>
      {button}
    </Tooltip>
  );
};

export default RailNavButton;
