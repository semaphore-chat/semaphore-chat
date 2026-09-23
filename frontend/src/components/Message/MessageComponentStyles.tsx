/**
 * MessageComponentStyles
 *
 * Styled components for MessageComponent.
 * Provides container styling with hover effects, delete animations, and mention highlighting.
 */

import { styled, keyframes } from "@mui/material/styles";
import { alpha } from "@mui/material/styles";

// Flash animation for search highlight
const searchHighlightFlash = keyframes`
  0% {
    background-color: transparent;
  }
  15% {
    background-color: rgba(255, 235, 59, 0.4);
  }
  30% {
    background-color: rgba(255, 235, 59, 0.2);
  }
  45% {
    background-color: rgba(255, 235, 59, 0.35);
  }
  60% {
    background-color: rgba(255, 235, 59, 0.15);
  }
  100% {
    background-color: transparent;
  }
`;

export const Container = styled("div", {
  shouldForwardProp: (prop) =>
    prop !== "stagedForDelete" &&
    prop !== "isDeleting" &&
    prop !== "isHighlighted" &&
    prop !== "isSearchHighlight" &&
    prop !== "isPending" &&
    prop !== "isFailed" &&
    prop !== "grouped",
})<{
  stagedForDelete?: boolean;
  isDeleting?: boolean;
  isHighlighted?: boolean;
  isSearchHighlight?: boolean;
  /** Optimistic send in flight — reduced opacity, no layout change (PR-13). */
  isPending?: boolean;
  /** Optimistic send failed — error tint (PR-13). */
  isFailed?: boolean;
  /** Continuation of a same-author run — tighter top spacing, no header. */
  grouped?: boolean;
}>(({ theme, stagedForDelete, isDeleting, isHighlighted, isSearchHighlight, isPending, isFailed, grouped }) => ({
  padding: theme.spacing(0.5, 2),
  display: "flex",
  alignItems: "flex-start",
  width: "100%",
  marginBottom: 0,
  position: "relative",
  backgroundColor: isFailed
    ? alpha(theme.palette.error.main, 0.06)
    : isHighlighted
    ? alpha(theme.palette.primary.main, 0.08)
    : "transparent",
  border: stagedForDelete
    ? `2px solid ${theme.palette.error.main}`
    : isHighlighted
    ? `1px solid ${alpha(theme.palette.primary.main, 0.3)}`
    : "2px solid transparent",
  borderRadius: stagedForDelete || isSearchHighlight ? theme.spacing(1) : 0,
  transition: isDeleting ? "all 0.3s ease-out" : "all 0.2s ease-in-out",
  // Pending/failed opacity is independent of the delete-animation opacity —
  // isDeleting (0) always wins since a row can't be mid-delete-animation
  // while also optimistic. Kept at 1 for the real (settled) state so the
  // pending -> real transition never shifts anything but this one value.
  opacity: isDeleting ? 0 : isPending ? 0.6 : 1,
  transform: isDeleting
    ? "translateY(-10px) scale(0.98)"
    : "translateY(0) scale(1)",
  maxHeight: isDeleting ? 0 : "none",
  overflow: isDeleting ? "hidden" : "visible",
  // A run's first row gets breathing room above it; continuation rows sit
  // tight under the previous one so a run reads as one block.
  paddingTop: isDeleting ? 0 : grouped ? "1px" : theme.spacing(1),
  paddingBottom: isDeleting ? 0 : "1px",
  // Search highlight flash animation
  animation: isSearchHighlight ? `${searchHighlightFlash} 2.5s ease-in-out` : "none",
  "&:hover": {
    backgroundColor: stagedForDelete
      ? theme.palette.error.light
      : isFailed
      ? alpha(theme.palette.error.main, 0.1)
      : isHighlighted
      ? alpha(theme.palette.primary.main, 0.12)
      : theme.palette.action.hover,
    "& .message-tools": {
      opacity: 1,
    },
    "& .message-hover-time": {
      opacity: 1,
    },
  },
  "&:focus-visible .message-hover-time": {
    opacity: 1,
  },
  // On touch devices there is no real hover; a tap can produce a sticky :hover
  // state, so keep the hover toolbar hidden (actions come from the long-press
  // sheet instead).
  "@media (hover: none)": {
    "&:hover .message-tools": {
      opacity: 0,
    },
    // Same for the grouped-row time: on touch it shows only while the
    // long-press actions sheet is open (see MessageComponent).
    "&:hover .message-hover-time:not([data-sheet-open='true'])": {
      opacity: 0,
    },
  },
  // Roving-tabindex focus ring: mirrors the app's other themed
  // `outline: 2px solid` treatment (see TrimTimeline's trim-handle
  // `&:focus` styling) rather than relying on the browser default outline,
  // which is invisible against this Container's own border/background
  // states above. `:focus-visible` (not `:focus`) so a mouse/touch click
  // that also focuses the row (context menu, restoreFocus fallback) doesn't
  // draw the ring — only real keyboard navigation does.
  "&:focus-visible": {
    outline: `2px solid ${theme.palette.primary.main}`,
    outlineOffset: -2,
  },
}));
