/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useCallback, useLayoutEffect, useRef } from "react";
import { Snackbar, Alert, AlertColor } from "@mui/material";
import { logger } from "../utils/logger";
import { publishNotice } from "./noticeChannel";
import { useShownShellKind } from "../shell/shownShellKind";

interface NotificationContextType {
  showNotification: (message: string, severity?: AlertColor) => void;
}

export const NotificationContext = createContext<NotificationContextType | undefined>(
  undefined
);

export const useNotification = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error(
      "useNotification must be used within a NotificationProvider"
    );
  }
  return context;
};

/**
 * The notification API, or undefined outside a NotificationProvider (call
 * effects that also run in isolated tests). Warns in development, so a frame
 * mounted outside the provider does not lose its notices quietly.
 */
export const useOptionalNotification = () => {
  const context = useContext(NotificationContext);
  if (!context && import.meta.env.DEV && import.meta.env.MODE !== "test") {
    logger.warn("[Notification] used outside a NotificationProvider: notices are dropped");
  }
  return context;
};

interface NotificationProviderProps {
  children: React.ReactNode;
}

export const NotificationProvider: React.FC<NotificationProviderProps> = ({
  children,
}) => {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [severity, setSeverity] = useState<AlertColor>("info");
  // One notice at a time, the latest wins (contexts/noticeChannel.ts). While the new design's shell is
  // shown it presents the notice as a kit toast and this snackbar renders nothing; the notice stays open
  // here until a presenter has shown it for its time, so a flip either way hands it over, never drops it.
  const lounge = useShownShellKind() === "lounge";
  const [key, setKey] = useState(0);
  const keyRef = useRef(0);
  const [announced, setAnnounced] = useState<number | null>(null);

  useLayoutEffect(() => {
    publishNotice(open ? { key, message, severity, announced: announced === key } : null, {
      dismiss: (k) => {
        if (k === keyRef.current) setOpen(false);
      },
      markAnnounced: (k) => setAnnounced(k),
    });
  }, [open, key, message, severity, announced]);
  useLayoutEffect(() => () => publishNotice(null, null), []);

  const showNotification = useCallback(
    (msg: string, sev: AlertColor = "info") => {
      keyRef.current += 1;
      setKey(keyRef.current);
      setMessage(msg);
      setSeverity(sev);
      setOpen(true);
    },
    []
  );

  const handleClose = (
    _event?: React.SyntheticEvent | Event,
    reason?: string
  ) => {
    if (reason === "clickaway") {
      return;
    }
    setOpen(false);
  };

  return (
    <NotificationContext.Provider value={{ showNotification }}>
      {children}
      {!lounge && (
        <Snackbar
          open={open}
          autoHideDuration={3000}
          onClose={handleClose}
          anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        >
          <Alert
            onClose={handleClose}
            severity={severity}
            sx={{ width: "100%" }}
            // Handed over from the new shell's toast, which read it out already: show it, do not speak it again.
            {...(announced === key ? { role: "status", "aria-live": "off" as const } : {})}
          >
            {message}
          </Alert>
        </Snackbar>
      )}
    </NotificationContext.Provider>
  );
};
