/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from "react";
import { useVoiceConnection } from "../hooks/useVoiceConnection";

const AUTO_DISMISS_MS = 30_000;

export interface IncomingCall {
  dmGroupId: string;
  dmGroupName: string;
  callerName: string;
  callerAvatar: string | null;
  startedAt: number;
}

interface IncomingCallContextValue {
  incomingCall: IncomingCall | null;
  showIncomingCall: (call: IncomingCall) => void;
  dismissCall: () => void;
}

const IncomingCallContext = createContext<IncomingCallContextValue | undefined>(undefined);

export const useIncomingCall = (): IncomingCallContextValue => {
  const context = useContext(IncomingCallContext);
  if (!context) {
    throw new Error("useIncomingCall must be used within an IncomingCallProvider");
  }
  return context;
};

interface IncomingCallProviderProps {
  children: React.ReactNode;
}

export const IncomingCallProvider: React.FC<IncomingCallProviderProps> = ({ children }) => {
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { state: voiceState } = useVoiceConnection();

  const clearTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const dismissCall = useCallback(() => {
    clearTimer();
    setIncomingCall(null);
  }, [clearTimer]);

  const showIncomingCall = useCallback(
    (call: IncomingCall) => {
      clearTimer();
      setIncomingCall(call);

      timeoutRef.current = setTimeout(() => {
        setIncomingCall(null);
      }, AUTO_DISMISS_MS);
    },
    [clearTimer],
  );

  // Clear if user joins the DM voice call that is ringing
  useEffect(() => {
    if (
      incomingCall &&
      voiceState.isConnected &&
      voiceState.contextType === "dm" &&
      voiceState.currentDmGroupId === incomingCall.dmGroupId
    ) {
      dismissCall();
    }
  }, [
    incomingCall,
    voiceState.isConnected,
    voiceState.contextType,
    voiceState.currentDmGroupId,
    dismissCall,
  ]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, [clearTimer]);

  return (
    <IncomingCallContext.Provider value={{ incomingCall, showIncomingCall, dismissCall }}>
      {children}
    </IncomingCallContext.Provider>
  );
};
