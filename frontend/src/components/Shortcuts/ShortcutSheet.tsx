import React from "react";
import { Box, Button, DialogActions, DialogContent, Typography } from "@mui/material";
import { ResponsiveDialog } from "../Common/ResponsiveDialog";
import {
  SHORTCUTS,
  SHORTCUT_GROUPS,
  shortcutKeyLabels,
  shortcutSpokenLabel,
} from "../../utils/shortcuts";
import { isMacPlatform } from "../../utils/platform";

export interface ShortcutSheetProps {
  open: boolean;
  onClose: () => void;
  /** Mac key labels (⌘ ⌥). Defaults to the detected platform. */
  mac?: boolean;
}

/** One key cap. */
export const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Box
    component="kbd"
    sx={{
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      minWidth: 24,
      height: 24,
      px: 0.75,
      borderRadius: 1,
      border: 1,
      borderColor: "divider",
      borderBottomWidth: 2,
      bgcolor: "action.hover",
      color: "text.primary",
      fontFamily: "inherit",
      fontSize: "scale.sm",
      fontWeight: 600,
      lineHeight: 1,
      whiteSpace: "nowrap",
    }}
  >
    {children}
  </Box>
);

/**
 * The keyboard shortcut sheet (Ctrl+/ or ⌘/, or "Keyboard shortcuts" in the
 * account menu): every global shortcut, grouped, read from `SHORTCUTS`.
 */
export const ShortcutSheet: React.FC<ShortcutSheetProps> = ({ open, onClose, mac: macProp }) => {
  const mac = macProp ?? isMacPlatform();

  return (
    <ResponsiveDialog
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      maxWidth="sm"
      fullWidth
    >
      <DialogContent dividers>
        {SHORTCUT_GROUPS.map((group) => {
          const shortcuts = SHORTCUTS.filter((s) => s.group === group);
          return (
            <Box component="section" key={group} aria-labelledby={`shortcut-group-${group}`} sx={{ "&:not(:first-of-type)": { mt: 2.5 } }}>
              <Typography
                id={`shortcut-group-${group}`}
                variant="overline"
                component="h3"
                sx={{ color: "text.secondary", display: "block", mb: 0.5 }}
              >
                {group}
              </Typography>
              <Box component="dl" sx={{ m: 0 }}>
                {shortcuts.map((s) => (
                  <Box
                    key={s.id}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 2,
                      py: 0.75,
                      "&:not(:last-of-type)": { borderBottom: 1, borderColor: "divider" },
                    }}
                  >
                    <Typography component="dt" variant="body2" sx={{ minWidth: 0 }}>
                      {s.description}
                    </Typography>
                    <Box
                      component="dd"
                      aria-label={shortcutSpokenLabel(s.id, mac)}
                      sx={{ m: 0, display: "flex", gap: 0.5, flexShrink: 0 }}
                    >
                      {shortcutKeyLabels(s.id, mac).map((label, i) => (
                        <Kbd key={i}>{label}</Kbd>
                      ))}
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          );
        })}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </ResponsiveDialog>
  );
};

export default ShortcutSheet;
