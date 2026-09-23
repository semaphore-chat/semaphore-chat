/**
 * MessageInputStyles
 *
 * Shared styled components for MessageInput components.
 * Provides consistent styling across channel and DM message inputs.
 */

import { Paper, TextField } from "@mui/material";
import { styled } from "@mui/material/styles";

export const StyledPaper = styled(Paper)(({ theme }) => ({
  padding: theme.spacing(2),
  display: "flex",
  alignItems: "flex-end",
  gap: theme.spacing(1),
  background: theme.palette.background.paper,
}));

export const StyledTextField = styled(TextField)(({ theme }) => ({
  "& .MuiOutlinedInput-notchedOutline": {
    borderColor: theme.palette.divider,
  },
  "& .MuiInputBase-root.Mui-focused .MuiOutlinedInput-notchedOutline": {
    borderColor: theme.palette.primary.main,
  },
}));

/**
 * Stands in for the composer when the user can't post (no permission,
 * timed out, banned). Same padding as StyledPaper so the chat doesn't jump
 * when the state changes; the inner row matches the small text field height.
 */
export const StyledNoticePaper = styled(Paper)(({ theme }) => ({
  padding: theme.spacing(2),
  display: "flex",
  alignItems: "center",
  gap: theme.spacing(1.5),
  minHeight: 40,
  boxSizing: "content-box",
  background: theme.palette.background.paper,
  color: theme.palette.text.secondary,
}));
