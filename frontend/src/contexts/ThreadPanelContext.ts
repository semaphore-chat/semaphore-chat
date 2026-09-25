import { createContext, useContext } from "react";

// The provider component lives in ThreadPanelProvider.tsx so each module only
// exports components or non-components (React Fast Refresh).

export interface ThreadPanelState {
  openThreadId: string | null;
  openThread: (id: string) => void;
  closeThread: () => void;
}

export const ThreadPanelContext = createContext<ThreadPanelState | null>(null);

export function useThreadPanel(): ThreadPanelState {
  const context = useContext(ThreadPanelContext);
  if (!context) {
    throw new Error("useThreadPanel must be used within a ThreadPanelProvider");
  }
  return context;
}
