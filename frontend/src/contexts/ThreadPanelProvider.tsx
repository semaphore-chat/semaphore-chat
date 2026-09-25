import React, { useState, useCallback } from "react";
import { ThreadPanelContext } from "./ThreadPanelContext";

export const ThreadPanelProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);

  const openThread = useCallback((id: string) => {
    setOpenThreadId(id);
  }, []);

  const closeThread = useCallback(() => {
    setOpenThreadId(null);
  }, []);

  return (
    <ThreadPanelContext.Provider value={{ openThreadId, openThread, closeThread }}>
      {children}
    </ThreadPanelContext.Provider>
  );
};
