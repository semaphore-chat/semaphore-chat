/**
 * DockedSidePanel
 *
 * The non-modal right-hand panel that holds a thread, the pinned list or
 * search results next to the message list on wide desktop windows. Unlike the
 * drawers it replaces, it doesn't dim or lock the channel and doesn't trap
 * focus: it's a labelled `complementary` landmark you can Tab in and out of.
 *
 * - Focus moves into the panel when it opens or its content swaps (unless
 *   the content already focused something inside it, e.g. the search input).
 * - Esc closes it while focus is inside, unless a child already handled the
 *   key (an open menu or autocomplete calls preventDefault/stopPropagation).
 * - Returning focus to the trigger is the owner's job (it knows the trigger).
 */
import React, { useEffect, useRef } from "react";
import { Box } from "@mui/material";
import { SIDE_PANEL_WIDTH } from "../../constants/layout";

export type DockedPanelKind = "thread" | "pins" | "search";

export const DOCKED_PANEL_ATTR = "data-docked-side-panel";

interface DockedSidePanelProps {
  /** Accessible name of the landmark, e.g. "Thread". */
  label: string;
  /** Which content is shown; a change counts as opening a new panel. */
  kind: DockedPanelKind;
  onClose: () => void;
  children: React.ReactNode;
}

export const DockedSidePanel: React.FC<DockedSidePanelProps> = ({ label, kind, onClose, children }) => {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el && !el.contains(document.activeElement)) {
      el.focus({ preventScroll: true });
    }
  }, [kind]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    onClose();
  };

  return (
    <Box
      component="aside"
      ref={ref}
      aria-label={label}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      {...{ [DOCKED_PANEL_ATTR]: kind }}
      data-testid="docked-side-panel"
      sx={{
        width: SIDE_PANEL_WIDTH,
        flexShrink: 0,
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        borderLeft: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
        outline: "none",
      }}
    >
      {children}
    </Box>
  );
};

export default DockedSidePanel;
