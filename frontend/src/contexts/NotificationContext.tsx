/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { Snackbar, Alert, AlertColor } from "@mui/material";
import { logger } from "../utils/logger";
import { currentNotificationSink } from "./notificationSink";
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
  // While the new design's shell is shown its sink takes notifications (kit toasts) and this
  // old-look snackbar renders nothing; it is closed then, so it never comes back with a stale message.
  const lounge = useShownShellKind() === "lounge";
  useEffect(() => {
    if (lounge) setOpen(false);
  }, [lounge]);

  const showNotification = useCallback(
    (msg: string, sev: AlertColor = "info") => {
      const sink = currentNotificationSink();
      if (sink) {
        sink(msg, sev);
        return;
      }
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
          <Alert onClose={handleClose} severity={severity} sx={{ width: "100%" }}>
            {message}
          </Alert>
        </Snackbar>
      )}
    </NotificationContext.Provider>
  );
};
